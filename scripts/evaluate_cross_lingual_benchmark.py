#!/usr/bin/env python3
"""
Cross-Lingual Semantic Alignment (VI <-> EN v2.4) Benchmark & Real Vietnamese PDF Evaluator.

Runs two comprehensive evaluations:
1. Multi-Domain Cross-Lingual Benchmark & Ablation (AI/CS, Law/Policy, Economics/Finance,
   Biomedicine, Education, Translated Title Detection, Bracketed Translation Preservation,
   Cross-Lingual Polarity Contradiction, and Implicit Vietnamese Body Context Discovery).
2. Direct End-to-End Evaluation on Real Vietnamese PDFs from `vn_legal_reports/`,
   `vn_legal_reports/hard_cases/`, and `tdtu_github_reports/` where Vietnamese body text
   cites English/international publications and Vietnamese legal documents.
"""

from __future__ import annotations

import sys
from pathlib import Path

from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.matching.vn_en_academic_bridge import (
    VN_EN_ACADEMIC_BRIDGE,
    bridge_vn_to_en,
    compute_cross_lingual_concept_overlap,
    is_vietnamese_text,
)
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import ValidationLabel


def run_multi_domain_benchmark() -> tuple[int, int]:
    print("=" * 105)
    print("PART 1: MULTI-DOMAIN CROSS-LINGUAL (VI <-> EN v2.4) BENCHMARK & ABLATION")
    print(f"Loaded VN_EN_ACADEMIC_BRIDGE with {len(VN_EN_ACADEMIC_BRIDGE)} academic concepts.")
    print("=" * 105)

    matcher = SemanticMatcher.get_instance()
    checker = NeuroSymbolicChecker()

    cases = [
        # 1. AI / Computer Science
        {
            "id": "CS-01",
            "domain": "AI / NLP",
            "vn_context": (
                "Cơ chế tự chú ý trong kiến trúc bộ biến đổi giúp mô hình ngôn ngữ lớn "
                "nắm bắt phụ thuộc xa và đạt độ chính xác vượt trội trong dịch máy thần kinh."
            ),
            "en_title": "Attention Is All You Need",
            "en_abstract": (
                "We propose the Transformer, a model architecture eschewing recurrence and "
                "relying entirely on a self-attention mechanism to draw global dependencies "
                "between input and output, achieving state-of-the-art machine translation accuracy."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 2. Computer Vision / Deep Learning
        {
            "id": "CS-02",
            "domain": "AI / CV",
            "vn_context": (
                "Mạng nơ-ron tích chập kết hợp học chuyển giao và giảm thiểu hàm mất mát "
                "giúp cải thiện đáng kể hiệu năng phân loại ảnh và phát hiện đối tượng."
            ),
            "en_title": "Deep Residual Learning for Image Recognition",
            "en_abstract": (
                "Convolutional neural networks with transfer learning and loss function "
                "optimization significantly improve image classification and object detection."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 3. Law / Corporate & M&A / FDI
        {
            "id": "LAW-01",
            "domain": "Law / FDI & M&A",
            "vn_context": (
                "Pháp luật về kiểm soát hoạt động mua lại và sáp nhập doanh nghiệp của "
                "nhà đầu tư trực tiếp nước ngoài nhằm bảo vệ an ninh kinh tế và hạn chế "
                "tập trung kinh tế theo quy định của luật cạnh tranh."
            ),
            "en_title": "Foreign Direct Investment Screening and Merger Control in Emerging Markets",
            "en_abstract": (
                "This article analyzes legal frameworks governing foreign direct investment (FDI) "
                "and cross-border mergers and acquisitions (M&A), focusing on competition law "
                "and economic concentration review to safeguard national economic security."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 4. Law / Green Bonds & Sustainable Development
        {
            "id": "LAW-02",
            "domain": "Law / Green Finance",
            "vn_context": (
                "Hoàn thiện khung pháp lý về phát hành trái phiếu xanh và thực hành "
                "môi trường, xã hội và quản trị nhằm hướng tới mục tiêu phát triển bền vững "
                "và giảm phát thải ròng bằng không."
            ),
            "en_title": "Regulatory Frameworks for Green Bonds and ESG Disclosure in ASEAN",
            "en_abstract": (
                "We examine the legal framework for green bond issuance and environmental, "
                "social, and governance (ESG) reporting to promote sustainable development "
                "and net-zero emissions targets."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 5. Law / Intellectual Property & Digital Assets
        {
            "id": "LAW-03",
            "domain": "Law / IP & Civil",
            "vn_context": (
                "Xác định giá trị quyền sở hữu trí tuệ và thế chấp tài sản số trong "
                "giao dịch dân sự nhằm bảo vệ quyền lợi hợp pháp của doanh nghiệp và "
                "bồi thường thiệt hại khi có hành vi xâm phạm."
            ),
            "en_title": "Valuation of Intellectual Property Rights and Collateralization of Digital Assets",
            "en_abstract": (
                "This paper investigates intellectual property rights valuation, digital asset "
                "collateral in civil law transactions, and damages compensation for infringement."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 6. Economics / Monetary Policy & Inflation
        {
            "id": "ECON-01",
            "domain": "Economics / Macro",
            "vn_context": (
                "Sử dụng hồi quy dữ liệu bảng với hiệu ứng cố định, kết quả thực nghiệm "
                "chứng minh rằng chính sách tiền tệ và điều chỉnh lãi suất của ngân hàng trung ương "
                "có ý nghĩa thống kê trong việc kiểm soát lạm phát và thúc đẩy tăng trưởng kinh tế."
            ),
            "en_title": "Monetary Policy Transmission, Interest Rates, and Inflation Control",
            "en_abstract": (
                "Using fixed-effects panel data regression, our empirical results demonstrate "
                "that central bank monetary policy and interest rate adjustments have a "
                "statistically significant impact on inflation control and economic growth."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 7. Medicine / Clinical Trial
        {
            "id": "MED-01",
            "domain": "Medicine / Clinical",
            "vn_context": (
                "Thử nghiệm lâm sàng ngẫu nhiên có đối chứng cho thấy phác đồ điều trị kết hợp "
                "giúp cải thiện tỷ lệ sống sót và giảm kháng kháng sinh ở bệnh nhân nhiễm trùng nặng."
            ),
            "en_title": "Randomized Controlled Trial of Combination Therapy in Severe Infections",
            "en_abstract": (
                "In this randomized controlled trial, combination treatment regimen significantly "
                "improved survival rate and reduced antibiotic resistance in patients."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 8. Education / Higher Education
        {
            "id": "EDU-01",
            "domain": "Education / Pedagogy",
            "vn_context": (
                "Phương pháp lớp học đảo ngược và học tập kết hợp trong giáo dục đại học "
                "giúp nâng cao tư duy phản biện, động lực học tập và kết quả học tập của sinh viên."
            ),
            "en_title": "Flipped Classroom and Blended Learning in Higher Education",
            "en_abstract": (
                "Implementing flipped classroom and blended learning pedagogy in higher education "
                "enhances students' critical thinking, learning motivation, and academic achievement."
            ),
            "expect_aligned": True,
            "expect_stance": "supported",
        },
        # 9. Cross-Lingual Contradiction (Polarity Mismatch)
        {
            "id": "CONTRA-01",
            "domain": "Polarity Contradiction",
            "vn_context": (
                "Nghiên cứu của Smith (2022) chứng minh rõ ràng rằng làm việc từ xa "
                "làm tăng đáng kể năng suất lao động và sự gắn kết của nhân viên."
            ),
            "en_title": "Re-evaluating Remote Work and Employee Productivity",
            "en_abstract": (
                "Our longitudinal study finds no evidence that remote work increases "
                "employee productivity; instead, full-time remote work fails to improve "
                "team engagement."
            ),
            "expect_aligned": False,
            "expect_stance": "contradiction_risk",
        },
    ]

    passed = 0
    total = len(cases) + 3  # +3 for title translation & implicit context tests

    for c in cases:
        raw_sim = matcher.similarity(c["vn_context"], f"{c['en_title']}. {c['en_abstract']}")
        res = matcher.check_content_alignment(
            cited_context=c["vn_context"],
            source_title=c["en_title"],
            source_abstract=c["en_abstract"],
        )
        ok = (
            res.cross_lingual_detected
            and res.is_aligned == c["expect_aligned"]
            and res.stance_label == c["expect_stance"]
        )
        if ok:
            passed += 1
        status_str = "PASS" if ok else "FAIL"
        print(
            f"[{status_str}] {c['id']:9s} ({c['domain']:22s}) | "
            f"Raw={raw_sim:.3f} -> Calibrated={res.similarity:.3f} | "
            f"Aligned={str(res.is_aligned):5s} | Stance={res.stance_label:18s} | "
            f"Bridged={len(res.bridged_concepts)} concepts"
        )
        if res.bridged_concepts:
            print(f"       Bridged pairs: {', '.join(res.bridged_concepts[:4])}")

    # Test 10: Translated Title WITHOUT Original Title -> METADATA_ERROR (R-CROSS-LINGUAL-TITLE-MATCH)
    cit_translated = Citation(
        raw_text="Goodfellow, I., Bengio, Y., & Courville, A. (2016). Học sâu. MIT Press.",
        authors=["Goodfellow, Ian", "Bengio, Yoshua", "Courville, Aaron"],
        year=2016,
        title="Học sâu",
        venue="MIT Press",
    )
    src_dl = SourceResult(
        citation_raw=cit_translated.raw_text,
        candidates=[
            SourceCandidate(
                source_name="crossref",
                found=True,
                title="Deep Learning",
                authors=["Goodfellow, Ian", "Bengio, Yoshua", "Courville, Aaron"],
                year="2016",
                venue="MIT Press",
                confidence=0.95,
                score=0.95,
            )
        ],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=["crossref"],
        sources_failed=[],
    )
    outcome_trans = checker.check(cit_translated, src_dl)
    ok_trans = (
        outcome_trans.label == ValidationLabel.METADATA_ERROR
        and "R-CROSS-LINGUAL-TITLE-MATCH" in outcome_trans.triggered_rules
        and "title" in outcome_trans.mismatched_fields
    )
    if ok_trans:
        passed += 1
    print(
        f"[{'PASS' if ok_trans else 'FAIL'}] TITLE-01  (Translated-Only Title) | "
        f"Label={outcome_trans.label.value:14s} | Rules={outcome_trans.triggered_rules} | "
        f"Mismatched={outcome_trans.mismatched_fields}"
    )

    # Test 11: Original Title + Bracketed Vietnamese Translation -> VERIFIED
    cit_bracketed = Citation(
        raw_text="Goodfellow, I., Bengio, Y., & Courville, A. (2016). Deep Learning [Học sâu]. MIT Press.",
        authors=["Goodfellow, Ian", "Bengio, Yoshua", "Courville, Aaron"],
        year=2016,
        title="Deep Learning [Học sâu]",
        venue="MIT Press",
    )
    outcome_brack = checker.check(cit_bracketed, src_dl)
    ok_brack = (
        outcome_brack.label == ValidationLabel.VERIFIED
        and "R-CROSS-LINGUAL-TITLE-MATCH" not in outcome_brack.triggered_rules
    )
    if ok_brack:
        passed += 1
    print(
        f"[{'PASS' if ok_brack else 'FAIL'}] TITLE-02  (Original + [Bản dịch]) | "
        f"Label={outcome_brack.label.value:14s} | Rules={outcome_brack.triggered_rules}"
    )

    # Test 12: Implicit Vietnamese Body Context Discovery for English Paper
    vn_body_pages = [
        (1, "Chương 1 trình bày tổng quan về lịch sử phát triển của công nghệ thông tin và hệ thống phần mềm."),
        (
            2,
            "Để giải quyết bài toán dịch máy thần kinh, nghiên cứu này áp dụng kiến trúc bộ biến đổi "
            "với cơ chế tự chú ý đa đầu giúp mô hình hóa phụ thuộc xa mà không cần mạng nơ-ron hồi quy.",
        ),
        (3, "Chương 3 mô tả chi tiết cấu hình phần cứng thử nghiệm và thông số máy chủ."),
    ]
    disc_res = matcher.discover_implicit_body_context(
        body_pages=vn_body_pages,
        source_title="Attention Is All You Need: Transformer with Multi-Head Self-Attention",
        source_abstract="We propose the Transformer based solely on attention mechanisms for neural machine translation.",
    )
    ok_disc = disc_res is not None and disc_res[0] == 2 and "cơ chế tự chú ý" in disc_res[1]
    if ok_disc:
        passed += 1
    print(
        f"[{'PASS' if ok_disc else 'FAIL'}] DISC-01   (Implicit VN Context)   | "
        f"Page={disc_res[0] if disc_res else 'None'} Score={disc_res[2] if disc_res else 0.0:.3f} | "
        f"Top='{disc_res[1][:65] if disc_res else ''}...'"
    )

    print("-" * 105)
    print(f"PART 1 RESULT: {passed}/{total} benchmark cases passed (100% accuracy target).")
    print("=" * 105)
    return passed, total


def evaluate_real_vietnamese_pdfs() -> tuple[int, int]:
    print("\n" + "=" * 105)
    print("PART 2: REAL VIETNAMESE PDF E2E INSPECTION (vn_legal_reports & tdtu_github_reports)")
    print("=" * 105)

    pdf_candidates = [
        Path("vn_legal_reports/hard_cases/hard_01_vn_legal_standard_tdtu.pdf"),
        Path("vn_legal_reports/hard_cases/hard_02_vn_legal_hierarchy_and_metadata_errors.pdf"),
        Path("vn_legal_reports/001_vn_legal_CHAO_BAN_TRAI_PHIEU_DOANH_NGHIEP_RIENG_LE_THEO_PHAP_LUAT_VIET_NAM_THUC_TRAN.pdf"),
        Path("vn_legal_reports/005_vn_legal_Hoan_thien_phap_luat_ve_trai_phieu_doanh_nghiep_xanh_nham_muc_tieu_phat_tri.pdf"),
        Path("vn_legal_reports/006_vn_legal_KIEM_SOAT_HOAT_DONG_MUA_LAI_DOANH_NGHIEP_CUA_NHA_DAU_TU_NUOC_NGOAI_NHAM_BAO.pdf"),
        Path("vn_legal_reports/018_vn_legal_Rao_can_trien_khai_ESG_tai_doanh_nghiep_Viet_Nam_va_de_xuat_giai_phap_khac_.pdf"),
        Path("vn_legal_reports/027_vn_legal_HOAN_THIEN_PHAP_LUAT_VIET_NAM_VE_THE_CHAP_TAI_SAN_SO_TU_KINH_NGHIEM_PHAP_LU.pdf"),
        Path("tdtu_github_reports/001_tdtu_thnhan1_nlp_final_project_NLP_final_report.pdf"),
        Path("tdtu_github_reports/004_tdtu_thnhan2_ml_tdtu_final_521H0507_TranHuuNhan.pdf"),
        Path("tdtu_github_reports/047_tdtu_fuhidev_phantichthietkegiaithuat_Bai1.pdf"),
    ]

    dp = DocumentParser()
    linker = CitationLinker()
    matcher = SemanticMatcher.get_instance()

    pdfs_processed = 0
    total_refs = 0
    total_vn_body_cits = 0
    total_bridged_cits = 0

    for pdf_path in pdf_candidates:
        if not pdf_path.exists():
            continue
        parsed = dp.parse(str(pdf_path))
        refs = list(parsed.references)
        body_cits = list(parsed.body_citations)
        linker.link(body_cits, refs)

        pdfs_processed += 1
        total_refs += len(refs)

        vn_contexts_in_file = 0
        bridged_in_file = 0
        sample_bridges: list[str] = []

        # Build page text lookup from parsed.document.pages
        page_text_map: dict[int, str] = {}
        for p in getattr(parsed.document, "pages", []) or []:
            page_text_map[p.page_num] = p.text or ""

        def _get_surrounding_window(cit: Citation) -> str:
            if getattr(cit, "context", None):
                return str(cit.context)
            ptxt = page_text_map.get(cit.page_num, "")
            if not ptxt or not cit.raw_text:
                return cit.raw_text or ""
            idx = ptxt.find(cit.raw_text)
            if idx == -1:
                # Fallback to first 350 chars of page if exact raw_text wrapped across lines
                return ptxt[:350].replace("\n", " ")
            start = max(0, idx - 180)
            end = min(len(ptxt), idx + len(cit.raw_text) + 180)
            return ptxt[start:end].replace("\n", " ")

        # Inspect body citations & surrounding contexts
        for c in body_cits:
            ctx = _get_surrounding_window(c)
            c.context = ctx
            if is_vietnamese_text(ctx):
                vn_contexts_in_file += 1
                total_vn_body_cits += 1
                _, _, pairs = bridge_vn_to_en(ctx)
                if pairs:
                    bridged_in_file += 1
                    total_bridged_cits += 1
                    for p in pairs:
                        if p not in sample_bridges:
                            sample_bridges.append(p)

        # Also check body pages (pages 4..10 to skip cover/TOC) for Vietnamese academic concepts when body_cits == 0
        if not body_cits and page_text_map:
            sorted_pnums = sorted(page_text_map.keys())
            body_pnums = sorted_pnums[3:10] if len(sorted_pnums) > 4 else sorted_pnums
            for pnum in body_pnums:
                ptxt = page_text_map[pnum]
                if is_vietnamese_text(ptxt):
                    vn_contexts_in_file += 1
                    total_vn_body_cits += 1
                    _, _, pairs = bridge_vn_to_en(ptxt[:1500])
                    if pairs:
                        bridged_in_file += 1
                        total_bridged_cits += 1
                        for p in pairs:
                            if p not in sample_bridges:
                                sample_bridges.append(p)

        # Also check if any English references exist in this Vietnamese PDF and test cross-lingual alignment
        # against the PDF's Vietnamese body citations/paragraphs!
        en_refs = [
            r for r in refs
            if r.title and not is_vietnamese_text(r.title) and len(r.title) > 12
        ]
        cross_lingual_pairs_checked = 0
        for r in en_refs[:5]:
            linked_contexts = [
                getattr(bc, "context", "")
                for bc in body_cits
                if getattr(bc, "reference_id", None) == getattr(r, "reference_id", None)
                and getattr(r, "reference_id", None) is not None
                and getattr(bc, "context", "")
            ]
            if not linked_contexts and page_text_map:
                all_ctx_pages = [
                    (pnum, ptxt)
                    for pnum, ptxt in page_text_map.items()
                    if ptxt and is_vietnamese_text(ptxt)
                ]
                disc = matcher.discover_implicit_body_context(
                    body_pages=all_ctx_pages,
                    source_title=r.title or "",
                    source_abstract=r.venue or "",
                )
                if disc:
                    linked_contexts = [disc[1]]
            if linked_contexts:
                align_res = matcher.check_content_alignment(
                    cited_context=linked_contexts[0],
                    source_title=r.title or "",
                    source_abstract=r.venue or None,
                )
                cross_lingual_pairs_checked += 1
                for bp in align_res.bridged_concepts:
                    if bp not in sample_bridges:
                        sample_bridges.append(bp)

        print(
            f"[PDF {pdfs_processed:02d}] {pdf_path.name[:54]:54s} | "
            f"Refs={len(refs):2d} (EN={len(en_refs):2d}) | "
            f"BodyCits={len(body_cits):2d} (VN_Ctx={vn_contexts_in_file:2d}, Bridged={bridged_in_file:2d})"
        )
        if sample_bridges:
            print(f"         Extracted VI->EN Bridges: {', '.join(sample_bridges[:5])}")

    print("-" * 105)
    print(
        f"PART 2 SUMMARY: Processed {pdfs_processed} real Vietnamese PDFs | "
        f"Total Refs={total_refs} | VN Body Contexts={total_vn_body_cits} | "
        f"Bridged Contexts={total_bridged_cits}"
    )
    print("=" * 105)
    return pdfs_processed, len(pdf_candidates)


if __name__ == "__main__":
    p1_pass, p1_total = run_multi_domain_benchmark()
    p2_done, p2_total = evaluate_real_vietnamese_pdfs()
    if p1_pass != p1_total or p2_done == 0:
        sys.exit(1)
    sys.exit(0)
