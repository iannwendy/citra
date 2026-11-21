#!/usr/bin/env python3
"""Import papers from S2ORC into local database.

S2ORC (Semantic Scholar Open Research Corpus) contains:
- ~8M papers across multiple domains
- Full metadata including DOI, arXiv ID, title, authors, abstract

Filtered categories for CS/AI/ML:
- cs.CL (Computation and Language/NLP)
- cs.LG (Machine Learning)
- cs.AI (Artificial Intelligence)
- cs.CV (Computer Vision)
- cs.NE (Neural and Evolutionary Computing)

Usage:
    python scripts/import_s2orc.py --s2orc-path ./data/s2orc/ [--db-path ./data/local_papers.db]

Note: Download S2ORC from:
    https://github.com/allenai/s2orc
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.database import LocalDatabase, Paper  # noqa: E402

ARXIV_CS_CATEGORIES = {
    "cs.CL",
    "cs.LG",
    "cs.AI",
    "cs.CV",
    "cs.NE",
    "cs.CR",
    "cs.IR",
    "cs.IT",
    "cs.RO",
}


def parse_s2orc_line(line: str) -> dict[str, Any] | None:
    """Parse a single line from S2ORC JSONL."""
    if not line or not line.strip():
        return None
    try:
        data = json.loads(line.strip())
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def s2orc_to_paper(
    s2orc_data: dict[str, Any] | None,
    allowed_categories: set[str] | None = None,
) -> Paper | None:
    """Convert S2ORC paper dict to our Paper model."""
    if not s2orc_data or not isinstance(s2orc_data, dict):
        return None

    title = s2orc_data.get("title")
    if not title or not str(title).strip():
        return None

    raw_categories = s2orc_data.get("arxiv_categories") or []
    target_categories = allowed_categories if allowed_categories is not None else ARXIV_CS_CATEGORIES
    categories = [c for c in raw_categories if c in target_categories]

    if allowed_categories is not None:
        if not categories:
            return None
    elif raw_categories and not categories:
        return None

    doi = None
    doi_field = s2orc_data.get("doi")
    if doi_field:
        doi = str(doi_field).strip() or None

    arxiv_id = None
    for external_id in s2orc_data.get("external_ids") or []:
        if isinstance(external_id, dict) and external_id.get("source") == "arXiv":
            arxiv_id = external_id.get("id")
            break

    authors: list[str] = []
    for author in s2orc_data.get("authors") or []:
        if isinstance(author, dict):
            name = author.get("name", "")
            if name:
                authors.append(str(name))

    year = s2orc_data.get("year")
    if year is not None:
        try:
            year = int(year)
        except (ValueError, TypeError):
            year = None

    abstract = s2orc_data.get("abstract") or None
    venue = s2orc_data.get("venue")
    if venue and not str(venue).strip():
        venue = None

    external_ids: dict[str, str] = {}
    for ext_id in s2orc_data.get("external_ids") or []:
        if isinstance(ext_id, dict):
            source = str(ext_id.get("source", "")).lower()
            ext_id_val = str(ext_id.get("id", ""))
            if source and ext_id_val:
                external_ids[source] = ext_id_val

    s2orc_id = s2orc_data.get("paper_id")
    if s2orc_id:
        external_ids["s2orc"] = str(s2orc_id)

    return Paper(
        doi=doi,
        arxiv_id=arxiv_id,
        title=str(title).strip(),
        authors=authors,
        year=year,
        venue=venue,
        abstract=abstract,
        categories=categories,
        external_ids=external_ids,
        source="s2orc",
    )


def process_s2orc_file(
    file_path: Path,
    db: LocalDatabase,
    limit: int | None = None,
    skip_existing: bool = True,
    batch_size: int = 1000,
    allowed_categories: set[str] | None = None,
) -> tuple[int, int]:
    """Process a S2ORC JSONL file and import to database."""
    if limit is not None and limit <= 0:
        return 0, 0

    total_processed = 0
    total_added = 0
    batch: list[Paper] = []

    print(f"Processing {file_path}...")

    opener = gzip.open if file_path.suffix == ".gz" else open

    with opener(file_path, "rt", encoding="utf-8") as f:
        for line in f:
            parsed = parse_s2orc_line(line)
            if not parsed:
                continue
            paper = s2orc_to_paper(parsed, allowed_categories=allowed_categories)
            if paper:
                batch.append(paper)
                total_processed += 1

                if len(batch) >= batch_size:
                    added = process_batch(db, batch, skip_existing)
                    total_added += added
                    batch = []

                    if total_processed % 10000 == 0:
                        print(f"  Processed: {total_processed}, Added: {total_added}")

                if limit is not None and total_processed >= limit:
                    break

    if batch:
        added = process_batch(db, batch, skip_existing)
        total_added += added

    return total_processed, total_added


def process_batch(
    db: LocalDatabase,
    papers: list[Paper],
    skip_existing: bool = True,
) -> int:
    """Process a batch of papers."""
    if not skip_existing:
        return db.add_papers_bulk(papers)

    new_papers: list[Paper] = []
    for paper in papers:
        if paper.doi and db.find_by_doi(paper.doi):
            continue
        new_papers.append(paper)

    if new_papers:
        return db.add_papers_bulk(new_papers)
    return 0


def import_s2orc_path(
    s2orc_path: Path,
    db: LocalDatabase,
    limit: int | None = None,
    skip_existing: bool = True,
    batch_size: int = 1000,
    allowed_categories: set[str] | None = None,
) -> tuple[int, int]:
    """Import S2ORC papers from a single JSONL(.gz) file or a directory of shards."""
    if limit is not None and limit <= 0:
        return 0, 0

    if s2orc_path.is_dir():
        files = sorted(s2orc_path.glob("*.jsonl")) + sorted(s2orc_path.glob("*.jsonl.gz"))
        print(f"Found {len(files)} files in directory")
    elif s2orc_path.is_file():
        files = [s2orc_path]
    else:
        raise FileNotFoundError(f"Path not found: {s2orc_path}")

    total_processed = 0
    total_added = 0

    for file_path in files:
        remaining = (limit - total_processed) if limit is not None else None
        if remaining is not None and remaining <= 0:
            break

        print(f"\nProcessing: {file_path.name}")
        processed, added = process_s2orc_file(
            file_path,
            db,
            limit=remaining,
            skip_existing=skip_existing,
            batch_size=batch_size,
            allowed_categories=allowed_categories,
        )
        total_processed += processed
        total_added += added
        print(f"  File: {processed} processed, {added} added")

        if limit is not None and total_processed >= limit:
            break

    return total_processed, total_added


def main() -> None:
    parser = argparse.ArgumentParser(description="Import papers from S2ORC into local database")
    parser.add_argument(
        "--s2orc-path",
        type=Path,
        required=True,
        help="Path to S2ORC JSONL file or directory",
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path("./data/local_papers.db"),
        help="Path to local database",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of papers to import",
    )
    parser.add_argument(
        "--categories",
        nargs="+",
        default=["cs.CL", "cs.LG", "cs.AI"],
        help="arXiv categories to import",
    )
    parser.add_argument(
        "--no-skip-existing",
        action="store_true",
        help="Do not skip existing papers",
    )

    args = parser.parse_args()

    db = LocalDatabase(args.db_path)
    print(f"Database: {db.db_path}")

    allowed_cats = set(args.categories) if args.categories else None
    try:
        total_processed, total_added = import_s2orc_path(
            args.s2orc_path,
            db,
            limit=args.limit,
            skip_existing=not args.no_skip_existing,
            allowed_categories=allowed_cats,
        )
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    print(f"\nTotal: {total_processed} processed, {total_added} added")

    stats = db.get_stats()
    print("\nDatabase stats:")
    print(f"  Total papers: {stats['total_papers']}")
    for source, count in stats["source_counts"].items():
        print(f"  {source}: {count}")


if __name__ == "__main__":
    main()
