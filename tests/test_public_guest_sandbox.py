"""Tests for Task 3.1: Public Rate-Limited Instant Guest Citation Checker
(`POST /api/essays/sandbox/public-verify`).
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from integrity_checker.api import deps
from integrity_checker.api.main import create_app
from integrity_checker.api.routes import essays as essays_route
from integrity_checker.db import session as db_session_mod
from integrity_checker.db.models import Base
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline


@pytest.fixture()
def public_guest_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolated FastAPI + SQLite environment with reset public sandbox rate-limit buckets."""
    db_path = tmp_path / "public_guest_sandbox.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _conn_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def _get_session() -> Session:
        return session_factory()

    def _override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(db_session_mod, "get_session", _get_session)
    if hasattr(essays_route, "_public_sandbox_rate_buckets"):
        essays_route._public_sandbox_rate_buckets.clear()

    observed_serpapi_flags: list[bool | None] = []

    class _GuestSpyOrchestrator:
        async def retrieve(
            self, cit: Citation, *, allow_serpapi: bool | None = None
        ) -> SourceResult:
            observed_serpapi_flags.append(allow_serpapi)
            raw_lower = (cit.raw_text or "").lower()
            if "qjae994" in raw_lower or "invented" in raw_lower:
                return SourceResult(
                    citation_raw=cit.raw_text,
                    candidates=[],
                    sources_queried=["crossref", "openalex"],
                    sources_succeeded=[],
                    sources_failed={
                        "crossref": "No results found",
                        "openalex": "No results found",
                    },
                )
            return SourceResult(
                citation_raw=cit.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        doi="10.1257/aer.91.5.1369",
                        title="The Colonial Origins of Comparative Development: An Empirical Investigation",
                        authors=[
                            "Daron Acemoglu",
                            "Simon Johnson",
                            "James A. Robinson",
                        ],
                        year="2001",
                        venue="American Economic Review",
                        confidence=0.985,
                    )
                ],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=["crossref"],
            )

    class _GuestSpyChecker:
        def check(
            self, citation: Citation, source: SourceResult, **_kw
        ) -> CitationVerdict:
            if not source.candidates:
                return CitationVerdict(
                    citation=citation,
                    label=ValidationLabel.SUSPECTED_HALLUCINATION,
                    confidence=0.94,
                    reasoning="DOI 10.1093/qje/qjae994 does not resolve and zero scholarly records match.",
                    triggered_rules=["R-NONEXISTENT-DOI", "R-NO-SCHOLARLY-RECORD"],
                    mismatched_fields=["doi", "title"],
                    matched_source=source,
                )
            cited_yr = str(citation.year or "")
            if cited_yr and cited_yr != "2001":
                return CitationVerdict(
                    citation=citation,
                    label=ValidationLabel.METADATA_ERROR,
                    confidence=0.885,
                    reasoning=f"Publication year mismatch: cited {cited_yr} vs 2001.",
                    triggered_rules=["R-YEAR-MISMATCH"],
                    mismatched_fields=["year"],
                    matched_source=source,
                )
            return CitationVerdict(
                citation=citation,
                label=ValidationLabel.VERIFIED,
                confidence=0.985,
                reasoning="Confirmed exact DOI, title, authors, and publication year in Crossref.",
                triggered_rules=["R-DOI-TITLE-AUTHOR", "R-WELL-LINKED"],
                mismatched_fields=[],
                matched_source=source,
            )

    fake_pipeline = IntegrityPipeline(
        orchestrator=_GuestSpyOrchestrator(),  # type: ignore[arg-type]
        checker=_GuestSpyChecker(),  # type: ignore[arg-type]
    )

    app = create_app()
    app.dependency_overrides[deps.get_db] = _override_get_db
    app.dependency_overrides[deps.get_pipeline] = lambda: fake_pipeline

    try:
        yield SimpleNamespace(
            app=app,
            client=TestClient(app),
            observed_serpapi_flags=observed_serpapi_flags,
        )
    finally:
        if hasattr(essays_route, "_public_sandbox_rate_buckets"):
            essays_route._public_sandbox_rate_buckets.clear()
        app.dependency_overrides.clear()
        engine.dispose()


