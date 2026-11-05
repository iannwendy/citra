"""Regression tests for Audit Batch P0 fixes (BUG-01, BUG-06, BUG-07, BUG-17, BUG-18, BUG-19)."""

from __future__ import annotations

import asyncio
from io import BytesIO
from unittest.mock import patch

import fitz
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from integrity_checker.api.deps import get_db
from integrity_checker.api.main import app
from integrity_checker.db.models import Base, EssayRecord, User
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.features import MatchFeatures
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, ValidationLabel
from integrity_checker.retrieval.link_validator import LinkCheckResult, LinkStatus
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


def _make_valid_pdf_bytes(num_pages: int = 1) -> bytes:
    doc = fitz.open()
    for i in range(num_pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"Sample academic text page {i + 1}.")
    data = doc.tobytes()
    doc.close()
    return data


@pytest.mark.asyncio
async def test_bug01_concurrent_retrieve_archive_url_no_race() -> None:
    """BUG-01: Concurrent URL validations on a shared RetrievalOrchestrator must not
    clobber archive_url via shared self._last_archive_url state."""

    class StaggeredValidator:
        async def validate_url(self, url: str) -> LinkCheckResult:
            if "archived-site" in url:
                await asyncio.sleep(0.01)
                return LinkCheckResult(
                    url=url,
                    status=LinkStatus.ARCHIVED_ALIVE,
                    status_code=200,
                    archive_url="https://web.archive.org/web/20250101000000/" + url,
                )
            await asyncio.sleep(0.02)
            return LinkCheckResult(
                url=url,
                status=LinkStatus.ALIVE,
                status_code=200,
                archive_url=None,
            )

    orch = RetrievalOrchestrator(
        use_local_db=False,
        enable_link_validation=True,
        link_validator=StaggeredValidator(),  # type: ignore[arg-type]
    )

    # Simulate an async interleaving where cit_archived finishes validate_url at t=10ms,
    # cit_live finishes validate_url at t=20ms (wiping self._last_archive_url = None),
    # and cit_archived constructs SourceResult at t=30ms.
    orig_validate_fn = RetrievalOrchestrator._validate_citation_url_with_archive

    async def yielding_validate(
        self_obj: RetrievalOrchestrator, cit: Citation
    ) -> tuple[str | None, int | None, str | None]:
        res = await orig_validate_fn(self_obj, cit)
        if cit.url and "archived-site" in cit.url:
            await asyncio.sleep(0.02)
        return res

    with patch.object(RetrievalOrchestrator, "_validate_citation_url_with_archive", yielding_validate):
        cit_archived = Citation(
            raw_text="https://archived-site.org/legacy-guide",
            url="https://archived-site.org/legacy-guide",
            citation_type=CitationType.REFERENCE_LIST,
        )
        cit_live = Citation(
            raw_text="https://live-site.org/current-docs",
            url="https://live-site.org/current-docs",
            citation_type=CitationType.REFERENCE_LIST,
        )

        res_archived, res_live = await asyncio.gather(
            orch.retrieve(cit_archived),
            orch.retrieve(cit_live),
        )

    assert res_archived.url_status == "archived_alive"
    assert (
        res_archived.archive_url
        == "https://web.archive.org/web/20250101000000/https://archived-site.org/legacy-guide"
    )
    assert res_live.url_status == "alive"
    assert res_live.archive_url is None


def test_bug06a_chimeric_known_author_wrong_title_and_stolen_doi() -> None:
    """BUG-06a: Vaswani (2017) + completely fabricated title + stolen ResNet DOI
    must be SUSPECTED_HALLUCINATION (R-CHIMERIC-DOI-MISMATCH), NOT METADATA_ERROR."""
    checker = NeuroSymbolicChecker(enable_content_alignment=False)
    citation = Citation(
        raw_text=(
            "Vaswani, A., Shazeer, N., & Parmar, N. (2017). "
            "Hyperbolic quantum graph topology for autonomous underwater swarm navigation. "
            "Advances in Neural Information Processing Systems. https://doi.org/10.1109/CVPR.2016.90"
        ),
        authors=["Vaswani, A.", "Shazeer, N.", "Parmar, N."],
        year=2017,
        title="Hyperbolic quantum graph topology for autonomous underwater swarm navigation",
        venue="Advances in Neural Information Processing Systems",
        doi="10.1109/CVPR.2016.90",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    source = SourceResult(
        citation_raw=citation.raw_text,
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                doi="10.1109/cvpr.2016.90",
                title="Deep Residual Learning for Image Recognition",
                authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
                year="2016",
                venue="2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
                confidence=0.95,
            ),
            SourceCandidate(
                source_name="openalex",
                found=True,
                doi="10.1109/cvpr.2016.90",
                title="Deep Residual Learning for Image Recognition",
                authors=["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
                year="2016",
                venue="CVPR",
                confidence=0.95,
            ),
        ],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref", "openalex"],
        sources_failed={},
    )

    verdict = checker.check(citation, source)
    assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-CHIMERIC-DOI-MISMATCH" in verdict.triggered_rules


