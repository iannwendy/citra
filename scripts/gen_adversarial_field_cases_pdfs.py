#!/usr/bin/env python3
"""Generate adversarial multi-citation PDFs targeting subtle field-comparison,
chimeric DOI, buzzword hallucination, preprint-vs-venue conflict, Vietnamese legal,
and cross-lingual citation edge cases.

Outputs in data/essays/:
  - essay_06_chimeric_and_buzzword_traps.pdf
  - essay_07_subtle_metadata_and_preprint_conflicts.pdf
  - essay_08_vn_legal_cross_lingual_and_url_traps.pdf
  - adversarial_ground_truth.json
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT_DIR = Path(__file__).resolve().parent.parent


@dataclass
class AdversarialRefSpec:
    index: int
    raw_reference: str
    intext_marker: str
    expected_label: str
    forbidden_matched_fields: list[str]
    forbidden_100_badges: list[str]
    notes: str


def register_unicode_fonts() -> None:
    font_dir = Path("/System/Library/Fonts/Supplemental")
    regular = font_dir / "Times New Roman.ttf"
    bold = font_dir / "Times New Roman Bold.ttf"
    italic = font_dir / "Times New Roman Italic.ttf"
    bold_italic = font_dir / "Times New Roman Bold Italic.ttf"

    if not regular.exists():
        raise FileNotFoundError(f"Unicode font not found: {regular}")

    pdfmetrics.registerFont(TTFont("TimesUni", str(regular)))
    pdfmetrics.registerFont(TTFont("TimesUni-Bold", str(bold if bold.exists() else regular)))
    pdfmetrics.registerFont(TTFont("TimesUni-Italic", str(italic if italic.exists() else regular)))
    pdfmetrics.registerFont(
        TTFont("TimesUni-BoldItalic", str(bold_italic if bold_italic.exists() else regular))
    )
    pdfmetrics.registerFontFamily(
        "TimesUni",
        normal="TimesUni",
        bold="TimesUni-Bold",
        italic="TimesUni-Italic",
        boldItalic="TimesUni-BoldItalic",
    )


def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "AdvTitle",
            parent=base["Normal"],
            fontName="TimesUni-Bold",
            fontSize=15,
            leading=20,
            alignment=TA_CENTER,
            spaceAfter=12,
        ),
        "h2": ParagraphStyle(
            "AdvH2",
            parent=base["Normal"],
            fontName="TimesUni-Bold",
            fontSize=12.5,
            leading=16,
            spaceBefore=10,
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "AdvBody",
            parent=base["Normal"],
            fontName="TimesUni",
            fontSize=11,
            leading=15,
            alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        "ref": ParagraphStyle(
            "AdvRef",
            parent=base["Normal"],
            fontName="TimesUni",
            fontSize=10,
            leading=13.5,
            alignment=TA_LEFT,
            leftIndent=0.8 * cm,
            firstLineIndent=-0.8 * cm,
            spaceAfter=6,
        ),
    }


def render_pdf(
    out_path: Path,
    title: str,
    paragraphs: list[str],
    ref_heading: str,
    refs: list[AdversarialRefSpec],
) -> None:
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=2.2 * cm,
        rightMargin=2.2 * cm,
        topMargin=2.2 * cm,
        bottomMargin=2.2 * cm,
    )
    flow = [Paragraph(escape(title), styles["title"]), Spacer(1, 0.25 * cm)]
    for para in paragraphs:
        flow.append(Paragraph(escape(para), styles["body"]))
    flow.append(PageBreak())
    flow.append(Paragraph(escape(ref_heading), styles["h2"]))
    for r in refs:
        flow.append(Paragraph(escape(r.raw_reference), styles["ref"]))
    doc.build(flow)


def build_essay_06() -> tuple[str, list[str], str, list[AdversarialRefSpec]]:
    title = "Essay 06 — Chimeric Citations and LLM Buzzword Hallucination Traps"
    refs = [
        AdversarialRefSpec(
            index=1,
            raw_reference=(
                "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., "
                "Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention is all you need. "
                "Advances in Neural Information Processing Systems, 30. "
                "https://doi.org/10.48550/arXiv.1706.03762"
            ),
            intext_marker="(Vaswani et al., 2017)",
            expected_label="verified",
            forbidden_matched_fields=[],
            forbidden_100_badges=[],
            notes="Valid control citation with arXiv DOI and NeurIPS venue.",
        ),
        AdversarialRefSpec(
            index=2,
            raw_reference=(
                "Kowalski, M., & Vandenberg, L. (2017). Hyperbolic quantum graph topology "
                "for autonomous underwater swarm navigation. Journal of Subsea Robotics, 14(2), "
                "112-124. https://doi.org/10.1109/CVPR.2016.90"
            ),
            intext_marker="(Kowalski & Vandenberg, 2017)",
            expected_label="suspected_hallucination",
            forbidden_matched_fields=["title", "authors", "year", "venue"],
            forbidden_100_badges=["title", "authors", "year", "venue"],
            notes="Chimeric citation splicing fabricated authors/title/venue with He et al. (2016) ResNet DOI.",
        ),
        AdversarialRefSpec(
            index=3,
            raw_reference=(
                "Devlin, J., & Chang, M. W. (2019). Magnetohydrodynamic turbulence modeling "
                "in circumstellar accretion disks. Astrophysical Journal Letters, 875(2), L14. "
                "https://doi.org/10.18653/v1/N19-1423"
            ),
            intext_marker="(Devlin & Chang, 2019)",
            expected_label="suspected_hallucination",
            forbidden_matched_fields=["title", "venue"],
            forbidden_100_badges=["title", "venue"],
            notes="Same-author + real BERT DOI chimera with completely unrelated astrophysics title and venue.",
        ),
        AdversarialRefSpec(
            index=4,
            raw_reference=(
                "Martinez, C. R., & Takahashi, K. (2024). Self-reflective retrieval-augmented "
                "generation for hallucination mitigation in large language models. "
                "Journal of Artificial Intelligence Research, 81, 415-448. "
                "https://doi.org/10.1613/jair.1.99871"
            ),
            intext_marker="(Martinez & Takahashi, 2024)",
            expected_label="suspected_hallucination",
            forbidden_matched_fields=["doi", "authors", "venue"],
            forbidden_100_badges=["doi", "authors", "venue", "url"],
            notes="Realistic JAIR DOI prefix (10.1613/jair) + high-buzzword 2024 RAG/LLM hallucinated title.",
        ),
        AdversarialRefSpec(
            index=5,
            raw_reference=(
                "Patel, S. K., & O'Connor, D. J. (2024). Fine-grained factual consistency "
                "evaluation in abstractive summarization with large language models. "
                "Artificial Intelligence, 335, 109999. "
                "https://doi.org/10.1016/j.artint.2024.999999"
            ),
            intext_marker="(Patel & O'Connor, 2024)",
            expected_label="suspected_hallucination",
            forbidden_matched_fields=["doi", "authors"],
            forbidden_100_badges=["doi", "authors", "url"],
            notes="Realistic Elsevier Artificial Intelligence DOI prefix with non-existent suffix + buzzword title.",
        ),
    ]
    paragraphs = [
        "Modern sequence transduction architectures rely heavily on multi-head self-attention "
        "mechanisms introduced in foundational deep learning research (Vaswani et al., 2017). "
        "However, automated literature synthesis tools occasionally splice real persistent "
        "identifiers onto unrelated domains such as underwater robotics (Kowalski & Vandenberg, 2017) "
        "or astrophysical fluid dynamics (Devlin & Chang, 2019).",
        "Recent benchmark evaluations also reveal that generative models frequently synthesize "
        "plausible-sounding retrieval-augmented generation references using real journal prefixes "
        "(Martinez & Takahashi, 2024) as well as summarization consistency studies that do not "
        "exist in publisher registries (Patel & O'Connor, 2024).",
    ]
    return title, paragraphs, "References", refs


def build_essay_07() -> tuple[str, list[str], str, list[AdversarialRefSpec]]:
    title = "Essay 07 — Subtle Metadata Conflicts, Adjacent DOI Typos, and Venue Swaps"
    refs = [
        AdversarialRefSpec(
            index=1,
            raw_reference=(
                "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. "
                "Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14538"
            ),
            intext_marker="(LeCun, Bengio, & Hinton, 2015)",
            expected_label="metadata_error",
            forbidden_matched_fields=["doi"],
            forbidden_100_badges=["doi", "url"],
            notes="1-digit DOI typo (nature14538 is an adjacent real Nature article; paper is nature14539).",
        ),
        AdversarialRefSpec(
            index=2,
            raw_reference=(
                "Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). "
                "BERT: Pre-training of deep bidirectional transformers for language understanding. "
                "International Journal of Quantum Chemistry, 119(4), 4171-4186. "
                "https://doi.org/10.18653/v1/N19-1423"
            ),
            intext_marker="(Devlin et al., 2019)",
            expected_label="metadata_error",
            forbidden_matched_fields=["venue"],
            forbidden_100_badges=["venue"],
            notes="Real BERT authors/year/title/DOI but completely wrong non-preprint journal venue.",
        ),
        AdversarialRefSpec(
            index=3,
            raw_reference=(
                "Sutskever, I., Vinyals, O., & Le, Q. V. (2016). "
                "Deep residual learning for image recognition. "
                "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, "
                "770-778. https://doi.org/10.1109/CVPR.2016.90"
            ),
            intext_marker="(Sutskever, Vinyals, & Le, 2016)",
            expected_label="metadata_error",
            forbidden_matched_fields=["authors"],
            forbidden_100_badges=["authors"],
            notes="Author swap: Seq2Seq authors attributed to ResNet CVPR paper and DOI.",
        ),
        AdversarialRefSpec(
            index=4,
            raw_reference=(
                "He, K., Zhang, X., Ren, S., & Sun, J. (2020). "
                "Deep residual learning for image recognition. "
                "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, "
                "770-778. https://doi.org/10.1109/CVPR.2016.90"
            ),
            intext_marker="(He et al., 2020)",
            expected_label="metadata_error",
            forbidden_matched_fields=["year"],
            forbidden_100_badges=["year"],
            notes="4-year publication year error (2020 vs 2016) on real ResNet paper and DOI.",
        ),
        AdversarialRefSpec(
            index=5,
            raw_reference=(
                "Brown, T. B., Mann, B., Ryder, N., Subbiah, M., Kaplan, J., Dhariwal, P., "
                "Neelakantan, A., et al. (2020). Language models are few-shot learners. "
                "Advances in Neural Information Processing Systems, 33, 1877-1901. "
                "https://doi.org/10.48550/arXiv.2005.14165"
            ),
            intext_marker="(Brown et al., 2020)",
            expected_label="verified",
            forbidden_matched_fields=[],
            forbidden_100_badges=[],
            notes="Valid NeurIPS paper cited with official arXiv preprint DOI.",
        ),
    ]
    paragraphs = [
        "Representation learning hierarchies enable deep neural networks to discover intricate "
        "structures in high-dimensional data (LeCun, Bengio, & Hinton, 2015). Bidirectional "
        "language pre-training has similarly advanced natural language understanding benchmarks "
        "(Devlin et al., 2019).",
        "In computer vision, skip connections allow optimization of deep convolutional stacks, "
        "though bibliographic records sometimes misattribute authorship (Sutskever, Vinyals, & Le, 2016) "
        "or misstate publication years (He et al., 2020). Scaling autoregressive transformers "
        "subsequently unlocked strong few-shot transfer (Brown et al., 2020).",
    ]
    return title, paragraphs, "References", refs


def build_essay_08() -> tuple[str, list[str], str, list[AdversarialRefSpec]]:
    title = "Essay 08 — Kiểm định Trích dẫn Pháp luật Việt Nam, Đa ngôn ngữ và Liên kết Web"
    refs = [
        AdversarialRefSpec(
            index=1,
            raw_reference="[1] Bộ luật Dân sự (Bộ luật số 91/2015/QH13) ngày 24/11/2015 của Quốc hội.",
            intext_marker="[1]",
            expected_label="resource",
            forbidden_matched_fields=[],
            forbidden_100_badges=[],
            notes="Valid Vietnamese Civil Code 2015.",
        ),
        AdversarialRefSpec(
            index=2,
            raw_reference="[2] Luật Doanh nghiệp (Luật số 59/2020/QH14) ngày 17/06/2020 của Bộ Tài chính.",
            intext_marker="[2]",
            expected_label="metadata_error",
            forbidden_matched_fields=["venue"],
            forbidden_100_badges=["venue"],
            notes="Corrupted Vietnamese Enterprise Law 2020: wrong issuing authority (Bộ Tài chính vs Quốc hội).",
        ),
        AdversarialRefSpec(
            index=3,
            raw_reference=(
                "[3] Bộ luật Trí tuệ Nhân tạo Quốc gia (Bộ luật số 888/2024/QH15) "
                "ngày 15/08/2024 của Quốc hội."
            ),
            intext_marker="[3]",
            expected_label="suspected_hallucination",
            forbidden_matched_fields=["title", "year", "venue"],
            forbidden_100_badges=["title", "year", "venue"],
            notes="Fabricated Vietnamese Code (outside the 6 official Codes + impossible code number 888).",
        ),
        AdversarialRefSpec(
            index=4,
            raw_reference=(
                "[4] Vaswani, A., Shazeer, N., & Parmar, N. (2017). "
                "Chú ý là tất cả những gì bạn cần. "
                "Advances in Neural Information Processing Systems, 30, 5998-6008."
            ),
            intext_marker="[4]",
            expected_label="metadata_error",
            forbidden_matched_fields=["title"],
            forbidden_100_badges=["title"],
            notes="Cross-lingual translated title violation (Vietnamese translation of Attention Is All You Need).",
        ),
        AdversarialRefSpec(
            index=5,
            raw_reference=(
                "[5] Nguyen, H. T., & Tran, Q. M. (2024). Khung đánh giá tính toàn vẹn "
                "học thuật tự động cho khóa luận tốt nghiệp đại học. "
                "Tạp chí Khoa học Giả định Việt Nam, 99(1), 10-25. "
                "https://tapchikhoahocgiadinh-vn.invalid/2024/integrity-framework"
            ),
            intext_marker="[5]",
            expected_label="suspected_hallucination",
            forbidden_matched_fields=["title", "authors", "venue", "doi"],
            forbidden_100_badges=["title", "authors", "venue", "doi", "url"],
            notes="Fabricated Vietnamese article with .invalid fake/unreachable URL.",
        ),
    ]
    paragraphs = [
        "Trong hệ thống pháp luật thực định Việt Nam, nguyên tắc thiện chí và trung thực trong "
        "xác lập giao dịch dân sự được quy định rõ tại Bộ luật Dân sự hiện hành [1], đồng thời "
        "quy chế quản trị pháp nhân thương mại chịu sự điều chỉnh của Luật Doanh nghiệp [2]. "
        "Tuy nhiên, các công cụ sinh văn bản tự động thường bịa đặt ra các đạo luật chưa từng "
        "được Quốc hội thông qua như đạo luật về trí tuệ nhân tạo có số hiệu bất khả thi [3].",
        "Bên cạnh đó, khi trích dẫn các công trình học thuật quốc tế nền tảng về kiến trúc "
        "Transformer, một số sinh viên tự ý dịch tiêu đề gốc tiếng Anh sang tiếng Việt trái với "
        "quy định trích dẫn học thuật [4], hoặc đính kèm đường dẫn tên miền không tồn tại cho "
        "các bài báo hư cấu [5].",
    ]
    return title, paragraphs, "Tài liệu tham khảo", refs


def main() -> None:
    register_unicode_fonts()
    out_dir = ROOT_DIR / "data" / "essays"
    out_dir.mkdir(parents=True, exist_ok=True)

    builders = [
        ("essay_06_chimeric_and_buzzword_traps.pdf", build_essay_06),
        ("essay_07_subtle_metadata_and_preprint_conflicts.pdf", build_essay_07),
        ("essay_08_vn_legal_cross_lingual_and_url_traps.pdf", build_essay_08),
    ]

    manifest: list[dict] = []
    for fname, builder in builders:
        title, paragraphs, ref_heading, refs = builder()
        pdf_path = out_dir / fname
        render_pdf(pdf_path, title, paragraphs, ref_heading, refs)
        print(f"Generated {pdf_path} ({pdf_path.stat().st_size:,} bytes)")
        manifest.append({
            "filename": fname,
            "title": title,
            "references": [asdict(r) for r in refs],
        })

    gt_path = out_dir / "adversarial_ground_truth.json"
    gt_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved ground truth manifest -> {gt_path}")


if __name__ == "__main__":
    main()