def test_public_verify_rejects_empty_or_whitespace_without_auth(public_guest_env) -> None:
    """1. Unauthenticated POST /api/essays/sandbox/public-verify rejects empty/whitespace input with 400."""
    for bad_text, lang in [("", "en"), ("   \n\t  ", "vi")]:
        resp = public_guest_env.client.post(
            "/api/essays/sandbox/public-verify",
            json={"references_text": bad_text, "lang": lang},
        )
        assert resp.status_code == 400, resp.text
        detail = resp.json().get("detail", "")
        assert isinstance(detail, str) and len(detail) > 10


def test_public_verify_rejects_over_1500_chars_and_over_3_references(
    public_guest_env,
) -> None:
    """2. Rejects > 1500 chars with 400 and > 3 references with 400 inviting full manuscript upload."""
    long_text = (
        "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). "
        "The colonial origins of comparative development. American Economic Review, 91(5), 1369-1401. "
    ) * 14
    assert len(long_text) > 1500

    resp_long = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        json={"references_text": long_text, "lang": "en"},
    )
    assert resp_long.status_code == 400, resp_long.text
    detail_long = resp_long.json().get("detail", "")
    assert "1,500" in detail_long or "1500" in detail_long

    four_apa_refs = "\n".join(
        [
            "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). The colonial origins of comparative development. American Economic Review, 91(5), 1369-1401.",
            "Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263-291.",
            "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.",
            "Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers. NAACL-HLT.",
        ]
    )
    assert len(four_apa_refs) <= 1500

    resp_four = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        json={"references_text": four_apa_refs, "lang": "en"},
    )
    assert resp_four.status_code == 400, resp_four.text
    detail_four = resp_four.json().get("detail", "").lower()
    assert "3" in detail_four
    assert any(w in detail_four for w in ("upload", "manuscript", "pdf", "word", "full"))

    # Also test 4 distinct unformatted lines that could otherwise merge or fall back
    four_plain_lines = "\n".join(
        [
            "Reference Alpha 2020 https://example.org/paper-alpha",
            "Reference Beta 2021 https://example.org/paper-beta",
            "Reference Gamma 2022 https://example.org/paper-gamma",
            "Reference Delta 2023 https://example.org/paper-delta",
        ]
    )
    resp_four_lines = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        json={"references_text": four_plain_lines, "lang": "vi"},
    )
    assert resp_four_lines.status_code == 400, resp_four_lines.text
    assert "3" in resp_four_lines.json().get("detail", "")


