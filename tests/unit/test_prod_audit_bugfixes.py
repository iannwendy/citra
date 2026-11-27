"""Regression test suite for production audit backend bugfixes (Phase 1A):
- BUG-01: Teacher class analytics (`top_triggered_rules`) excludes verified/positive match rules
- BUG-43: Teacher pending reviews & Admin audit log enrich student/class/essay metadata via batch queries
- BUG-18: Circuit breaker sanitizes raw Python reprs, hex addresses, and user citation strings in `last_error`
- BUG-47: System health exposes `checked_at`, `degraded_sources`, and `upstream_status`
- BUG-07 & BUG-21: Scanned PDF diagnostics emit bilingual `warning_message_en`/`warning_message_vi` & `is_unscannable`
- BUG-25 & BUG-07: Sandbox verify gibberish fast-path, `not_applicable` mapping_status, bilingual VN Legal & Fabricated DOI
- BUG-28: Cross-file revision diff never spuriously auto-compares `10.bib` vs `10.ris` or non-descriptive/mismatched stems
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from integrity_checker.api import deps
from integrity_checker.api.main import app
from integrity_checker.api.routes import essays as essays_route
from integrity_checker.api.routes.audit import list_audit
from integrity_checker.api.routes.report import (
    _compute_revision_diff,
    _extract_document_diagnostics,
    _json_response,
)
from integrity_checker.api.routes.system import get_system_health
from integrity_checker.api.routes.teacher import (
    get_class_analytics,
    list_pending_reviews,
)
from integrity_checker.db.models import (
    AuditLog,
    Base,
    Class,
    ClassMembership,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.pipeline.integrity_pipeline import (
    SCANNED_PDF_WARNING_EN,
    SCANNED_PDF_WARNING_VI,
    IntegrityPipeline,
)
from integrity_checker.retrieval.circuit_breaker import (
    CircuitBreakerRegistry,
    get_circuit_breaker_registry,
    reset_circuit_breaker_registry,
    sanitize_error_reason,
)


@pytest.fixture()
def mem_db() -> Session:
    """Strictly isolated in-memory SQLite session."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


async def _read_streaming_json(resp) -> dict:
    chunks: list[bytes] = []
    async for chunk in resp.body_iterator:
        chunks.append(chunk.encode("utf-8") if isinstance(chunk, str) else bytes(chunk))
    return json.loads(b"".join(chunks).decode("utf-8"))


# ---------------------------------------------------------------------------
# BUG-01: Teacher Class Analytics excludes verified / positive verification rules
# ---------------------------------------------------------------------------


