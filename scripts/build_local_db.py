#!/usr/bin/env python3
"""Build local paper database from ACL Anthology.

This script automates the full database building process:
1. Download ACL Anthology BibTeX
2. Import ACL papers to database
3. (Optional) Import S2ORC papers

Usage:
    # Build with ACL Anthology only (recommended for start)
    python scripts/build_local_db.py --acl-only

    # Build with S2ORC (requires downloaded S2ORC data)
    python scripts/build_local_db.py --s2orc-path ./data/s2orc/

    # Show database statistics
    python scripts/build_local_db.py --stats
"""

import argparse
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from integrity_checker.database import LocalDatabase


def build_acl_database(db_path: Path, limit: int | None = None) -> int:
    """Build database from ACL Anthology.

    Args:
        db_path: Path to database
        limit: Optional limit on papers to import

    Returns:
        Number of papers imported
    """
    # Import here to avoid circular imports
    from scripts.import_acl_anthology import download_acl_anthology, parse_bibtex

    db = LocalDatabase(db_path)

    # Check existing count
    stats = db.get_stats()
    existing = stats['source_counts'].get('acl', 0)
    print(f"Existing ACL papers in DB: {existing}")

    if existing > 1000 and limit is None:
        print(f"Database already has {existing} ACL papers. Skipping import.")
        return 0

    # Download ACL Anthology
    bibtex_path = Path('./data/acl_anthology.bib')
    if not bibtex_path.exists():
        print("Downloading ACL Anthology...")
        download_acl_anthology(bibtex_path)
    else:
        print(f"Using existing file: {bibtex_path}")

    # Parse and import
    print("Parsing BibTeX...")
    with open(bibtex_path, encoding='utf-8') as f:
        bibtex_content = f.read()

    papers = parse_bibtex(bibtex_content)

    if limit:
        papers = papers[:limit]

    print(f"Found {len(papers)} papers in BibTeX")
    print(f"Importing {len(papers)} papers...")

    count = db.add_papers_bulk(papers)
    print(f"Imported {count} ACL papers")

    return count


def build_s2orc_database(db_path: Path, s2orc_path: Path, limit: int | None = None) -> int:
    """Build database from S2ORC.

    Args:
        db_path: Path to database
        s2orc_path: Path to S2ORC JSONL files
        limit: Optional limit on papers to import

    Returns:
        Number of papers imported
    """
    from scripts.import_s2orc import process_s2orc_file

    db = LocalDatabase(db_path)
    total_processed, total_added = process_s2orc_file(
        s2orc_path,
        db,
        limit=limit,
        skip_existing=True,
    )

    return total_added


def show_stats(db_path: Path) -> None:
    """Show database statistics.

    Args:
        db_path: Path to database
    """
    db = LocalDatabase(db_path)
    stats = db.get_stats()

    print("=" * 50)
    print("LOCAL DATABASE STATISTICS")
    print("=" * 50)
    print(f"Total papers: {stats['total_papers']}")
    print(f"Total queries: {stats['total_queries']}")
    print(f"Hit rate: {stats['hit_rate_percent']:.1f}%")
    print()
    print("Papers by source:")
    for source, count in stats['source_counts'].items():
        print(f"  {source}: {count}")
    print()
    print("Recent papers:")
    papers = db.get_all_papers(limit=5)
    for p in papers:
        print(f"  - {p.title[:60]}... ({p.year})")


def main():
    parser = argparse.ArgumentParser(
        description="Build local paper database from ACL Anthology and S2ORC"
    )
    parser.add_argument(
        '--db-path',
        type=Path,
        default=Path('./data/local_papers.db'),
        help='Path to local database'
    )
    parser.add_argument(
        '--acl-only',
        action='store_true',
        help='Build only from ACL Anthology'
    )
    parser.add_argument(
        '--acl-data-dir',
        type=Path,
        default=Path('./data/acl_data/data/xml'),
        help='Path to ACL Anthology XML directory'
    )
    parser.add_argument(
        '--s2orc-path',
        type=Path,
        help='Path to S2ORC JSONL file or directory'
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Limit number of papers to import'
    )
    parser.add_argument(
        '--stats',
        action='store_true',
        help='Show database statistics'
    )
    parser.add_argument(
        '--reset',
        action='store_true',
        help='Delete all existing papers'
    )

    args = parser.parse_args()

    # Handle reset
    if args.reset:
        db = LocalDatabase(args.db_path)
        count = db.delete_all()
        print(f"Deleted {count} papers")
        return

    # Show stats
    if args.stats:
        show_stats(args.db_path)
        return

    # Build database
    total_added = 0

    # Default to ACL import if nothing specified
    do_acl = args.acl_only or (not args.s2orc_path)

    # ACL Anthology
    if do_acl:
        print("Building database from ACL Anthology XML...")
        try:
            from scripts.import_acl_xml import parse_acl_xml
            db = LocalDatabase(args.db_path)

            # Check existing count
            stats = db.get_stats()
            existing = stats['source_counts'].get('acl', 0)
            print(f"Existing ACL papers in DB: {existing}")

            count = parse_acl_xml(args.acl_data_dir, db, limit=args.limit)
            total_added += count
        except Exception as e:
            print(f"Error importing ACL: {e}")
    else:
        print("Skipping ACL Anthology (use --acl-only to include)")

    # S2ORC
    if args.s2orc_path:
        print("\nBuilding database from S2ORC...")
        count = build_s2orc_database(args.db_path, args.s2orc_path, args.limit)
        total_added += count

    # Summary
    print(f"\n{'=' * 50}")
    print("Database build complete!")
    print(f"Total papers added: {total_added}")
    print(f"Database location: {args.db_path}")
    print(f"{'=' * 50}")

    # Show final stats
    show_stats(args.db_path)


if __name__ == '__main__':
    main()
