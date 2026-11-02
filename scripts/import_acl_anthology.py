#!/usr/bin/env python3
"""Import papers from ACL Anthology into local database.

ACL Anthology contains high-quality NLP papers from:
- ACL, EMNLP, NAACL, COLING, etc.

Usage:
    python scripts/import_acl_anthology.py [--db-path ./data/local_papers.db]
"""

import argparse
import re
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from integrity_checker.database import LocalDatabase, Paper


def parse_bibtex(bibtex_text: str) -> list[Paper]:
    """Parse BibTeX entries into Paper objects.

    Args:
        bibtex_text: Raw BibTeX content

    Returns:
        List of Paper objects
    """
    papers = []

    # Pattern to match BibTeX entries
    entry_pattern = re.compile(
        r'@(\w+)\s*\{([^,]+),\s*([\s\S]*?)(?=\n@|\Z)',
        re.MULTILINE
    )

    # Field pattern
    field_pattern = re.compile(r'(\w+)\s*=\s*[{"]([^}"]*)[}"]', re.MULTILINE)

    for match in entry_pattern.finditer(bibtex_text):
        entry_type = match.group(1).lower()
        entry_id = match.group(2).strip()
        fields_text = match.group(3)

        # Skip non-paper entries
        if entry_type not in ['article', 'inproceedings', 'proceedings', 'book', 'incollection']:
            continue

        # Parse fields
        fields = {}
        for field_match in field_pattern.finditer(fields_text):
            key = field_match.group(1).lower()
            value = field_match.group(2).strip()
            fields[key] = value

        # Skip if no title
        if 'title' not in fields or not fields['title']:
            continue

        # Extract authors
        authors = []
        if 'author' in fields:
            # BibTeX authors are separated by "and"
            author_list = re.split(r'\s+and\s+', fields['author'])
            for author in author_list:
                author = author.strip()
                if author:
                    # Clean up author name
                    author = re.sub(r'[{}]', '', author)
                    authors.append(author)

        # Extract year
        year = None
        if 'year' in fields:
            year_match = re.search(r'(\d{4})', fields['year'])
            if year_match:
                year = int(year_match.group(1))

        # Extract DOI
        doi = fields.get('doi', '').strip() or None

        # Extract arXiv ID
        arxiv_id = None
        if 'eprint' in fields:
            arxiv_id = fields['eprint']
        elif 'arxivid' in fields:
            arxiv_id = fields['arxivid']

        # Extract venue
        venue = fields.get('booktitle', '') or fields.get('journal', '') or None
        if venue:
            venue = venue.strip()

        # Create Paper object
        paper = Paper(
            doi=doi,
            arxiv_id=arxiv_id,
            title=fields.get('title', '').strip(),
            authors=authors,
            year=year,
            venue=venue,
            abstract=None,  # BibTeX doesn't typically include abstracts
            categories=['cs.CL', 'cs.AI'],  # ACL is NLP/AI
            source='acl',
        )
        papers.append(paper)

    return papers


def download_acl_anthology(output_path: Path) -> Path:
    """Download ACL Anthology BibTeX file.

    Args:
        output_path: Path to save the downloaded file

    Returns:
        Path to downloaded file
    """
    import urllib.request

    url = "https://aclanthology.org/anthology.bib"
    # The full anthology is ~70 MB.  Stream it in chunks and validate the
    # result, because an interrupted download silently produced a truncated
    # file in the past (the last entry was missing its closing brace).
    timeout = 300
    chunk_size = 1 << 20

    print(f"Downloading ACL Anthology from {url}...")
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        with urllib.request.urlopen(url, timeout=timeout) as response:
            with open(output_path, 'wb') as f:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    total += len(chunk)

        if total == 0:
            raise OSError("downloaded 0 bytes")

        # Sanity check: a complete BibTeX file must end with a closing brace.
        with open(output_path, 'rb') as f:
            f.seek(max(0, total - 64))
            tail = f.read().decode('utf-8', errors='replace')
        if not tail.rstrip().endswith('}'):
            raise OSError(
                "downloaded file looks truncated (does not end with '}'); "
                "refusing to keep a partial anthology"
            )

        print(f"Downloaded {total} bytes to {output_path}")
        return output_path
    except Exception as e:
        print(f"Error downloading: {e}")
        # Never leave a partial file behind in place of a good one.
        if output_path.exists():
            output_path.unlink()
        raise


def main():
    parser = argparse.ArgumentParser(
        description="Import papers from ACL Anthology into local database"
    )
    parser.add_argument(
        '--db-path',
        type=Path,
        default=Path('./data/local_papers.db'),
        help='Path to local database'
    )
    parser.add_argument(
        '--bibtex-path',
        type=Path,
        default=None,
        help='Path to existing BibTeX file (skip download)'
    )
    parser.add_argument(
        '--download',
        action='store_true',
        help='Download latest ACL Anthology'
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Limit number of papers to import (for testing)'
    )

    args = parser.parse_args()

    # Initialize database
    db = LocalDatabase(args.db_path)

    # Get or download BibTeX
    if args.bibtex_path and args.bibtex_path.exists():
        bibtex_path = args.bibtex_path
        print(f"Using existing BibTeX file: {bibtex_path}")
    elif args.download:
        bibtex_path = Path('./data/acl_anthology.bib')
        download_acl_anthology(bibtex_path)
    else:
        bibtex_path = Path('./data/acl_anthology.bib')
        if not bibtex_path.exists():
            bibtex_path = Path('./data/acl_anthology.bib')
            download_acl_anthology(bibtex_path)
        print(f"Using existing file: {bibtex_path}")

    # Read and parse BibTeX
    print("Parsing BibTeX...")
    with open(bibtex_path, encoding='utf-8') as f:
        bibtex_content = f.read()

    papers = parse_bibtex(bibtex_content)

    if args.limit:
        papers = papers[:args.limit]

    print(f"Found {len(papers)} papers in BibTeX")

    # Import to database
    print("Importing to database...")
    count = db.add_papers_bulk(papers)
    print(f"Imported {count} papers")

    # Show stats
    stats = db.get_stats()
    print("\nDatabase stats:")
    print(f"  Total papers: {stats['total_papers']}")
    print(f"  ACL papers: {stats['source_counts'].get('acl', 0)}")


if __name__ == '__main__':
    main()
