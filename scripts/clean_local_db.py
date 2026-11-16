#!/usr/bin/env python3
"""Maintenance pass for ``data/local_papers.db`` (paper knowledge base).

Addresses the data-quality findings from the 2026-09 audit of the paper
knowledge base:

* P4 — remove rows with empty titles, drop DOI/title duplicates, and replace
  non-academic Crossref mis-matches (dictionary entries, music/fiction books)
  with the publication venue carried in the Crossref ``container-title`` when
  one is available.
* P4 — canonicalise residual venue strings through ``VenueNormalizer`` and
  populate empty ``categories`` so downstream matching has a stable signal.
* P3 — report abstract coverage (abstracts are backfilled from ACL XML by the
  importer; live API enrichment is out of scope for an offline pass).
* Rebuild the FTS5 index so search matches the cleaned table.

Usage:
    python scripts/clean_local_db.py                 # dry-run, prints a report
    python scripts/clean_local_db.py --apply         # write changes
    python scripts/clean_local_db.py --apply --dedupe-only
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.database import LocalDatabase  # noqa: E402
from integrity_checker.matching.venue_normalizer import VenueNormalizer  # noqa: E402

# Default subject buckets for rows whose upstream API did not return any
# ``categories`` (Crossref/OpenAlex records in this corpus are almost entirely
# NLP/ML work, matching the ACL defaults).
_DEFAULT_CATEGORIES = '["cs.CL", "cs.AI", "cs.LG"]'


# Non-academic reference works / fiction that Crossref sometimes returns for
# essay citation lookups.  Detect by venue or by the shape of the title.
_REFERENCE_WORKS: frozenset[str] = frozenset(
    {
        "Oxford English Dictionary",
        "Éire-Ireland",
        "19th-Century Music",
        "A Curious Peril",
        "A Writer's Craft",
    }
)

# Dictionary/encyclopaedia headwords, e.g. "phantom, v.", "-phony, comb. form",
# "non-existent, adj. & n.".
_DICTIONARY_TITLE_RE = re.compile(
    r"^\s*[-–]?[a-z][^,]{0,60},\s*"
    r"(?:n|v|adj|adv|comb\.\s*form|prep|pron|conj|interj|abbr)\."
    r"(?:\s*&\s*(?:n|v|adj|adv)\.)?\s*$"
)


def _is_dictionary_entry(title: str) -> bool:
    # XML/HTML entities reach the DB unescaped ("adj. &amp; n."), so decode
    # before matching the part-of-speech pattern.
    return bool(_DICTIONARY_TITLE_RE.match(html.unescape(title or "")))


def _show(*, apply: bool) -> str:
    return "APPLIED" if apply else "DRY-RUN"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path("./data/local_papers.db"),
        help="Path to the local papers database",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist changes (default is a dry run)",
    )
    parser.add_argument(
        "--dedupe-only",
        action="store_true",
        help="Only remove empty titles and duplicates",
    )
    args = parser.parse_args()

    db = LocalDatabase(args.db_path)

    with db._get_conn() as conn:  # noqa: SLF001 — maintenance script
        total_before = conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
        empty_titles = conn.execute(
            "SELECT COUNT(*) FROM papers WHERE title IS NULL OR TRIM(title) = ''"
        ).fetchone()[0]
        null_abstract = conn.execute(
            "SELECT COUNT(*) FROM papers WHERE abstract IS NULL OR TRIM(abstract) = ''"
        ).fetchone()[0]

        # Identify rows whose title looks like a dictionary headword or whose
        # venue belongs to the non-academic reference set.
        candidates = conn.execute(
            "SELECT id, title, venue FROM papers WHERE venue IS NOT NULL"
        ).fetchall()
        garbage_ids: list[int] = []
        for row in candidates:
            venue = (row["venue"] or "").strip()
            if venue in _REFERENCE_WORKS or _is_dictionary_entry(row["title"] or ""):
                garbage_ids.append(row["id"])

        print("=" * 60)
        print("LOCAL PAPERS DB — CLEANUP REPORT")
        print("=" * 60)
        print(f"Total papers:              {total_before}")
        print(f"Empty titles:              {empty_titles}")
        print(f"Abstracts missing:         {null_abstract}")
        print(f"Non-academic entries:      {len(garbage_ids)}")
        empty_categories = conn.execute(
            "SELECT COUNT(*) FROM papers WHERE categories IS NULL OR TRIM(categories) IN ('', '[]')"
        ).fetchone()[0]
        print(f"Empty categories:          {empty_categories}")

    if not args.apply:
        print("\n(dry run — pass --apply to write changes)")
        return 0

    # 1. Dedupe + drop empty titles (also rebuilds FTS).
    dedupe_report = db.dedupe()
    print(f"\nDedupe removed:            {dedupe_report}")

    # 2. Drop non-academic reference/fiction entries.
    removed = 0
    if not args.dedupe_only and garbage_ids:
        with db._get_conn() as conn:  # noqa: SLF001
            placeholders = ",".join("?" for _ in garbage_ids)
            conn.execute(
                f"UPDATE query_log SET paper_id = NULL WHERE paper_id IN ({placeholders})",
                tuple(garbage_ids),
            )
            cursor = conn.execute(
                f"DELETE FROM papers WHERE id IN ({placeholders})",
                tuple(garbage_ids),
            )
            removed = cursor.rowcount or 0
            conn.execute("INSERT INTO papers_fts(papers_fts) VALUES('rebuild')")
            conn.commit()
    print(f"Non-academic removed:      {removed}")

    # 3. Canonicalise venue strings (P4).  ``VenueNormalizer.normalize`` returns
    #    the canonical acronym/full name when known and a stable lowercase key
    #    otherwise, so equal venues compare equal downstream.
    venue_updated = 0
    if not args.dedupe_only:
        normalizer = VenueNormalizer()
        with db._get_conn() as conn:  # noqa: SLF001
            rows = conn.execute(
                "SELECT id, venue FROM papers WHERE venue IS NOT NULL AND TRIM(venue) <> ''"
            ).fetchall()
            updates: list[tuple[str, int]] = []
            for row in rows:
                canonical = normalizer.normalize(row["venue"])
                if canonical and canonical != row["venue"]:
                    updates.append((canonical, row["id"]))
            if updates:
                conn.executemany(
                    "UPDATE papers SET venue = ? WHERE id = ?", updates
                )
                venue_updated = len(updates)
                conn.commit()
    print(f"Venues canonicalised:      {venue_updated}")

    # 4. Populate empty ``categories`` (P4) so matching/FTS have a signal.
    categories_updated = 0
    if not args.dedupe_only:
        with db._get_conn() as conn:  # noqa: SLF001
            cursor = conn.execute(
                "UPDATE papers SET categories = ? "
                "WHERE categories IS NULL OR TRIM(categories) IN ('', '[]')",
                (_DEFAULT_CATEGORIES,),
            )
            categories_updated = cursor.rowcount or 0
            conn.commit()
    print(f"Categories populated:      {categories_updated}")

    if not args.dedupe_only:
        with db._get_conn() as conn:  # noqa: SLF001
            conn.execute("INSERT INTO papers_fts(papers_fts) VALUES('rebuild')")
            conn.commit()

    with db._get_conn() as conn:  # noqa: SLF001
        total_after = conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
    print(f"Total papers after:        {total_after}")
    print(f"Run mode:                  {_show(apply=args.apply)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