def test_bug01_class_analytics_excludes_verified_and_positive_rules(mem_db: Session) -> None:
    teacher = User(username="prof_bug01", password_hash="x", role="teacher", is_active=1)
    student = User(
        username="stu_bug01",
        full_name="Trần Minh Khoa",
        password_hash="x",
        role="user",
        is_active=1,
    )
    mem_db.add_all([teacher, student])
    mem_db.flush()

    cls = Class(name="Software Verification", teacher_id=teacher.id, join_code="CITRA-B01")
    mem_db.add(cls)
    mem_db.flush()
    mem_db.add(ClassMembership(class_id=cls.id, student_id=student.id))

    essay = EssayRecord(
        filename="Khoa_Thesis.pdf",
        num_pages=18,
        user_id=student.id,
        class_id=cls.id,
        cis_json=json.dumps({"score": 76.0}),
        job_status="completed",
    )
    mem_db.add(essay)
    mem_db.flush()

    mem_db.add_all(
        [
            # Positive verified verdicts MUST never appear in top_triggered_rules
            VerdictRecord(
                essay_id=essay.id,
                citation_raw="Vaswani et al. (2017). Attention Is All You Need.",
                label="verified",
                confidence=0.99,
                mapping_status="matched",
                triggered_rules=json.dumps(
                    ["R-LOCAL_DB_VERIFIED", "R-WELL-LINKED", "R-DOI-TITLE-AUTHOR"]
                ),
            ),
            # Metadata error carrying BOTH legacy positive tags AND genuine issue rule
            VerdictRecord(
                essay_id=essay.id,
                citation_raw="Devlin et al. (2020). BERT.",
                label="metadata_error",
                confidence=0.82,
                mapping_status="matched",
                triggered_rules=json.dumps(
                    [
                        "R-LOCAL_DB_VERIFIED",
                        "R-LOCAL_DB_GOOD_MATCH",
                        "R-KNOWN-PAPER",
                        "Đã xác minh khớp chính xác trong cơ sở dữ liệu học thuật cục bộ",
                        "R-YEAR-MISMATCH",
                    ]
                ),
            ),
            # Suspected hallucination with legal-document tag + fabricated legal rule
            VerdictRecord(
                essay_id=essay.id,
                citation_raw="Fake Law 888/2023/QH15.",
                label="suspected_hallucination",
                confidence=0.94,
                mapping_status="matched",
                triggered_rules=json.dumps(
                    ["R-LEGAL-DOCUMENT", "R-VN-LEGAL-FABRICATED", "R-FABRICATED-DOI"]
                ),
            ),
            # Verified Layer-2 verdict WITH genuine Layer-1 mapping issue -> keep issue rule, drop positive tag
            VerdictRecord(
                essay_id=essay.id,
                citation_raw="Kahneman & Tversky (1979). Prospect Theory.",
                label="verified",
                confidence=0.95,
                mapping_status="style_inconsistent",
                triggered_rules=json.dumps(["R-LOCAL_DB_VERIFIED", "R-STYLE-INCONSISTENT"]),
            ),
            # Resource verdict -> completely excluded
            VerdictRecord(
                essay_id=essay.id,
                citation_raw="Luật Doanh nghiệp 59/2020/QH14.",
                label="resource",
                confidence=0.96,
                mapping_status="matched",
                triggered_rules=json.dumps(["R-LEGAL-DOCUMENT", "R-VN-LEGAL-VERIFIED"]),
            ),
        ]
    )
    mem_db.commit()

    analytics = get_class_analytics(class_id=cls.id, teacher=teacher, db=mem_db)
    rule_ids = {r.rule_id for r in analytics.top_triggered_rules}

    assert rule_ids == {"R-YEAR-MISMATCH", "R-VN-LEGAL-FABRICATED", "R-FABRICATED-DOI", "R-STYLE-INCONSISTENT"}
    assert "R-LOCAL_DB_VERIFIED" not in rule_ids
    assert "R-WELL-LINKED" not in rule_ids
    assert "R-DOI-TITLE-AUTHOR" not in rule_ids
    assert "R-KNOWN-PAPER" not in rule_ids
    assert "R-LEGAL-DOCUMENT" not in rule_ids
    assert "R-VN-LEGAL-VERIFIED" not in rule_ids


# ---------------------------------------------------------------------------
# BUG-43: Teacher Pending Reviews & Admin Audit Log metadata enrichment
# ---------------------------------------------------------------------------


