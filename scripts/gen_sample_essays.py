#!/usr/bin/env python
"""Sinh 5-10 PDF tiểu luận mẫu để test pipeline end-to-end.

Phân bố:
    2 essay toàn citation THẬT (DOI crossref-resolvable)
    3 essay MIXED (một số thật + một số metadata sai)
    2 essay FABRICATED (DOI/author/venue fake)
    1 essay EDGE CASE (citation ít, format lạ)

Mỗi essay:
    - 2 trang
    - 1 section References rõ ràng
    - 2-4 in-text citations

Cú pháp:
    python scripts/gen_sample_essays.py [--output-dir PATH]
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


@dataclass
class CitationEntry:
    """Một reference entry — có thể là thật hoặc ảo."""

    authors: str           # APA format: "Smith, J., & Jones, A."
    year: str
    title: str
    venue: str
    doi: str | None = None
    url: str | None = None


# =====================================================================
# Citation pools
# =====================================================================

# --- 1. REAL citations (DOI thật, crossref-resolvable) ---
REAL = [
    CitationEntry(
        authors="Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I.",
        year="2017",
        title="Attention is all you need",
        venue="Advances in Neural Information Processing Systems, 30",
        doi="10.48550/arXiv.1706.03762",
    ),
    CitationEntry(
        authors="Devlin, J., Chang, M. W., Lee, K., & Toutanova, K.",
        year="2019",
        title="BERT: Pre-training of deep bidirectional transformers for language understanding",
        venue="Proceedings of NAACL-HLT",
        doi="10.18653/v1/N19-1423",
    ),
    CitationEntry(
        authors="He, K., Zhang, X., Ren, S., & Sun, J.",
        year="2016",
        title="Deep residual learning for image recognition",
        venue="Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
        doi="10.1109/CVPR.2016.90",
    ),
    CitationEntry(
        authors="Brown, T. B., Mann, B., Ryder, N., Subbiah, M., Kaplan, J., Dhariwal, P., Neelakantan, A., et al.",
        year="2020",
        title="Language models are few-shot learners",
        venue="Advances in Neural Information Processing Systems, 33",
        doi="10.48550/arXiv.2005.14165",
    ),
    CitationEntry(
        authors="LeCun, Y., Bengio, Y., & Hinton, G.",
        year="2015",
        title="Deep learning",
        venue="Nature, 521(7553), 436-444",
        doi="10.1038/nature14539",
    ),
]


# --- 2. FABRICATED (DOI/author/venue fake) ---
FABRICATED = [
    CitationEntry(
        authors="Smith, J. Q., & Doe, R. K.",
        year="2024",
        title="A novel framework for hallucination detection in large language models",
        venue="Journal of Imaginary AI Research, 99(12), 1-25",
        doi="10.9999/jiar.2024.9999",
    ),
    CitationEntry(
        authors="Nguyen, V. A., Tran, T. B., & Le, M. H.",
        year="2023",
        title="Citation integrity in student essays using neuro-symbolic methods",
        venue="Proceedings of the Hypothetical Conference on Education AI, 5, 100-110",
        doi="10.5555/hcea.2023.5.100",
    ),
    CitationEntry(
        authors="Anderson, P. R., & Brown, L. M.",
        year="2025",
        title="Reference hallucination: Causes and mitigation strategies",
        venue="Nonexistent Journal of Academic Integrity, 1(1), 1-15",
        doi="10.0000/njai.2025.001",
    ),
]


# =====================================================================
# Helper: build in-text + reference entry
# =====================================================================


def build_body(title: str, paragraphs: list[str], entries: list[CitationEntry]) -> list:
    """Tạo flowables cho 1 essay."""
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=styles["Normal"],
        fontSize=11,
        leading=15,
        spaceAfter=8,
        alignment=4,  # justify
    )
    h1 = ParagraphStyle(
        "H1",
        parent=styles["Heading1"],
        fontSize=16,
        leading=20,
        spaceAfter=12,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontSize=13,
        leading=16,
        spaceBefore=10,
        spaceAfter=8,
    )
    ref = ParagraphStyle(
        "Ref",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        leftIndent=1 * cm,
        spaceAfter=6,
    )

    flow = [
        Paragraph(title, h1),
        Spacer(1, 0.3 * cm),
    ]
    for p in paragraphs:
        flow.append(Paragraph(p, body))
    flow.append(PageBreak())

    # References
    flow.append(Paragraph("References", h2))
    for e in entries:
        line = f"{e.authors} ({e.year}). {e.title}. <i>{e.venue}</i>."
        if e.doi:
            line += f" https://doi.org/{e.doi}"
        elif e.url:
            line += f" {e.url}"
        flow.append(Paragraph(line, ref))
    return flow


# =====================================================================
# Essay definitions
# =====================================================================


def essay_01_real_only() -> list:
    """Toàn citation thật."""
    title = "Essay 01 — Citation Real (control)"
    paragraphs = [
        "In recent years, deep learning has revolutionized many fields "
        "(<i>LeCun, Bengio, &amp; Hinton, 2015</i>). One of the most influential "
        "architectures is the residual network, which enables the training of very "
        "deep convolutional networks (<i>He, Zhang, Ren, &amp; Sun, 2016</i>).",
        "In the field of natural language processing, the introduction of the "
        "Transformer architecture marked a paradigm shift (<i>Vaswani et al., 2017</i>). "
        "Subsequent models such as BERT (<i>Devlin et al., 2019</i>) demonstrated that "
        "pre-trained language representations could be fine-tuned for many downstream "
        "tasks. More recently, large language models have shown remarkable few-shot "
        "learning capabilities (<i>Brown et al., 2020</i>).",
    ]
    return build_body(title, paragraphs, REAL)


def essay_02_mixed() -> list:
    """Một số thật, một số metadata sai (year hoặc venue)."""
    title = "Essay 02 — Mixed Real + Metadata Error"
    mixed = [
        REAL[0],  # Vaswani - thật
        CitationEntry(
            authors="Devlin, J., Chang, M. W., Lee, K., & Toutanova, K.",
            year="2018",  # SAI: paper gốc 2019
            title="BERT: Pre-training of deep bidirectional transformers",
            venue="Unknown Conference Proceedings",  # SAI venue
            doi="10.18653/v1/N19-1423",
        ),
        REAL[2],  # He - thật
        FABRICATED[0],  # ảo
    ]
    paragraphs = [
        "The Transformer architecture has fundamentally changed how we approach "
        "sequence modeling (<i>Vaswani et al., 2017</i>). Subsequently, pre-trained "
        "models like BERT have shown strong performance on many NLP tasks "
        "(<i>Devlin et al., 2018</i>).",
        "Visual recognition has also benefited from deep learning advances, "
        "especially residual networks (<i>He, Zhang, Ren, &amp; Sun, 2016</i>).",
        "However, some recent work has explored new directions in hallucination "
        "detection (<i>Smith &amp; Doe, 2024</i>).",
    ]
    return build_body(title, paragraphs, mixed)


def essay_03_fabricated() -> list:
    """Toàn fabricated."""
    title = "Essay 03 — Fully Fabricated"
    paragraphs = [
        "The field of citation integrity has gained significant attention in "
        "recent years (<i>Smith &amp; Doe, 2024</i>). Several frameworks have been "
        "proposed to address hallucination in student essays (<i>Nguyen et al., 2023</i>). "
        "Anderson and Brown (<i>2025</i>) discussed mitigation strategies for "
        "reference hallucination.",
    ]
    return build_body(title, paragraphs, FABRICATED)


def essay_04_real_only_2() -> list:
    """Toàn thật, citation ít — dễ test."""
    title = "Essay 04 — Real Citations (small)"
    paragraphs = [
        "Deep learning is a subfield of machine learning (<i>LeCun et al., 2015</i>). "
        "Recent advances in transformer architectures have pushed the state-of-the-art "
        "in language understanding (<i>Vaswani et al., 2017</i>).",
    ]
    return build_body(title, paragraphs, [REAL[0], REAL[4]])


def essay_05_edge_case() -> list:
    """Citation ít, chỉ có DOI, không có author/year."""
    title = "Essay 05 — Edge Case (DOI only)"
    paragraphs = [
        "Various studies have explored hallucination detection. See 10.48550/arXiv.1706.03762 "
        "for foundational work. Recent literature on the topic has expanded rapidly "
        "(DOI: 10.1038/nature14539).",
    ]
    weird_entries = [
        CitationEntry(
            authors="Various",
            year="2017",
            title="Attention is all you need",
            venue="arXiv",
            doi="10.48550/arXiv.1706.03762",
        ),
        CitationEntry(
            authors="Various",
            year="2015",
            title="Deep learning",
            venue="Nature",
            doi="10.1038/nature14539",
        ),
    ]
    return build_body(title, paragraphs, weird_entries)


# =====================================================================
# Main
# =====================================================================


ESSAYS = [
    ("essay_01_real_only.pdf", essay_01_real_only),
    ("essay_02_mixed.pdf", essay_02_mixed),
    ("essay_03_fabricated.pdf", essay_03_fabricated),
    ("essay_04_real_small.pdf", essay_04_real_only_2),
    ("essay_05_edge_doi_only.pdf", essay_05_edge_case),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate sample PDF essays")
    parser.add_argument(
        "--output-dir",
        default="data/essays",
        help="Output directory (default: data/essays)",
    )
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating {len(ESSAYS)} sample essays → {out_dir}/")
    for filename, builder in ESSAYS:
        path = out_dir / filename
        doc = SimpleDocTemplate(
            str(path),
            pagesize=A4,
            leftMargin=2 * cm,
            rightMargin=2 * cm,
            topMargin=2 * cm,
            bottomMargin=2 * cm,
            title=filename,
        )
        doc.build(builder())
        print(f"  ✓ {filename}")

    print("\nDone. Để xem:")
    print(f"  ls {out_dir}/")


if __name__ == "__main__":
    main()