def test_public_verify_verifies_valid_mismatched_and_fabricated_without_auth_and_disables_serpapi(
    public_guest_env,
) -> None:
    """3. Verifies valid, mismatched, & fabricated citations without Authorization header while forcing allow_serpapi=False."""
    three_mixed_refs = "\n\n".join(
        [
            "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). The colonial origins of comparative development: An empirical investigation. American Economic Review, 91(5), 1369-1401. https://doi.org/10.1257/aer.91.5.1369",
            "Acemoglu, D., Johnson, S., & Robinson, J. A. (2003). The colonial origins of comparative development: An empirical investigation. American Economic Review, 91(5), 1369-1401. https://doi.org/10.1257/aer.91.5.1369",
            "Nguyen, T. H., & Morrison, D. R. (2024). Invented macroeconomic resilience of digital supply chains. Quarterly Journal of Economics, 139(4), 2145-2180. https://doi.org/10.1093/qje/qjae994",
        ]
    )

    # Deliberately omit Authorization header
    resp = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        json={"references_text": three_mixed_refs, "lang": "en"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["total"] == 3
    assert body["summary"]["verified"] == 1
    assert body["summary"]["metadata_error"] == 1
    assert body["summary"]["suspected_hallucination"] == 1
    assert len(body["results"]) == 3

    labels = [r["label"] for r in body["results"]]
    assert labels == ["verified", "metadata_error", "suspected_hallucination"]

    # Repaired APA text is provided for verified & metadata_error entries
    assert isinstance(body.get("remediation"), dict)
    assert isinstance(body.get("remediated_apa"), str) and "2001" in body["remediated_apa"]
    assert body["results"][1].get("remediated_apa") and "2001" in body["results"][1]["remediated_apa"]

    # Paid SerpAPI fallback MUST be strictly False for all guest checks
    assert len(public_guest_env.observed_serpapi_flags) == 3
    assert all(flag is False for flag in public_guest_env.observed_serpapi_flags)


def test_public_verify_enforces_sliding_window_ip_rate_limit_6_per_60s(
    public_guest_env,
) -> None:
    """4. First 6 calls from the same IP succeed (200), 7th rapid call returns 429 with Retry-After header."""
    payload = {
        "references_text": (
            "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). "
            "The colonial origins of comparative development. American Economic Review, 91(5), 1369-1401."
        ),
        "lang": "en",
    }
    ip_headers = {"X-Real-IP": "198.51.100.24"}

    for call_num in range(1, 7):
        ok_resp = public_guest_env.client.post(
            "/api/essays/sandbox/public-verify",
            headers=ip_headers,
            json=payload,
        )
        assert ok_resp.status_code == 200, f"Call #{call_num} failed unexpectedly: {ok_resp.text}"

    # 7th rapid call from the same IP must be rejected with 429 + Retry-After
    throttled_resp = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        headers=ip_headers,
        json=payload,
    )
    assert throttled_resp.status_code == 429, throttled_resp.text
    retry_after = throttled_resp.headers.get("Retry-After")
    assert retry_after is not None and int(retry_after) >= 1

    # different client IP has its own independent bucket and succeeds
    other_ip_resp = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        headers={"X-Real-IP": "198.51.100.77"},
        json=payload,
    )
    assert other_ip_resp.status_code == 200, other_ip_resp.text


def test_public_verify_consumes_rate_limit_before_ref_parser_while_keeping_empty_and_over_1500_cheap(
    public_guest_env,
) -> None:
    """5. CPU abuse protection: empty & >1500 char pre-checks do NOT consume tokens,
    but valid-length payloads consume rate-limit tokens BEFORE parse_reference_section runs
    so flooding 4-reference regex payloads triggers 429 on the 7th attempt.
    """
    ip_headers = {"X-Real-IP": "198.51.100.88"}

    # Empty & >1500 char pre-checks remain cheap 400s without consuming rate-limit tokens
    for _ in range(4):
        r_empty = public_guest_env.client.post(
            "/api/essays/sandbox/public-verify",
            headers=ip_headers,
            json={"references_text": "   ", "lang": "en"},
        )
        assert r_empty.status_code == 400
        r_long = public_guest_env.client.post(
            "/api/essays/sandbox/public-verify",
            headers=ip_headers,
            json={"references_text": "X" * 1505, "lang": "en"},
        )
        assert r_long.status_code == 400

    four_inline_apa = (
        "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). Colonial origins. AER, 91(5), 1369-1401. "
        "Kahneman, D., & Tversky, A. (1979). Prospect theory. Econometrica, 47(2), 263-291. "
        "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. NeurIPS, 30. "
        "Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT. NAACL-HLT."
    )

    # First 6 calls with 4-ref payloads consume rate-limit tokens and return 400 (> 3 refs)
    for attempt in range(1, 7):
        resp_400 = public_guest_env.client.post(
            "/api/essays/sandbox/public-verify",
            headers=ip_headers,
            json={"references_text": four_inline_apa, "lang": "en"},
        )
        assert resp_400.status_code == 400, f"Attempt #{attempt}: {resp_400.text}"

    # 7th rapid 4-ref payload MUST be blocked with 429 BEFORE regex reference parsing runs
    resp_429 = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        headers=ip_headers,
        json={"references_text": four_inline_apa, "lang": "en"},
    )
    assert resp_429.status_code == 429, resp_429.text
    assert int(resp_429.headers.get("Retry-After", "0")) >= 1