def test_bug43_teacher_pending_reviews_and_admin_audit_log_batch_enrichment(
    mem_db: Session,
) -> None:
    admin = User(username="admin_b43", password_hash="x", role="admin", is_active=1)
    teacher = User(username="prof_b43", password_hash="x", role="teacher", is_active=1)
    stu_named = User(
        username="sv_anh",
        full_name="Nguyễn Minh Anh",
        password_hash="x",
        role="user",
        is_active=1,
    )
    stu_noname = User(
        username="sv_noname",
        full_name=None,
        password_hash="x",
        role="user",
        is_active=1,
    )
    mem_db.add_all([admin, teacher, stu_named, stu_noname])
    mem_db.flush()

    cls = Class(name="CS401 Capstone", teacher_id=teacher.id, join_code="CITRA-B43")
    mem_db.add(cls)
    mem_db.flush()
    mem_db.add_all(
        [
            ClassMembership(class_id=cls.id, student_id=stu_named.id),
            ClassMembership(class_id=cls.id, student_id=stu_noname.id),
        ]
    )

    e1 = EssayRecord(
        filename="MinhAnh_Draft.pdf",
        num_pages=12,
        user_id=stu_named.id,
        class_id=cls.id,
        job_status="completed",
    )
    e2 = EssayRecord(
        filename="NoName_Report.docx",
        num_pages=6,
        user_id=stu_noname.id,
        class_id=None,  # enrolled student without explicit essay.class_id
        job_status="completed",
    )
    mem_db.add_all([e1, e2])
    mem_db.flush()

    v1 = VerdictRecord(
        essay_id=e1.id,
        citation_raw="Fake Author (2025). Hallucinated Paper.",
        label="suspected_hallucination",
        confidence=0.91,
        reasoning="Not found.",
        triggered_rules=json.dumps(["R-NO-CANDIDATE"]),
        mismatched_fields=json.dumps(["title"]),
        is_overridden=0,
    )
    v2 = VerdictRecord(
        essay_id=e2.id,
        citation_raw="Smith (2024). Wrong Year Paper.",
        label="metadata_error",
        confidence=0.80,
        reasoning="Year mismatch.",
        triggered_rules=json.dumps(["R-YEAR-MISMATCH"]),
        mismatched_fields=json.dumps(["year"]),
        is_overridden=0,
    )
    mem_db.add_all([v1, v2])
    mem_db.flush()

    mem_db.add_all(
        [
            AuditLog(
                verdict_id=v1.id,
                original_label="suspected_hallucination",
                new_label="verified",
                user="prof_b43",
                note="Confirmed print copy",
                logged_at=datetime(2026, 6, 1, 10, 0, tzinfo=UTC),
            ),
            AuditLog(
                verdict_id=v2.id,
                original_label="metadata_error",
                new_label="verified",
                user="admin_b43",
                note="Verified manually",
                logged_at=datetime(2026, 6, 1, 11, 0, tzinfo=UTC),
            ),
        ]
    )
    mem_db.commit()

    # 1. Teacher pending reviews exposes student_name, student_username, class_id, class_name
    pending = list_pending_reviews(class_id=cls.id, teacher=teacher, db=mem_db)
    by_vid = {item.verdict_id: item for item in pending}
    assert len(pending) == 2
    assert by_vid[v1.id].student_username == "sv_anh"
    assert by_vid[v1.id].student_name == "Nguyễn Minh Anh"
    assert by_vid[v1.id].class_id == cls.id
    assert by_vid[v1.id].class_name == "CS401 Capstone"
    assert by_vid[v2.id].student_username == "sv_noname"
    assert by_vid[v2.id].student_name == "sv_noname"  # falls back cleanly to username
    assert by_vid[v2.id].class_id == cls.id
    assert by_vid[v2.id].class_name == "CS401 Capstone"

    # 2. Admin audit log enriches essay_filename, student_name, student_username in batch (no N+1)
    executed_sql: list[str] = []

    def _count_queries(_conn, _cursor, statement, _params, _ctx, _many):
        executed_sql.append(statement)

    event.listen(mem_db.get_bind(), "before_cursor_execute", _count_queries)
    try:
        rows = list_audit(limit=50, offset=0, user=None, admin=admin, db=mem_db)
    finally:
        event.remove(mem_db.get_bind(), "before_cursor_execute", _count_queries)

    assert len(rows) == 2
    # Ordered DESC: v2 first, v1 second
    assert rows[0]["verdict_id"] == v2.id
    assert rows[0]["essay_id"] == e2.id
    assert rows[0]["essay_filename"] == "NoName_Report.docx"
    assert rows[0]["student_username"] == "sv_noname"
    assert rows[0]["student_name"] == "sv_noname"

    assert rows[1]["verdict_id"] == v1.id
    assert rows[1]["essay_id"] == e1.id
    assert rows[1]["essay_filename"] == "MinhAnh_Draft.pdf"
    assert rows[1]["student_username"] == "sv_anh"
    assert rows[1]["student_name"] == "Nguyễn Minh Anh"

    # 1 audit query + 1 verdicts batch + 1 essays batch + 1 users batch = 4 queries total
    assert len(executed_sql) <= 4


