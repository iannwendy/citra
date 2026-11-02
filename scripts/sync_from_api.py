#!/usr/bin/env python3
"""Sync new papers from API queries into local database.

This script can be run periodically to add papers that were queried
via external APIs but not yet in the local database.

Usage:
    python scripts/sync_from_api.py [--db-path ./data/local_papers.db]

Or use as a module:
    from scripts.sync_from_api import sync_paper_to_db
    sync_paper_to_db(db, source_candidate)
"""

import argparse
import sys
from pathlib import Path
from typing import Any

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from integrity_checker.database import LocalDatabase, Paper


def sync_paper_to_db(
    db: LocalDatabase,
    source_candidate: Any,
    source: str = "api"
) -> bool:
    """Sync a paper from API result to local database.

    Args:
        db: LocalDatabase instance
        source_candidate: SourceCandidate from retrieval
        source: Source of the data ('crossref', 'openalex', 'semantic_scholar', 'arxiv')

    Returns:
        True if paper was added, False if already exists or failed
    """
    # Check if already exists
    if source_candidate.doi:
        existing = db.find_by_doi(source_candidate.doi)
        if existing:
            return False  # Already exists

    if source_candidate.arxiv_id:
        existing = db.find_by_arxiv_id(source_candidate.arxiv_id)
        if existing:
            return False  # Already exists

    # Create paper
    paper = Paper(
        doi=source_candidate.doi,
        arxiv_id=source_candidate.arxiv_id if hasattr(source_candidate, 'arxiv_id') else None,
        title=source_candidate.title or "",
        authors=source_candidate.authors or [],
        year=int(source_candidate.year) if source_candidate.year else None,
        venue=source_candidate.venue,
        abstract=None,  # External APIs may not provide abstract
        categories=[],
        external_ids=source_candidate.external_ids or {},
        source=source,
    )

    # Add to database
    paper_id = db.add_paper(paper)
    return paper_id is not None


def sync_from_query_log(db: LocalDatabase, source: str = "api") -> int:
    """Sync papers from recent query logs that weren't found.

    This looks at query_log entries where found=0 and tries to
    resolve them via the API.

    Args:
        db: LocalDatabase instance
        source: Default source for synced papers

    Returns:
        Number of papers synced
    """
    print("Syncing from query log is not yet implemented.")
    print("This requires API access.")
    return 0


def export_to_bibtex(db: LocalDatabase, output_path: Path, limit: int = 1000) -> int:
    """Export papers from database to BibTeX format.

    Args:
        db: LocalDatabase instance
        output_path: Path to output BibTeX file
        limit: Maximum papers to export

    Returns:
        Number of papers exported
    """
    papers = db.get_all_papers(limit=limit)

    lines = []
    for i, paper in enumerate(papers):
        # Generate citation key
        first_author = paper.authors[0].split()[-1] if paper.authors else "Unknown"
        year = paper.year or "nd"
        key = f"{first_author}{year}"

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

    # Write to file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines))

    print(f"Exported {len(papers)} papers to {output_path}")
    return len(papers)


def main():
    parser = argparse.ArgumentParser(
        description="Sync papers from API to local database"
    )
    parser.add_argument(
        '--db-path',
        type=Path,
        default=Path('./data/local_papers.db'),
        help='Path to local database'
    )
    parser.add_argument(
        '--stats',
        action='store_true',
        help='Show database statistics'
    )
    parser.add_argument(
        '--export-bibtex',
        type=Path,
        metavar='OUTPUT',
        help='Export to BibTeX file'
    )
    parser.add_argument(
        '--export-limit',
        type=int,
        default=1000,
        help='Maximum papers to export'
    )
    parser.add_argument(
        '--delete-all',
        action='store_true',
        help='Delete all papers (for testing)'
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
        for source, count in stats['source_counts'].items():
            print(f"    {source}: {count}")

    if args.export_bibtex:
        export_to_bibtex(db, args.export_bibtex, args.export_limit)

    if args.delete_all:
        count = db.delete_all()
        print(f"Deleted {count} papers")


if __name__ == '__main__':
    main()
