"""Unit & API wiring tests for Operational Telemetry, SQLite WAL Health, Cache Clear,
Live Progress Diagnostics/Queue Position & Essays/Shared/Sandbox Enrichment (v3.69 Wave 1B).
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient

import integrity_checker.database.local_db as local_db_mod
import integrity_checker.db.session as session_mod
from integrity_checker.api import deps
from integrity_checker.api.main import app
from integrity_checker.api.progress import (
    ProgressState,
    get_tracker,
    load_db_fallback_snapshot,
)
from integrity_checker.api.routes.essays import create_essay_share_token
from integrity_checker.config import get_settings
from integrity_checker.database.local_db import (
    LocalDatabase,
    clear_local_query_cache,
    get_local_papers_tuning_report,
)
from integrity_checker.database.models import Paper
from integrity_checker.db.models import (
    CitationCache,
    CitationRecord,
    ClassMembership,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import (
    Class as ClassModel,
)
from integrity_checker.db.models import (
    Session as SessionModel,
)
from integrity_checker.db.session import get_app_db_tuning_report, get_session
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    CitationVerdict,
    MatchFeatures,
    ValidationLabel,
)
from integrity_checker.retrieval.circuit_breaker import (
    CircuitBreakerRegistry,
    CircuitState,
    reset_circuit_breaker_registry,
)
from integrity_checker.retrieval.html_meta_verifier import HtmlPageMeta
from integrity_checker.retrieval.retrieval_orchestrator import (
    RetrievalOrchestrator,
    get_enabled_upstream_source_names,
)


@pytest.fixture(autouse=True)
def _clean_tables():
    """Keep the isolated in-memory SQLite tables clean around every test."""
    session = get_session()
    try:
        session.query(VerdictRecord).delete()
        session.query(CitationRecord).delete()
        session.query(EssayRecord).delete()
        session.query(CitationCache).delete()
        session.query(ClassMembership).delete()
        session.query(ClassModel).delete()
        session.query(SessionModel).delete()
        session.query(User).delete()
        session.commit()
    finally:
        session.close()
    yield
    session = get_session()
    try:
        session.query(VerdictRecord).delete()
        session.query(CitationRecord).delete()
        session.query(EssayRecord).delete()
        session.query(CitationCache).delete()
        session.query(ClassMembership).delete()
        session.query(ClassModel).delete()
        session.query(SessionModel).delete()
        session.query(User).delete()
        session.commit()
    finally:
        session.close()


def _login_headers(username: str = "admin", password: str = "admin123") -> dict[str, str]:
    client = TestClient(app)
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


class TestCircuitBreakerTelemetryAndSerpApiWiring:
    """Verify Requirement 1: avg_latency_ms, p95_latency_ms, pre-registration & SerpApi CB."""

    def test_registry_starts_empty_and_computes_avg_p95_failure_telemetry(self) -> None:
        now = [1000.0]
        reg = CircuitBreakerRegistry(
            failure_threshold=3,
            recovery_timeout_seconds=30.0,
            now_fn=lambda: now[0],
        )
        assert reg.snapshot_all() == {}

        reg.register_sources(["crossref", "openalex", "", "  "])
        snap0 = reg.snapshot_all()
        assert set(snap0.keys()) == {"crossref", "openalex"}
        assert snap0["crossref"]["state"] == CircuitState.CLOSED.value
        assert snap0["crossref"]["avg_latency_ms"] is None
        assert snap0["crossref"]["p95_latency_ms"] is None
        assert snap0["crossref"]["has_latency_sample"] is False
        assert snap0["crossref"]["failure_count"] == 0
        assert snap0["crossref"]["total_failures"] == 0
        assert snap0["crossref"]["cooldown_remaining_s"] == 0.0
        assert snap0["crossref"]["last_error"] is None
        assert snap0["crossref"]["last_status_code"] is None
        assert snap0["crossref"]["last_failure_at"] is None

        # Record 20 deterministic samples 10, 20, ..., 200 -> 95th percentile index = ceil(0.95*20)-1 = 18 -> 190.0
        for idx in range(1, 21):
            reg.record_success("crossref", latency_ms=float(idx * 10))

        # Re-registering must NOT clobber existing telemetry
        reg.register_sources(["crossref", "arxiv"])
        snap1 = reg.snapshot_all()
        assert snap1["crossref"]["has_latency_sample"] is True
        assert snap1["crossref"]["avg_latency_ms"] == snap1["crossref"]["ema_latency_ms"]
        assert snap1["crossref"]["avg_latency_ms"] is not None
        assert snap1["crossref"]["p95_latency_ms"] == 190.0
        assert snap1["arxiv"]["avg_latency_ms"] is None

        # Infra failure without latency_ms keeps avg_latency_ms None on untouched provider
        now[0] = 1005.0
        reg.record_infra_failure("openalex", "rate limit exceeded on polite pool")
        snap_oa = reg.snapshot_all()["openalex"]
        assert snap_oa["avg_latency_ms"] is None
        assert snap_oa["last_status_code"] == 429
        assert snap_oa["last_failure_at"] == 1005.0
        assert snap_oa["last_error"] == "rate limit exceeded on polite pool"
        assert snap_oa["failure_count"] == 1
        assert snap_oa["total_failures"] == 1

        # Trip openalex OPEN with HTTP 503 + latency sample
        now[0] = 1006.0
        reg.record_infra_failure("openalex", "HTTP 503 Service Unavailable", latency_ms=250.0)
        now[0] = 1007.0
        long_reason = "HTTP 502 Bad Gateway: " + ("x" * 300)
        reg.record_infra_failure("openalex", long_reason, latency_ms=350.0)

        snap_open = reg.snapshot_all()["openalex"]
        assert snap_open["state"] == CircuitState.OPEN.value
        assert snap_open["avg_latency_ms"] is not None
        assert snap_open["p95_latency_ms"] == 350.0
        assert snap_open["failure_count"] == 3
        assert snap_open["total_failures"] == 3
        assert snap_open["cooldown_remaining_s"] == pytest.approx(30.0)
        assert snap_open["open_remaining_seconds"] == pytest.approx(30.0)
        assert snap_open["last_status_code"] == 502
        assert snap_open["last_failure_at"] == 1007.0
        assert len(snap_open["last_error"]) == 240

    def test_enabled_upstream_source_names_respects_serpapi_keys(self) -> None:
        cfg_no_key = SimpleNamespace(
            serper_api_key="",
            serpapi_api_key="",
            retrieval=SimpleNamespace(sources=SimpleNamespace(serpapi=True, crossref=True)),
        )
        names_no_key = get_enabled_upstream_source_names(cfg_no_key)
        assert "crossref" in names_no_key
        assert "serpapi" not in names_no_key

        cfg_with_key = SimpleNamespace(
            serper_api_key="serper-test-key",
            serpapi_api_key="",
            retrieval=SimpleNamespace(sources=SimpleNamespace(serpapi=True, crossref=True)),
        )
        names_with_key = get_enabled_upstream_source_names(cfg_with_key)
        assert "serpapi" in names_with_key

    @pytest.mark.asyncio
    async def test_serpapi_fallback_records_cb_telemetry_and_skips_when_open(self) -> None:
        now = [500.0]
        reg = CircuitBreakerRegistry(
            failure_threshold=2,
            recovery_timeout_seconds=60.0,
            now_fn=lambda: now[0],
        )
        mock_serpapi = MagicMock()
        mock_serpapi.name = "serpapi"
        mock_serpapi.lookup = AsyncMock(
            return_value=SourceCandidate(
                source_name="serpapi",
                found=True,
                title="Attention Is All You Need",
                confidence=0.9,
            )
        )
        orch = RetrievalOrchestrator(
            serpapi=mock_serpapi,
            circuit_breakers=reg,
            use_local_db=False,
            enable_link_validation=False,
        )
        cit = Citation(
            raw_text="Vaswani et al. (2017). Attention Is All You Need.",
            title="Attention Is All You Need",
            year="2017",
        )

        hit = await orch._lookup_serpapi_fallback(cit)
        assert hit is not None and hit.found is True
        snap_ok = reg.snapshot_all()["serpapi"]
        assert snap_ok["success_count"] == 1
        assert snap_ok["avg_latency_ms"] is not None

        # Two consecutive timeouts trip serpapi circuit OPEN
        mock_serpapi.lookup = AsyncMock(side_effect=httpx.ReadTimeout("serper read timed out"))
        res_fail_1 = await orch._lookup_serpapi_fallback(cit)
        assert res_fail_1 is not None and res_fail_1.found is False
        res_fail_2 = await orch._lookup_serpapi_fallback(cit)
        assert res_fail_2 is not None and res_fail_2.found is False

        snap_open = reg.snapshot_all()["serpapi"]
        assert snap_open["state"] == CircuitState.OPEN.value
        assert snap_open["timeout_count"] == 2
        assert snap_open["failure_count"] == 2

        # Next call must fast-fail with None without invoking lookup
        mock_serpapi.lookup.reset_mock()
        skipped = await orch._lookup_serpapi_fallback(cit)
        assert skipped is None
        mock_serpapi.lookup.assert_not_called()

    def test_system_health_pre_registers_sources_and_exposes_sqlite_wal(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        reset_circuit_breaker_registry()
        local_papers_path = tmp_path / "health_local_papers.db"
        LocalDatabase(local_papers_path)

        headers = _login_headers("admin", "admin123")
        client = TestClient(app)
        resp = client.get("/api/system/health", headers=headers)
        assert resp.status_code == 200, resp.text
        payload = resp.json()

        upstream = payload["upstream_sources"]
        for expected_provider in (
            "crossref",
            "openalex",
            "datacite",
            "doaj",
            "arxiv",
            "dblp",
            "europepmc",
            "doi_ra",
        ):
            assert expected_provider in upstream
            assert upstream[expected_provider]["state"] == "closed"
            assert "avg_latency_ms" in upstream[expected_provider]
            assert "p95_latency_ms" in upstream[expected_provider]
            assert "cooldown_remaining_s" in upstream[expected_provider]

        assert "sqlite_wal" in payload
        assert isinstance(payload["sqlite_wal"]["app_db"], dict)
        assert isinstance(payload["sqlite_wal"]["local_papers_db"], dict)
        assert "wal_enabled" in payload["sqlite_wal"]["local_papers_db"]


class TestSqliteWalLocalHitsAndCacheClear:
    """Verify Requirement 2: WAL tuning reports, local_hits_count & DELETE /api/cache."""

    def test_tuning_reports_and_local_db_hits_counter(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Verify LocalDatabase WAL report + local_hits_count + clear_local_query_cache
        monkeypatch.delenv("SQLITE_JOURNAL_MODE", raising=False)
        papers_db_path = tmp_path / "isolated_local_papers.db"
        ldb = LocalDatabase(papers_db_path)

        local_rep = get_local_papers_tuning_report()
        assert local_rep is not None
        assert local_rep["effective_journal_mode"] == "WAL"
        assert local_rep["wal_enabled"] is True

        pid = ldb.add_paper(
            Paper(
                doi="10.1000/v369-test",
                title="Operational Telemetry Wiring Study",
                authors=["Nguyen, A."],
                year=2025,
                venue="ICSE",
                source="crossref",
            )
        )
        assert pid is not None
        ldb.log_query({"doi": "10.1000/v369-test"}, found=True, source="local_db", paper_id=pid)
        ldb.log_query({"doi": "10.1000/v369-hit2"}, found=True, source="local_db", paper_id=pid)
        ldb.log_query({"doi": "10.1000/missing"}, found=False, source="local_db", paper_id=None)

        stats = ldb.get_stats()
        assert stats["total_queries"] == 3
        assert stats["local_hits_count"] == 2
        assert stats["hit_rate_percent"] == pytest.approx(66.67, abs=0.05)

        # Populate _QUERY_CACHE via lookup then clear via clear_local_query_cache()
        assert ldb.find_by_doi("10.1000/v369-test") is not None
        assert len(local_db_mod._QUERY_CACHE) > 0
        clear_local_query_cache()
        assert len(local_db_mod._QUERY_CACHE) == 0

        # Verify session.get_app_db_tuning_report() on isolated tmp_path SQLite file
        prev_engine = session_mod._engine
        prev_url = session_mod._engine_url
        prev_session_local = session_mod._SessionLocal
        prev_report = session_mod._LAST_APP_DB_TUNING_REPORT
        try:
            app_db_file = tmp_path / "isolated_app.db"
            monkeypatch.setenv("DATABASE_URL", f"sqlite:///{app_db_file}")
            get_settings.cache_clear()
            session_mod._engine = None
            session_mod._engine_url = None
            session_mod._SessionLocal = None
            eng = session_mod.get_engine()
            app_rep = get_app_db_tuning_report()
            assert app_rep is not None
            assert app_rep["effective_journal_mode"] == "WAL"
            assert app_rep["wal_enabled"] is True
            eng.dispose()
        finally:
            if session_mod._engine is not None and session_mod._engine is not prev_engine:
                session_mod._engine.dispose()
            session_mod._engine = prev_engine
            session_mod._engine_url = prev_url
            session_mod._SessionLocal = prev_session_local
            session_mod._LAST_APP_DB_TUNING_REPORT = prev_report
            monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
            get_settings.cache_clear()

    def test_delete_cache_clears_local_query_cache_and_persistent_cache_counters(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session = get_session()
        try:
            session.add(
                CitationCache(
                    cache_key="k_v369_1",
                    source="crossref",
                    raw_response="{}",
                )
            )
            session.commit()
        finally:
            session.close()

        with local_db_mod._DB_CACHE_LOCK:
            local_db_mod._QUERY_CACHE[("dummy", "key")] = "cached_val"

        fake_pc = SimpleNamespace(hits=14, misses=9, _hits=14, _misses=9)
        fake_orch = MagicMock()
        fake_orch._persistent_cache = fake_pc
        fake_orch.persistent_cache = fake_pc
        fake_pipeline = SimpleNamespace(orchestrator=fake_orch)
        monkeypatch.setattr(deps, "_pipeline_singleton", fake_pipeline)

        headers = _login_headers("admin", "admin123")
        client = TestClient(app)
        resp = client.delete("/api/cache", headers=headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["deleted_count"] == 1
        assert len(local_db_mod._QUERY_CACHE) == 0
        fake_orch.clear_runtime_caches.assert_called_once()
        assert fake_pc.hits == 0
        assert fake_pc.misses == 0
        assert fake_pc._hits == 0
        assert fake_pc._misses == 0


class TestProgressDiagnosticsAndQueuePosition:
    """Verify Requirement 3: document_diagnostics in ProgressState & SQLite FIFO queue position."""

    def test_progress_state_includes_document_diagnostics_in_to_dict(self) -> None:
        diag = {
            "is_scanned_pdf": True,
            "scanned_pages_count": 4,
            "warning_code": "SCANNED_PDF_DETECTED",
        }
        st = ProgressState(status="processing", document_diagnostics=diag)
        as_dict = st.to_dict()
        assert as_dict["document_diagnostics"] == diag
        assert st.to_snapshot()["document_diagnostics"] == diag

    def test_load_db_fallback_snapshot_fifo_queue_position_and_failed_quota_charged(self) -> None:
        session = get_session()
        try:
            e1 = EssayRecord(filename="q1.pdf", num_pages=2, job_status="queued", quota_charged=1)
            e_done = EssayRecord(
                filename="done.pdf", num_pages=2, job_status="completed", quota_charged=1
            )
            e2 = EssayRecord(filename="q2.pdf", num_pages=3, job_status="queued", quota_charged=1)
            e_fail_refunded = EssayRecord(
                filename="fail_refund.pdf",
                num_pages=1,
                job_status="failed",
                job_error="Worker timeout",
                quota_charged=0,
            )
            e_fail_charged = EssayRecord(
                filename="fail_charged.pdf",
                num_pages=1,
                job_status="failed",
                job_error="Invalid PDF",
                quota_charged=1,
            )
            session.add_all([e1, e_done, e2, e_fail_refunded, e_fail_charged])
            session.commit()

            snap_q1 = load_db_fallback_snapshot(e1.id, db=session)
            snap_q2 = load_db_fallback_snapshot(e2.id, db=session)
            assert snap_q1 is not None and snap_q1["queue_position"] == 1
            assert snap_q2 is not None and snap_q2["queue_position"] == 2

            snap_fail_0 = load_db_fallback_snapshot(e_fail_refunded.id, db=session)
            snap_fail_1 = load_db_fallback_snapshot(e_fail_charged.id, db=session)
            assert snap_fail_0 is not None and snap_fail_0["quota_charged"] is False
            assert snap_fail_1 is not None and snap_fail_1["quota_charged"] is True
        finally:
            session.close()


class TestEssaysSharedAndSandboxEnrichment:
    """Verify Requirement 4: /api/essays, /status, /shared/{token}, and /sandbox/verify."""

    def test_essays_list_detail_status_and_shared_verdict_enrichment(self) -> None:
        headers = _login_headers("admin", "admin123")
        client = TestClient(app)

        session = get_session()
        try:
            admin_user = session.query(User).filter(User.username == "admin").first()
            assert admin_user is not None

            queued_a = EssayRecord(
                filename="queued_a.pdf",
                num_pages=5,
                user_id=admin_user.id,
                job_status="queued",
                job_attempt_count=1,
                quota_charged=1,
            )
            queued_b = EssayRecord(
                filename="queued_b.pdf",
                num_pages=6,
                user_id=admin_user.id,
                job_status="queued",
                job_attempt_count=2,
                job_error="Retrying after transient lock",
                quota_charged=0,
            )
            shared_essay = EssayRecord(
                filename="shared_thesis.pdf",
                num_pages=10,
                user_id=admin_user.id,
                job_status="completed",
                quota_charged=1,
            )
            session.add_all([queued_a, queued_b, shared_essay])
            session.flush()

            features_blob = {
                "title_sim_fuzzy": 0.96,
                "author_jaccard": 1.0,
                "url_status": "archived_only",
                "url_status_code": 404,
                "archive_url": "https://web.archive.org/web/20240101/https://example.edu/paper",
                "checked_url": "https://example.edu/paper",
                "is_retracted": True,
                "html_meta": {
                    "page_title": "Archived Thesis Reference",
                    "site_name": "Example University",
                },
                "html_meta_title_sim": 0.91,
                "numeric_index": 12,
                "sub_index": "b",
                "composite_label": "[12b]",
                "citation_link": {
                    "occurrence_id": "occ-0001",
                    "reference_id": "ref-0001",
                    "status": "matched",
                    "confidence": 1.0,
                    "method": "exact_numeric",
                },
                "matched_sources": [
                    {
                        "source": "crossref",
                        "title": "Archived Thesis Reference",
                        "doi": "10.1000/shared.12b",
                        "confidence": 0.98,
                    }
                ],
            }
            session.add(
                VerdictRecord(
                    essay_id=shared_essay.id,
                    citation_raw="[12b] Le, M. (2024). Archived Thesis Reference.",
                    label="verified",
                    confidence=0.98,
                    reasoning="Verified with archive link.",
                    triggered_rules=json.dumps(["R-RETRACTED-PAPER"]),
                    mismatched_fields="[]",
                    features=json.dumps(features_blob),
                    mapping_status="matched",
                    mapping_confidence=1.0,
                )
            )
            session.commit()
            qa_id, qb_id, sh_id = queued_a.id, queued_b.id, shared_essay.id
        finally:
            session.close()

        get_tracker().clear(qa_id)
        get_tracker().clear(qb_id)

        # 1. GET /api/essays includes job lifecycle & quota_charged fields
        list_resp = client.get("/api/essays", headers=headers)
        assert list_resp.status_code == 200, list_resp.text
        by_id = {item["id"]: item for item in list_resp.json()}
        assert by_id[qb_id]["job_status"] == "queued"
        assert by_id[qb_id]["job_error"] == "Retrying after transient lock"
        assert by_id[qb_id]["job_attempt_count"] == 2
        assert by_id[qb_id]["quota_charged"] is False

        # 2. GET /api/essays/{id} includes job lifecycle & quota_charged fields
        detail_resp = client.get(f"/api/essays/{qb_id}", headers=headers)
        assert detail_resp.status_code == 200, detail_resp.text
        detail = detail_resp.json()
        assert detail["job_status"] == "queued"
        assert detail["job_error"] == "Retrying after transient lock"
        assert detail["job_attempt_count"] == 2
        assert detail["quota_charged"] is False

        # 3. GET /api/essays/{id}/status computes 1-based FIFO queue_position & quota_charged
        st_a = client.get(f"/api/essays/{qa_id}/status", headers=headers).json()
        st_b = client.get(f"/api/essays/{qb_id}/status", headers=headers).json()
        assert st_a["status"] == "queued"
        assert st_a["queue_position"] == 1
        assert st_a["quota_charged"] is True
        assert st_b["status"] == "queued"
        assert st_b["queue_position"] == 2
        assert st_b["quota_charged"] is False

        # 4. GET /api/essays/shared/{share_token} exposes enriched verdict fields
        token_info = create_essay_share_token(sh_id, expires_days=7)
        shared_resp = client.get(f"/api/essays/shared/{token_info['share_token']}")
        assert shared_resp.status_code == 200, shared_resp.text
        pub_v = shared_resp.json()["verdicts"][0]
        assert pub_v["url_status"] == "archived_only"
        assert pub_v["url_status_code"] == 404
        assert pub_v["archive_url"].startswith("https://web.archive.org/")
        assert pub_v["cited_url"] == "https://example.edu/paper"
        assert pub_v["is_retracted"] is True
        assert pub_v["html_meta"]["page_title"] == "Archived Thesis Reference"
        assert pub_v["html_meta_title_sim"] == pytest.approx(0.91)
        assert pub_v["matched_source"]["source"] == "crossref"
        assert pub_v["matched_sources"][0]["doi"] == "10.1000/shared.12b"
        assert pub_v["numeric_index"] == 12
        assert pub_v["sub_index"] == "b"
        assert pub_v["composite_label"] == "[12b]"
        assert pub_v["citation_link"]["reference_id"] == "ref-0001"
        assert pub_v["features"]["title_sim_fuzzy"] == pytest.approx(0.96)

    def test_sandbox_verify_enriches_html_meta_web_fallback_features_and_summary(self) -> None:
        headers = _login_headers("admin", "admin123")

        # Item 1: Web/Wayback resource with NO scholarly candidate -> synthesizes wayback_html_meta
        web_html = HtmlPageMeta(
            page_title="Example Technical Spec v2",
            citation_title="Example Technical Specification",
            citation_authors=["Docs Team"],
            published_year="2024",
            site_name="Example Docs",
            canonical_url="https://docs.example.org/spec",
            is_soft_404=False,
        )
        web_source = SourceResult(
            citation_raw="[1a] Docs Team (2024). Example Technical Specification.",
            candidates=[],
            sources_queried=["crossref"],
            sources_succeeded=[],
            sources_failed={"crossref": "No results for query"},
            url_status="archived_only",
            url_status_code=404,
            archive_url="https://web.archive.org/web/2024/https://docs.example.org/spec",
            html_meta=web_html,
        )

        # Item 2: Scholarly candidate with external_ids & retraction
        schol_cand = SourceCandidate(
            source_name="openalex",
            found=True,
            doi="10.1000/retracted.2023",
            title="Retracted Deep Learning Study",
            authors=["Tran, B."],
            year="2023",
            venue="NeurIPS",
            url="https://doi.org/10.1000/retracted.2023",
            external_ids={"openalex": "W12345", "is_retracted": "true"},
            confidence=0.95,
        )
        schol_source = SourceResult(
            citation_raw="[2] Tran, B. (2023). Retracted Deep Learning Study.",
            candidates=[schol_cand],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
            sources_failed={},
            url_status="alive",
            url_status_code=200,
            is_retracted=True,
        )

        fake_orch = MagicMock()
        fake_orch._local_db = None
        fake_orch.retrieve = AsyncMock(side_effect=[web_source, schol_source])

        def _fake_check(cit: Citation, src: SourceResult, **_kwargs):
            if not src.candidates:
                feat = MatchFeatures(title_sim_fuzzy=0.88)
                feat.html_meta_title_sim = 0.93  # type: ignore[attr-defined]
                feat.has_scholarly_candidate = False  # type: ignore[attr-defined]
                return CitationVerdict(
                    citation=cit,
                    label=ValidationLabel.RESOURCE,
                    confidence=0.9,
                    matched_source=src,
                    features=feat,
                    triggered_rules=["R-WEB-RESOURCE"],
                    reasoning="Verified via archived HTML metadata.",
                )
            feat2 = MatchFeatures(
                title_sim_fuzzy=0.99,
                author_jaccard=1.0,
                doi_exact_match=True,
                venue_sim=0.95,
            )
            return CitationVerdict(
                citation=cit,
                label=ValidationLabel.VERIFIED,
                confidence=0.95,
                matched_source=src,
                features=feat2,
                triggered_rules=["R-RETRACTED-PAPER"],
                reasoning="Matched scholarly work (retracted).",
            )

        fake_checker = MagicMock()
        fake_checker.rules = None
        fake_checker.check = MagicMock(side_effect=_fake_check)
        fake_pipeline = SimpleNamespace(
            orchestrator=fake_orch,
            checker=fake_checker,
            ref_parser=MagicMock(),
        )

        app.dependency_overrides[deps.get_pipeline] = lambda: fake_pipeline
        try:
            client = TestClient(app)
            resp = client.post(
                "/api/essays/sandbox/verify",
                headers=headers,
                json={
                    "style": "ieee",
                    "lang": "en",
                    "items": [
                        {
                            "authors": ["Docs Team"],
                            "year": "2024",
                            "title": "Example Technical Specification",
                            "url": "https://docs.example.org/spec",
                            "numeric_index": 1,
                            "sub_index": "a",
                            "composite_label": "[1a]",
                        },
                        {
                            "authors": ["Tran, B."],
                            "year": "2023",
                            "title": "Retracted Deep Learning Study",
                            "venue": "NeurIPS",
                            "doi": "10.1000/retracted.2023",
                            "numeric_index": 2,
                        },
                    ],
                },
            )
            assert resp.status_code == 200, resp.text
            body = resp.json()

            summary = body["summary"]
            assert summary["total"] == 2
            assert summary["resource"] == 1
            assert summary["verified"] == 1
            assert summary["unresolved"] == 0

            r0, r1 = body["results"]
            assert r0["cited_url"] == "https://docs.example.org/spec"
            assert r0["url_status"] == "archived_only"
            assert r0["url_status_code"] == 404
            assert r0["archive_url"].startswith("https://web.archive.org/")
            assert r0["numeric_index"] == 1
            assert r0["sub_index"] == "a"
            assert r0["composite_label"] == "[1a]"
            assert r0["html_meta"]["citation_title"] == "Example Technical Specification"
            assert r0["matched_source"]["source"] == "wayback_html_meta"
            assert r0["matched_sources"][0]["source"] == "wayback_html_meta"
            assert r0["features"]["html_meta_title_sim"] == pytest.approx(0.93)
            assert r0["features"]["has_scholarly_candidate"] is False

            assert r1["is_retracted"] is True
            assert r1["matched_sources"][0]["external_ids"]["openalex"] == "W12345"
            assert r1["features"]["doi_exact_match"] is True
            assert r1["features"]["has_scholarly_candidate"] is True
        finally:
            app.dependency_overrides.pop(deps.get_pipeline, None)