# ---------------------------------------------------------------------------
# BUG-18 & BUG-47: Circuit Breaker error sanitization & System Health telemetry
# ---------------------------------------------------------------------------


def test_bug18_circuit_breaker_sanitizes_raw_reprs_hex_and_quoted_citations() -> None:
    dirty_cases = [
        (
            "RetryError[<Future at 0x7f8a4291bc00 state=finished raised ReadTimeout>]",
            "Request timed out (timeout)",
        ),
        (
            "timeout (ReadTimeout: )",
            "Request timed out (timeout)",
        ),
        (
            "HTTP 5xx (RetryError: RetryError[<Future at 0x7f8a4291bc00 state=finished raised HTTPStatusError>])",
            "Upstream server error (HTTP 5xx)",
        ),
        (
            "HTTP 503: Client error '503 Service Unavailable' for url 'https://api.crossref.org/works?query=ConfidentialThesis'",
            "Upstream server error (HTTP 503)",
        ),
        (
            "OpenAlex failed for 'Secret Student Paper Title (2025)': HTTP 429 Too Many Requests",
            "Rate limited (HTTP 429)",
        ),
        (
            "ConnectError: [Errno 61] Connection refused",
            "Connection error",
        ),
        (
            "RetryError[<Future at 0x104a5b2c0 state=finished raised ValueError>]",
            "Upstream request failed",
        ),
    ]
    for raw, expected in dirty_cases:
        cleaned = sanitize_error_reason(raw)
        assert cleaned == expected, f"raw={raw!r} -> got {cleaned!r}"
        assert "RetryError" not in cleaned
        assert "<Future" not in cleaned
        assert "0x" not in cleaned
        assert "ConfidentialThesis" not in cleaned
        assert "Secret Student Paper" not in cleaned

    # Clean human-readable messages remain intact
    assert sanitize_error_reason("rate limit exceeded on polite pool") == "rate limit exceeded on polite pool"
    assert sanitize_error_reason("") is None
    assert sanitize_error_reason(None) is None

    # Verify record_infra_failure + snapshot_all both emit sanitized last_error
    reg = CircuitBreakerRegistry(failure_threshold=4, recovery_timeout_seconds=30.0)
    reg.record_infra_failure(
        "crossref",
        "RetryError[<Future at 0x7f8a4291bc00 state=finished raised ReadTimeout>] for 'Student Private Citation'",
        latency_ms=1200.0,
    )
    snap = reg.snapshot_all()["crossref"]
    assert snap["last_error"] == "Request timed out (timeout)"
    assert snap["timeout_count"] == 1
    assert snap["http_429_count"] == 0  # hex address containing 429 must not misclassify


