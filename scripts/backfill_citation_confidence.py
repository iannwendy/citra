#!/usr/bin/env python
"""Backfill stale ``citations`` columns in ``app.db``.

``ReferenceListParser`` used to leave ``Citation.confidence`` at its 0.0
default, so every APA/IEEE/Vancouver reference parsed from a PDF landed in
``app.db`` with no confidence.  The parser now scores each entry from the
metadata it recovered (see ``_estimate_reference_confidence``), but rows
written before that fix still hold the stale 0.0.

This script performs four idempotent repairs:

1. Re-derive ``confidence`` using the *same* helper the parser now uses.
2. Recover identifiers the old regexes missed: arXiv IDs (``arXiv:1911.09339``
   / ``arxiv.org/abs/...``) become ``10.48550/arXiv.<id>`` and explicit
   ``doi.org/10.x`` URLs become their DOI.  This directly addresses the low
   citation DOI coverage (245/685) noted in the handoff §3.
3. Fill a missing ``venue`` from the reference ``raw_text`` when the entry
   carries a recognisable journal/proceedings name.
4. Resolve in-text citations such as ``Sennrich et al. (2016)`` against the
   essay's own bibliography and copy the matching reference's metadata
   (authors/title/year/DOI), so the inline row is no longer blank.

Usage:

    python scripts/backfill_citation_confidence.py            # dry-run
    python scripts/backfill_citation_confidence.py --apply    # write
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from sqlalchemy import text  # noqa: E402

from integrity_checker.db.session import get_session  # noqa: E402
from integrity_checker.extraction.reference_parser import (  # noqa: E402
    _estimate_reference_confidence,
)
from integrity_checker.models.citation import Citation  # noqa: E402

# arXiv references appear as "arXiv:1911.09339" or "arxiv.org/abs/1911.09339".
_ARXIV_RE = re.compile(r"arxiv(?:\.org/abs/|[:/\s]+)(\d{4}\.\d{4,5})", re.IGNORECASE)
# Explicit DOI URL, e.g. "https://doi.org/10.18653/v1/N19-1423".
_DOI_URL_RE = re.compile(r"doi\.org/(10\.[^\s,;)\]]+)", re.IGNORECASE)
# Trailing venue before the year/page block of an IEEE/Vancouver reference,
# e.g. `, Advances in Neural Information Processing Systems, vol. 30, pp. ...`.
_VENUE_RE = re.compile(
    r",\s*(?P<venue>[A-Z][^,]{6,80}?)\s*,\s*(?:vol\.|no\.|pp\.|\d{4})",
)


def _authors_from_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return [raw] if raw.strip() else []
    if isinstance(parsed, list):
        return [str(a) for a in parsed]
    return [str(parsed)]


def _recover_doi(blob: str) -> str | None:
    """Extract a DOI from reference text the old regex missed."""
    m = _DOI_URL_RE.search(blob)
    if m:
        return m.group(1).rstrip(".")
    m = _ARXIV_RE.search(blob)
    if m:
        return f"10.48550/arXiv.{m.group(1)}"
    return None


def _recover_venue(blob: str) -> str | None:
    """Extract a venue name embedded between commas in a reference entry."""
    m = _VENUE_RE.search(blob)
    if m:
        venue = m.group("venue").strip().rstrip(",")
        # Reject obvious non-venues (page ranges, bare numbers, URLs).
        if not re.search(r"\d{4}", venue) and "http" not in venue.lower():
            return venue
    return None


_INLINE_YEAR_RE = re.compile(r"\((\d{4})[a-z]?\)|,\s*(\d{4})[a-z]?\s*\)?")


def _inline_surname_and_year(raw: str) -> tuple[str | None, str | None]:
    """Pull the lead surname and year out of an in-text citation.

    Handles ``(WHO, 2023)``, ``Sennrich et al. (2016)`` and ``Yu et al. (2018)``.
    """
    text = (raw or "").strip().strip("()")
    year_m = _INLINE_YEAR_RE.search(raw or "")
    year = (year_m.group(1) or year_m.group(2)) if year_m else None
    head = re.split(r",|\(| et al|\s&\s", text)[0].strip()
    surname = head.split()[-1] if head else None
    return (surname or None), year


def _match_reference(
    surname: str | None,
    year: str | None,
    refs: list[tuple],
) -> tuple | None:
    """Find the reference row whose authors/year agree with an inline citation."""
    if not surname or not year:
        return None
    surname_l = surname.lower()
    for ref in refs:
        # ref = (id, authors_json, year, title, doi, venue)
        ref_authors = _authors_from_json(ref[1])
        if (ref[2] or "") != year:
            continue
        if any(surname_l in str(a).lower() for a in ref_authors):
            return ref
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Write the recomputed confidence values (default: dry-run).",
    )
    args = ap.parse_args()

    session = get_session()
    try:
        rows = session.execute(
            text(
                "SELECT id, title, authors, year, doi, venue, confidence, raw_text "
                "FROM citations ORDER BY id"
            )
        ).all()

        changed = 0
        doi_added = 0
        venue_added = 0
        titles_resolved = 0
        samples: list[tuple[int, float, float]] = []

        # Pre-load reference rows per essay so inline citations can be enriched.
        ref_rows = session.execute(
            text(
                "SELECT id, essay_id, authors, year, title, doi, venue FROM citations "
                "WHERE citation_type = 'reference_list'"
            )
        ).all()
        refs_by_essay: dict[int, list[tuple]] = {}
        for r in ref_rows:
            refs_by_essay.setdefault(r.essay_id, []).append(
                (r.id, r.authors, r.year, r.title, r.doi, r.venue)
            )

        essay_by_citation = {
            row[0]: row[1]
            for row in session.execute(
                text("SELECT id, essay_id FROM citations")
            ).all()
        }

        for cid, title, authors_raw, year, doi, venue, current, raw_text in rows:
            orig_doi = doi
            orig_venue = venue
            blob = " ".join(part for part in (title, venue, raw_text) if part)

            # 4. Resolve an inline citation against the essay bibliography.
            new_title = title
            new_authors = authors_raw
            new_year = year
            resolved_doi = doi
            resolved_venue = venue
            if not title and not doi:
                surname, inline_year = _inline_surname_and_year(raw_text or "")
                ref = _match_reference(
                    surname, inline_year, refs_by_essay.get(essay_by_citation.get(cid, -1), [])
                )
                if ref is not None:
                    new_title, new_authors, new_year = ref[3], ref[1], ref[2]
                    if not resolved_doi and ref[4]:
                        resolved_doi = ref[4]
                    if not resolved_venue and ref[5]:
                        resolved_venue = ref[5]
                    if new_title:
                        titles_resolved += 1

            new_doi = resolved_doi
            if not new_doi:
                recovered = _recover_doi(blob or "")
                if recovered:
                    new_doi = recovered
                    doi_added += 1

            new_venue = resolved_venue
            if not new_venue:
                recovered_venue = _recover_venue(blob or "")
                if recovered_venue:
                    new_venue = recovered_venue
                    venue_added += 1

            citation = Citation(
                raw_text="",
                title=new_title,
                authors=_authors_from_json(new_authors),
                year=str(new_year) if new_year not in (None, "") else None,
                doi=new_doi,
                venue=new_venue,
            )
            new_conf = _estimate_reference_confidence(citation)

            conf_changed = abs(new_conf - float(current or 0.0)) > 1e-9
            if conf_changed and len(samples) < 8:
                samples.append((cid, float(current or 0.0), new_conf))
            row_changed = (
                conf_changed
                or new_doi != orig_doi
                or new_venue != orig_venue
                or new_title != title
                or new_authors != authors_raw
                or new_year != year
            )
            if row_changed:
                changed += 1
            if args.apply and row_changed:
                session.execute(
                    text(
                        "UPDATE citations SET confidence = :c, doi = :d, venue = :v, "
                        "title = :t, authors = :a, year = :y "
                        "WHERE id = :i"
                    ),
                    {
                        "c": new_conf,
                        "d": new_doi,
                        "v": new_venue,
                        "t": new_title,
                        "a": new_authors,
                        "y": new_year,
                        "i": cid,
                    },
                )

        if args.apply:
            session.commit()
    finally:
        session.close()

    mode = "APPLIED" if args.apply else "DRY-RUN"
    print(f"[{mode}] rows scanned={len(rows)} rows_changed={changed}")
    print(
        f"  DOIs recovered={doi_added}  venues recovered={venue_added}  "
        f"inline titles resolved={titles_resolved}"
    )
    for cid, old, new in samples:
        print(f"  citation #{cid}: {old:.2f} -> {new:.2f}")
    if not args.apply and (changed or doi_added or venue_added or titles_resolved):
        print("Re-run with --apply to write these values.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
