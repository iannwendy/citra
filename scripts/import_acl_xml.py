#!/usr/bin/env python3
"""Import papers from ACL Anthology XML data.

Uses the XML export from ACL Anthology repository.
This directly parses the XML files.

Usage:
    python scripts/import_acl_xml.py [--data-dir ./data/acl_data/data/xml]
"""

import argparse
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from integrity_checker.database import LocalDatabase, Paper


def parse_acl_xml(
    xml_dir: Path,
    db: LocalDatabase,
    limit: int | None = None,
    batch_size: int = 500,
) -> int:
    """Parse ACL Anthology XML files and import to database.

    Args:
        xml_dir: Path to XML directory
        db: LocalDatabase instance
        limit: Optional limit on papers to import
        batch_size: Number of papers to process per batch

    Returns:
        Number of papers imported
    """
    xml_files = list(xml_dir.glob("*.xml"))
    print(f"Found {len(xml_files)} XML files")

    total_imported = 0
    batch = []
    processed = 0

    for file_index, xml_file in enumerate(xml_files, start=1):
        try:
            papers = _parse_xml_file(xml_file)
            for paper in papers:
                batch.append(paper)
                processed += 1

                # Process batch
                if len(batch) >= batch_size:
                    imported = _save_batch(db, batch)
                    total_imported += imported
                    batch = []

                    if limit and processed >= limit:
                        break

            # Report on every file boundary (the old check compared a running
            # counter against a modulus, so it almost never printed).
            if file_index % 200 == 0 or file_index == len(xml_files):
                print(
                    f"  Files: {file_index}/{len(xml_files)}, "
                    f"Processed: {processed}, Imported: {total_imported}"
                )

            if limit and processed >= limit:
                break

        except Exception as e:
            print(f"Error processing {xml_file.name}: {e}")
            continue

        if limit and processed >= limit:
            break

    # Process remaining batch
    if batch:
        imported = _save_batch(db, batch)
        total_imported += imported

    return total_imported


def _parse_xml_file(xml_path: Path) -> list[Paper]:
    """Parse a single ACL Anthology XML file."""
    papers = []

    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
    except Exception:
        return papers

    # Get collection/volume metadata
    collection_id = root.get('id', '')

    # ACL files may contain many <volume> elements (e.g. 2019.ws.xml has 103).
    # Iterating over every volume is required: reading only the first one drops
    # ~35% of the corpus.  Files without explicit <volume> wrappers fall back to
    # top-level <paper> elements (or a single synthetic volume).
    volumes = root.findall('.//volume')
    if not volumes:
        volumes = [root]

    for volume in volumes:
        # Extract per-volume meta info.  A volume's own <meta> wins; only fall
        # back to the root-level meta when the volume does not define one.
        meta = volume.find('meta')
        if meta is None and root is not volume:
            meta = root.find('.//meta')

        year = None
        booktitle = None
        venue = None

        if meta is not None:
            year_elem = meta.find('year')
            if year_elem is not None and year_elem.text:
                try:
                    year = int(year_elem.text.strip())
                except (ValueError, AttributeError):
                    pass

            booktitle_elem = meta.find('booktitle')
            if booktitle_elem is not None and booktitle_elem.text:
                booktitle = booktitle_elem.text.strip()

            venue_elem = meta.find('venue')
            if venue_elem is not None and venue_elem.text:
                venue = venue_elem.text.strip()

        # Parse each paper in this volume (never re-scan the whole tree here).
        for paper_elem in volume.findall('paper'):
            paper = _parse_paper(paper_elem, collection_id, year, venue, booktitle)
            if paper:
                papers.append(paper)

    return papers


