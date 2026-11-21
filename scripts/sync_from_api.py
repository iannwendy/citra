#!/usr/bin/env python3
"""Inspect, export, or maintain synced API papers in the local paper database.

Usage:
    python scripts/sync_from_api.py --stats [--db-path ./data/local_papers.db]
    python scripts/sync_from_api.py --export-bibtex ./papers.bib [--export-limit 1000]

Or use as a module:
    from scripts.sync_from_api import sync_paper_to_db
    sync_paper_to_db(db, source_candidate)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.database import LocalDatabase, Paper  # noqa: E402


def sync_paper_to_db(
    db: LocalDatabase,
    source_candidate: Any,
    source: str = "api",
) -> bool:
    """Sync a paper from API result to local database.

    Args:
        db: LocalDatabase instance
        source_candidate: SourceCandidate from retrieval
        source: Source of the data ('crossref', 'openalex', 'dblp', 'arxiv')

    Returns:
        True if paper was added, False if already exists or failed
    """
    ext_ids = dict(getattr(source_candidate, "external_ids", None) or {})
    arxiv_id = getattr(source_candidate, "arxiv_id", None) or ext_ids.get("arxiv")

    if source_candidate.doi:
        existing = db.find_by_doi(source_candidate.doi)
        if existing:
            return False

    if arxiv_id:
        existing = db.find_by_arxiv_id(arxiv_id)
        if existing:
            return False

    raw_year = str(source_candidate.year or "").strip()
    year_match = re.search(r"\d{4}", raw_year)
    parsed_year = int(year_match.group(0)) if year_match else None

    paper = Paper(
        doi=source_candidate.doi,
        arxiv_id=arxiv_id,
        title=source_candidate.title or "",
        authors=source_candidate.authors or [],
        year=parsed_year,
        venue=source_candidate.venue,
        abstract=getattr(source_candidate, "abstract", None),
        categories=[],
        external_ids=ext_ids,
        source=source,
    )

    paper_id = db.add_paper(paper)
    return paper_id is not None


def _alpha_suffix(index: int) -> str:
    """Convert 1-based collision index into bijective base-26 suffix (1->a, 26->z, 27->aa)."""
    chars: list[str] = []
    n = index
    while n > 0:
        n, rem = divmod(n - 1, 26)
        chars.append(chr(ord("a") + rem))
    return "".join(reversed(chars))


def _disambiguate_key(base_key: str, seen_counts: dict[str, int], used_keys: set[str]) -> str:
    """Return a unique BibTeX citation key by appending a..z, aa..zz suffixes on collisions."""
    count = seen_counts.get(base_key, 0)
    while True:
        candidate = base_key if count == 0 else f"{base_key}{_alpha_suffix(count)}"
        count += 1
        if candidate not in used_keys:
            seen_counts[base_key] = count
            used_keys.add(candidate)
            return candidate


def export_to_bibtex(db: LocalDatabase, output_path: Path, limit: int = 1000) -> int:
    """Export papers from database to BibTeX format with unique citation keys."""
    papers = db.get_all_papers(limit=limit)

    lines: list[str] = []
    seen_keys: dict[str, int] = {}
    used_keys: set[str] = set()
    for paper in papers:
        author_tokens = (
            paper.authors[0].split() if paper.authors and paper.authors[0].strip() else []
        )
        raw_surname = author_tokens[-1] if author_tokens else "Unknown"
        clean_surname = re.sub(r"[^A-Za-z0-9]", "", raw_surname) or "Unknown"
        year = paper.year or "nd"
        key = _disambiguate_key(f"{clean_surname}{year}", seen_keys, used_keys)

        lines.append(f"@article{{{key},")
        lines.append(f"  title = {{{paper.title}}},")

        if paper.authors:
            authors_str = " and ".join(paper.authors)
            lines.append(f"  author = {{{authors_str}}},")

        if paper.year:
            lines.append(f"  year = {{{paper.year}}},")

        if paper.venue:
            lines.append(f"  journal = {{{paper.venue}}},")

        if paper.doi:
            lines.append(f"  doi = {{{paper.doi}}},")

        if paper.arxiv_id:
            lines.append(f"  eprint = {{{paper.arxiv_id}}},")

        lines.append("}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Exported {len(papers)} papers to {output_path}")
    return len(papers)


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect or export synced local database papers")
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path("./data/local_papers.db"),
        help="Path to local database",
    )
    action_group = parser.add_mutually_exclusive_group(required=True)
    action_group.add_argument(
        "--stats",
        action="store_true",
        help="Show database statistics",
    )
    action_group.add_argument(
        "--export-bibtex",
        type=Path,
        metavar="OUTPUT",
        help="Export to BibTeX file",
    )
    action_group.add_argument(
        "--delete-all",
        action="store_true",
        help="Delete all papers (for testing)",
    )
    parser.add_argument(
        "--export-limit",
        type=int,
        default=1000,
        help="Maximum papers to export",
    )

    args = parser.parse_args()
    db = LocalDatabase(args.db_path)

    if args.stats:
        stats = db.get_stats()
        print("Database Statistics:")
        print(f"  Total papers: {stats['total_papers']}")
        print(f"  Total queries: {stats['total_queries']}")
        print(f"  Hit rate: {stats['hit_rate_percent']:.1f}%")
        print("\nPapers by source:")
        for src_name, count in stats["source_counts"].items():
            print(f"    {src_name}: {count}")
    elif args.export_bibtex:
        export_to_bibtex(db, args.export_bibtex, args.export_limit)
    elif args.delete_all:
        count = db.delete_all()
        print(f"Deleted {count} papers")


if __name__ == "__main__":
    main()
