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
