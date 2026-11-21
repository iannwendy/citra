#!/usr/bin/env python3
"""Import papers from OpenAlex to local database using cursor/page pagination.

Usage:
    export OPENALEX_API_KEY="your-key"  # Optional polite/higher rate limit
    python scripts/import_openalex.py --field cs --limit 10000
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.database.schemas import INIT_STATEMENTS  # noqa: E402


def get_openalex_api_key() -> str | None:
    """Get API key from environment variable."""
    return os.environ.get("OPENALEX_API_KEY")


def reconstruct_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    """Reconstruct plain-text abstract from OpenAlex `abstract_inverted_index`."""
    if not inverted_index or not isinstance(inverted_index, dict):
        return None
    positions: list[tuple[int, str]] = []
    for token, pos_list in inverted_index.items():
        if not isinstance(pos_list, list):
            continue
        for pos in pos_list:
            if isinstance(pos, int):
                positions.append((pos, str(token)))
    if not positions:
        return None
    positions.sort(key=lambda item: item[0])
    text = " ".join(tok for _, tok in positions).strip()
    return text or None


def search_papers_cursor(
    query: str,
    field: str | None = None,
    limit: int = 100,
    *,
    page: int | None = None,
    cursor: str | None = "*",
    max_retries: int = 3,
) -> tuple[list[dict[str, Any]], str | None]:
    """Query OpenAlex `/works` using `cursor` or `page` pagination (never deprecated `offset`)."""
    api_key = get_openalex_api_key()
    contact_email = os.environ.get("CONTACT_EMAIL", "noreply@citra.edu.vn")
    base_url = "https://api.openalex.org/works"

    params: dict[str, Any] = {
        "search": query,
        "per-page": max(1, min(int(limit), 200)),
        "mailto": contact_email,
        "select": "id,title,authorships,publication_year,doi,primary_location,concepts,abstract_inverted_index",
    }
    if page is not None:
        params["page"] = max(1, int(page))
    else:
        params["cursor"] = cursor or "*"

    if field:
        field_map = {
            "cs": "C41008148",
            "ai": "C39432304",
            "nlp": "C185592680",
        }
        if field.lower() in field_map:
            params["filter"] = f"concepts.id:{field_map[field.lower()]}"

    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    for attempt in range(max(1, max_retries)):
        response = requests.get(base_url, params=params, headers=headers, timeout=30)
        if response.status_code == 429 and attempt + 1 < max_retries:
            wait_sec = min(60, 5 * (attempt + 1))
            print(f"Rate limited (429). Waiting {wait_sec} seconds...")
            time.sleep(wait_sec)
            continue
        response.raise_for_status()
        payload = response.json()
        results = payload.get("results") or []
        next_cursor = (payload.get("meta") or {}).get("next_cursor")
        return results, next_cursor

    return [], None


def search_papers(
    query: str,
    field: str | None = None,
    limit: int = 100,
    page: int = 1,
    cursor: str | None = None,
) -> list[dict[str, Any]]:
    """Search papers on OpenAlex via `page` or `cursor` pagination."""
    if cursor is not None:
        results, _ = search_papers_cursor(query, field, limit, cursor=cursor)
    else:
        results, _ = search_papers_cursor(query, field, limit, page=page, cursor=None)
    return results


def paper_to_dict(work: dict[str, Any]) -> dict[str, Any]:
    """Convert OpenAlex work JSON into a `papers` table row dict with reconstructed abstract."""
    authors: list[str] = []
    for authorship in work.get("authorships") or []:
        author = authorship.get("author") or {}
        name = author.get("display_name")
        if name:
            authors.append(str(name))

    raw_doi = str(work.get("doi") or "").strip()
    doi = raw_doi.replace("https://doi.org/", "").replace("http://doi.org/", "").strip().lower()

    venue = ""
    primary_location = work.get("primary_location") or {}
    source_obj = primary_location.get("source") or {}
    if source_obj.get("display_name"):
        venue = str(source_obj["display_name"])

    concepts: list[str] = []
    for concept in work.get("concepts") or []:
        if (concept.get("score") or 0) > 0.3 and concept.get("display_name"):
            concepts.append(str(concept["display_name"]))

    openalex_id = str(work.get("id") or "").replace("https://openalex.org/", "").strip()
    abstract = reconstruct_abstract(work.get("abstract_inverted_index"))

    return {
        "doi": doi or None,
        "arxiv_id": None,
        "title": str(work.get("title") or "").strip(),
        "authors": json.dumps(authors, ensure_ascii=False),
        "year": work.get("publication_year"),
        "venue": venue,
        "abstract": abstract,
        "categories": json.dumps(concepts, ensure_ascii=False),
        "external_ids": json.dumps({"openalex": openalex_id}, ensure_ascii=False),
        "source": "openalex",
        "created_at": datetime.now().isoformat(),
    }


def _sync_fts_if_untriggered(conn: sqlite3.Connection, row_id: int, paper: dict[str, Any]) -> None:
    """Ensure `papers_fts` stays synchronized even if DB lacks automatic FTS5 triggers."""
    has_fts = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='papers_fts'"
    ).fetchone()
    if not has_fts:
        return
    has_trigger = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='papers_fts_insert'"
    ).fetchone()
    if has_trigger:
        return
    conn.execute("DELETE FROM papers_fts WHERE rowid = ?", (row_id,))
    conn.execute(
        "INSERT INTO papers_fts(rowid, title, authors, abstract) VALUES (?, ?, ?, ?)",
        (row_id, paper["title"], paper["authors"], paper["abstract"]),
    )


def insert_paper(conn: sqlite3.Connection, paper: dict[str, Any]) -> int | None:
    """Insert or update paper in `papers` and keep `papers_fts` synchronized."""
    if not paper.get("title"):
        return None
    try:
        cursor = conn.execute(
            """
            INSERT INTO papers (doi, arxiv_id, title, authors, year, venue,
                               abstract, categories, external_ids, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(doi) DO UPDATE SET
                title = excluded.title,
                authors = excluded.authors,
                year = excluded.year,
                venue = excluded.venue,
                abstract = COALESCE(excluded.abstract, papers.abstract),
                categories = excluded.categories,
                external_ids = excluded.external_ids,
                source = excluded.source,
                created_at = excluded.created_at
            """,
            (
                paper["doi"],
                paper["arxiv_id"],
                paper["title"],
                paper["authors"],
                paper["year"],
                paper["venue"],
                paper["abstract"],
                paper["categories"],
                paper["external_ids"],
                paper["source"],
                paper["created_at"],
            ),
        )
        row_id = cursor.lastrowid
        if paper.get("doi"):
            fetched = conn.execute(
                "SELECT id FROM papers WHERE doi = ?", (paper["doi"],)
            ).fetchone()
            if fetched:
                row_id = int(fetched[0])
        if row_id is not None:
            _sync_fts_if_untriggered(conn, int(row_id), paper)
        return int(row_id) if row_id is not None else None
    except Exception as exc:
        print(f"Error inserting paper: {exc}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Import papers from OpenAlex")
    parser.add_argument("--query", "-q", default="machine learning", help="Search query")
    parser.add_argument(
        "--field",
        "-f",
        choices=["cs", "ai", "nlp", "all"],
        default="cs",
        help="Field filter",
    )
    parser.add_argument("--limit", "-l", type=int, default=1000, help="Number of papers to import")
    parser.add_argument("--db", "-d", default="data/local_papers.db", help="Database path")
    parser.add_argument("--batch-size", "-b", type=int, default=100, help="Batch size for API calls")

    args = parser.parse_args()
    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    api_key = get_openalex_api_key()
    if api_key:
        print(f"Using API key: {api_key[:8]}...")
    else:
        print("WARNING: No API key set. Using polite free tier.")

    conn = sqlite3.connect(str(db_path))
    try:
        for stmt in INIT_STATEMENTS:
            conn.executescript(stmt)
        conn.commit()

        total_imported = 0
        consecutive_errors = 0
        max_consecutive_errors = 5
        cursor: str | None = "*"

        print(f"Importing papers: query='{args.query}', field={args.field}, limit={args.limit}")

        while total_imported < args.limit and cursor:
            batch_size = min(args.batch_size, args.limit - total_imported)
            try:
                print(f"Fetching batch: cursor={cursor[:16]}..., size={batch_size}...")
                works, next_cursor = search_papers_cursor(
                    args.query,
                    None if args.field == "all" else args.field,
                    batch_size,
                    cursor=cursor,
                )
                consecutive_errors = 0
                if not works:
                    print("No more results")
                    break

                for work in works:
                    if total_imported >= args.limit:
                        break
                    paper = paper_to_dict(work)
                    if paper["doi"] and insert_paper(conn, paper) is not None:
                        total_imported += 1

                conn.commit()
                print(f"Imported: {total_imported}/{args.limit}")
                cursor = next_cursor
                time.sleep(0.12)
            except requests.exceptions.RequestException as exc:
                consecutive_errors += 1
                print(
                    f"Error ({consecutive_errors}/{max_consecutive_errors}): {exc}",
                    file=sys.stderr,
                )
                if consecutive_errors >= max_consecutive_errors:
                    print(
                        "Aborting OpenAlex import after repeated network/API errors.",
                        file=sys.stderr,
                    )
                    raise SystemExit(1) from exc
                time.sleep(5)
    finally:
        conn.close()

    print(f"Done! Total imported: {total_imported}")


if __name__ == "__main__":
    main()
