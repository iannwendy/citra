"""Unit tests for Phase 2 & Phase 4 Performance Optimizations:
- Strategic Composite B-Tree Indexes in SQLite
- Batch Repository helpers eliminating N+1 queries
- LocalDatabase inode initialization cache & get_stats() Read-Through RAM Cache + Invalidation
- FastAPI GZipMiddleware compression on large JSON responses
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event, inspect

from integrity_checker.api.main import create_app
from integrity_checker.database.local_db import LocalDatabase
from integrity_checker.database.models import Paper
from integrity_checker.db.models import Base, EssayRecord, VerdictRecord
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import _run_inline_migrations, get_engine, get_session


def test_composite_btree_indexes_created_in_db() -> None:
    """Verify all strategic composite B-Tree indexes are created on SQLite tables."""
    session = get_session()
    try:
        engine = get_engine()
        Base.metadata.create_all(bind=engine)
        _run_inline_migrations(engine)

        inspector = inspect(engine)
        expected_indexes = {
            "users": {"idx_users_role_username"},
            "essays": {
                "idx_essays_user_uploaded",
                "idx_essays_class_uploaded",
                "idx_essays_user_filename",
                "idx_essays_uploaded_at",
            },
            "citations": {"idx_citations_essay_type"},
            "verdicts": {"idx_verdicts_essay_override_label", "idx_verdicts_label"},
            "audit_logs": {"idx_audit_logs_user_logged", "idx_audit_logs_logged_at"},
        }
        for table_name, required_set in expected_indexes.items():
            actual_names = {idx["name"] for idx in inspector.get_indexes(table_name)}
            assert required_set.issubset(actual_names), (
                f"Missing indexes on {table_name}: {required_set - actual_names}"
            )
    finally:
        session.close()


def test_batch_repository_methods_eliminate_n_plus_1() -> None:
    """Verify batch helpers return exact results using constant O(1) SQL queries."""
    session = get_session()
    try:
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        repo = Repository(session)

        teacher = repo.create_user("prof_perf", "hash", "teacher")
        students = [
            repo.create_user(f"stu_{i}", "hash", "user")
            for i in range(5)
        ]
        classes = [
            repo.create_class(f"Class {c}", teacher.id, f"Desc {c}")
            for c in range(3)
        ]
        for idx, stu in enumerate(students):
            repo.add_student_to_class(classes[idx % len(classes)].id, stu.id)

        essays: list[EssayRecord] = []
        for idx, stu in enumerate(students):
            e = repo.create_essay_with_user(
                filename=f"thesis_{idx}.pdf",
                num_pages=20,
                user_id=stu.id,
                class_id=classes[idx % len(classes)].id,
            )
            essays.append(e)
            session.add(
                VerdictRecord(
                    essay_id=e.id,
                    citation_raw=f"[{idx}]",
                    label="metadata_error" if idx % 2 == 0 else "verified",
                    confidence=0.8,
                    is_overridden=0,
                )
            )
        student_ids = [s.id for s in students]
        essay_ids = [e.id for e in essays]
        class_ids = [c.id for c in classes]
        repo.commit()
        session.expunge_all()

        # Count SQL statements executed during batch operations
        sql_count = 0

        def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
            nonlocal sql_count
            sql_count += 1

        event.listen(engine, "before_cursor_execute", _before_cursor_execute)
        try:
            users_map = repo.get_users_by_ids(student_ids)
            essays_map = repo.get_essays_by_ids(essay_ids)
            verdicts_map = repo.get_verdicts_by_essay_ids(essay_ids)
            class_counts = repo.count_students_by_class_ids(class_ids)
            pending_total = repo.count_pending_reviews_by_essay_ids(essay_ids)
        finally:
            event.remove(engine, "before_cursor_execute", _before_cursor_execute)

        assert sql_count == 5, f"Expected exactly 5 batch queries, got {sql_count}"
        assert len(users_map) == 5
        assert len(essays_map) == 5
        assert sum(len(v) for v in verdicts_map.values()) == 5
        assert sum(class_counts.values()) == 5
        assert pending_total == 3  # indices 0, 2, 4 have metadata_error
    finally:
        session.close()


def test_local_database_stats_cache_and_invalidation(tmp_path: Path) -> None:
    """Verify LocalDatabase.get_stats() caches in RAM and invalidates on writes."""
    db_file = tmp_path / "perf_local_papers.db"
    db = LocalDatabase(db_file)

    stats0 = db.get_stats()
    assert stats0["total_papers"] == 0

    # Adding a paper must immediately invalidate the cached stats
    db.add_paper(
        Paper(
            doi="10.1000/perf.1",
            title="High Performance Neuro-Symbolic Citation Verification",
            authors=["Nguyen, A.", "Tran, B."],
            year=2026,
            venue="ACL",
            source="acl",
        )
    )
    stats1 = db.get_stats()
    assert stats1["total_papers"] == 1
    assert stats1["source_counts"].get("acl") == 1

    # Logging a query must immediately invalidate the cached stats
    db.log_query({"title": "High Performance"}, found=True, source="local_db", paper_id=1)
    stats2 = db.get_stats()
    assert stats2["total_queries"] == 1
    assert stats2["hit_rate_percent"] == 100.0

    # Repeated get_stats() calls hit RAM cache (< 1ms)
    t0 = time.perf_counter()
    for _ in range(20):
        cached_stats = db.get_stats()
    elapsed_ms = (time.perf_counter() - t0) * 1000.0 / 20.0
    assert cached_stats["total_papers"] == 1
    assert elapsed_ms < 2.0

    # Deleting all papers invalidates the cache immediately
    db.delete_all()
    assert db.get_stats()["total_papers"] == 0


def test_gzip_middleware_compresses_large_responses() -> None:
    """Verify GZipMiddleware compresses responses >= 1KB when Accept-Encoding: gzip is sent."""
    app = create_app()
    client = TestClient(app)

    # Request OpenAPI schema (>1KB JSON) with gzip encoding
    resp = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"


def test_semantic_matcher_embedding_cache_eliminates_duplicate_encodes() -> None:
    """Verify FeatureCalculator + SemanticMatcher encode each unique text at most once across multi-occurrence alignment."""
    from integrity_checker.matching.features import FeatureCalculator
    from integrity_checker.matching.semantic import SemanticMatcher
    from integrity_checker.models.citation import Citation, CitationType
    from integrity_checker.models.source import SourceCandidate, SourceResult

    matcher = SemanticMatcher.get_instance()
    if hasattr(matcher, "clear_embedding_cache"):
        matcher.clear_embedding_cache()

    encoded_texts: list[str] = []
    model = matcher._get_model()
    assert model is not None
    orig_model_encode = model.encode

    def spy_model_encode(texts, *args, **kwargs):
        if isinstance(texts, (list, tuple)):
            encoded_texts.extend(str(t) for t in texts)
        else:
            encoded_texts.append(str(texts))
        return orig_model_encode(texts, *args, **kwargs)

    abstract_sents = [
        "English and Chinese have witnessed strong performance from pre-trained language models.",
        "Although Vietnam has 100 million speakers, pre-trained models remain limited on social media.",
        "In this paper, we present ViSoBERT, a pre-trained language model for Vietnamese social media text processing.",
        "We evaluate ViSoBERT on five downstream natural language processing tasks including emotion and sentiment recognition.",
        "Experimental results demonstrate that ViSoBERT outperforms PhoBERT and XLM-R baselines across all social media benchmarks.",
    ]
    cit = Citation(
        raw_text="Nguyen, N., Phan, T., Nguyen, D. V., & Nguyen, K. (2023). ViSoBERT: A pre-trained language model for Vietnamese social media text processing.",
        citation_type=CitationType.REFERENCE_LIST,
        title="ViSoBERT: A pre-trained language model for Vietnamese social media text processing",
        authors=["Nguyen, N.", "Phan, T.", "Nguyen, D. V.", "Nguyen, K."],
        year=2023,
        doi="10.18653/v1/2023.emnlp-main.319",
    )
    cit._occurrence_contexts = [  # type: ignore[attr-defined]
        {
            "page": 2,
            "raw": "[6]",
            "context": "Recent Vietnamese NLP studies introduced ViSoBERT [6] to handle noisy social media comments on YouTube and Facebook.",
        },
        {
            "page": 5,
            "raw": "[6]",
            "context": "We fine-tune the pre-trained ViSoBERT backbone [6] for depression detection on Vietnamese YouTube comments.",
        },
        {
            "page": 8,
            "raw": "[6]",
            "context": "Compared with XLM-RoBERTa, ViSoBERT [6] achieves higher macro-F1 on informal Vietnamese social media text.",
        },
        {
            "page": 11,
            "raw": "[6]",
            "context": "Tokenizer normalization follows the Vietnamese social media preprocessing pipeline established in ViSoBERT [6].",
        },
    ]
    source = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[
            SourceCandidate(
                source_name="openalex",
                found=True,
                title="ViSoBERT: A Pre-Trained Language Model for Vietnamese Social Media Text Processing",
                authors=["Nam Nguyen", "Thang Phan", "Duc-Vu Nguyen", "Kiet Nguyen"],
                year=2023,
                doi="10.18653/v1/2023.emnlp-main.319",
                abstract=" ".join(abstract_sents),
                confidence=0.98,
                score=0.98,
            )
        ],
        sources_queried=["openalex"],
        sources_succeeded=["openalex"],
    )

    model.encode = spy_model_encode  # type: ignore[method-assign]
    try:
        fc = FeatureCalculator(semantic=matcher, enable_content_alignment=True)
        features = fc.compute(
            cit,
            source,
            citation_context=cit._occurrence_contexts[0]["context"],  # type: ignore[attr-defined]
        )
    finally:
        model.encode = orig_model_encode  # type: ignore[method-assign]

    assert features.content_alignment_score > 0.40
    assert len(features.occurrence_alignments) == 4
    # Every string sent to the underlying SentenceTransformer.encode must be unique (0 duplicate encodings)
    assert len(encoded_texts) == len(set(encoded_texts)), (
        f"Expected 0 duplicate text encodings, but {len(encoded_texts) - len(set(encoded_texts))} "
        f"texts were re-encoded ({len(encoded_texts)} total vs {len(set(encoded_texts))} unique)"
    )


def test_single_occurrence_reuses_primary_alignment_without_recomputing() -> None:
    """When a reference has only 1 in-text occurrence, FeatureCalculator must reuse alignment_result instead of calling check_content_alignment twice."""
    from unittest.mock import patch

    from integrity_checker.matching.features import FeatureCalculator
    from integrity_checker.matching.semantic import SemanticMatcher
    from integrity_checker.models.citation import Citation, CitationType
    from integrity_checker.models.source import SourceCandidate, SourceResult

    matcher = SemanticMatcher.get_instance()
    cit = Citation(
        raw_text="Vaswani et al. (2017). Attention Is All You Need.",
        citation_type=CitationType.REFERENCE_LIST,
        title="Attention Is All You Need",
        authors=["Vaswani, A."],
        year=2017,
    )
    ctx_str = "The Transformer architecture relies entirely on self-attention mechanisms (Vaswani et al., 2017)."
    cit._occurrence_contexts = [  # type: ignore[attr-defined]
        {"page": 3, "raw": "(Vaswani et al., 2017)", "context": ctx_str}
    ]
    source = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[
            SourceCandidate(
                source_name="openalex",
                found=True,
                title="Attention Is All You Need",
                authors=["Ashish Vaswani"],
                year=2017,
                abstract="We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
                confidence=0.98,
                score=0.98,
            )
        ],
        sources_queried=["openalex"],
        sources_succeeded=["openalex"],
    )

    call_count = 0
    orig_check = matcher.check_content_alignment

    def counting_check(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return orig_check(*args, **kwargs)

    with patch.object(matcher, "check_content_alignment", side_effect=counting_check):
        fc = FeatureCalculator(semantic=matcher, enable_content_alignment=True)
        features = fc.compute(cit, source, citation_context=ctx_str)

    assert call_count == 1, f"Expected check_content_alignment to be called once for 1 occurrence, got {call_count}"
    assert len(features.occurrence_alignments) == 1
    assert features.occurrence_alignments[0]["page"] == 3


def test_semantic_matcher_loads_local_cache_first_without_network_check() -> None:
    """Verify SemanticMatcher._load_sentence_transformer tries local_files_only=True first before falling back to network."""
    from unittest.mock import MagicMock, patch

    from integrity_checker.matching.semantic import SemanticMatcher

    calls: list[dict] = []
    fake_model = MagicMock()

    def fake_st_ctor(model_name: str, **kwargs):
        calls.append({"model_name": model_name, **kwargs})
        return fake_model

    with patch("sentence_transformers.SentenceTransformer", side_effect=fake_st_ctor):
        loaded = SemanticMatcher._load_sentence_transformer("sentence-transformers/all-MiniLM-L6-v2")

    assert loaded is fake_model
    assert len(calls) == 1
    assert calls[0].get("local_files_only") is True


def test_pipeline_emits_all_eight_steps_in_strict_order_with_separated_comparing_and_checking(
    tmp_path,
) -> None:
    """Verify IntegrityPipeline.run_async emits all 8 steps (0..7) in strict order and separates comparing (5) from checking (6)."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from integrity_checker.extraction.base import Document, Page
    from integrity_checker.extraction.document_parser import ParsedDocument
    from integrity_checker.models.citation import Citation, CitationType
    from integrity_checker.models.source import SourceCandidate, SourceResult
    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

    pdf_file = tmp_path / "sample.pdf"
    pdf_file.write_bytes(b"%PDF-1.4\n%fake\n")

    in_text = Citation(
        raw_text="[1]",
        citation_type=CitationType.NUMERIC,
        page_num=1,
        reference_id="occ_1",
    )
    ref = Citation(
        raw_text="[1] Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS.",
        citation_type=CitationType.REFERENCE_LIST,
        title="Attention Is All You Need",
        authors=["Vaswani, A."],
        year=2017,
        reference_id="ref_1",
        page_num=2,
    )
    parsed_doc = ParsedDocument(
        document=Document(
            file_path=str(pdf_file),
            num_pages=2,
            pages=[
                Page(
                    page_num=1,
                    text="The Transformer relies entirely on self-attention mechanisms [1].",
                ),
                Page(
                    page_num=2,
                    text="References\n[1] Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS.",
                ),
            ],
        ),
        sections=[],
        body_citations=[in_text],
        references=[ref],
        appendix_citations=[],
    )

    mock_doc_parser = MagicMock()
    mock_doc_parser.parse.return_value = parsed_doc

    mock_orch = MagicMock()
    mock_orch.retrieve = AsyncMock(
        return_value=SourceResult(
            citation_raw=ref.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="openalex",
                    found=True,
                    title="Attention Is All You Need",
                    authors=["Ashish Vaswani"],
                    year=2017,
                    abstract="We propose the Transformer, based solely on attention mechanisms.",
                    confidence=0.98,
                    score=0.98,
                )
            ],
            sources_queried=["openalex"],
            sources_succeeded=["openalex"],
        )
    )

    pipeline = IntegrityPipeline(
        document_parser=mock_doc_parser,
        orchestrator=mock_orch,
        use_report_cache=False,
    )

    emitted_events: list[tuple[str, int, dict]] = []
    checker_called_at_step: list[str] = []

    def progress_cb(step_key: str, step_index: int, stats: dict) -> None:
        emitted_events.append((step_key, step_index, dict(stats)))

    orig_check = pipeline.checker.check

    def spy_check(*args, **kwargs):
        current_step = emitted_events[-1][0] if emitted_events else "none"
        checker_called_at_step.append(current_step)
        return orig_check(*args, **kwargs)

    pipeline.checker.check = spy_check  # type: ignore[method-assign]

    asyncio.run(
        pipeline.run_async(
            str(pdf_file),
            essay_id="test-8-steps",
            progress_callback=progress_cb,
        )
    )

    # Deduplicate consecutive identical (step_key, step_index) emissions
    distinct_steps: list[tuple[str, int]] = []
    for key, idx, _ in emitted_events:
        if not distinct_steps or distinct_steps[-1] != (key, idx):
            distinct_steps.append((key, idx))

    expected_steps = [
        ("parsing", 0),
        ("style_detection", 1),
        ("extracting", 2),
        ("linking", 3),
        ("retrieving", 4),
        ("comparing", 5),
        ("checking", 6),
        ("scoring", 7),
    ]
    assert distinct_steps == expected_steps, (
        f"Expected strict 8-step sequence {expected_steps}, got {distinct_steps}"
    )
    # NeuroSymbolicChecker.check (rule application + Platt calibration) must execute during Step 6 ('checking'), not Step 5 ('comparing')
    assert checker_called_at_step == ["checking"], (
        f"Expected checker.check to run during 'checking' (Step 6), but ran during {checker_called_at_step}"
    )

