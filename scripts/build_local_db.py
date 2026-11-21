#!/usr/bin/env python3
"""Build local paper database from ACL Anthology and S2ORC.

This script automates the full database building process:
1. Import ACL Anthology XML (`--acl-data-dir`) or BibTeX (`--acl-bibtex`, auto-downloads if missing)
2. (Optional) Import S2ORC papers (`--s2orc-path`)

Usage:
    # Build from ACL Anthology BibTeX (downloads acl_anthology.bib if missing)
    python scripts/build_local_db.py --acl-bibtex

    # Build from local ACL Anthology XML export
    python scripts/build_local_db.py --acl-only --acl-data-dir ./data/acl_data/data/xml

    # Build with S2ORC (requires downloaded S2ORC data)
    python scripts/build_local_db.py --s2orc-path ./data/s2orc/

    # Show database statistics
    python scripts/build_local_db.py --stats
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.database import LocalDatabase  # noqa: E402


def build_acl_database(
    db_path: Path,
    limit: int | None = None,
    bibtex_path: Path | None = None,
) -> int:
    """Build database from ACL Anthology BibTeX."""
    from scripts.import_acl_anthology import download_acl_anthology, parse_bibtex

    db = LocalDatabase(db_path)

    stats = db.get_stats()
    existing = stats["source_counts"].get("acl", 0)
    print(f"Existing ACL papers in DB: {existing}")

    if existing > 1000 and limit is None:
        print(f"Database already has {existing} ACL papers. Skipping import.")
        return 0

    target_bib = bibtex_path or Path("./data/acl_anthology.bib")
    if not target_bib.exists():
        print("Downloading ACL Anthology...")
        download_acl_anthology(target_bib)
    else:
        print(f"Using existing file: {target_bib}")

    print("Parsing BibTeX...")
    with open(target_bib, encoding="utf-8") as f:
        bibtex_content = f.read()

    papers = parse_bibtex(bibtex_content)
    if limit is not None:
        papers = papers[: max(0, limit)]

    print(f"Found {len(papers)} papers in BibTeX")
    if not papers:
        return 0
    print(f"Importing {len(papers)} papers...")

    count = db.add_papers_bulk(papers)
    print(f"Imported {count} ACL papers")
    return count


def build_s2orc_database(db_path: Path, s2orc_path: Path, limit: int | None = None) -> int:
    """Build database from S2ORC JSONL file or directory."""
    from scripts.import_s2orc import import_s2orc_path

    db = LocalDatabase(db_path)
    _total_processed, total_added = import_s2orc_path(
        s2orc_path,
        db,
        limit=limit,
        skip_existing=True,
    )
    return total_added


def show_stats(db_path: Path) -> None:
    """Show database statistics."""
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
    for source, count in stats["source_counts"].items():
        print(f"  {source}: {count}")
    print()
    print("Recent papers:")
    papers = db.get_all_papers(limit=5)
    for p in papers:
        print(f"  - {p.title[:60]}... ({p.year})")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build local paper database from ACL Anthology and S2ORC"
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path("./data/local_papers.db"),
        help="Path to local database",
    )
    parser.add_argument(
        "--acl-only",
        action="store_true",
        help="Build only from ACL Anthology XML",
    )
    parser.add_argument(
        "--acl-bibtex",
        action="store_true",
        help="Build from ACL Anthology BibTeX (auto-downloads if ./data/acl_anthology.bib is absent)",
    )
    parser.add_argument(
        "--acl-data-dir",
        type=Path,
        default=Path("./data/acl_data/data/xml"),
        help="Path to ACL Anthology XML directory",
    )
    parser.add_argument(
        "--s2orc-path",
        type=Path,
        help="Path to S2ORC JSONL file or directory",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of papers to import",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Show database statistics",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete all existing papers",
    )

    args = parser.parse_args()

    if args.reset:
        db = LocalDatabase(args.db_path)
        count = db.delete_all()
        print(f"Deleted {count} papers")
        return

    if args.stats:
        show_stats(args.db_path)
        return

    total_added = 0
    do_acl = args.acl_only or args.acl_bibtex or (not args.s2orc_path)

    if do_acl:
        if args.acl_bibtex:
            print("Building database from ACL Anthology BibTeX...")
            try:
                count = build_acl_database(args.db_path, limit=args.limit)
                total_added += count
            except Exception as exc:
                print(f"Error importing ACL BibTeX: {exc}", file=sys.stderr)
                sys.exit(1)
        else:
            print("Building database from ACL Anthology XML...")
            if not args.acl_data_dir.exists() or not any(args.acl_data_dir.glob("*.xml")):
                print(
                    f"Error: ACL XML directory not found or empty: {args.acl_data_dir}\n"
                    "Pass --acl-bibtex to auto-download ACL BibTeX, or clone acl-anthology XML into --acl-data-dir.",
                    file=sys.stderr,
                )
                sys.exit(1)
            try:
                from scripts.import_acl_xml import parse_acl_xml

                db = LocalDatabase(args.db_path)
                stats = db.get_stats()
                existing = stats["source_counts"].get("acl", 0)
                print(f"Existing ACL papers in DB: {existing}")

                count = parse_acl_xml(args.acl_data_dir, db, limit=args.limit)
                total_added += count
            except Exception as exc:
                print(f"Error importing ACL XML: {exc}", file=sys.stderr)
                sys.exit(1)
    else:
        print("Skipping ACL Anthology (use --acl-only or --acl-bibtex to include)")

    if args.s2orc_path:
        if not args.s2orc_path.exists():
            print(f"Error: S2ORC path not found: {args.s2orc_path}", file=sys.stderr)
            sys.exit(1)
        print("\nBuilding database from S2ORC...")
        count = build_s2orc_database(args.db_path, args.s2orc_path, args.limit)
        total_added += count

    print(f"\n{'=' * 50}")
    print("Database build complete!")
    print(f"Total papers added: {total_added}")
    print(f"Database location: {args.db_path}")
    print(f"{'=' * 50}")

    show_stats(args.db_path)


if __name__ == "__main__":
    main()
