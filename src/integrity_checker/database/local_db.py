"""Local SQLite database for paper metadata storage.

This module provides a local database to cache paper metadata from:
1. ACL Anthology (NLP papers)
2. S2ORC (broad academic papers)
3. API queries (auto-sync)

The database uses SQLite with FTS5 for full-text search.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from integrity_checker.db import sqlite_tuning as _sqlite_tuning
from integrity_checker.db.sqlite_tuning import (
    apply_sqlite_connection_pragmas,
    detect_sqlite_filesystem_type,
    resolve_sqlite_journal_mode,
)
from integrity_checker.retrieval.normalization import (
    author_keys,
    normalize_arxiv_id,
    normalize_doi,
    title_similarity,
    title_tokens,
    year_key,
)

from .models import Paper
from .schemas import INIT_STATEMENTS

# Default database path (project root / data / local_papers.db)
DEFAULT_DB_PATH = Path(__file__).resolve().parents[3] / "data" / "local_papers.db"

_DB_CACHE_LOCK = threading.Lock()
_STATS_COMPUTE_LOCK = threading.Lock()
_INITIALIZED_DB_INODES: dict[str, tuple[int, str]] = {}
_STATS_CACHE: dict[str, tuple[float, int, int, int, dict[str, Any]]] = {}
_PAPERS_COUNTS_CACHE: dict[str, tuple[float, int, int, dict[str, int]]] = {}
_STATS_CACHE_TTL_SECONDS = 3600.0
_QUERY_CACHE: OrderedDict[tuple[Any, ...], Any] = OrderedDict()
_QUERY_CACHE_MAX_SIZE = 2048
_MUTATION_VERSION = 0
_QUERY_LOG_VERSION = 0
_LAST_LOCAL_PAPERS_TUNING_REPORT: Any | None = None


@dataclass(frozen=True)
class _LocalSqliteTuningReport:
    db_path: str
    filesystem_type: str
    requested_journal_mode: str
    journal_mode: str
    effective_journal_mode: str
    wal_enabled: bool
    fallback_degraded: bool
    busy_timeout_ms: int = 30000
    synchronous: str = "NORMAL"
    mmap_bytes: int = 67108864
    wal_autocheckpoint: int = 1000

    def to_dict(self) -> dict[str, Any]:
        return {
            "db_path": self.db_path,
            "filesystem_type": self.filesystem_type,
            "requested_journal_mode": self.requested_journal_mode,
            "journal_mode": self.journal_mode,
            "effective_journal_mode": self.effective_journal_mode,
            "wal_enabled": self.wal_enabled,
            "fallback_degraded": self.fallback_degraded,
            "busy_timeout_ms": self.busy_timeout_ms,
            "synchronous": self.synchronous,
            "mmap_bytes": self.mmap_bytes,
            "wal_autocheckpoint": self.wal_autocheckpoint,
        }


def get_local_papers_tuning_report() -> dict[str, Any] | None:
    """Return the latest SQLite WAL/PRAGMA tuning report for `local_papers.db`, if available."""
    report = _LAST_LOCAL_PAPERS_TUNING_REPORT
    if report is None:
        return None
    to_dict_fn = getattr(report, "to_dict", None)
    if callable(to_dict_fn):
        return dict(to_dict_fn())
    if isinstance(report, dict):
        return dict(report)
    return None


def clear_local_query_cache() -> None:
    """Clear in-process `local_papers.db` query and stats caches under `_DB_CACHE_LOCK`."""
    with _DB_CACHE_LOCK:
        _QUERY_CACHE.clear()
        _STATS_CACHE.clear()


def _apply_and_capture_local_pragmas(
    conn: Any,
    db_path: Path,
    journal_mode: str,
    *,
    mmap_bytes: int = 67108864,
) -> str:
    global _LAST_LOCAL_PAPERS_TUNING_REPORT
    adaptive_fn = getattr(_sqlite_tuning, "apply_adaptive_sqlite_pragmas", None)
    if callable(adaptive_fn):
        rep = adaptive_fn(conn, db_path, mmap_bytes=mmap_bytes)
        _LAST_LOCAL_PAPERS_TUNING_REPORT = rep
        eff = getattr(rep, "effective_journal_mode", None) or getattr(rep, "journal_mode", None)
        return str(eff or journal_mode).upper()

    raw_req = (os.getenv("SQLITE_JOURNAL_MODE", "AUTO") or "AUTO").strip().upper() or "AUTO"
    fstype = detect_sqlite_filesystem_type(db_path)
    effective = apply_sqlite_connection_pragmas(conn, journal_mode, mmap_bytes=mmap_bytes)
    eff_upper = str(effective or journal_mode).strip().upper()
    _LAST_LOCAL_PAPERS_TUNING_REPORT = _LocalSqliteTuningReport(
        db_path=str(db_path),
        filesystem_type=fstype,
        requested_journal_mode=raw_req,
        journal_mode=eff_upper,
        effective_journal_mode=eff_upper,
        wal_enabled=(eff_upper == "WAL"),
        fallback_degraded=(raw_req in ("AUTO", "WAL") and eff_upper != "WAL"),
        busy_timeout_ms=30000,
        synchronous="NORMAL",
        mmap_bytes=int(mmap_bytes),
        wal_autocheckpoint=1000 if eff_upper == "WAL" else 0,
    )
    return eff_upper


def _bump_mutation_version() -> None:
    global _MUTATION_VERSION
    with _DB_CACHE_LOCK:
        _MUTATION_VERSION += 1
        _QUERY_CACHE.clear()


def _bump_query_log_version() -> None:
    global _QUERY_LOG_VERSION
    with _DB_CACHE_LOCK:
        _QUERY_LOG_VERSION += 1


def _title_key(title: str | None) -> str:
    """Case/punctuation-insensitive key for exact-ish title comparison.

    Only used to look a row up in the curated ``known_papers`` table — it is
    deliberately stricter than :func:`title_similarity`, which is tuned for
    candidate ranking and treats containment as a near-match.
    """
    if not title:
        return ""
    text = title.casefold()
    text = "".join(ch if (ch.isalnum() or ch.isspace()) else " " for ch in text)
    return " ".join(text.split())


def _known_papers_metadata() -> dict[tuple[str, str], dict]:
    """Load the curated seminal-paper table lazily.

    The table lives in ``retrieval.retrieval_orchestrator``, which imports
    from the retrieval layer.  Importing it at module load time would create a
    cycle once retrieval starts depending on the database package, so the
    lookup is deferred until dedupe actually needs it.
    """
    from integrity_checker.retrieval.retrieval_orchestrator import _KNOWN_PAPERS

    return _KNOWN_PAPERS


class LocalDatabase:
    """Local SQLite database for paper metadata.

    Features:
        - FTS5 full-text search on title, authors, abstract
        - Fast lookup by DOI, arXiv ID
        - Query logging for analytics
        - Thread-safe connections
    """

    def __init__(self, db_path: Path | str | None = None) -> None:
        """Initialize database connection.

        Args:
            db_path: Path to SQLite database file. Defaults to ./data/local_papers.db
        """
        self.db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self._journal_mode = resolve_sqlite_journal_mode(self.db_path)
        self._query_cache = _QUERY_CACHE
        self._init_db()

    def _init_db(self) -> None:
        """Initialize database schema if not exists (cached per file inode and journal mode)."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        resolved_key = str(self.db_path.resolve())
        try:
            if self.db_path.is_file():
                stat = self.db_path.stat()
                if stat.st_size > 0 and _LAST_LOCAL_PAPERS_TUNING_REPORT is not None:
                    with _DB_CACHE_LOCK:
                        if _INITIALIZED_DB_INODES.get(resolved_key) == (
                            stat.st_ino,
                            self._journal_mode,
                        ):
                            return
        except OSError:
            pass

        with self._get_conn() as conn:
            for stmt in INIT_STATEMENTS:
                conn.executescript(stmt)
            # ``PRAGMA journal_mode`` returns a row, so it must be executed via
            # ``apply_sqlite_connection_pragmas`` rather than inside ``executescript``.
            _apply_and_capture_local_pragmas(
                conn,
                self.db_path,
                self._journal_mode,
                mmap_bytes=67108864,
            )
            conn.commit()

        try:
            stat = self.db_path.stat()
            if stat.st_size > 0:
                with _DB_CACHE_LOCK:
                    _INITIALIZED_DB_INODES[resolved_key] = (stat.st_ino, self._journal_mode)
        except OSError:
            pass

    @contextmanager
    def _get_conn(self) -> Generator[sqlite3.Connection, None, None]:
        """Get database connection with row factory, adaptive WAL/mmap, and FTS5 cache."""
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        _apply_and_capture_local_pragmas(
            conn,
            self.db_path,
            self._journal_mode,
            mmap_bytes=67108864,
        )
        conn.execute("PRAGMA cache_size=-16000")
        conn.execute("PRAGMA temp_store=MEMORY")
        try:
            yield conn
        finally:
            conn.close()

    # ==================== Basic CRUD ====================

    def add_paper(self, paper: Paper) -> int | None:
        """Add or update a paper in the database.

        Args:
            paper: Paper object to add

        Returns:
            Canonical paper row ID if successful, None if failed.

        Note:
            ``ON CONFLICT(doi) DO UPDATE`` keeps the *existing* row id in
            SQLite, so ``cursor.lastrowid`` is not reliable for conflict
            updates.  We resolve the row id explicitly so that provenance
            (``query_log.paper_id``, ``candidate.paper_id``) always points at
            the row that actually holds the metadata.
        """
        paper.doi = normalize_doi(paper.doi)
        paper.arxiv_id = normalize_arxiv_id(paper.arxiv_id)

        # SQLite UNIQUE permits multiple NULL values.  API results without a
        # DOI would therefore be inserted repeatedly on every run.  Reuse an
        # existing metadata record before attempting the insert.
        if not paper.doi:
            existing = self._find_existing_metadata_paper(paper)
            if existing is not None:
                if paper.abstract and paper.abstract.strip() and not (existing.abstract and existing.abstract.strip()):
                    with self._get_conn() as conn:
                        conn.execute(
                            "UPDATE papers SET abstract = ? WHERE id = ?",
                            (paper.abstract.strip(), existing.id),
                        )
                        conn.commit()
                    _bump_mutation_version()
                return existing.id

        # Guard against UNIQUE(arxiv_id) IntegrityError when a paper with the
        # same arxiv_id already exists under a different (or NULL) DOI.
        if paper.arxiv_id:
            existing_arxiv = self.find_by_arxiv_id(paper.arxiv_id)
            if existing_arxiv is not None:
                if not paper.doi or normalize_doi(existing_arxiv.doi) != paper.doi:
                    if paper.abstract and paper.abstract.strip() and not (existing_arxiv.abstract and existing_arxiv.abstract.strip()):
                        with self._get_conn() as conn:
                            conn.execute(
                                "UPDATE papers SET abstract = ? WHERE id = ?",
                                (paper.abstract.strip(), existing_arxiv.id),
                            )
                            conn.commit()
                        _bump_mutation_version()
                    return existing_arxiv.id

        with self._get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO papers (doi, arxiv_id, title, authors, year, venue,
                                   abstract, categories, external_ids, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(doi) DO UPDATE SET
                    title = CASE
                        WHEN excluded.title IS NULL OR TRIM(excluded.title) = ''
                            THEN papers.title ELSE excluded.title END,
                    authors = CASE
                        WHEN excluded.authors IN ('[]', '') OR excluded.authors IS NULL
                            THEN papers.authors ELSE excluded.authors END,
                    year = COALESCE(excluded.year, papers.year),
                    venue = COALESCE(NULLIF(excluded.venue, ''), papers.venue),
                    abstract = COALESCE(NULLIF(excluded.abstract, ''), papers.abstract),
                    categories = CASE
                        WHEN excluded.categories IN ('[]', '') OR excluded.categories IS NULL
                            THEN papers.categories ELSE excluded.categories END,
                    external_ids = CASE
                        WHEN excluded.external_ids IN ('{}', '') OR excluded.external_ids IS NULL
                            THEN papers.external_ids ELSE excluded.external_ids END,
                    source = CASE
                        WHEN excluded.source IN ('local_db', 'known_papers')
                             AND papers.source NOT IN ('local_db', 'known_papers')
                            THEN papers.source
                        WHEN papers.source = 'acl' AND excluded.source <> 'acl'
                            THEN papers.source
                        ELSE excluded.source END,
                    created_at = papers.created_at
                """,
                (
                    paper.doi,
                    paper.arxiv_id,
                    paper.title,
                    json.dumps(paper.authors),
                    paper.year,
                    paper.venue,
                    paper.abstract,
                    json.dumps(paper.categories),
                    json.dumps(paper.external_ids),
                    paper.source,
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            _bump_mutation_version()

            # Resolve the actual row id for query provenance.  A conflict
            # update keeps the original row id, so re-read it rather than
            # trusting ``cursor.lastrowid``.
            if paper.doi:
                row = conn.execute(
                    "SELECT id FROM papers WHERE doi = ? COLLATE NOCASE",
                    (paper.doi,),
                ).fetchone()
                return int(row["id"]) if row else None
            if paper.arxiv_id:
                row = conn.execute(
                    "SELECT id FROM papers WHERE arxiv_id = ? COLLATE NOCASE",
                    (paper.arxiv_id,),
                ).fetchone()
                if row:
                    return int(row["id"])
            if cursor.lastrowid:
                return cursor.lastrowid
            return None

    def _find_existing_metadata_paper(self, paper: Paper) -> Paper | None:
        """Find an existing no-DOI record using normalized metadata."""
        if not paper.title:
            return None
        candidates = self.fuzzy_search(
            title=paper.title,
            authors=paper.authors,
            year=paper.year,
            limit=20,
        )
        for candidate in candidates:
            if title_similarity(paper.title, candidate.title) < 0.90:
                continue
            query_year = year_key(paper.year)
            if query_year and candidate.year and abs(query_year - candidate.year) > 1:
                continue
            query_authors = author_keys(paper.authors)
            candidate_authors = author_keys(candidate.authors)
            if query_authors and candidate_authors and not query_authors & candidate_authors:
                continue
            return candidate
        return None

    def get_paper(self, paper_id: int) -> Paper | None:
        """Get paper by ID."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM papers WHERE id = ?", (paper_id,)
            ).fetchone()
            return Paper.from_dict(dict(row)) if row else None

    # ==================== Lookup Methods ====================

    def _cache_key(self, method: str, *args: Any) -> tuple[Any, ...]:
        try:
            st = self.db_path.stat()
            file_sig = (st.st_ino, st.st_mtime_ns, st.st_size)
        except OSError:
            file_sig = (0, 0, 0)
        return (str(self.db_path), file_sig, _MUTATION_VERSION, method, *args)

    def _cache_get(self, key: tuple[Any, ...]) -> tuple[bool, Any]:
        with _DB_CACHE_LOCK:
            if key in _QUERY_CACHE:
                _QUERY_CACHE.move_to_end(key)
                return True, copy.deepcopy(_QUERY_CACHE[key])
        return False, None

    def _cache_set(self, key: tuple[Any, ...], value: Any) -> None:
        with _DB_CACHE_LOCK:
            if key in _QUERY_CACHE:
                _QUERY_CACHE.move_to_end(key)
            _QUERY_CACHE[key] = copy.deepcopy(value)
            while len(_QUERY_CACHE) > _QUERY_CACHE_MAX_SIZE:
                _QUERY_CACHE.popitem(last=False)

    def find_by_doi(self, doi: str | None) -> Paper | None:
        """Find paper by DOI.

        Args:
            doi: DOI to search for

        Returns:
            Paper if found, None otherwise
        """
        if not doi:
            return None

        doi = normalize_doi(doi)
        if not doi:
            return None

        key = self._cache_key("find_by_doi", doi.casefold())
        hit, cached = self._cache_get(key)
        if hit:
            return cached

        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM papers WHERE doi = ? COLLATE NOCASE", (doi,)
            ).fetchone()
            res = Paper.from_dict(dict(row)) if row else None
        self._cache_set(key, res)
        return res

    def find_by_arxiv_id(self, arxiv_id: str | None) -> Paper | None:
        """Find paper by arXiv ID.

        Args:
            arxiv_id: arXiv ID to search for (e.g., "1706.03762")

        Returns:
            Paper if found, None otherwise
        """
        if not arxiv_id:
            return None

        arxiv_id = normalize_arxiv_id(arxiv_id)
        if not arxiv_id:
            return None

        key = self._cache_key("find_by_arxiv_id", arxiv_id.casefold())
        hit, cached = self._cache_get(key)
        if hit:
            return cached

        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM papers WHERE arxiv_id = ? COLLATE NOCASE", (arxiv_id,)
            ).fetchone()
            res = Paper.from_dict(dict(row)) if row else None
        self._cache_set(key, res)
        return res

    def search_by_title(
        self,
        title: str,
        limit: int = 10,
        year: int | None = None,
        author: str | None = None,
    ) -> list[Paper]:
        """Search papers by title using FTS5.

        Args:
            title: Title to search for
            limit: Maximum results to return
            year: Optional year filter
            author: Optional author filter

        Returns:
            List of matching papers
        """
        tokens = title_tokens(title)
        if not tokens:
            return []
        key = self._cache_key(
            "search_by_title",
            tuple(tokens),
            limit,
            year,
            (author or "").casefold(),
        )
        hit, cached = self._cache_get(key)
        if hit:
            return cached

        with self._get_conn() as conn:
            # Match all meaningful words instead of the raw title string.
            # This tolerates terminal punctuation and Unicode dash variants.
            fts_query = " AND ".join(f'"{token}"' for token in tokens)

            if year and author:
                query = """
                    SELECT p.*, bm25(papers_fts) as rank
                    FROM papers_fts
                    JOIN papers p ON papers_fts.rowid = p.id
                    WHERE papers_fts MATCH ? AND p.year = ? AND p.authors LIKE ?
                    ORDER BY rank
                    LIMIT ?
                """
                rows = conn.execute(
                    query, (fts_query, year, f"%{author}%", limit)
                ).fetchall()
            elif year:
                query = """
                    SELECT p.*, bm25(papers_fts) as rank
                    FROM papers_fts
                    JOIN papers p ON papers_fts.rowid = p.id
                    WHERE papers_fts MATCH ? AND p.year = ?
                    ORDER BY rank
                    LIMIT ?
                """
                rows = conn.execute(query, (fts_query, year, limit)).fetchall()
            elif author:
                query = """
                    SELECT p.*, bm25(papers_fts) as rank
                    FROM papers_fts
                    JOIN papers p ON papers_fts.rowid = p.id
                    WHERE papers_fts MATCH ? AND p.authors LIKE ?
                    ORDER BY rank
                    LIMIT ?
                """
                rows = conn.execute(query, (fts_query, f"%{author}%", limit)).fetchall()
            else:
                query = """
                    SELECT p.*, bm25(papers_fts) as rank
                    FROM papers_fts
                    JOIN papers p ON papers_fts.rowid = p.id
                    WHERE papers_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                """
                rows = conn.execute(query, (fts_query, limit)).fetchall()

            res = [Paper.from_dict(dict(row)) for row in rows]
        self._cache_set(key, res)
        return res

    def fuzzy_search(
        self,
        title: str | None = None,
        authors: list[str] | str | None = None,
        year: int | None = None,
        limit: int = 10,
    ) -> list[Paper]:
        """Fuzzy search for papers by title/authors/year.

        This method is used when exact lookup fails and we need
        to find potential matches.

        Args:
            title: Title to search
            authors: List of authors
            year: Publication year
            limit: Maximum results

        Returns:
            List of matching papers
        """
        query_authors = author_keys(authors)
        query_year = year_key(year)
        query_tokens = title_tokens(title)

        # FTS narrows the 80k+ ACL rows efficiently.  If an old database was
        # created before FTS was populated, fall back to a broad title query.
        rows: list[sqlite3.Row] = []
        with self._get_conn() as conn:
            if query_tokens:
                fts_query = " AND ".join(f'title:"{token}"' for token in query_tokens)
                rows = conn.execute(
                    """
                    SELECT p.*
                    FROM papers_fts
                    JOIN papers p ON papers_fts.rowid = p.id
                    WHERE papers_fts MATCH ?
                    ORDER BY length(p.title) ASC
                    LIMIT ?
                    """,
                    (fts_query, max(limit * 20, 50)),
                ).fetchall()

            if not rows and len(query_tokens) >= 3:
                # Fallback if first token lost a hyphen (e.g. "Scikitlearn" vs "Scikit-learn")
                sub_fts = " AND ".join(f'title:"{token}"' for token in query_tokens[1:])
                rows = conn.execute(
                    """
                    SELECT p.*
                    FROM papers_fts
                    JOIN papers p ON papers_fts.rowid = p.id
                    WHERE papers_fts MATCH ?
                    ORDER BY length(p.title) ASC
                    LIMIT ?
                    """,
                    (sub_fts, max(limit * 20, 50)),
                ).fetchall()

            if not rows and title:
                first_token = query_tokens[0] if query_tokens else str(title)
                rows = conn.execute(
                    "SELECT * FROM papers WHERE lower(title) LIKE ? LIMIT ?",
                    (f"%{first_token.casefold()}%", max(limit * 20, 50)),
                ).fetchall()

        papers = [Paper.from_dict(dict(row)) for row in rows]
        scored: list[tuple[float, Paper]] = []
        for paper in papers:
            score = title_similarity(title, paper.title) if title else 0.0
            if title and score < 0.70:
                continue

            candidate_authors = author_keys(paper.authors)
            author_match = bool(query_authors & candidate_authors)
            if query_authors and candidate_authors and not author_match:
                # A title containing generic words such as "transfer learning"
                # is not enough to identify a paper.  Require the first author
                # whenever both sides provide author metadata.
                continue

            if query_year and paper.year:
                distance = abs(query_year - paper.year)
                if distance > 3:
                    continue
                score += max(0.0, 0.08 - distance * 0.02)
            if author_match:
                score += 0.08
            scored.append((score, paper))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [paper for _, paper in scored[:limit]]

    # ==================== Query Logging ====================

    def log_query(
        self,
        query_params: dict[str, Any],
        found: bool,
        source: str,
        paper_id: int | None = None,
    ) -> int:
        """Log a database query for analytics.

        Args:
            query_params: Parameters used for the query
            found: Whether a paper was found
            source: Source of the result ('local_db', 'api')
            paper_id: ID of found paper (if any)

        Returns:
            Log entry ID
        """
        # Create hash of query params for deduplication
        param_str = json.dumps(query_params, sort_keys=True)
        query_hash = hashlib.md5(param_str.encode()).hexdigest()

        with self._get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO query_log (query_hash, found, source, paper_id, queried_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    query_hash,
                    1 if found else 0,
                    source,
                    paper_id,
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            _bump_query_log_version()
            return cursor.lastrowid or 0

    def get_stats(self) -> dict[str, Any]:
        """Get database statistics with Read-Through RAM Cache + Event Invalidation.

        Returns:
            Dictionary with stats
        """
        resolved_key = str(self.db_path.resolve())
        now_mono = time.monotonic()
        st_ino = 0
        try:
            if self.db_path.is_file():
                st_ino = self.db_path.stat().st_ino
        except OSError:
            pass

        with _DB_CACHE_LOCK:
            cached = _STATS_CACHE.get(resolved_key)
            if cached is not None:
                cached_at, c_ino, c_ver, c_qver, payload = cached
                if (
                    now_mono - cached_at < _STATS_CACHE_TTL_SECONDS
                    and c_ino == st_ino
                    and c_ver == _MUTATION_VERSION
                    and c_qver == _QUERY_LOG_VERSION
                ):
                    return copy.deepcopy(payload)

        with _STATS_COMPUTE_LOCK:
            now_mono = time.monotonic()
            with _DB_CACHE_LOCK:
                cached = _STATS_CACHE.get(resolved_key)
                if cached is not None:
                    cached_at, c_ino, c_ver, c_qver, payload = cached
                    if (
                        now_mono - cached_at < _STATS_CACHE_TTL_SECONDS
                        and c_ino == st_ino
                        and c_ver == _MUTATION_VERSION
                        and c_qver == _QUERY_LOG_VERSION
                    ):
                        return copy.deepcopy(payload)
                mut_ver_snapshot = _MUTATION_VERSION
                qlog_ver_snapshot = _QUERY_LOG_VERSION
                p_cached = _PAPERS_COUNTS_CACHE.get(resolved_key)

            source_counts_dict: dict[str, int] | None = None
            if p_cached is not None:
                p_at, p_ino, p_ver, p_counts = p_cached
                if (
                    now_mono - p_at < _STATS_CACHE_TTL_SECONDS
                    and p_ino == st_ino
                    and p_ver == mut_ver_snapshot
                ):
                    source_counts_dict = dict(p_counts)

            with self._get_conn() as conn:
                if source_counts_dict is None:
                    # Count by source (uses covering index idx_papers_source, avoiding 245MB table scan)
                    source_rows = conn.execute(
                        """
                        SELECT source, COUNT(*) as count
                        FROM papers
                        GROUP BY source
                        ORDER BY count DESC
                        """
                    ).fetchall()
                    source_counts_dict = {row[0]: int(row[1]) for row in source_rows}
                    with _DB_CACHE_LOCK:
                        _PAPERS_COUNTS_CACHE[resolved_key] = (
                            now_mono,
                            st_ino,
                            mut_ver_snapshot,
                            dict(source_counts_dict),
                        )

                total_papers = sum(source_counts_dict.values())

                # Count queries + hits + hit rate in a single pass
                q_row = conn.execute(
                    """
                    SELECT
                        COUNT(*),
                        COALESCE(SUM(CASE WHEN found = 1 THEN 1 ELSE 0 END), 0),
                        CAST(SUM(found) AS FLOAT) / COUNT(*) * 100
                    FROM query_log
                    """
                ).fetchone()
                total_queries = int(q_row[0] or 0) if q_row else 0
                local_hits_count = int(q_row[1] or 0) if q_row else 0
                hit_rate = (q_row[2] if q_row and q_row[2] is not None else 0) or 0

                # Recent queries
                recent_queries = conn.execute(
                    """
                    SELECT l.*, p.title
                    FROM query_log l
                    LEFT JOIN papers p ON l.paper_id = p.id
                    ORDER BY l.queried_at DESC
                    LIMIT 10
                    """
                ).fetchall()

                result = {
                    "total_papers": total_papers,
                    "source_counts": dict(source_counts_dict),
                    "total_queries": total_queries,
                    "local_hits_count": int(local_hits_count),
                    "hit_rate_percent": round(hit_rate, 2),
                    "recent_queries": [dict(row) for row in recent_queries],
                }

            with _DB_CACHE_LOCK:
                _STATS_CACHE[resolved_key] = (
                    now_mono,
                    st_ino,
                    mut_ver_snapshot,
                    qlog_ver_snapshot,
                    copy.deepcopy(result),
                )
            return result

    # ==================== Bulk Operations ====================

    def add_papers_bulk(self, papers: list[Paper]) -> int:
        """Add multiple papers in a single SQLite connection and transaction.

        Args:
            papers: List of papers to add

        Returns:
            Number of papers added
        """
        if not papers:
            return 0

        added = 0
        now_iso = datetime.now().isoformat()
        with self._get_conn() as conn:
            for paper in papers:
                paper.doi = normalize_doi(paper.doi)
                paper.arxiv_id = normalize_arxiv_id(paper.arxiv_id)

                if not paper.doi:
                    existing = self._find_existing_metadata_paper(paper)
                    if existing is not None:
                        if (
                            paper.abstract
                            and paper.abstract.strip()
                            and not (existing.abstract and existing.abstract.strip())
                        ):
                            conn.execute(
                                "UPDATE papers SET abstract = ? WHERE id = ?",
                                (paper.abstract.strip(), existing.id),
                            )
                        added += 1
                        continue

                if paper.arxiv_id:
                    row = conn.execute(
                        "SELECT * FROM papers WHERE arxiv_id = ? COLLATE NOCASE",
                        (paper.arxiv_id,),
                    ).fetchone()
                    if row is not None:
                        existing_arxiv = Paper.from_dict(dict(row))
                        if not paper.doi or normalize_doi(existing_arxiv.doi) != paper.doi:
                            if (
                                paper.abstract
                                and paper.abstract.strip()
                                and not (
                                    existing_arxiv.abstract
                                    and existing_arxiv.abstract.strip()
                                )
                            ):
                                conn.execute(
                                    "UPDATE papers SET abstract = ? WHERE id = ?",
                                    (paper.abstract.strip(), existing_arxiv.id),
                                )
                            added += 1
                            continue

                conn.execute(
                    """
                    INSERT INTO papers (doi, arxiv_id, title, authors, year, venue,
                                       abstract, categories, external_ids, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(doi) DO UPDATE SET
                        title = CASE
                            WHEN excluded.title IS NULL OR TRIM(excluded.title) = ''
                                THEN papers.title ELSE excluded.title END,
                        authors = CASE
                            WHEN excluded.authors IN ('[]', '') OR excluded.authors IS NULL
                                THEN papers.authors ELSE excluded.authors END,
                        year = COALESCE(excluded.year, papers.year),
                        venue = COALESCE(NULLIF(excluded.venue, ''), papers.venue),
                        abstract = COALESCE(NULLIF(excluded.abstract, ''), papers.abstract),
                        categories = CASE
                            WHEN excluded.categories IN ('[]', '') OR excluded.categories IS NULL
                                THEN papers.categories ELSE excluded.categories END,
                        external_ids = CASE
                            WHEN excluded.external_ids IN ('{}', '') OR excluded.external_ids IS NULL
                                THEN papers.external_ids ELSE excluded.external_ids END,
                        source = CASE
                            WHEN excluded.source IN ('local_db', 'known_papers')
                                 AND papers.source NOT IN ('local_db', 'known_papers')
                                THEN papers.source
                            WHEN papers.source = 'acl' AND excluded.source <> 'acl'
                                THEN papers.source
                            ELSE excluded.source END,
                        created_at = papers.created_at
                    """,
                    (
                        paper.doi,
                        paper.arxiv_id,
                        paper.title,
                        json.dumps(paper.authors),
                        paper.year,
                        paper.venue,
                        paper.abstract,
                        json.dumps(paper.categories),
                        json.dumps(paper.external_ids),
                        paper.source,
                        now_iso,
                    ),
                )
                added += 1
            conn.commit()
        _bump_mutation_version()
        return added

    def get_all_papers(self, limit: int = 100, offset: int = 0) -> list[Paper]:
        """Get all papers with pagination.

        Args:
            limit: Maximum papers to return
            offset: Number of papers to skip

        Returns:
            List of papers
        """
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM papers ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
            return [Paper.from_dict(dict(row)) for row in rows]

    def sample_random_papers(
        self,
        count: int = 12,
        prefer_with_doi: bool = True,
    ) -> list[Paper]:
        """Fast O(k log N) random paper sampler from the local ACL/scholarly database.

        Selects high-quality records with complete metadata (title, authors, year,
        venue, DOI) suitable for live interactive sandbox testing and synthetic PDF
        manuscript generation.
        """
        import random
        import re

        target = max(1, min(int(count or 12), 30))
        picked: dict[str, Paper] = {}
        bad_title_re = re.compile(
            r"(?:this\s+essay|comprehensive\s+survey|comprehensive\s+review|"
            r"introduction\s+to\s+|abstract\s+|survey\s*$|:?\s*survey\s+of\s+|"
            r"a\s+(?:brief\s+)?(?:survey|review|introduction)|"
            r"^\s*(?:deep\s+learning|natural\s+language\s+processing)|"
            r"[{}\\]|^proceedings\s+of|^book\s+reviews?)",
            re.IGNORECASE,
        )

        def _is_clean_candidate(p: Paper) -> bool:
            t = (p.title or "").strip().rstrip(".")
            if len(t) < 18 or len(t) > 180:
                return False
            if "." in t or "?" in t or "!" in t:
                return False
            if bad_title_re.search(t):
                return False
            if not p.authors or not any(str(a).strip() for a in p.authors):
                return False
            # Ensure first author has an alphabetic surname of at least 3 chars
            first_auth = str(p.authors[0]).strip()
            if len(re.sub(r"[^A-Za-zÀ-ÿ]", "", first_auth)) < 3:
                return False
            if not p.year or not (1995 <= int(p.year) <= 2026):
                return False
            if prefer_with_doi and not (p.doi and str(p.doi).strip()):
                return False
            return True

        try:
            with self._get_conn() as conn:
                bounds = conn.execute("SELECT MIN(id), MAX(id) FROM papers").fetchone()
                min_id = int(bounds[0]) if bounds and bounds[0] is not None else 0
                max_id = int(bounds[1]) if bounds and bounds[1] is not None else 0
                if max_id > 0 and max_id >= min_id:
                    attempts = 0
                    max_attempts = target * 10
                    while len(picked) < target and attempts < max_attempts:
                        attempts += 1
                        rand_id = random.randint(min_id, max_id)
                        require_abs = attempts <= max_attempts // 2
                        if require_abs:
                            rows = conn.execute(
                                """
                                SELECT * FROM papers
                                WHERE id >= ?
                                  AND title IS NOT NULL AND TRIM(title) <> ''
                                  AND year IS NOT NULL AND year >= 1998
                                  AND authors IS NOT NULL AND authors NOT IN ('[]', '')
                                  AND doi IS NOT NULL AND TRIM(doi) <> ''
                                  AND abstract IS NOT NULL AND TRIM(abstract) <> ''
                                LIMIT 6
                                """,
                                (rand_id,),
                            ).fetchall()
                        else:
                            rows = conn.execute(
                                """
                                SELECT * FROM papers
                                WHERE id >= ?
                                  AND title IS NOT NULL AND TRIM(title) <> ''
                                  AND year IS NOT NULL AND year >= 1998
                                  AND authors IS NOT NULL AND authors NOT IN ('[]', '')
                                LIMIT 6
                                """,
                                (rand_id,),
                            ).fetchall()
                        for r in rows:
                            paper = Paper.from_dict(dict(r))
                            if not _is_clean_candidate(paper):
                                continue
                            norm_t = _title_key(paper.title)
                            if norm_t and norm_t not in picked:
                                if not paper.venue or not str(paper.venue).strip():
                                    paper.venue = "Proceedings of the Association for Computational Linguistics (ACL)"
                                picked[norm_t] = paper
                                if len(picked) >= target:
                                    break

                # Relax DOI requirement if DB has rows without DOI
                if len(picked) < target and max_id > 0:
                    rows = conn.execute(
                        """
                        SELECT * FROM papers
                        WHERE title IS NOT NULL AND TRIM(title) <> ''
                          AND year IS NOT NULL
                          AND authors IS NOT NULL AND authors NOT IN ('[]', '')
                        ORDER BY RANDOM()
                        LIMIT ?
                        """,
                        (target * 6,),
                    ).fetchall()
                    for r in rows:
                        paper = Paper.from_dict(dict(r))
                        t = (paper.title or "").strip().rstrip(".")
                        if (
                            len(t) >= 18
                            and "." not in t
                            and not bad_title_re.search(t)
                            and paper.authors
                            and paper.year
                        ):
                            norm_t = _title_key(paper.title)
                            if norm_t and norm_t not in picked:
                                if not paper.venue or not str(paper.venue).strip():
                                    paper.venue = "Proceedings of the Association for Computational Linguistics (ACL)"
                                picked[norm_t] = paper
                                if len(picked) >= target:
                                    break
        except Exception:
            pass

        # Curated fallback ACL/NLP papers if local_papers.db is empty (e.g., CI environment)
        if len(picked) < target:
            fallback_pool = [
                Paper(
                    title="Attention Is All You Need",
                    authors=["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
                    year=2017,
                    venue="Advances in Neural Information Processing Systems (NeurIPS)",
                    doi="10.48550/arXiv.1706.03762",
                    source="acl",
                    abstract="We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
                ),
                Paper(
                    title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                    authors=["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
                    year=2019,
                    venue="Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics (NAACL-HLT)",
                    doi="10.18653/v1/N19-1423",
                    source="acl",
                    abstract="We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers.",
                ),
                Paper(
                    title="Neural Machine Translation of Rare Words with Subword Units",
                    authors=["Rico Sennrich", "Barry Haddow", "Alexandra Birch"],
                    year=2016,
                    venue="Proceedings of the 54th Annual Meeting of the Association for Computational Linguistics (ACL)",
                    doi="10.18653/v1/P16-1162",
                    source="acl",
                    abstract="We introduce a simpler and more effective approach, making the NMT model capable of open-vocabulary translation by encoding rare and unknown words as sequences of subword units.",
                ),
                Paper(
                    title="Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
                    authors=["Nils Reimers", "Iryna Gurevych"],
                    year=2019,
                    venue="Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing (EMNLP-IJCNLP)",
                    doi="10.18653/v1/D19-1410",
                    source="acl",
                    abstract="We present Sentence-BERT (SBERT), a modification of the pretrained BERT network that use siamese and triplet network structures to derive semantically meaningful sentence embeddings.",
                ),
                Paper(
                    title="BART: Denoising Sequence-to-Sequence Pre-training for Natural Language Generation, Translation, and Comprehension",
                    authors=["Mike Lewis", "Yinhan Liu", "Naman Goyal", "Marjan Ghazvininejad"],
                    year=2020,
                    venue="Proceedings of the 58th Annual Meeting of the Association for Computational Linguistics (ACL)",
                    doi="10.18653/v1/2020.acl-main.703",
                    source="acl",
                    abstract="We present BART, a denoising autoencoder for pretraining sequence-to-sequence models.",
                ),
                Paper(
                    title="RoBERTa: A Robustly Optimized BERT Pretraining Approach",
                    authors=["Yinhan Liu", "Myle Ott", "Naman Goyal", "Jingfei Du"],
                    year=2019,
                    venue="Computing Research Repository (CoRR)",
                    doi="10.48550/arXiv.1907.11692",
                    source="acl",
                    abstract="We present a replication study of BERT pretraining that carefully measures the impact of many key hyperparameters and training data size.",
                ),
                Paper(
                    title="A Large Annotated Corpus for Learning Natural Language Inference",
                    authors=["Samuel Bowman", "Gabor Angeli", "Christopher Potts", "Christopher Manning"],
                    year=2015,
                    venue="Proceedings of the 2015 Conference on Empirical Methods in Natural Language Processing (EMNLP)",
                    doi="10.18653/v1/D15-1075",
                    source="acl",
                    abstract="We introduce the Stanford Natural Language Inference corpus, a new, freely available collection of labeled sentence pairs.",
                ),
                Paper(
                    title="GloVe: Global Vectors for Word Representation",
                    authors=["Jeffrey Pennington", "Richard Socher", "Christopher Manning"],
                    year=2014,
                    venue="Proceedings of the 2014 Conference on Empirical Methods in Natural Language Processing (EMNLP)",
                    doi="10.3115/v1/D14-1162",
                    source="acl",
                    abstract="We propose a new global log-bilinear regression model that combines the advantages of global matrix factorization and local context window methods.",
                ),
                Paper(
                    title="Effective Approaches to Attention-based Neural Machine Translation",
                    authors=["Minh-Thang Luong", "Hieu Pham", "Christopher Manning"],
                    year=2015,
                    venue="Proceedings of the 2015 Conference on Empirical Methods in Natural Language Processing (EMNLP)",
                    doi="10.18653/v1/D15-1166",
                    source="acl",
                    abstract="This paper examines two simple and effective classes of attentional mechanism: a global approach which always attends to all source words and a local one that only looks at a subset of words at a time.",
                ),
                Paper(
                    title="SQuAD: 100,000+ Questions for Machine Comprehension of Text",
                    authors=["Pranav Rajpurkar", "Jian Zhang", "Konstantin Lopyrev", "Percy Liang"],
                    year=2016,
                    venue="Proceedings of the 2016 Conference on Empirical Methods in Natural Language Processing (EMNLP)",
                    doi="10.18653/v1/D16-1264",
                    source="acl",
                    abstract="We present the Stanford Question Answering Dataset (SQuAD), a new reading comprehension dataset consisting of 100,000+ questions posed by crowdworkers on Wikipedia articles.",
                ),
                Paper(
                    title="Deep Contextualized Word Representations",
                    authors=["Matthew Peters", "Mark Neumann", "Mohit Iyyer", "Matt Gardner"],
                    year=2018,
                    venue="Proceedings of the 2018 Conference of the North American Chapter of the Association for Computational Linguistics (NAACL-HLT)",
                    doi="10.18653/v1/N18-1202",
                    source="acl",
                    abstract="We introduce a new type of deep contextualized word representation that models both complex characteristics of word use and how these uses vary across linguistic contexts.",
                ),
                Paper(
                    title="BLEU: a Method for Automatic Evaluation of Machine Translation",
                    authors=["Kishore Papineni", "Salim Roukos", "Todd Ward", "Wei-Jing Zhu"],
                    year=2002,
                    venue="Proceedings of the 40th Annual Meeting of the Association for Computational Linguistics (ACL)",
                    doi="10.3115/1073083.1073135",
                    source="acl",
                    abstract="We propose a method of automatic machine translation evaluation that is quick, inexpensive, and language-independent, that correlates highly with human evaluation.",
                ),
                Paper(
                    title="Convolutional Neural Networks for Sentence Classification",
                    authors=["Yoon Kim"],
                    year=2014,
                    venue="Proceedings of the 2014 Conference on Empirical Methods in Natural Language Processing (EMNLP)",
                    doi="10.3115/v1/D14-1181",
                    source="acl",
                    abstract="We report on a series of experiments with convolutional neural networks trained on top of pre-trained word vectors for sentence-level classification tasks.",
                ),
                Paper(
                    title="Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
                    authors=["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus", "Fabio Petroni"],
                    year=2020,
                    venue="Advances in Neural Information Processing Systems (NeurIPS)",
                    doi="10.48550/arXiv.2005.11401",
                    source="acl",
                    abstract="We explore a general-purpose fine-tuning recipe for retrieval-augmented generation (RAG) models which combine pre-trained parametric and non-parametric memory for language generation.",
                ),
                Paper(
                    title="Language Models are Few-Shot Learners",
                    authors=["Tom Brown", "Benjamin Mann", "Nick Ryder", "Melanie Subbiah"],
                    year=2020,
                    venue="Advances in Neural Information Processing Systems (NeurIPS)",
                    doi="10.48550/arXiv.2005.14165",
                    source="acl",
                    abstract="We demonstrate that scaling up language models greatly improves task-agnostic, few-shot performance, sometimes even reaching competitiveness with prior state-of-the-art fine-tuning approaches.",
                ),
                Paper(
                    title="LoRA: Low-Rank Adaptation of Large Language Models",
                    authors=["Edward Hu", "Yelong Shen", "Phillip Wallis", "Zeyuan Allen-Zhu"],
                    year=2022,
                    venue="International Conference on Learning Representations (ICLR)",
                    doi="10.48550/arXiv.2106.09685",
                    source="acl",
                    abstract="We propose Low-Rank Adaptation, or LoRA, which freezes the pretrained model weights and injects trainable rank decomposition matrices into each layer of the Transformer architecture.",
                ),
            ]
            random.shuffle(fallback_pool)
            for fp in fallback_pool:
                norm_t = _title_key(fp.title)
                if norm_t not in picked:
                    try:
                        pid = self.add_paper(fp)
                        if pid:
                            fp.id = pid
                    except Exception:
                        pass
                    picked[norm_t] = fp
                    if len(picked) >= target:
                        break

        result = list(picked.values())[:target]
        random.shuffle(result)
        return result

    def delete_all(self) -> int:
        """Delete all papers (for testing/reset).

        Returns:
            Number of papers deleted
        """
        with self._get_conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
            conn.execute("DELETE FROM papers")
            conn.execute("DELETE FROM query_log")
            conn.commit()
            _bump_mutation_version()
            return count

    # ==================== Maintenance ====================

    def dedupe(self) -> dict[str, int]:
        """Remove duplicate/empty rows and rebuild the FTS index.

        Crossref/OpenAlex sync can insert several rows for the same work when
        the DOI is missing or differs only by URL prefix.  This routine:

        1. Deletes rows without a usable title.
        2. Removes DOI duplicates, preferring the row referenced by
           ``query_log.paper_id`` and the smallest ``id`` otherwise.
        3. Removes remaining ``(normalized title, year)`` duplicates.
        4. Folds ``known_papers`` seed rows onto the live row that carries the
           curated DOI (title-only matches are never folded).
        5. Rebuilds the FTS5 index so the search table matches ``papers``.

        Returns:
            Counts keyed by ``removed_empty_title``, ``removed_doi_duplicates``,
            ``removed_title_duplicates``, ``removed_known_paper_duplicates``
            and ``total_removed``.
        """
        removed_empty = 0
        removed_doi = 0
        removed_title = 0
        removed_known_papers = 0

        with self._get_conn() as conn:
            # 1. Drop rows with no usable title.
            cursor = conn.execute(
                "DELETE FROM papers WHERE title IS NULL OR TRIM(title) = ''"
            )
            removed_empty = cursor.rowcount or 0

            # 2. DOI duplicates.  Keep the row that is referenced by the query
            #    log (has provenance) and, as a tie-breaker, the lowest id.
            dup_dois = conn.execute(
                """
                SELECT doi
                FROM papers
                WHERE doi IS NOT NULL AND TRIM(doi) <> ''
                GROUP BY lower(doi)
                HAVING COUNT(*) > 1
                """
            ).fetchall()
            for row in dup_dois:
                doi = row["doi"]
                candidates = conn.execute(
                    """
                    SELECT p.id,
                           (SELECT COUNT(*) FROM query_log q
                            WHERE q.paper_id = p.id) AS refs
                    FROM papers p
                    WHERE lower(p.doi) = lower(?)
                    ORDER BY refs DESC, p.id ASC
                    """,
                    (doi,),
                ).fetchall()
                keep_id = candidates[0]["id"]
                drop_ids = [c["id"] for c in candidates[1:]]
                if not drop_ids:
                    continue
                placeholders = ",".join("?" for _ in drop_ids)
                # Re-point provenance to the surviving row before deleting.
                conn.execute(
                    f"UPDATE query_log SET paper_id = ? WHERE paper_id IN ({placeholders})",
                    (keep_id, *drop_ids),
                )
                cursor = conn.execute(
                    f"DELETE FROM papers WHERE id IN ({placeholders})",
                    tuple(drop_ids),
                )
                removed_doi += cursor.rowcount or 0

            # 3. Remaining (title, year) duplicates without a DOI.
            dup_titles = conn.execute(
                """
                SELECT lower(TRIM(title)) AS norm_title, COALESCE(year, -1) AS y
                FROM papers
                GROUP BY norm_title, y
                HAVING COUNT(*) > 1
                """
            ).fetchall()
            for row in dup_titles:
                candidates = conn.execute(
                    """
                    SELECT p.id,
                           (SELECT COUNT(*) FROM query_log q
                            WHERE q.paper_id = p.id) AS refs
                    FROM papers p
                    WHERE lower(TRIM(p.title)) = ?
                      AND COALESCE(p.year, -1) = ?
                    ORDER BY refs DESC, p.id ASC
                    """,
                    (row["norm_title"], row["y"]),
                ).fetchall()
                keep_id = candidates[0]["id"]
                drop_ids = [c["id"] for c in candidates[1:]]
                if not drop_ids:
                    continue
                placeholders = ",".join("?" for _ in drop_ids)
                conn.execute(
                    f"UPDATE query_log SET paper_id = ? WHERE paper_id IN ({placeholders})",
                    (keep_id, *drop_ids),
                )
                cursor = conn.execute(
                    f"DELETE FROM papers WHERE id IN ({placeholders})",
                    tuple(drop_ids),
                )
                removed_title += cursor.rowcount or 0

            # 4. Fold curated ``known_papers`` rows onto the canonical live
            #     row, matched by the *curated DOI* only (never by title).
            #
            #     The curated table is authoritative: its DOI lives in code
            #     (``_KNOWN_PAPERS``), not in the ``papers.doi`` column, so
            #     comparing the DB column alone would leave the seed rows
            #     looking like distinct papers forever.  We resolve the DOI
            #     from the curated entry and collapse the seed row onto the
            #     live row that carries it.
            #
            #     A title-based fallback is deliberately NOT used.  A title
            #     match cannot prove two rows are the same work here: the ACL
            #     corpus republishes the same title across years/venues (e.g.
            #     "Adam" the 2015 ICLR paper vs. an unrelated 2014 EMNLP
            #     "A Fast and Accurate Dependency Parser" row that shares the
            #     title of the known-paper entry but has a different DOI).
            #     Only a shared DOI is strong enough evidence, so entries
            #     whose curated DOI is absent from the DB are left untouched.
            curated_titles = {
                _title_key(info["title"]): info
                for info in _known_papers_metadata().values()
            }

            known_rows = conn.execute(
                "SELECT id, title, doi, year FROM papers WHERE source = 'known_papers'"
            ).fetchall()
            for known in known_rows:
                curated_doi = normalize_doi(known["doi"]) if known["doi"] else None
                if not curated_doi:
                    info = curated_titles.get(_title_key(known["title"]))
                    if not info or not info.get("doi"):
                        continue
                    curated_doi = normalize_doi(info["doi"])
                if not curated_doi:
                    continue

                target = conn.execute(
                    "SELECT id FROM papers "
                    "WHERE source <> 'known_papers' "
                    "AND doi IS NOT NULL AND lower(doi) = ? LIMIT 1",
                    (curated_doi,),
                ).fetchone()
                if target is None:
                    continue

                keep_id = target["id"]
                conn.execute(
                    "UPDATE query_log SET paper_id = ? WHERE paper_id = ?",
                    (keep_id, known["id"]),
                )
                cursor = conn.execute(
                    "DELETE FROM papers WHERE id = ?", (known["id"],)
                )
                removed_known_papers += cursor.rowcount or 0

            conn.commit()

            # 5. Rebuild FTS to match the deduped table.
            conn.execute("INSERT INTO papers_fts(papers_fts) VALUES('rebuild')")
            conn.commit()
            _bump_mutation_version()

        return {
            "removed_empty_title": removed_empty,
            "removed_doi_duplicates": removed_doi,
            "removed_title_duplicates": removed_title,
            "removed_known_paper_duplicates": removed_known_papers,
            "total_removed": (
                removed_empty + removed_doi + removed_title + removed_known_papers
            ),
        }
