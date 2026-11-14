"""Consolidated regression tests for the v3.61 Final Polish Fix Wave (Findings 1–11)."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from integrity_checker.api import deps, job_recovery
from integrity_checker.api.main import app
from integrity_checker.api.progress import get_tracker
from integrity_checker.api.routes import cache as cache_routes
from integrity_checker.api.routes import essays as essays_routes
from integrity_checker.db.migrations import run_migrations
from integrity_checker.db.models import Base, EssayRecord, User
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.pipeline import integrity_pipeline
from integrity_checker.retrieval import tech_standard_client
from integrity_checker.retrieval.circuit_breaker import CircuitBreakerRegistry, CircuitState
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

REPO_ROOT = Path(__file__).resolve().parents[2]


def _make_isolated_session_factory(tmp_path: Path, db_name: str = "polish.db"):
    engine = create_engine(
        f"sqlite:///{tmp_path / db_name}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return engine, session_local


def _seed_user(
    session: Session,
    *,
    username: str = "polish_user",
    role: str = "user",
    used: int = 0,
) -> User:
    user = User(
        username=username,
        password_hash="hashed_pw",
        role=role,
        email=f"{username}@example.com",
        is_active=1,
        email_verified=1,
        plan_tier="pro",
        monthly_uploads_used=used,
        quota_reset_at=datetime.now(UTC) + timedelta(days=30),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


# ============================================================================
# Finding 1: Docker-included VN registry fallback & byte parity
# ============================================================================


@pytest.mark.asyncio
async def test_finding1_vn_registry_docker_fallback_and_byte_parity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_reg = REPO_ROOT / "data" / "registries" / "vn_standards_and_textbooks.json"
    cfg_reg = REPO_ROOT / "configs" / "registries" / "vn_standards_and_textbooks.json"

    assert data_reg.is_file(), f"Missing {data_reg}"
    assert cfg_reg.is_file(), f"Missing {cfg_reg}"
    assert data_reg.read_bytes() == cfg_reg.read_bytes()

    shadowed_missing_data_reg = (
        tmp_path / "empty_docker_data_mount" / "registries" / "vn_standards_and_textbooks.json"
    )
    monkeypatch.setattr(
        tech_standard_client,
        "_VN_REGISTRY_CANDIDATE_PATHS",
        (shadowed_missing_data_reg, cfg_reg),
    )
    tech_standard_client._load_vn_registry.cache_clear()
    try:
        loaded = tech_standard_client._load_vn_registry()
        assert len(loaded["standards_by_code"]) > 0
        assert len(loaded["textbooks"]) > 0

        first_code = next(iter(loaded["standards_by_code"]))
        client = tech_standard_client.TechStandardClient(contact_email="test@citra.io.vn")
        cand = await client.lookup(
            Citation(
                raw_text=f"{first_code} Tiêu chuẩn kỹ thuật Việt Nam.",
                citation_type=CitationType.REFERENCE_LIST,
                title=first_code,
            )
        )
        assert cand.found is True
    finally:
        tech_standard_client._load_vn_registry.cache_clear()


# ============================================================================
# Finding 2: Guard _check_known_papers against title-less chemistry & conflicts
# ============================================================================


@pytest.mark.asyncio
async def test_finding2_known_papers_guards_titleless_chemistry_conflicting_doi_and_venue() -> None:
    mock_cr = MagicMock()
    mock_cr.name = "crossref"
    mock_cr.lookup = AsyncMock(
        return_value=SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1021/jacs.5b12345",
            title="Nanoscale Metal-Organic Frameworks for Photodynamic Therapy",
            authors=["He, C.", "Lu, K.", "Lin, W."],
            year="2016",
            venue="Journal of the American Chemical Society",
            confidence=0.95,
        )
    )
    orch = RetrievalOrchestrator(
        crossref=mock_cr,
        use_local_db=False,
        use_persistent_cache=False,
        enable_link_validation=False,
    )

    # 1) Title-less REFERENCE_LIST chemistry citation (He, 2016) must NOT match ResNet
    chem_ref = Citation(
        raw_text="C. He, K. Lu, W. Lin, J. Am. Chem. Soc. 2016, 138, 602–605.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.ACS,
        authors=["He, C.", "Lu, K.", "Lin, W."],
        year="2016",
        title=None,
        venue="J. Am. Chem. Soc.",
    )
    assert orch._check_known_papers(chem_ref) is None
    live_res = await orch.retrieve(chem_ref, allow_serpapi=False)
    mock_cr.lookup.assert_awaited()
    assert all(c.source_name != "known_papers" for c in live_res.candidates)

    # 2) Bare in-text callout (He et al., 2016) STILL resolves via _check_known_papers
    intext_he = Citation(
        raw_text="(He et al., 2016)",
        citation_type=CitationType.IN_TEXT,
        style=CitationStyle.APA,
        authors=["He"],
        year="2016",
        title=None,
    )
    kp_intext = orch._check_known_papers(intext_he)
    assert kp_intext is not None
    assert kp_intext.candidates[0].source_name == "known_papers"
    assert "Residual Learning" in (kp_intext.candidates[0].title or "")

    # 3) Conflicting DOI on non-REFERENCE_LIST citation must reject known_papers match
    conflict_doi_cit = Citation(
        raw_text="L. Wang, Y. Zhang, Adv. Mater. 2018, 30, 1801234, doi:10.1002/adma.201801234",
        citation_type=CitationType.DOI,
        authors=["Wang, L.", "Zhang, Y."],
        year="2018",
        title=None,
        doi="https://doi.org/10.1002/adma.201801234",
    )
    assert orch._check_known_papers(conflict_doi_cit) is None

    # 4) Incompatible venue vs compatible full CVPR venue for ("he", "2016")
    incompatible_venue_cit = Citation(
        raw_text="He et al., 2016, Journal of the American Chemical Society",
        citation_type=CitationType.UNKNOWN,
        authors=["He"],
        year="2016",
        venue="Journal of the American Chemical Society",
    )
    assert orch._check_known_papers(incompatible_venue_cit) is None

    compatible_cvpr_cit = Citation(
        raw_text="He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning for Image Recognition. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["He, K.", "Zhang, X.", "Ren, S.", "Sun, J."],
        year="2016",
        title="Deep Residual Learning for Image Recognition",
        venue="Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
    )
    assert orch._check_known_papers(compatible_cvpr_cit) is not None


# ============================================================================
# Finding 3: GET /api/essays/{id}/report 425 guards & crashed re-analysis recovery
# ============================================================================


def test_finding3_report_endpoint_425_on_queued_web_only_and_failed_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, SessionLocal = _make_isolated_session_factory(tmp_path, "report_425.db")
    session = SessionLocal()
    tracker = get_tracker()

    try:
        user = _seed_user(session, username="report_student")
        queued_essay = EssayRecord(
            filename="queued.pdf",
            num_pages=4,
            user_id=user.id,
            job_status="queued",
            cis_json=None,
        )
        failed_essay = EssayRecord(
            filename="failed.pdf",
            num_pages=4,
            user_id=user.id,
            job_status="failed",
            job_error="Document file is corrupted or unreadable.",
            cis_json=None,
        )
        completed_essay = EssayRecord(
            filename="completed.pdf",
            num_pages=4,
            user_id=user.id,
            job_status="completed",
            cis_json=json.dumps({"score": 91.0, "components": {}, "num_citations": 0}),
        )
        session.add_all([queued_essay, failed_essay, completed_essay])
        session.commit()
        for row in (queued_essay, failed_essay, completed_essay):
            session.refresh(row)

        def _override_db():
            db = SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[deps.get_db] = _override_db
        app.dependency_overrides[deps.get_current_user] = lambda: user
        client = TestClient(app)

        # Case 1: In-memory queued state returns 425 (Retry-After: 3)
        monkeypatch.setenv("CITRA_WORKER_MODE", "inline")
        tracker.init(queued_essay.id)
        tracker.update(queued_essay.id, status="queued", step="queued")
        r_queued = client.get(f"/api/essays/{queued_essay.id}/report")
        assert r_queued.status_code == 425
        assert r_queued.headers.get("Retry-After") == "3"

        # Case 2: CITRA_WORKER_MODE=web_only ignores empty in-memory tracker and honors SQL job_status
        tracker.clear(queued_essay.id)
        monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")
        r_web_only = client.get(f"/api/essays/{queued_essay.id}/report")
        assert r_web_only.status_code == 425
        assert r_web_only.headers.get("Retry-After") == "3"

        # Case 3: Failed job before report generation (cis_json is None, verdicts == []) returns 425 (Retry-After: 1)
        r_failed = client.get(f"/api/essays/{failed_essay.id}/report?format=json")
        assert r_failed.status_code == 425
        assert r_failed.headers.get("Retry-After") == "1"
        assert "failed before report generation" in r_failed.json()["detail"].lower()

        # Case 4: Completed essay returns 200 normally
        r_ok = client.get(f"/api/essays/{completed_essay.id}/report?format=json")
        assert r_ok.status_code == 200
    finally:
        app.dependency_overrides.pop(deps.get_db, None)
        app.dependency_overrides.pop(deps.get_current_user, None)
        tracker.clear(queued_essay.id if "queued_essay" in locals() and queued_essay.id else -1)
        session.close()
        engine.dispose()


def test_finding3_recover_orphaned_reanalysis_restores_completed_without_touching_quota(
    tmp_path: Path,
) -> None:
    engine, SessionLocal = _make_isolated_session_factory(tmp_path, "reanalysis_orphan.db")
    session = SessionLocal()
    try:
        user = _seed_user(session, username="reanalysis_student", used=1)
        stale_hb = datetime.now(UTC) - timedelta(minutes=15)
        fresh_hb = datetime.now(UTC)

        crashed_reanalysis = EssayRecord(
            filename="completed_reanalyzing.pdf",
            num_pages=6,
            user_id=user.id,
            job_status="processing",
            job_heartbeat_at=stale_hb,
            quota_charged=1,
            cis_json=json.dumps({"score": 88.5, "components": {}}),
            style_profile_json=json.dumps(
                {
                    "style": "APA",
                    "confidence": 0.94,
                    "_progress_snapshot": {"status": "processing", "step": "retrieving"},
                }
            ),
        )
        active_peer_reanalysis = EssayRecord(
            filename="peer_active_reanalyzing.pdf",
            num_pages=5,
            user_id=user.id,
            job_status="processing",
            job_heartbeat_at=fresh_hb,
            quota_charged=1,
            cis_json=json.dumps({"score": 90.0, "components": {}}),
        )
        session.add_all([crashed_reanalysis, active_peer_reanalysis])
        session.commit()
        crashed_id = int(crashed_reanalysis.id)
        active_id = int(active_peer_reanalysis.id)
        uid = int(user.id)
    finally:
        session.close()

    try:
        summary = job_recovery.recover_orphaned_essay_jobs(
            lambda: MagicMock(),
            session_factory=SessionLocal,
            uploads_dir=tmp_path,
            run_rescheduled=False,
            stale_heartbeat_seconds=60.0,
        )
        assert summary == {"rescheduled": 0, "failed": 0, "refunded": 0}

        verify_sess = SessionLocal()
        try:
            restored = verify_sess.get(EssayRecord, crashed_id)
            still_active = verify_sess.get(EssayRecord, active_id)
            fresh_user = verify_sess.get(User, uid)

            assert restored is not None
            assert restored.job_status == "completed"
            assert (
                restored.job_error
                == "Orphaned re-analysis interrupted; previous completed report preserved."
            )
            assert restored.quota_charged == 1
            parsed_sp = json.loads(restored.style_profile_json or "{}")
            assert parsed_sp.get("style") == "APA"
            assert "_progress_snapshot" not in parsed_sp

            assert still_active is not None
            assert still_active.job_status == "processing"

            assert fresh_user is not None
            assert fresh_user.monthly_uploads_used == 1
        finally:
            verify_sess.close()
    finally:
        engine.dispose()


# ============================================================================
# Finding 4: _REPORT_CACHE_VERSION bumped to "report-v20"
# ============================================================================


def test_finding4_report_cache_version_bumped_to_v20() -> None:
    assert integrity_pipeline._REPORT_CACHE_VERSION == "report-v20"


# ============================================================================
# Finding 5: Restrict Vietnamese "bộ ..." in _LEGAL_OR_STANDARD_SIGNAL_RE
# ============================================================================


@pytest.mark.parametrize(
    "engineering_stub",
    [
        "Thiết kế bộ điều khiển PID cho hệ bồn nước đôi.",
        "Phân tích bộ biến đổi DC-DC hiệu suất cao.",
        "Ước lượng trạng thái dùng bộ lọc Kalman mở rộng.",
        "Xây dựng bộ dữ liệu tiếng Việt cho nhận dạng thực thể.",
    ],
)
def test_finding5_vietnamese_bo_engineering_stubs_flagged_incomplete_not_resource(
    engineering_stub: str,
) -> None:
    rules = SymbolicRules()
    empty_source = SourceResult(
        citation_raw=engineering_stub,
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no results for query",
            "openalex": "OpenAlex: no results for query",
        },
    )
    outcome = rules.apply(
        MatchFeatures(),
        empty_source,
        citation_raw=engineering_stub,
        citation_authors=[],
        citation_year=None,
    )
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "R-INCOMPLETE-METADATA" in outcome.triggered_rules
    assert "R-NON-SCHOLARLY-RESOURCE" not in outcome.triggered_rules


def test_finding5_real_vietnamese_ministries_still_classified_as_resource() -> None:
    rules = SymbolicRules()
    ministry_ref = (
        "Bộ Giáo dục và Đào tạo (2021). Chương trình giáo dục đại học ngành Kỹ thuật điều khiển."
    )
    empty_source = SourceResult(
        citation_raw=ministry_ref,
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no results for query",
            "openalex": "OpenAlex: no results for query",
        },
    )
    outcome = rules.apply(
        MatchFeatures(),
        empty_source,
        citation_raw=ministry_ref,
        citation_authors=["Bộ Giáo dục và Đào tạo"],
        citation_year="2021",
    )
    assert outcome.label == ValidationLabel.RESOURCE
    assert "R-NON-SCHOLARLY-RESOURCE" in outcome.triggered_rules


# ============================================================================
# Finding 6: "circuit_open" in rate_limited_sources & primary-graph guard
# ============================================================================


@pytest.mark.parametrize("degraded_primary", ["crossref", "openalex"])
def test_finding6_circuit_open_on_primary_graph_abstains_instead_of_hallucination(
    degraded_primary: str,
) -> None:
    rules = SymbolicRules()
    raw = "Nguyen, T. M., & Tran, Q. H. (2024). Adaptive Microgrid Optimization Under Uncertainty. IEEE Transactions on Smart Grid, 15(2), 410-422."
    source = SourceResult(
        citation_raw=raw,
        candidates=[],
        sources_queried=[degraded_primary, "dblp", "arxiv"],
        sources_succeeded=[],
        sources_failed={
            degraded_primary: "circuit_open (42s remaining)",
            "dblp": "DBLP: no results for 'Adaptive Microgrid Optimization'",
            "arxiv": "arXiv: no results for 'Adaptive Microgrid Optimization'",
        },
    )
    outcome = rules.apply(
        MatchFeatures(),
        source,
        citation_raw=raw,
        citation_doi="10.1109/TSG.2024.1234567",
        citation_authors=["Nguyen, T. M.", "Tran, Q. H."],
        citation_year="2024",
    )
    assert outcome.label == ValidationLabel.UNRESOLVED
    assert outcome.label != ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-RATE-LIMITED-ABSTAIN" in outcome.triggered_rules


# ============================================================================
# Finding 7: Purge _wave0_memory_cache & _negative_cache on DELETE /api/cache
# ============================================================================


def test_finding7_clear_cache_purges_runtime_caches_without_lazy_pipeline_init(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, SessionLocal = _make_isolated_session_factory(tmp_path, "cache_clear.db")
    session = SessionLocal()
    try:
        admin = _seed_user(session, username="cache_admin", role="admin")

        # 1) When _pipeline_singleton is None, clear_cache must NOT instantiate IntegrityPipeline
        monkeypatch.setattr(deps, "_pipeline_singleton", None)
        monkeypatch.delattr(essays_routes, "_pipeline", raising=False)
        res_lazy = cache_routes.clear_cache(admin=admin, db=session)
        assert res_lazy.deleted_count == 0
        assert deps._pipeline_singleton is None

        # 2) When pipeline is initialized, clear_cache empties both _wave0_memory_cache and _negative_cache
        orch = RetrievalOrchestrator(
            use_local_db=False,
            use_persistent_cache=False,
            enable_link_validation=False,
        )
        dummy_res = SourceResult(citation_raw="Dummy (2024)", candidates=[])
        orch._put_wave0_memory_hit("doi:10.1000/test", dummy_res)
        orch._negative_cache.set("neg:test", dummy_res)
        assert orch._get_wave0_memory_hit("doi:10.1000/test") is not None
        assert len(orch._negative_cache) == 1

        stub_pipeline = SimpleNamespace(orchestrator=orch)
        monkeypatch.setattr(deps, "_pipeline_singleton", stub_pipeline)
        cache_routes.clear_cache(admin=admin, db=session)

        assert orch._get_wave0_memory_hit("doi:10.1000/test") is None
        assert len(orch._wave0_memory_cache) == 0
        assert len(orch._negative_cache) == 0
    finally:
        session.close()
        engine.dispose()


# ============================================================================
# Finding 8: Unified quota lock, disk-I/O retry guard, & worker_only override
# ============================================================================


@pytest.mark.asyncio
async def test_finding8_unified_quota_lock_disk_io_retry_guard_and_worker_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1) Shared lock identity
    assert essays_routes._QUOTA_CLAIM_LOCK is job_recovery.QUOTA_LEDGER_LOCK

    # 2) Disk-I/O failure eligible for immediate auto-retry preserves quota until retry also fails
    engine, SessionLocal = _make_isolated_session_factory(tmp_path, "disk_io_retry.db")
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(essays_routes, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setenv("CITRA_WORKER_MODE", "inline")
    monkeypatch.setattr(essays_routes, "is_test_runtime", lambda: False)

    session = SessionLocal()
    tracker = get_tracker()
    try:
        user = _seed_user(session, username="retry_student", used=0)
        essay = essays_routes._claim_monthly_upload_slot_and_create_essay(
            session, user, filename="transient_io.pdf", num_pages=2
        )
        essay_id = int(essay.id)
        user_id = int(user.id)
        pdf_path = uploads_dir / f"{essay_id}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n%%EOF\n")
    finally:
        session.close()

    failing_pipeline = MagicMock()
    failing_pipeline.run_async = AsyncMock(
        side_effect=RuntimeError("sqlite3.OperationalError: disk I/O error")
    )

    try:
        with patch("integrity_checker.db.session.get_session", SessionLocal):
            # Initial attempt fails with disk I/O error while can_auto_retry(essay_id) is True -> NO premature refund
            tracker.init(essay_id, is_retry=False)
            await essays_routes._run_pipeline_task(
                essay_id,
                str(pdf_path),
                user_id,
                failing_pipeline,
                cleanup_file=False,
            )

            s1 = SessionLocal()
            try:
                e1 = s1.get(EssayRecord, essay_id)
                u1 = s1.get(User, user_id)
                assert e1 is not None and u1 is not None
                assert e1.quota_charged == 1
                assert u1.monthly_uploads_used == 1
            finally:
                s1.close()

            # Auto-retry consumes retry budget (is_retry=True -> can_auto_retry becomes False);
            # when retry ALSO fails, quota MUST be refunded once!
            tracker.init(essay_id, is_retry=True)
            assert tracker.can_auto_retry(essay_id) is False
            await essays_routes._run_pipeline_task(
                essay_id,
                str(pdf_path),
                user_id,
                failing_pipeline,
                cleanup_file=False,
            )

            s2 = SessionLocal()
            try:
                e2 = s2.get(EssayRecord, essay_id)
                u2 = s2.get(User, user_id)
                assert e2 is not None and u2 is not None
                assert e2.job_status == "failed"
                assert e2.quota_charged == 0
                assert u2.monthly_uploads_used == 0
            finally:
                s2.close()
    finally:
        tracker.clear(essay_id)
        engine.dispose()


def test_finding8_worker_main_forces_worker_only_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from integrity_checker import worker as worker_mod

    monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")
    with (
        patch.object(worker_mod.db_session, "init_db"),
        patch.object(worker_mod, "configure_logging"),
        patch.object(worker_mod, "run_worker_loop", new=AsyncMock(return_value={})),
    ):
        rc = worker_mod.main(["--max-iterations", "0"])
    assert rc == 0
    assert os.environ["CITRA_WORKER_MODE"] == "worker_only"


# ============================================================================
# Finding 9: Initial-hop non-80/443 port returns UNCHECKED (not FAKE_DOMAIN)
# ============================================================================


@pytest.mark.asyncio
async def test_finding9_nonstandard_port_initial_hop_returns_unchecked_while_ssrf_stays_fake() -> None:
    opened_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        opened_urls.append(str(request.url))
        if request.url.host == "public.redirect.example":
            return httpx.Response(
                302,
                headers={"Location": "http://dspace.university.edu.vn:8080/jspui/handle/1/2"},
            )
        raise AssertionError(f"Forbidden socket opened to {request.url}")

    def resolver(host: str, port: int = 80, *args, **kwargs):
        import socket

        if host == "public.redirect.example":
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))]
        if host == "evil.rebind.example":
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("192.168.1.10", port))]
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))]

    lv = LinkValidator(
        timeout=2.0,
        enable_wayback_fallback=False,
        resolver=resolver,
        transport=httpx.MockTransport(handler),
    )

    # Institutional repository on :8080 and public IP on :8443 -> UNCHECKED (no socket opened!)
    res_dspace = await lv.validate_url("http://dspace.university.edu.vn:8080/jspui/handle/123456789/42")
    assert res_dspace.status == LinkStatus.UNCHECKED
    assert res_dspace.is_broken is False
    assert opened_urls == []

    res_pub_port = await lv.validate_url("https://93.184.216.34:8443/paper.pdf")
    assert res_pub_port.status == LinkStatus.UNCHECKED
    assert opened_urls == []

    # Loopback, metadata, localhost, DNS-rebound private IP on :8080/:8000 -> FAKE_DOMAIN!
    for ssrf_url in (
        "http://127.0.0.1:8000/admin",
        "http://169.254.169.254:8080/latest/meta-data/",
        "http://[::1]:8080/secret",
        "http://localhost:8080/internal",
        "http://evil.rebind.example:8080/internal",
    ):
        res_bad = await lv.validate_url(ssrf_url)
        assert res_bad.status == LinkStatus.FAKE_DOMAIN, f"Expected FAKE_DOMAIN for {ssrf_url}"
    assert opened_urls == []

    # 302 redirect to non-80/443 port (hop == 1) -> FAKE_DOMAIN!
    res_redir_port = await lv.validate_url("https://public.redirect.example/start")
    assert res_redir_port.status == LinkStatus.FAKE_DOMAIN
    assert opened_urls == ["https://public.redirect.example/start"]


# ============================================================================
# Finding 10: CircuitBreakerRegistry.snapshot_all() effective HALF_OPEN state
# ============================================================================


def test_finding10_snapshot_all_reports_half_open_immediately_after_cooldown_expires() -> None:
    now = [100.0]
    reg = CircuitBreakerRegistry(
        failure_threshold=4,
        recovery_timeout_seconds=45.0,
        now_fn=lambda: now[0],
    )
    for _ in range(4):
        reg.record_infra_failure("crossref", "HTTP 503 Service Unavailable", latency_ms=250.0)

    snap_open = reg.snapshot_all()["crossref"]
    assert snap_open["state"] == CircuitState.OPEN.value
    assert snap_open["open_remaining_seconds"] == pytest.approx(45.0)

    # Advance past open_until WITHOUT calling allow_request -> snapshot_all reports half_open & 0.0s
    now[0] = 145.0
    snap_elapsed = reg.snapshot_all()["crossref"]
    assert snap_elapsed["state"] == CircuitState.HALF_OPEN.value
    assert snap_elapsed["open_remaining_seconds"] == 0.0


# ============================================================================
# Finding 11: sentence-transformers>=3.2,<4.0 in pyproject.toml & requirements.txt
# ============================================================================


def test_finding11_sentence_transformers_minimum_3_2_in_packaging_manifests() -> None:
    pyproject_text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    requirements_text = (REPO_ROOT / "requirements.txt").read_text(encoding="utf-8")

    assert '"sentence-transformers>=3.2,<4.0"' in pyproject_text
    assert "sentence-transformers>=2.6" not in pyproject_text

    assert "sentence-transformers>=3.2,<4.0" in requirements_text
    assert "sentence-transformers>=2.6" not in requirements_text
