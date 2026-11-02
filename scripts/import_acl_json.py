#!/usr/bin/env python3
"""Import papers from ACL Anthology JSON data.

Uses the JSON export from ACL Anthology repository.
This is faster than parsing BibTeX and preserves more metadata.

Usage:
    python scripts/import_acl_json.py [--data-dir ./data/acl_data]
"""

import argparse
import json
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from integrity_checker.database import LocalDatabase, Paper


def import_acl_from_json(
    data_dir: Path,
    db: LocalDatabase,
    limit: int | None = None,
    batch_size: int = 1000,
) -> int:
    """Import papers from ACL Anthology JSON data.

    Args:
        data_dir: Path to acl-anthology data directory
        db: LocalDatabase instance
        limit: Optional limit on papers to import
        batch_size: Number of papers to process per batch

    Returns:
        Number of papers imported
    """
    import re

    json_dir = data_dir / "data" / "json"
    if not json_dir.exists():
        print(f"JSON directory not found: {json_dir}")
        print("Please clone ACL Anthology repo: git clone https://github.com/acl-org/acl-anthology.git")
        return 0

    # Find all volume JSON files
    volume_files = list(json_dir.glob("**/volumes.json"))
    if not volume_files:
        print(f"No volume files found in {json_dir}")
        return 0

    print(f"Found {len(volume_files)} volume files")
    print("Processing papers...")

    total_imported = 0
    batch = []
    processed = 0

    for vol_file in volume_files:
        try:
            with open(vol_file, encoding='utf-8') as f:
                data = json.load(f)

            # Process each volume
            for volume_id, volume_data in data.get('volumes', {}).items():
                for paper_data in volume_data.get('papers', []):
                    paper = _parse_paper(paper_data, volume_data)
                    if paper:
                        batch.append(paper)
                        processed += 1

                        # Process batch
                        if len(batch) >= batch_size:
                            total_imported += _save_batch(db, batch)
                            batch = []

                            if processed % 5000 == 0:
                                print(f"  Processed: {processed}, Imported: {total_imported}")

                            if limit and processed >= limit:
                                break

                    if limit and processed >= limit:
                        break

                if limit and processed >= limit:
                    break

        except Exception as e:
            print(f"Error processing {vol_file}: {e}")
            continue

        if limit and processed >= limit:
            break

    # Process remaining batch
    if batch:
        total_imported += _save_batch(db, batch)

    return total_imported


def _parse_paper(paper_data: dict, volume_data: dict) -> Paper | None:
    """Parse a paper from ACL Anthology JSON format."""
    import re

    # Extract title
    title = paper_data.get('title', '')
    if not title:
        return None

    # Extract DOI
    doi = paper_data.get('doi')
    if doi and not doi.strip():
        doi = None

    # Extract arXiv ID
    arxiv_id = paper_data.get('arxiv_id')

    # Extract authors
    authors = []
    for author_data in paper_data.get('authors', []):
        if isinstance(author_data, dict):
            # Full name format
            full_name = author_data.get('full_name', '')
            if full_name:
                authors.append(full_name)
        elif isinstance(author_data, str):
            authors.append(author_data)

    # Extract year
    year = volume_data.get('year')
    if year:
        try:
            year = int(year)
        except (ValueError, TypeError):
            year = None

    # Extract venue
    volume_id = volume_data.get('id', '')
    collection_id = volume_id.split('.')[0] if '.' in volume_id else volume_id
    venue = _map_venue(collection_id)

    # Extract abstract
    abstract = paper_data.get('abstract')

    # Create paper
    return Paper(
        doi=doi,
        arxiv_id=arxiv_id,
        title=title.strip(),
        authors=authors,
        year=year,
        venue=venue,
        abstract=abstract,
        categories=['cs.CL', 'cs.AI', 'cs.LG'],  # ACL is NLP/AI/ML
        source='acl',
    )


def _map_venue(collection_id: str) -> str:
    """Map ACL collection ID to venue name."""
    venue_map = {
        'P': 'ACL',  # Annual ACL Conference
        'E': 'EMNLP',  # Empirical Methods in NLP
        'N': 'NAACL',  # NAACL
        'C': 'COLING',  # COLING
        'T': 'TACL',  # Transactions of the ACL
        'W': 'Workshop',
        'J': 'JCL',  # Journal of Computational Linguistics
        'K': 'COLING',  # KeY-Evidence
        'Q': 'ACL',  # short papers
        'M': 'MRL',  # Machine Reading
        'S': 'WASSA',  # Workshop
        'V': 'VAR',  # VAR
        'U': 'TACL',  # TACL
        'Y': 'ACL',  # findings
        'X': 'BlackboxNLP',
        'Z': 'NLS',  # Semantics
        'L': 'Lchange',
        'R': 'REPL4NLP',
        'I': 'Intex',
        'A': 'META',  # Metaphor
        'O': 'COST',
        'F': 'NUSE',
        'G': 'NLR',  # Lexical Resources
        'B': 'BIONLP',  # BioNLP
        'H': 'SocialNLP',
        'D': 'DUSC',
        'p': 'PeerDSL',
        'H': 'HLAI',
        'S': 'WS',  # Workshop on...
    }
    return venue_map.get(collection_id, collection_id)


def _save_batch(db: LocalDatabase, papers: list[Paper]) -> int:
    """Save a batch of papers to database."""
    # Check for existing DOIs
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
        description="Import papers from ACL Anthology JSON data"
    )
    parser.add_argument(
        '--data-dir',
        type=Path,
        default=Path('./data/acl_data'),
        help='Path to ACL Anthology data directory'
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
        '--batch-size',
        type=int,
        default=1000,
        help='Batch size for import'
    )

    args = parser.parse_args()

    # Check data directory
    if not args.data_dir.exists():
        print(f"ACL Anthology data not found at {args.data_dir}")
        print("Please clone the repository:")
        print("  git clone https://github.com/acl-org/acl-anthology.git")
        sys.exit(1)

    # Initialize database
    db = LocalDatabase(args.db_path)
    print(f"Database: {db.db_path}")

    # Check existing count
    stats = db.get_stats()
    existing = stats['source_counts'].get('acl', 0)
    print(f"Existing ACL papers: {existing}")

    # Import
    print(f"\nImporting from {args.data_dir}...")
    imported = import_acl_from_json(args.data_dir, db, args.limit, args.batch_size)

    print(f"\nImported {imported} new papers")

    # Show stats
    stats = db.get_stats()
    print("\nDatabase stats:")
    print(f"  Total papers: {stats['total_papers']}")
    print(f"  ACL papers: {stats['source_counts'].get('acl', 0)}")


if __name__ == '__main__':
    main()