def test_bug06b_chimeric_same_author_stolen_doi_fake_title() -> None:
    """BUG-06b: Same-author chimera (Devlin & Chang 2019 + BERT DOI + fabricated plasma title)
    must be SUSPECTED_HALLUCINATION (R-CHIMERIC-DOI-MISMATCH), even when local_db also succeeded."""
    checker = NeuroSymbolicChecker(enable_content_alignment=False)
    citation = Citation(
        raw_text=(
            "Devlin, J., & Chang, M. (2019). "
            "Magnetohydrodynamic turbulence modeling in galactic plasma filaments. "
            "Astrophysical Journal Letters. https://doi.org/10.18653/v1/N19-1423"
        ),
        authors=["Devlin, J.", "Chang, M."],
        year=2019,
        title="Magnetohydrodynamic turbulence modeling in galactic plasma filaments",
        venue="Astrophysical Journal Letters",
        doi="10.18653/v1/N19-1423",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    source = SourceResult(
        citation_raw=citation.raw_text,
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                doi="10.18653/v1/n19-1423",
                title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                authors=["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
                year="2019",
                venue="Proceedings of NAACL-HLT",
                confidence=0.95,
            ),
            SourceCandidate(
                source_name="local_db",
                found=True,
                doi="10.18653/v1/n19-1423",
                title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                authors=["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
                year="2019",
                venue="NAACL-HLT",
                confidence=0.95,
            ),
        ],
        sources_queried=["local_db", "crossref"],
        sources_succeeded=["local_db", "crossref"],
        sources_failed={},
    )

    verdict = checker.check(citation, source)
    assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert "R-CHIMERIC-DOI-MISMATCH" in verdict.triggered_rules


def test_bug07_local_db_wrong_year_not_flagged_as_content_hallucination() -> None:
    """BUG-07: Exact title + author + DOI match in local_db (without abstract) with wrong year
    must be METADATA_ERROR (mismatched_fields=['year']), NOT SUSPECTED_HALLUCINATION (content)."""
    rules = SymbolicRules()
    source = SourceResult(
        citation_raw="Vaswani, A., Shazeer, N., & Parmar, N. (2020). Attention is all you need.",
        candidates=[
            SourceCandidate(
                source_name="local_db",
                found=True,
                doi="10.48550/arXiv.1706.03762",
                title="Attention Is All You Need",
                authors=["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
                year="2017",
                venue="Advances in Neural Information Processing Systems",
                abstract=None,
                confidence=0.95,
            )
        ],
        sources_queried=["local_db"],
        sources_succeeded=["local_db"],
        sources_failed={},
    )
    features = MatchFeatures(
        title_sim_fuzzy=1.0,
        title_sim_semantic=1.0,
        author_jaccard=1.0,
        year_distance=3,
        doi_exact_match=True,
        source_consensus=1,
        venue_sim=1.0,
        content_alignment_score=0.35,
        content_is_aligned=False,
    )

    outcome = rules.apply(
        source=source,
        features=features,
        citation_doi="10.48550/arXiv.1706.03762",
        citation_raw=source.citation_raw,
        citation_authors=["Vaswani, A.", "Shazeer, N.", "Parmar, N."],
    )
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "year" in outcome.mismatched_fields
    assert "content" not in outcome.mismatched_fields
    assert "R-CONTENT-MISMATCH" not in outcome.triggered_rules


@pytest.mark.asyncio
async def test_bug17_atomic_monthly_upload_quota_under_concurrency(tmp_path) -> None:
    """BUG-17: Concurrent POST /api/essays requests on the async event loop must atomically
    increment monthly_uploads_used without lost updates or quota bypass."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'quota_race.db'}",
        connect_args={"check_same_thread": False, "timeout": 15},
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def _override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    pdf_bytes = _make_valid_pdf_bytes(num_pages=1)

    orig_read = __import__(
        "integrity_checker.api.routes.essays", fromlist=["_read_pdf_upload_bounded"]
    )._read_pdf_upload_bounded

    async def slow_read(upload_file, max_bytes=None):
        await asyncio.sleep(0.02)
        return await orig_read(upload_file, max_bytes=max_bytes)

    app.dependency_overrides[get_db] = _override_get_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            reg = await ac.post(
                "/api/auth/register",
                json={
                    "username": "batch_student",
                    "email": "batch_student@example.com",
                    "password": "Password123!",
                    "privacy_consent": True,
                },
            )
            assert reg.status_code in (200, 201), reg.text
            setup_db = SessionLocal()
            try:
                from datetime import UTC, datetime, timedelta

                u = setup_db.query(User).filter(User.username == "batch_student").first()
                assert u is not None
                u.is_active = 1
                u.plan_tier = "basic"
                u.monthly_uploads_used = 1  # Basic limit is 3 -> exactly 2 slots left
                u.quota_reset_at = datetime.now(UTC) + timedelta(days=30)
                setup_db.commit()
                user_id = u.id
            finally:
                setup_db.close()

            login = await ac.post(
                "/api/auth/login",
                json={"username": "batch_student", "password": "Password123!"},
            )
            assert login.status_code == 200, login.text
            token = login.json()["token"]

            with (
                patch("integrity_checker.api.routes.essays._run_pipeline_task"),
                patch("integrity_checker.api.routes.essays._read_pdf_upload_bounded", slow_read),
            ):
                resps = await asyncio.gather(
                    *[
                        ac.post(
                            "/api/essays",
                            files={"file": (f"batch_{i}.pdf", BytesIO(pdf_bytes), "application/pdf")},
                            headers={"Authorization": f"Bearer {token}"},
                        )
                        for i in range(4)
                    ]
                )
        statuses = [r.status_code for r in resps]
        assert statuses.count(200) == 2, f"Expected exactly 2 accepted uploads, got {statuses}"
        assert statuses.count(402) == 2, f"Expected 2 quota rejections (402), got {statuses}"

        check_db = SessionLocal()
        try:
            u_final = check_db.get(User, user_id)
            assert u_final is not None
            assert u_final.monthly_uploads_used == 3
        finally:
            check_db.close()
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_bug18_corrupt_pdf_rejected_400_without_consuming_quota() -> None:
    """BUG-18: Corrupt PDF with %PDF- header but broken xref/page tree must return 400
    and MUST NOT deduct monthly_uploads_used."""
    client = TestClient(app)
    login_resp = client.post("/api/auth/login", json={"username": "user", "password": "user123"})
    assert login_resp.status_code == 200
    token = login_resp.json()["token"]

    s = get_session()
    try:
        u = s.query(User).filter(User.username == "user").first()
        assert u is not None
        u.plan_tier = "basic"
        u.monthly_uploads_used = 0
        s.commit()
    finally:
        s.close()

    corrupt_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\n%%CORRUPT_NO_PAGES_NO_XREF\n%%EOF"
    with patch("integrity_checker.api.routes.essays._run_pipeline_task"):
        resp = client.post(
            "/api/essays",
            files={"file": ("corrupt_xref.pdf", BytesIO(corrupt_pdf), "application/pdf")},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 400

    s2 = get_session()
    try:
        u2 = s2.query(User).filter(User.username == "user").first()
        assert u2 is not None
        assert u2.monthly_uploads_used == 0
    finally:
        s2.close()


def test_bug19_get_verdicts_preserves_insertion_order_not_label_alphabetical(tmp_path) -> None:
    """BUG-19: Repository.get_verdicts and get_verdicts_by_essay_ids must return verdicts
    ordered by VerdictRecord.id ASC (bibliography order [1]..[N]), not alphabetical label."""
    engine = create_engine(f"sqlite:///{tmp_path / 'order_test.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        from sqlalchemy import text

        # Mirror production SQLite composite index selection when querying without ORDER BY
        session.execute(
            text("CREATE INDEX IF NOT EXISTS idx_verdicts_essay_label_probe ON verdicts(essay_id, label)")
        )
        session.execute(text("DROP INDEX IF EXISTS ix_verdicts_essay_id"))
        session.commit()

        repo = Repository(session)
        essay = EssayRecord(filename="ordered_refs.pdf", num_pages=5)
        session.add(essay)
        session.commit()

        verdicts = [
            CitationVerdict(
                citation=Citation(raw_text="[1] Verified Paper"),
                label=ValidationLabel.VERIFIED,
                confidence=0.95,
            ),
            CitationVerdict(
                citation=Citation(raw_text="[2] Hallucinated Paper"),
                label=ValidationLabel.SUSPECTED_HALLUCINATION,
                confidence=0.90,
            ),
            CitationVerdict(
                citation=Citation(raw_text="[3] Web Resource"),
                label=ValidationLabel.RESOURCE,
                confidence=0.95,
            ),
            CitationVerdict(
                citation=Citation(raw_text="[4] Metadata Error Paper"),
                label=ValidationLabel.METADATA_ERROR,
                confidence=0.75,
            ),
        ]
        repo.add_verdicts(essay.id, verdicts)
        session.commit()

        expected_raws = [
            "[1] Verified Paper",
            "[2] Hallucinated Paper",
            "[3] Web Resource",
            "[4] Metadata Error Paper",
        ]

        direct = repo.get_verdicts(essay.id)
        assert [v.citation_raw for v in direct] == expected_raws

        batched = repo.get_verdicts_by_essay_ids([essay.id])[essay.id]
        assert [v.citation_raw for v in batched] == expected_raws
    finally:
        session.close()