def test_public_verify_entry_boundary_counting_handles_inline_mixed_urls_and_wrapped_pdfs(
    public_guest_env,
) -> None:
    """6. Entry-boundary counting accurately rejects (a) 4 inline APA on 1 line and
    (b) 1 APA + 3 bare URLs, while allowing (c) 2 multi-line PDF-wrapped refs with bare years in titles
    and (d) 1 legitimate 4-line wrapped (n.d.) reference.
    """
    # (a) 4 inline APA references pasted on 1 single line -> rejected (400)
    case_a_inline_four = (
        "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). Colonial origins. AER, 91(5), 1369-1401. "
        "Kahneman, D., & Tversky, A. (1979). Prospect theory. Econometrica, 47(2), 263-291. "
        "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. NeurIPS, 30. "
        "Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT. NAACL-HLT."
    )
    resp_a = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        headers={"X-Real-IP": "198.51.100.101"},
        json={"references_text": case_a_inline_four, "lang": "en"},
    )
    assert resp_a.status_code == 400, resp_a.text

    # (b) 1 APA reference + 3 bare https://arxiv.org/abs/... URL lines -> rejected (400)
    case_b_mixed_urls = "\n".join(
        [
            "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001). Colonial origins. American Economic Review, 91(5), 1369-1401.",
            "https://arxiv.org/abs/1706.03762",
            "https://arxiv.org/abs/1810.04805",
            "https://arxiv.org/abs/2005.14165",
        ]
    )
    resp_b = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        headers={"X-Real-IP": "198.51.100.102"},
        json={"references_text": case_b_mixed_urls, "lang": "en"},
    )
    assert resp_b.status_code == 400, resp_b.text

    # (c) 2 legitimate multi-line PDF-wrapped references (8 lines total, bare years in titles, trailing DOI line) -> 200 OK
    case_c_wrapped_two = "\n".join(
        [
            "Acemoglu, D., Johnson, S., & Robinson, J. A. (2001).",
            "The colonial origins of comparative development: Evidence from 2019 and 2020 surveys.",
            "American Economic Review, 91(5), 1369-1401.",
            "https://doi.org/10.1257/aer.91.5.1369",
            "Kahneman, D., & Tversky, A. (1979).",
            "Prospect theory: Study of 2019–2020 markets under risk.",
            "Econometrica, 47(2), 263-291.",
            "https://doi.org/10.2307/1914185",
        ]
    )
    resp_c = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        headers={"X-Real-IP": "198.51.100.103"},
        json={"references_text": case_c_wrapped_two, "lang": "en"},
    )
    assert resp_c.status_code == 200, resp_c.text
    assert resp_c.json()["total"] == 2

    # (d) 1 legitimate 4-line wrapped (n.d.) reference across 4 lines without blank lines -> 200 OK
    case_d_wrapped_nd = "\n".join(
        [
            "World Health Organization.",
            "(n.d.). Global guidelines on digital health interventions.",
            "World Health Organization Press.",
            "https://www.who.int/publications/i/item/9789241550505",
        ]
    )
    resp_d = public_guest_env.client.post(
        "/api/essays/sandbox/public-verify",
        headers={"X-Real-IP": "198.51.100.104"},
        json={"references_text": case_d_wrapped_nd, "lang": "en"},
    )
    assert resp_d.status_code == 200, resp_d.text
    assert 1 <= resp_d.json()["total"] <= 2