def _parse_paper(
    paper_elem: ET.Element,
    collection_id: str,
    year: int | None,
    venue: str | None,
    booktitle: str | None,
) -> Paper | None:
    """Parse a single paper element."""
    # Extract title
    title_elem = paper_elem.find('title')
    if title_elem is None:
        return None

    # Get text content (may have mixed content with tags)
    title = ''.join(list(title_elem.itertext())).strip()
    if not title:
        return None

    # Extract authors
    authors = []
    for author_elem in paper_elem.findall('author'):
        # Read <first>/<last> separately.  The previous implementation called
        # itertext() for both fields, which returned the full text of the
        # author element twice, producing names like
        # "WarrenWeaver WarrenWeaver" instead of "Warren Weaver".
        first_elem = author_elem.find('first')
        last_elem = author_elem.find('last')
        first = ''.join(first_elem.itertext()).strip() if first_elem is not None else ''
        last = ''.join(last_elem.itertext()).strip() if last_elem is not None else ''

        if not first and not last:
            # Fallback for <author full_name="X Y"/> style records.
            name = (author_elem.get('full_name') or '').strip()
        else:
            name = f"{first} {last}".strip()

        if name:
            authors.append(name)

    # Extract DOI
    doi_elem = paper_elem.find('doi')
    doi = None
    if doi_elem is not None and doi_elem.text:
        doi = doi_elem.text.strip()
        if not doi:
            doi = None

    # Extract abstract (ACL Anthology embeds it for most recent papers).
    abstract = None
    abstract_elem = paper_elem.find('abstract')
    if abstract_elem is not None:
        abstract = ''.join(list(abstract_elem.itertext())).strip() or None

    # Extract arXiv ID from URL
    arxiv_id = None
    for url_elem in paper_elem.findall('url'):
        if url_elem.text and 'arxiv.org/abs/' in url_elem.text:
            match = re.search(r'arxiv\.org/abs/(\d+\.\d+)', url_elem.text)
            if match:
                arxiv_id = match.group(1)
                break

    # Extract year from paper if available
    paper_year = paper_elem.get('year', '')
    if paper_year:
        try:
            paper_year = int(paper_year)
        except ValueError:
            paper_year = year
    else:
        paper_year = year

    # Determine venue
    if not venue:
        venue = _get_venue_from_id(collection_id)

    return Paper(
        doi=doi,
        arxiv_id=arxiv_id,
        title=title,
        authors=authors,
        year=paper_year,
        venue=venue or booktitle,
        abstract=abstract,
        categories=['cs.CL', 'cs.AI', 'cs.LG'],
        source='acl',
    )


def _get_venue_from_id(collection_id: str) -> str:
    """Map collection ID to venue name."""
    if not collection_id:
        return 'ACL'

    # Extract venue code (e.g., "2024.acl-1" -> "acl")
    venue_map = {
        'acl': 'ACL',
        'emnlp': 'EMNLP',
        'naacl': 'NAACL',
        'coling': 'COLING',
        'tacl': 'TACL',
        'cl': 'CL',
        'eacl': 'EACL',
        'findings': 'Findings of ACL',
        'ws': 'Workshop',
    }

    # Try various formats
    for code, name in venue_map.items():
        if code in collection_id.lower():
            return name

    return collection_id.upper()


def _save_batch(db: LocalDatabase, papers: list[Paper]) -> int:
    """Save a batch of papers to database."""
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
        description="Import papers from ACL Anthology XML data"
    )
    parser.add_argument(
        '--data-dir',
        type=Path,
        default=Path('./data/acl_data/data/xml'),
        help='Path to ACL Anthology XML directory'
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
        default=500,
        help='Batch size for import'
    )

    args = parser.parse_args()

    # Check data directory
    if not args.data_dir.exists():
        print(f"ACL Anthology XML data not found at {args.data_dir}")
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
    imported = parse_acl_xml(args.data_dir, db, args.limit, args.batch_size)

    print(f"\nImported {imported} new papers")

    # Show stats
    stats = db.get_stats()
    print("\nDatabase stats:")
    print(f"  Total papers: {stats['total_papers']}")
    print(f"  ACL papers: {stats['source_counts'].get('acl', 0)}")


if __name__ == '__main__':
    main()
