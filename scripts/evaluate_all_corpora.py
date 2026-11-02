#!/usr/bin/env python3
"""
Comprehensive evaluation runner across:
1. 12 Hard-Case Synthetic Corpora (60 PDFs: 5 per style across 11 academic styles + VN_LEGAL)
2. 11 Real Multi-Style Corpora (220 PDFs: 20 real PDFs per style across 11 styles)
3. Real Vietnamese Legal Corpus (30 PDFs in `vn_legal_reports/`)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.extraction.section_segmenter import SectionType
from integrity_checker.extraction.style_detector import StyleDetector
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.duplicate_detector import DuplicateDetector
from integrity_checker.linking.statuses import CitationMappingStatus

STYLES = [
    "APA",
    "IEEE",
    "Vancouver",
    "Chicago",
    "Harvard",
    "MLA",
    "ACM",
    "Nature",
    "CSE",
    "ACS",
    "AMA",
]


def evaluate_hard_cases(dp: DocumentParser, linker: CitationLinker, dup_det: DuplicateDetector) -> dict:
    gt_paths = [
        Path(f"style_corpora/{st}/hard_cases/ground_truth.json") for st in STYLES
    ] + [Path("vn_legal_reports/hard_cases/ground_truth.json")]

    total_docs = 0
    exact_ref_docs = 0
    total_expected_refs = 0
    total_extracted_refs = 0
    linking_pass_docs = 0
    failures: list[str] = []

    print("=" * 110)
    print("PART 1: SYNTHETIC HARD-CASE CORPORA EVALUATION (60 PDFs across 11 Styles + VN_LEGAL)")
    print("=" * 110)

    for gt_path in gt_paths:
        if not gt_path.exists():
            failures.append(f"Missing {gt_path}")
            continue
        data = json.loads(gt_path.read_text(encoding="utf-8"))
        style_name = data["corpus_style"]
        folder = Path(data["directory"])
        doc_entries = data["documents"]

        style_exact_refs = 0
        style_linking_ok = 0

        for d in doc_entries:
            total_docs += 1
            pdf_path = folder / d["filename"]
            # Use regex extraction on synthetic benchmarks (no network/GROBID needed)
            text_doc = dp._load_pdf_text(str(pdf_path))
            parsed = dp._merge(text_doc, None)
            refs = list(parsed.references)
            body_cits = list(parsed.body_citations)
            link_res = linker.link(body_cits, refs)
            dups = dup_det.detect(refs)

            exp_refs = d["expected_reference_count"]
            total_expected_refs += exp_refs
            total_extracted_refs += len(refs)

            ref_ok = len(refs) == exp_refs
            if ref_ok:
                exact_ref_docs += 1
                style_exact_refs += 1
            else:
                failures.append(
                    f"[{style_name}] {d['filename']}: expected {exp_refs} refs, got {len(refs)}"
                )

            # Verify linking expectations
            exp_statuses = set(d.get("expected_mapping_statuses", []))
            matched_cnt = (
                link_res.status_counts.get(CitationMappingStatus.MATCHED, 0)
                or link_res.status_counts.get("matched", 0)
            )
            missing_cnt = (
                link_res.status_counts.get(CitationMappingStatus.MISSING_REFERENCE, 0)
                or link_res.status_counts.get("missing_reference", 0)
            )
            link_ok = True
            if "MISSING_REF" in exp_statuses and missing_cnt == 0:
                link_ok = False
            if "UNCITED_REF" in exp_statuses and len(link_res.unmatched_reference_ids) == 0:
                link_ok = False
            if "DUPLICATE" in exp_statuses and len(dups) == 0:
                link_ok = False
            if exp_statuses == {"MATCHED"} and matched_cnt == 0:
                link_ok = False

            if link_ok:
                linking_pass_docs += 1
                style_linking_ok += 1
            else:
                failures.append(
                    f"[{style_name}] {d['filename']}: linking status check failed "
                    f"(exp={exp_statuses}, counts={link_res.status_counts}, "
                    f"uncited={len(link_res.unmatched_reference_ids)}, dups={len(dups)})"
                )

        print(
            f"  [{style_name:9s}] Docs={len(doc_entries)}/5 | "
            f"ExactRefCount={style_exact_refs}/5 | LinkingScenariosOK={style_linking_ok}/5"
        )

    print("-" * 110)
    print(
        f"HARD-CASE SUMMARY: Docs={total_docs}/60 | ExactRefCount={exact_ref_docs}/{total_docs} "
        f"(Refs={total_extracted_refs}/{total_expected_refs}) | LinkingScenariosOK={linking_pass_docs}/{total_docs}"
    )
    if failures:
        print("Hard-case anomalies:")
        for f in failures[:15]:
            print(f"  - {f}")
    return {
        "total_docs": total_docs,
        "exact_ref_docs": exact_ref_docs,
        "linking_pass_docs": linking_pass_docs,
        "failures": failures,
    }


def evaluate_real_style_corpora(
    dp: DocumentParser,
    linker: CitationLinker,
    style_det: StyleDetector,
    per_style_limit: int = 20,
) -> dict:
    print("\n" + "=" * 110)
    print(f"PART 2: REAL MULTI-STYLE PDF CORPORA EVALUATION (11 Styles x {per_style_limit} PDFs)")
    print("=" * 110)

    summary_by_style: dict[str, dict] = {}
    total_pdfs = 0
    total_with_bib = 0
    total_with_refs = 0
    total_refs = 0
    total_body = 0
    total_matched_body = 0
    total_matched_refs = 0

    for st in STYLES:
        real_dir = Path(f"style_corpora/{st}/real")
        pdfs = sorted(real_dir.glob("*.pdf"))[:per_style_limit]
        st_pdfs = len(pdfs)
        st_bib = 0
        st_with_refs = 0
        st_refs = 0
        st_body = 0
        st_matched_body = 0
        st_matched_refs = 0

        for pdf_path in pdfs:
            total_pdfs += 1
            text_doc = dp._load_pdf_text(str(pdf_path))
            parsed = dp._merge(text_doc, None)
            refs = list(parsed.references)
            body_cits = list(parsed.body_citations)
            linker.link(body_cits, refs)

            has_bib = any(s.section_type == SectionType.BIBLIOGRAPHY for s in parsed.sections)
            if has_bib:
                st_bib += 1
                total_with_bib += 1
            if refs:
                st_with_refs += 1
                total_with_refs += 1

            m_body = sum(1 for c in body_cits if c.mapping_status == CitationMappingStatus.MATCHED.value)
            m_refs = sum(1 for r in refs if r.mapping_status == CitationMappingStatus.MATCHED.value)

            st_refs += len(refs)
            st_body += len(body_cits)
            st_matched_body += m_body
            st_matched_refs += m_refs

            total_refs += len(refs)
            total_body += len(body_cits)
            total_matched_body += m_body
            total_matched_refs += m_refs

        body_rate = (100.0 * st_matched_body / st_body) if st_body else 0.0
        ref_rate = (100.0 * st_matched_refs / st_refs) if st_refs else 0.0
        print(
            f"  [{st:9s}] PDFs={st_pdfs:2d} | BibSec={st_bib:2d}/{st_pdfs:2d} | "
            f"DocsWithRefs={st_with_refs:2d}/{st_pdfs:2d} | Refs={st_refs:4d} (Matched={st_matched_refs:4d}, {ref_rate:5.1f}%) | "
            f"Body={st_body:4d} (Matched={st_matched_body:4d}, {body_rate:5.1f}%)"
        )
        summary_by_style[st] = {
            "pdfs": st_pdfs,
            "bib_sec": st_bib,
            "docs_with_refs": st_with_refs,
            "refs": st_refs,
            "matched_refs": st_matched_refs,
            "body": st_body,
            "matched_body": st_matched_body,
        }

    overall_body_rate = (100.0 * total_matched_body / total_body) if total_body else 0.0
    overall_ref_rate = (100.0 * total_matched_refs / total_refs) if total_refs else 0.0
    print("-" * 110)
    print(
        f"REAL MULTI-STYLE SUMMARY ({total_pdfs} PDFs): BibSec={total_with_bib}/{total_pdfs} | "
        f"DocsWithRefs={total_with_refs}/{total_pdfs} | TotalRefs={total_refs} (Matched={total_matched_refs}, {overall_ref_rate:.1f}%) | "
        f"TotalBody={total_body} (Matched={total_matched_body}, {overall_body_rate:.1f}%)"
    )
    return summary_by_style


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20, help="Max real PDFs per style")
    args = ap.parse_args()

    dp = DocumentParser()
    linker = CitationLinker()
    dup_det = DuplicateDetector()
    style_det = StyleDetector()

    evaluate_hard_cases(dp, linker, dup_det)
    evaluate_real_style_corpora(dp, linker, style_det, per_style_limit=args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
