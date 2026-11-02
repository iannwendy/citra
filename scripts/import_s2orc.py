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

import argparse
import gzip
import json
import sys
from pathlib import Path
from typing import Any

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from integrity_checker.database import LocalDatabase, Paper

# arXiv categories to include
ARXIV_CS_CATEGORIES = {
    'cs.CL', 'cs.LG', 'cs.AI', 'cs.CV', 'cs.NE',
    'cs.CR', 'cs.IR', 'cs.IT', 'cs.RO'
}


def parse_s2orc_line(line: str) -> dict[str, Any] | None:
    """Parse a single line from S2ORC JSONL.

    Args:
        line: JSON line from S2ORC

    Returns:
        Parsed paper dict or None if invalid
    """
    try:
        data = json.loads(line.strip())
        return data
    except json.JSONDecodeError:
        return None


def s2orc_to_paper(s2orc_data: dict[str, Any]) -> Paper | None:
    """Convert S2ORC paper to our Paper model.

    Args:
        s2orc_data: S2ORC paper data

    Returns:
        Paper object or None if invalid
    """
    # Check required fields
    title = s2orc_data.get('title')
    if not title:
        return None

    # Extract DOI
    doi = None
    doi_field = s2orc_data.get('doi')
    if doi_field:
        doi = doi_field.strip()
        if not doi:
            doi = None

    # Extract arXiv ID
    arxiv_id = None
    for external_id in s2orc_data.get('external_ids', []):
        if external_id.get('source') == 'arXiv':
            arxiv_id = external_id.get('id')
            break

    # Extract authors
    authors = []
    for author in s2orc_data.get('authors', []):
        name = author.get('name', '')
        if name:
            authors.append(name)

    # Extract year
    year = s2orc_data.get('year')
    if year:
        try:
            year = int(year)
        except (ValueError, TypeError):
            year = None

    # Extract abstract
    abstract = s2orc_data.get('abstract')
    if not abstract:
        abstract = None

    # Extract venue
    venue = s2orc_data.get('venue')
    if venue and not venue.strip():
        venue = None

    # Extract categories
    categories = []
    for category in s2orc_data.get('arxiv_categories', []):
        if category in ARXIV_CS_CATEGORIES:
            categories.append(category)

    # If no CS category, skip unless explicitly requested
    if not categories:
        # Check if any arxiv category exists
        any_category = s2orc_data.get('arxiv_categories', [])
        if any_category:
            categories = any_category[:3]  # Take first 3

    # Extract external IDs
    external_ids = {}
    for ext_id in s2orc_data.get('external_ids', []):
        source = ext_id.get('source', '').lower()
        ext_id_val = ext_id.get('id', '')
        if source and ext_id_val:
            external_ids[source] = ext_id_val

    # Check S2ORC ID
    s2orc_id = s2orc_data.get('paper_id')

    return Paper(
        doi=doi,
        arxiv_id=arxiv_id,
        title=title.strip(),
        authors=authors,
        year=year,
        venue=venue,
        abstract=abstract,
        categories=categories,
        external_ids=external_ids,
        source='s2orc',
    )


def process_s2orc_file(
    file_path: Path,
    db: LocalDatabase,
    limit: int | None = None,
    skip_existing: bool = True,
    batch_size: int = 1000,
) -> tuple[int, int]:
    """Process a S2ORC JSONL file and import to database.

    Args:
        file_path: Path to S2ORC JSONL file
        db: LocalDatabase instance
        limit: Maximum papers to import
        skip_existing: Skip papers with existing DOI
        batch_size: Number of papers to process per batch

    Returns:
        (total_processed, total_added)
    """
    total_processed = 0
    total_added = 0
    batch = []

    print(f"Processing {file_path}...")

    # Open file (handle gzipped)
    if file_path.suffix == '.gz':
        opener = gzip.open
    else:
        opener = open

    with opener(file_path, 'rt', encoding='utf-8') as f:
        for line in f:
            paper = s2orc_to_paper(parse_s2orc_line(line))
            if paper:
                batch.append(paper)
                total_processed += 1

                # Process batch
                if len(batch) >= batch_size:
                    added = process_batch(db, batch, skip_existing)
                    total_added += added
                    batch = []

                    # Progress
                    if total_processed % 10000 == 0:
                        print(f"  Processed: {total_processed}, Added: {total_added}")

                    # Check limit
                    if limit and total_processed >= limit:
                        break

            # Check limit
            if limit and total_processed >= limit:
                break

    # Process remaining batch
    if batch:
        added = process_batch(db, batch, skip_existing)
        total_added += added

    return total_processed, total_added


def process_batch(
    db: LocalDatabase,
    papers: list[Paper],
    skip_existing: bool = True,
) -> int:
    """Process a batch of papers.

    Args:
        db: LocalDatabase instance
        papers: List of papers to add
        skip_existing: Skip papers with existing DOI

    Returns:
        Number of papers actually added
    """
    if not skip_existing:
        return db.add_papers_bulk(papers)

    # Filter out existing DOIs
    new_papers = []
    for paper in papers:
        if paper.doi:
            existing = db.find_by_doi(paper.doi)
            if existing:
                continue
        new_papers.append(paper)

    if new_papers:
        return db.add_papers_bulk(new_papers)
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Import papers from S2ORC into local database"
    )
    parser.add_argument(
        '--s2orc-path',
        type=Path,
        required=True,
        help='Path to S2ORC JSONL file or directory'
    )
    parser.add_argument(
        '--db-path',
        type=Path,
        default=Path('./data/local_papers.db'),
        help='Path to local database'
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Limit number of papers to import'
    )
    parser.add_argument(
        '--categories',
        nargs='+',
        default=['cs.CL', 'cs.LG', 'cs.AI'],
        help='arXiv categories to import'
    )
    parser.add_argument(
        '--no-skip-existing',
        action='store_true',
        help='Do not skip existing papers'
    )

    args = parser.parse_args()

    # Initialize database
    db = LocalDatabase(args.db_path)
    print(f"Database: {db.db_path}")

    # Get files to process
    path = args.s2orc_path
    if path.is_dir():
        files = list(path.glob('*.jsonl')) + list(path.glob('*.jsonl.gz'))
        print(f"Found {len(files)} files in directory")
    elif path.is_file():
        files = [path]
    else:
        print(f"Path not found: {path}")
        sys.exit(1)

    # Process each file
    total_processed = 0
    total_added = 0

    for file_path in files:
        print(f"\nProcessing: {file_path.name}")
        processed, added = process_s2orc_file(
            file_path,
            db,
            limit=args.limit,
            skip_existing=not args.no_skip_existing,
        )
        total_processed += processed
        total_added += added
        print(f"  File: {processed} processed, {added} added")

        if args.limit and total_processed >= args.limit:
            break

    print(f"\nTotal: {total_processed} processed, {total_added} added")

    # Show stats
    stats = db.get_stats()
    print("\nDatabase stats:")
    print(f"  Total papers: {stats['total_papers']}")
    for source, count in stats['source_counts'].items():
        print(f"  {source}: {count}")


if __name__ == '__main__':
    main()
