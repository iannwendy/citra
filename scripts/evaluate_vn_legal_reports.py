#!/usr/bin/env python3
"""
Diagnostic and evaluation runner for Vietnamese Legal PDFs in `vn_legal_reports/`.
Inspects SectionSegmenter, ReferenceListParser (GROBID + Regex + Merged),
CitationExtractor (Academic + Vietnamese Legal in-text citations),
CitationLinker (Bidirectional linking), and NeuroSymbolicChecker (Verdicts & CIS).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import fitz  # PyMuPDF

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.extraction.document_parser import DocumentParser  # noqa: E402
from integrity_checker.extraction.patterns.apa import is_vn_legal_reference  # noqa: E402
from integrity_checker.extraction.section_segmenter import SectionType  # noqa: E402
from integrity_checker.linking.citation_linker import CitationLinker  # noqa: E402
from integrity_checker.linking.statuses import CitationMappingStatus  # noqa: E402
from integrity_checker.logic.rules import _is_non_journal_or_unindexed_source  # noqa: E402


def inspect_pdf_raw_bib(pdf_path: Path) -> str:
    doc = fitz.open(pdf_path)
    try:
        n = len(doc)
        last_txt = "\n---PAGE---\n".join(
            f"[P{i+1}]\n" + doc[i].get_text("text")
            for i in range(max(0, n - 4), n)
        )
        return last_txt
    finally:
        doc.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="vn_legal_reports")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--detail", type=int, default=0, help="Show detailed dump for file ID (1..30)")
    args = ap.parse_args()

    folder = Path(args.dir)
    pdfs = sorted(p for p in folder.glob("*.pdf") if p.is_file())[: args.limit]
    if not pdfs:
        print(f"No PDFs found in {folder}")
        return 1

    dp = DocumentParser()
    linker = CitationLinker()

    total_refs = 0
    total_legal_refs = 0
    total_body = 0
    total_matched_refs = 0
    total_missing_body = 0
    total_uncited_refs = 0
    files_with_bib_sec = 0

    for idx, pdf_path in enumerate(pdfs, start=1):
        if args.detail and idx != args.detail:
            continue

        parsed = dp.parse(str(pdf_path))
        refs = list(parsed.references)
        body_cits = list(parsed.body_citations)
        linker.link(body_cits, refs)

        bib_secs = [s for s in parsed.sections if s.section_type == SectionType.BIBLIOGRAPHY]
        has_bib_sec = len(bib_secs) > 0
        if has_bib_sec:
            files_with_bib_sec += 1

        legal_refs = [
            r for r in refs
            if r.matched_pattern == "vn_legal_document"
            or is_vn_legal_reference(r.raw_text or "")
            or _is_non_journal_or_unindexed_source(r.raw_text, r.url, r.doi, r.authors)[1] == "legal_or_standard"
        ]
        matched_refs = [r for r in refs if r.mapping_status == CitationMappingStatus.MATCHED.value]
        uncited_refs = [r for r in refs if r.mapping_status == CitationMappingStatus.UNCITED_REFERENCE.value]
        missing_body = [c for c in body_cits if c.mapping_status == CitationMappingStatus.MISSING_REFERENCE.value]
        matched_body = [c for c in body_cits if c.mapping_status == CitationMappingStatus.MATCHED.value]

        total_refs += len(refs)
        total_legal_refs += len(legal_refs)
        total_body += len(body_cits)
        total_matched_refs += len(matched_refs)
        total_missing_body += len(missing_body)
        total_uncited_refs += len(uncited_refs)

        sec_str = ", ".join(f"{s.section_type.value}({s.start_page}-{s.end_page})" for s in parsed.sections)
        print(
            f"[{idx:02d}] {pdf_path.name[:50]:50s} | Sec: {sec_str:26s} | "
            f"Refs={len(refs):2d} (Legal={len(legal_refs):2d}) | "
            f"Body={len(body_cits):2d} (Match={len(matched_body):2d}, Miss={len(missing_body):2d}) | "
            f"RefMatch={len(matched_refs):2d}/{len(refs):2d}",
            flush=True,
        )

        if args.detail == idx or len(refs) == 0 or not has_bib_sec:
            print("  --- RAW LAST PAGES BIBLIOGRAPHY PREVIEW ---")
            raw_bib = inspect_pdf_raw_bib(pdf_path)
            for ln in raw_bib.splitlines()[-45:]:
                print("    ", ln)
            print("  --- EXTRACTED REFERENCES ---")
            for r_i, r in enumerate(refs, 1):
                print(
                    f"    [R{r_i:02d}] status={r.mapping_status} "
                    f"pat={r.matched_pattern} yr={r.year} num={r.numeric_index} "
                    f"auth={[str(a) for a in r.authors[:3]]} | title={str(r.title)[:65]} | raw={r.raw_text[:85]}"
                )
            print("  --- EXTRACTED BODY CITATIONS ---")
            for c_i, c in enumerate(body_cits[:35], 1):
                print(
                    f"    [C{c_i:02d}] p={c.page_num} status={c.mapping_status} "
                    f"pat={c.matched_pattern} yr={c.year} num={c.numeric_index} "
                    f"auth={[str(a) for a in c.authors[:2]]} | raw={c.raw_text}"
                )

    if not args.detail:
        print("=" * 110)
        print(
            f"SUMMARY ({len(pdfs)} PDFs): "
            f"BibSection={files_with_bib_sec}/{len(pdfs)} | "
            f"TotalRefs={total_refs} (LegalRefs={total_legal_refs}) | "
            f"TotalBody={total_body} (Matched={total_body - total_missing_body}, MissingRef={total_missing_body}) | "
            f"MatchedRefs={total_matched_refs}/{total_refs} (Uncited={total_uncited_refs})"
        )
        print("=" * 110)
    return 0


if __name__ == "__main__":
    sys.exit(main())
