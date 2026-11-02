"""Regression tests for duplicate-upload collapsing in the app DB (handoff § 5 P5)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from integrity_checker.db.models import Base, CitationRecord, EssayRecord
from integrity_checker.db.repository import Repository


def _session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'app.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_duplicate_filenames_are_collapsed(tmp_path) -> None:
    session = _session(tmp_path)
    repo = Repository(session)
    base_time = datetime(2026, 9, 1, tzinfo=UTC)

    # Three uploads of the same file; only the newest produced citations.
    first = EssayRecord(filename="4.pdf", num_pages=37, uploaded_at=base_time)
    second = EssayRecord(filename="4.pdf", num_pages=37, uploaded_at=base_time + timedelta(days=1))
    third = EssayRecord(filename="4.pdf", num_pages=37, uploaded_at=base_time + timedelta(days=2))
    session.add_all([first, second, third])
    session.commit()

    session.add(
        CitationRecord(essay_id=third.id, raw_text="x", citation_type="reference", style="APA")
    )
    session.commit()

    grouped = repo.get_all_essays_deduped()
    assert len(grouped) == 1
    kept, dupes = grouped[0]
    # The copy that actually produced citations must be kept.
    assert kept.id == third.id
    assert set(dupes) == {first.id, second.id}


def test_distinct_filenames_are_preserved(tmp_path) -> None:
    session = _session(tmp_path)
    repo = Repository(session)
    session.add_all(
        [
            EssayRecord(filename="a.pdf", num_pages=1),
            EssayRecord(filename="b.pdf", num_pages=2),
        ]
    )
    session.commit()
    grouped = repo.get_all_essays_deduped()
    assert len(grouped) == 2
    assert all(dupes == [] for _, dupes in grouped)


def test_different_users_with_same_filename_are_not_collapsed(tmp_path) -> None:
    session = _session(tmp_path)
    repo = Repository(session)
    e1 = EssayRecord(filename="thesis.pdf", num_pages=10, user_id=1)
    e2 = EssayRecord(filename="thesis.pdf", num_pages=10, user_id=2)
    session.add_all([e1, e2])
    session.commit()

    grouped_all = repo.get_all_essays_deduped()
    assert len(grouped_all) == 2

    grouped_u1 = repo.get_all_essays_deduped(user_id=1)
    assert len(grouped_u1) == 1
    assert grouped_u1[0][0].id == e1.id


def test_newer_completed_upload_wins_over_older_inflated_upload(tmp_path) -> None:
    session = _session(tmp_path)
    repo = Repository(session)
    base_time = datetime(2026, 9, 1, tzinfo=UTC)

    older = EssayRecord(filename="paper.pdf", num_pages=12, user_id=1, uploaded_at=base_time)
    newer = EssayRecord(
        filename="paper.pdf",
        num_pages=12,
        user_id=1,
        uploaded_at=base_time + timedelta(hours=2),
    )
    session.add_all([older, newer])
    session.commit()

    # Older run had 2 noisy citations; newer run has 1 clean citation.
    session.add_all(
        [
            CitationRecord(essay_id=older.id, raw_text="old1", citation_type="in_text", style="APA"),
            CitationRecord(essay_id=older.id, raw_text="old2", citation_type="in_text", style="APA"),
            CitationRecord(essay_id=newer.id, raw_text="new1", citation_type="in_text", style="APA"),
        ]
    )
    session.commit()

    grouped = repo.get_all_essays_deduped(user_id=1)
    assert len(grouped) == 1
    kept, dupes = grouped[0]
    assert kept.id == newer.id
    assert dupes == [older.id]


def test_test_runtime_never_binds_to_main_app_db(monkeypatch) -> None:
    from integrity_checker.config import MAIN_APP_DB_PATH, get_settings, is_main_app_db_url
    from integrity_checker.db.session import get_engine

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{MAIN_APP_DB_PATH}")
    get_settings.cache_clear()
    engine = get_engine()
    assert not is_main_app_db_url(str(engine.url))