def test_bug47_system_health_exposes_checked_at_degraded_sources_and_upstream_status(
    mem_db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from integrity_checker.api.routes import system as system_mod

    admin = User(username="admin_b47", password_hash="x", role="admin", is_active=1)
    mem_db.add(admin)
    mem_db.commit()

    monkeypatch.setattr(
        system_mod,
        "_get_grobid_health",
        lambda: SimpleNamespace(available=False, container_running=False, parser_mode="regex"),
    )

    reset_circuit_breaker_registry()
    try:
        reg = get_circuit_breaker_registry()
        # Clean healthy state
        health_ok = get_system_health(admin=admin, db=mem_db)
        assert health_ok["status"] == "ok"
        assert health_ok["upstream_status"] == "ok"
        assert health_ok["degraded_sources"] == []
        # Valid ISO-8601 checked_at timestamp
        parsed_dt = datetime.fromisoformat(health_ok["checked_at"])
        assert parsed_dt.tzinfo is not None

        # Trigger all 3 degradation criteria across separate sources:
        # 1) openalex: OPEN state (4 failures)
        for _ in range(4):
            reg.record_infra_failure("openalex", "HTTP 503 Service Unavailable")
        # 2) dblp: consecutive_failures == 2 (still closed)
        reg.record_infra_failure("dblp", "timeout (ReadTimeout: )")
        reg.record_infra_failure("dblp", "timeout (ReadTimeout: )")
        # 3) arxiv: total_calls >= 3 and success_count/total_calls < 0.80 (3/5 = 0.60, consecutive_failures = 0)
        reg.record_infra_failure("arxiv", "HTTP 502 Bad Gateway")
        reg.record_infra_failure("arxiv", "HTTP 502 Bad Gateway")
        reg.record_success("arxiv", latency_ms=100.0)
        reg.record_success("arxiv", latency_ms=110.0)
        reg.record_success("arxiv", latency_ms=120.0)
        # 4) crossref: healthy (4/5 = 0.80, closed, consecutive_failures = 0) -> NOT degraded
        reg.record_infra_failure("crossref", "HTTP 429")
        for _ in range(4):
            reg.record_success("crossref", latency_ms=80.0)
        # 5) datacite: 1 failure + 1 success (total_calls = 2 < 3, consecutive = 0) -> NOT degraded
        reg.record_infra_failure("datacite", "HTTP 503")
        reg.record_success("datacite", latency_ms=90.0)

        health_deg = get_system_health(admin=admin, db=mem_db)
        assert health_deg["status"] == "ok"  # core DB/cache/parser still ok
        assert health_deg["upstream_status"] == "degraded"
        assert health_deg["degraded_sources"] == ["arxiv", "dblp", "openalex"]
        # Ensure sanitized last_error surfaces cleanly inside upstream_sources
        assert health_deg["upstream_sources"]["dblp"]["last_error"] == "Request timed out (timeout)"
    finally:
        reset_circuit_breaker_registry()


# ---------------------------------------------------------------------------
# BUG-07 & BUG-21: Scanned PDF bilingual warning messages & unscannable CIS flag
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bug07_bug21_scanned_pdf_bilingual_diagnostics_and_unscannable_flag() -> None:
    # 1. Fallback diagnostic reconstruction (no style_profile_json persisted)
    scanned_essay = SimpleNamespace(
        id=101,
        filename="scanned_thesis.pdf",
        num_pages=5,
        uploaded_at=datetime(2026, 6, 1, tzinfo=UTC),
        style_profile_json=None,
        cis_json=None,
    )
    resp = _json_response("scanned_thesis.pdf", scanned_essay, verdicts=[], citations=[])
    payload = await _read_streaming_json(resp)

    diag = payload["document_diagnostics"]
    assert diag["is_scanned_pdf"] is True
    assert diag["is_unscannable"] is True
    assert diag["warning_code"] == "SCANNED_PDF_DETECTED"
    assert diag["warning_message"] == SCANNED_PDF_WARNING_VI
    assert diag["warning_message_vi"] == SCANNED_PDF_WARNING_VI
    assert diag["warning_message_en"] == SCANNED_PDF_WARNING_EN
    assert "Scanned or image-only PDF detected" in diag["warning_message_en"]

    assert payload["cis"]["is_unscannable"] is True
    assert payload["cis"]["risk_level"] == "unscannable"

    # 2. Legacy persisted document_diagnostics (only had warning_message) gets enriched with _en & _vi
    legacy_sp = {
        "document_diagnostics": {
            "is_scanned_pdf": True,
            "scanned_pages_count": 3,
            "warning_code": "SCANNED_PDF_DETECTED",
            "warning_message": SCANNED_PDF_WARNING_VI,
        }
    }
    enriched = _extract_document_diagnostics(scanned_essay, legacy_sp, citations=[], verdicts=[])
    assert enriched["warning_message_en"] == SCANNED_PDF_WARNING_EN
    assert enriched["warning_message_vi"] == SCANNED_PDF_WARNING_VI
    assert enriched["is_unscannable"] is True

    # 3. Normal non-scanned PDF is NOT unscannable
    normal_essay = SimpleNamespace(
        id=102,
        filename="digital_thesis.pdf",
        num_pages=4,
        uploaded_at=datetime(2026, 6, 1, tzinfo=UTC),
        style_profile_json=json.dumps(
            {"document_diagnostics": {"is_scanned_pdf": False, "scanned_pages_count": 0}}
        ),
        cis_json=json.dumps({"score": 92.0}),
    )
    normal_resp = _json_response("digital_thesis.pdf", normal_essay, verdicts=[], citations=[])
    normal_payload = await _read_streaming_json(normal_resp)
    assert normal_payload["document_diagnostics"]["is_scanned_pdf"] is False
    assert normal_payload["document_diagnostics"]["is_unscannable"] is False
    assert normal_payload["document_diagnostics"]["warning_message_en"] is None
    assert normal_payload["cis"]["is_unscannable"] is False
    assert "risk_level" not in normal_payload["cis"]


# ---------------------------------------------------------------------------
# BUG-25 & BUG-07: Sandbox verify gibberish fast-path, mapping_status, VN Legal & Fabricated DOI
# ---------------------------------------------------------------------------


def test_bug25_bug07_sandbox_gibberish_not_applicable_vn_legal_and_fabricated_doi(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if hasattr(essays_route, "_sandbox_verify_rate_buckets"):
        essays_route._sandbox_verify_rate_buckets.clear()

    retrieve_calls: list[str] = []

    class _SpyOrchestrator:
        _local_db = None

        async def retrieve(self, cit: Citation, **_kw) -> SourceResult:
            retrieve_calls.append(cit.raw_text)
            if "attention is all you need" in (cit.raw_text or "").lower():
                return SourceResult(
                    citation_raw=cit.raw_text,
                    candidates=[
                        SourceCandidate(
                            source_name="crossref",
                            found=True,
                            doi="10.48550/arXiv.1706.03762",
                            title="Attention Is All You Need",
                            authors=["Ashish Vaswani", "Noam Shazeer"],
                            year="2017",
                            venue="NeurIPS",
                            confidence=0.98,
                        )
                    ],
                    sources_queried=["crossref"],
                    sources_succeeded=["crossref"],
                )
            return SourceResult(
                citation_raw=cit.raw_text,
                candidates=[],
                sources_queried=["crossref"],
                sources_succeeded=[],
                sources_failed={"crossref": "No results for query"},
            )

    real_checker = NeuroSymbolicChecker()
    fake_pipeline = IntegrityPipeline(
        orchestrator=_SpyOrchestrator(),  # type: ignore[arg-type]
        checker=real_checker,
    )
    fake_user = User(
        id=999,
        username="sandbox_pro_tester",
        password_hash="x",
        role="user",
        plan_tier="pro",
        is_active=1,
    )

    app.dependency_overrides[deps.get_pipeline] = lambda: fake_pipeline
    app.dependency_overrides[deps.get_current_user] = lambda: fake_user
    try:
        client = TestClient(app)

        # 1. Gibberish input fast-path (ZERO orchestrator calls, mapping_status='not_applicable')
        retrieve_calls.clear()
        resp_gib_en = client.post(
            "/api/essays/sandbox/verify",
            json={"references_text": "asdfghjkl 12345", "lang": "en", "style": "apa"},
        )
        assert resp_gib_en.status_code == 200, resp_gib_en.text
        body_gib = resp_gib_en.json()
        assert retrieve_calls == [], f"Gibberish must NOT hit external APIs: {retrieve_calls}"
        assert body_gib["total"] == 1
        assert body_gib["summary"]["layer1_linking_issues"] == 0
        r_gib = body_gib["results"][0]
        assert r_gib["label"] == "unresolved"
        assert r_gib["mapping_status"] == "not_applicable"
        assert r_gib["is_invalid_input"] is True
        assert "valid bibliographic citation" in r_gib["reasoning"].lower()
        assert "reasoning_en" in r_gib and "reasoning_vi" in r_gib
        assert r_gib["remediated_apa"] is None

        # Short gibberish in Vietnamese
        resp_gib_vi = client.post(
            "/api/essays/sandbox/verify",
            json={"references_text": "hello world", "lang": "vi", "style": "apa"},
        )
        assert resp_gib_vi.status_code == 200, resp_gib_vi.text
        assert retrieve_calls == []
        r_gib_vi = resp_gib_vi.json()["results"][0]
        assert r_gib_vi["mapping_status"] == "not_applicable"
        assert "không giống một trích dẫn học thuật hợp lệ" in r_gib_vi["reasoning"].lower()

        # 2. Bibliography-only Quick Paste sets mapping_status='not_applicable' (not misleading 'matched')
        resp_quick = client.post(
            "/api/essays/sandbox/verify",
            json={
                "references_text": "Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need. NeurIPS.",
                "lang": "en",
                "style": "apa",
            },
        )
        assert resp_quick.status_code == 200, resp_quick.text
        body_quick = resp_quick.json()
        assert body_quick["summary"]["layer1_linking_issues"] == 0
        assert body_quick["results"][0]["mapping_status"] == "not_applicable"
        assert "Direct bibliography verification" in body_quick["results"][0]["mapping_note"]

        # 3. Fabricated DOI returns rich bilingual EN & VI explanations and skips orchestrator
        retrieve_calls.clear()
        fab_doi_ref = "Nguyen, T. (2024). Synthetic Hallucinated Paper. Journal of AI. https://doi.org/10.9999/fake.doi.2024"
        resp_doi_en = client.post(
            "/api/essays/sandbox/verify",
            json={"references_text": fab_doi_ref, "lang": "en", "style": "apa"},
        )
        assert resp_doi_en.status_code == 200, resp_doi_en.text
        assert retrieve_calls == []
        r_doi_en = resp_doi_en.json()["results"][0]
        assert "R-FABRICATED-DOI" in r_doi_en["triggered_rules"]
        assert r_doi_en["label"] == "suspected_hallucination"
        assert "10.9999/fake.doi.2024" in r_doi_en["reasoning"]
        assert "invalid or placeholder doi" in r_doi_en["reasoning"].lower()
        assert "10.9999/fake.doi.2024" in r_doi_en["reasoning_vi"]
        assert "không hợp lệ" in r_doi_en["reasoning_vi"].lower()

        resp_doi_vi = client.post(
            "/api/essays/sandbox/verify",
            json={"references_text": fab_doi_ref, "lang": "vi", "style": "apa"},
        )
        assert resp_doi_vi.status_code == 200, resp_doi_vi.text
        r_doi_vi = resp_doi_vi.json()["results"][0]
        assert "không hợp lệ" in r_doi_vi["reasoning"].lower()
        assert "invalid or placeholder doi" in r_doi_vi["reasoning_en"].lower()

        # 4. VN Legal citations respect lang='en' and return bilingual EN & VI explanations
        vn_legal_valid = "Quốc hội (2020). Luật Doanh nghiệp số 59/2020/QH14 ban hành ngày 17/06/2020."
        resp_law_en = client.post(
            "/api/essays/sandbox/verify",
            json={"references_text": vn_legal_valid, "lang": "en", "style": "apa"},
        )
        assert resp_law_en.status_code == 200, resp_law_en.text
        r_law_en = resp_law_en.json()["results"][0]
        assert "R-VN-LEGAL-VERIFIED" in r_law_en["triggered_rules"]
        assert "Verified valid Vietnamese legal statute" in r_law_en["reasoning"]
        assert "Đã xác thực" not in r_law_en["reasoning"]
        assert "Đã xác thực" in r_law_en["reasoning_vi"]

        vn_legal_fab = "Quốc hội (2023). Luật An ninh Lượng tử số 888/2023/QH15."
        resp_law_fab_en = client.post(
            "/api/essays/sandbox/verify",
            json={"references_text": vn_legal_fab, "lang": "en", "style": "apa"},
        )
        assert resp_law_fab_en.status_code == 200, resp_law_fab_en.text
        r_law_fab = resp_law_fab_en.json()["results"][0]
        assert "R-VN-LEGAL-FABRICATED" in r_law_fab["triggered_rules"]
        assert "Unverified Vietnamese legal document" in r_law_fab["reasoning"]
        assert "Phát hiện sai lệch" not in r_law_fab["reasoning"]
        assert "Phát hiện sai lệch" in r_law_fab["reasoning_vi"]
        assert "bịa đặt" not in r_law_fab["reasoning_vi"].lower()
    finally:
        app.dependency_overrides.pop(deps.get_pipeline, None)
        app.dependency_overrides.pop(deps.get_current_user, None)
        if hasattr(essays_route, "_sandbox_verify_rate_buckets"):
            essays_route._sandbox_verify_rate_buckets.clear()


# ---------------------------------------------------------------------------
# BUG-28: Cross-File Revision Diff prevents spurious v1 -> v2 matching
# ---------------------------------------------------------------------------


def test_bug28_revision_diff_blocks_cross_format_and_numeric_stems() -> None:
    class _V:
        def __init__(self, raw: str, label: str) -> None:
            self.citation_raw = raw
            self.label = label
            self.triggered_rules = "[]"
            self.features = "{}"

    class _E:
        def __init__(self, eid: int, filename: str, cis: float) -> None:
            self.id = eid
            self.filename = filename
            self.user_id = 42
            self.uploaded_at = datetime(2026, 6, 1, tzinfo=UTC)
            self.job_status = "completed"
            self.cis_json = json.dumps({"score": cis})

    class _Repo:
        def __init__(self, essays: list[_E], vmap: dict[int, list[_V]]) -> None:
            self._essays = essays
            self._vmap = vmap

        def get_user_essays(self, _uid: int) -> list[_E]:
            return self._essays

        def get_verdicts(self, eid: int) -> list[_V]:
            return self._vmap.get(eid, [])

    v_list = [_V("Vaswani et al. (2017). Attention Is All You Need.", "verified")]

    # 1. 10.bib vs 10.ris MUST NOT auto-compare as v1 -> v2
    e_bib = _E(1, "10.bib", 80.0)
    e_ris = _E(2, "10.ris", 90.0)
    repo_bib_ris = _Repo([e_ris, e_bib], {1: v_list, 2: v_list})
    assert _compute_revision_diff(repo_bib_ris, e_ris, v_list) is None  # type: ignore[arg-type]

    # 2. Same descriptive stem across DIFFERENT bibliography export formats (.bib vs .ris) MUST NOT auto-compare
    e_named_bib = _E(3, "climate_citations.bib", 80.0)
    e_named_ris = _E(4, "climate_citations.ris", 90.0)
    repo_named_fmt = _Repo([e_named_ris, e_named_bib], {3: v_list, 4: v_list})
    assert _compute_revision_diff(repo_named_fmt, e_named_ris, v_list) is None  # type: ignore[arg-type]

    # 3. Purely numeric stem (10.pdf vs 10.pdf) MUST NOT auto-compare
    e_num1 = _E(5, "10.pdf", 70.0)
    e_num2 = _E(6, "10.pdf", 85.0)
    repo_num = _Repo([e_num2, e_num1], {5: v_list, 6: v_list})
    assert _compute_revision_diff(repo_num, e_num2, v_list) is None  # type: ignore[arg-type]

    # 4. Explicit compare_with STILL works even for 10.bib vs 10.ris
    explicit_diff = _compute_revision_diff(
        repo_bib_ris, e_ris, v_list, compare_with_id=e_bib.id  # type: ignore[arg-type]
    )
    assert explicit_diff is not None
    assert explicit_diff["previous_essay_id"] == e_bib.id

    # 5. Legitimate manuscript v1.pdf -> v2_fixed.docx STILL auto-matches cleanly
    e_ms1 = _E(10, "Graduation_Thesis_v1.pdf", 65.0)
    e_ms2 = _E(11, "Graduation_Thesis_v2_fixed.docx", 95.0)
    repo_ms = _Repo([e_ms2, e_ms1], {10: v_list, 11: v_list})
    ms_diff = _compute_revision_diff(repo_ms, e_ms2, v_list)  # type: ignore[arg-type]
    assert ms_diff is not None
    assert ms_diff["previous_essay_id"] == 10
    assert ms_diff["is_same_manuscript_family"] is True
