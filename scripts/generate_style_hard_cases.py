#!/usr/bin/env python3
"""Generate synthetic multi-page hard-case PDF corpora for all 11 academic citation
styles plus Vietnamese Legal (VN_LEGAL), along with ground_truth.json files.

Deliverables:
- style_corpora/<STYLE>/hard_cases/ (for APA, IEEE, Vancouver, Chicago, Harvard, MLA, ACM, Nature, CSE, ACS, AMA):
    1. hard_01_verified_and_resource.pdf
    2. hard_02_metadata_errors_and_mismatch.pdf
    3. hard_03_hallucinations_and_chimera.pdf
    4. hard_04_linking_anomalies.pdf
    5. hard_05_extreme_edge_cases_and_unresolved.pdf
    + ground_truth.json
- vn_legal_reports/hard_cases/ (for VN_LEGAL):
    1. hard_01_vn_legal_standard_tdtu.pdf
    2. hard_02_vn_legal_hierarchy_and_metadata_errors.pdf
    3. hard_03_vn_legal_hallucinations_and_fake_laws.pdf
    4. hard_04_vn_legal_linking_anomalies.pdf
    5. hard_05_vn_legal_complex_intext_and_unresolved.pdf
    + ground_truth.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import fitz
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate

ROOT_DIR = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from integrity_checker.config import get_settings  # noqa: E402
from integrity_checker.extraction.document_parser import DocumentParser  # noqa: E402
from integrity_checker.extraction.style_detector import StyleDetector  # noqa: E402
from integrity_checker.linking.citation_linker import CitationLinker  # noqa: E402
from integrity_checker.linking.duplicate_detector import DuplicateDetector  # noqa: E402

STYLES: list[str] = [
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

FONT_FAMILY = "TimesUni"


def register_unicode_fonts() -> None:
    """Register macOS TrueType Times New Roman fonts for full Unicode & Vietnamese support."""
    font_dir = Path("/System/Library/Fonts/Supplemental")
    regular = font_dir / "Times New Roman.ttf"
    bold = font_dir / "Times New Roman Bold.ttf"
    italic = font_dir / "Times New Roman Italic.ttf"
    bold_italic = font_dir / "Times New Roman Bold Italic.ttf"

    if not regular.exists():
        raise FileNotFoundError(f"Required Unicode TrueType font not found: {regular}")

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


def build_paragraph_styles() -> dict[str, ParagraphStyle]:
    """Create ReportLab paragraph styles tuned for 3-4 page academic papers."""
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "DocTitle",
            parent=base["Normal"],
            fontName="TimesUni-Bold",
            fontSize=15,
            leading=20,
            alignment=TA_CENTER,
            spaceAfter=10,
        ),
        "author": ParagraphStyle(
            "DocAuthor",
            parent=base["Normal"],
            fontName="TimesUni-Italic",
            fontSize=11,
            leading=15,
            alignment=TA_CENTER,
            spaceAfter=14,
        ),
        "abstract_heading": ParagraphStyle(
            "AbstractHeading",
            parent=base["Normal"],
            fontName="TimesUni-Bold",
            fontSize=11,
            leading=15,
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "abstract_body": ParagraphStyle(
            "AbstractBody",
            parent=base["Normal"],
            fontName="TimesUni-Italic",
            fontSize=10.5,
            leading=15,
            alignment=TA_JUSTIFY,
            leftIndent=18,
            rightIndent=18,
            spaceAfter=14,
        ),
        "heading": ParagraphStyle(
            "SectionHeading",
            parent=base["Normal"],
            fontName="TimesUni-Bold",
            fontSize=12.5,
            leading=17,
            alignment=TA_LEFT,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "BodyParagraph",
            parent=base["Normal"],
            fontName="TimesUni",
            fontSize=11,
            leading=16.5,
            alignment=TA_JUSTIFY,
            spaceAfter=9,
        ),
        "ref_heading": ParagraphStyle(
            "RefHeading",
            parent=base["Normal"],
            fontName="TimesUni-Bold",
            fontSize=13,
            leading=18,
            alignment=TA_LEFT,
            spaceBefore=6,
            spaceAfter=10,
        ),
        "ref_entry": ParagraphStyle(
            "RefEntry",
            parent=base["Normal"],
            fontName="TimesUni",
            fontSize=10.5,
            leading=15,
            alignment=TA_LEFT,
            leftIndent=18,
            firstLineIndent=-18,
            spaceAfter=2,
        ),
        "blank_sep": ParagraphStyle(
            "BlankSep",
            parent=base["Normal"],
            fontName="TimesUni",
            fontSize=6,
            leading=7,
            spaceAfter=2,
        ),
    }


def _page_footer(canvas: Any, doc: Any) -> None:
    canvas.saveState()
    canvas.setFont("TimesUni", 9)
    canvas.drawCentredString(A4[0] / 2.0, 1.2 * cm, f"Page {doc.page}")
    canvas.restoreState()


def render_pdf(
    output_path: Path,
    title: str,
    subtitle: str,
    abstract_title: str,
    abstract_text: str,
    sections: list[tuple[str, list[str]]],
    ref_heading: str,
    references: list[str],
) -> None:
    """Render a 3-5 page academic PDF using ReportLab and TimesUni TrueType fonts."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pstyles = build_paragraph_styles()
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=2.3 * cm,
        rightMargin=2.3 * cm,
        topMargin=2.3 * cm,
        bottomMargin=2.3 * cm,
        title=title,
        author="Synthetic Integrity Benchmark Suite",
    )

    story: list[Any] = []
    story.append(Paragraph(escape(title), pstyles["title"]))
    story.append(Paragraph(escape(subtitle), pstyles["author"]))
    story.append(Paragraph(escape(abstract_title), pstyles["abstract_heading"]))
    story.append(Paragraph(escape(abstract_text), pstyles["abstract_body"]))

    for sec_title, paragraphs in sections:
        story.append(Paragraph(escape(sec_title), pstyles["heading"]))
        for para in paragraphs:
            story.append(Paragraph(escape(para), pstyles["body"]))

    story.append(PageBreak())
    story.append(Paragraph(escape(ref_heading), pstyles["ref_heading"]))
    for idx, ref_text in enumerate(references):
        story.append(Paragraph(escape(ref_text), pstyles["ref_entry"]))
        if idx < len(references) - 1:
            # Emit a whitespace-only separator line so PyMuPDF extracts \n \n between entries
            story.append(Paragraph("&nbsp;", pstyles["blank_sep"]))

    doc.build(story, onFirstPage=_page_footer, onLaterPages=_page_footer)


# ==============================================================================
# STYLE-SPECIFIC FORMATTERS FOR ALL 11 CITATION STYLES
# ==============================================================================

def format_article_ref(style: str, idx: int, spec: dict[str, Any]) -> str:
    """Format a journal/conference article reference in authentic <style> syntax."""
    kind = spec.get("kind", "article")
    if kind == "resource":
        return format_resource_ref(style, idx, spec)
    if kind == "unresolved":
        return format_unresolved_ref(style, idx, spec)

    authors: list[tuple[str, str, str]] = spec["authors"]  # (last, initials_dots, full_first)
    year = spec["year"]
    title = spec["title"]
    venue = spec["venue"]
    venue_abbr = spec.get("venue_abbr", venue)
    vol = spec.get("vol", "30")
    issue = spec.get("issue", "1")
    pages = spec.get("pages", "100-115")
    doi = spec.get("doi")

    if style == "APA":
        if len(authors) == 1:
            a_str = f"{authors[0][0]}, {authors[0][1]}"
        elif len(authors) == 2:
            a_str = f"{authors[0][0]}, {authors[0][1]}, & {authors[1][0]}, {authors[1][1]}"
        else:
            init_parts = [f"{a[0]}, {a[1]}" for a in authors[:-1]]
            a_str = ", ".join(init_parts) + f", & {authors[-1][0]}, {authors[-1][1]}"
        doi_str = f" https://doi.org/{doi}" if doi else ""
        return f"{a_str} ({year}). {title}. {venue}, {vol}({issue}), {pages}.{doi_str}"

    if style == "IEEE":
        if len(authors) == 1:
            a_str = f"{authors[0][1]} {authors[0][0]}"
        elif len(authors) == 2:
            a_str = f"{authors[0][1]} {authors[0][0]} and {authors[1][1]} {authors[1][0]}"
        else:
            init_parts = [f"{a[1]} {a[0]}" for a in authors[:-1]]
            a_str = ", ".join(init_parts) + f", and {authors[-1][1]} {authors[-1][0]}"
        doi_str = f", doi: {doi}." if doi else "."
        return f"[{idx}] {a_str}, \"{title},\" in {venue}, vol. {vol}, no. {issue}, pp. {pages}, {year}{doi_str}"

    if style == "Vancouver":
        a_parts = [f"{a[0]} {a[1].replace('.', '').replace(' ', '')}" for a in authors]
        a_str = ", ".join(a_parts)
        doi_str = f" doi:{doi}" if doi else ""
        return f"{idx}. {a_str}. {title}. {venue_abbr}. {year};{vol}({issue}):{pages}.{doi_str}"

    if style == "Chicago":
        first = f"{authors[0][0]}, {authors[0][2]}"
        if len(authors) == 1:
            a_str = first
        elif len(authors) == 2:
            a_str = f"{first}, and {authors[1][2]} {authors[1][0]}"
        else:
            mid = [f"{a[2]} {a[0]}" for a in authors[1:-1]]
            a_str = f"{first}, " + ", ".join(mid) + f", and {authors[-1][2]} {authors[-1][0]}"
        doi_str = f" doi:{doi}." if doi else "."
        return f"{a_str}. {year}. \"{title}.\" {venue} {vol} ({issue}): {pages}.{doi_str}"

    if style == "Harvard":
        if len(authors) == 1:
            a_str = f"{authors[0][0]}, {authors[0][1]}"
        elif len(authors) == 2:
            a_str = f"{authors[0][0]}, {authors[0][1]} and {authors[1][0]}, {authors[1][1]}"
        else:
            init_parts = [f"{a[0]}, {a[1]}" for a in authors[:-1]]
            a_str = ", ".join(init_parts) + f" and {authors[-1][0]}, {authors[-1][1]}"
        doi_str = f" doi:{doi}." if doi else ""
        return f"{a_str} ({year}) '{title}', {venue}, {vol}({issue}), pp. {pages}.{doi_str}"

    if style == "MLA":
        first = f"{authors[0][0]}, {authors[0][2]}"
        if len(authors) == 1:
            a_str = f"{first}."
        elif len(authors) == 2:
            a_str = f"{first}, and {authors[1][2]} {authors[1][0]}."
        else:
            a_str = f"{first}, et al."
        doi_str = f", doi:{doi}." if doi else "."
        return f"{a_str} \"{title}.\" {venue}, vol. {vol}, no. {issue}, {year}, pp. {pages}{doi_str}"

    if style == "ACM":
        if len(authors) == 1:
            a_str = f"{authors[0][2]} {authors[0][0]}"
        elif len(authors) == 2:
            a_str = f"{authors[0][2]} {authors[0][0]} and {authors[1][2]} {authors[1][0]}"
        else:
            init_parts = [f"{a[2]} {a[0]}" for a in authors[:-1]]
            a_str = ", ".join(init_parts) + f", and {authors[-1][2]} {authors[-1][0]}"
        doi_str = f" https://doi.org/{doi}" if doi else ""
        return f"[{idx}] {a_str}. {year}. {title}. In {venue}, Vol. {vol}. {pages}.{doi_str}"

    if style == "Nature":
        if len(authors) == 1:
            a_str = f"{authors[0][0]}, {authors[0][1]}"
        elif len(authors) == 2:
            a_str = f"{authors[0][0]}, {authors[0][1]} & {authors[1][0]}, {authors[1][1]}"
        else:
            init_parts = [f"{a[0]}, {a[1]}" for a in authors[:-1]]
            a_str = ", ".join(init_parts) + f" & {authors[-1][0]}, {authors[-1][1]}"
        doi_str = f" doi:{doi}" if doi else ""
        return f"{idx}. {a_str} {title}. {venue_abbr} {vol}, {pages} ({year}).{doi_str}"

    if style == "CSE":
        a_parts = [f"{a[0]} {a[1].replace('.', '').replace(' ', '')}" for a in authors]
        a_str = ", ".join(a_parts)
        doi_str = f" doi:{doi}." if doi else ""
        return f"{a_str}. {year}. {title}. {venue_abbr}. {vol}({issue}):{pages}.{doi_str}"

    if style == "ACS":
        a_parts = [f"{a[0]}, {a[1]}" for a in authors]
        a_str = "; ".join(a_parts)
        doi_str = f" doi:{doi}." if doi else ""
        return f"({idx}) {a_str} {title}. {venue_abbr} {year}, {vol} ({issue}), {pages}.{doi_str}"

    if style == "AMA":
        a_parts = [f"{a[0]} {a[1].replace('.', '').replace(' ', '')}" for a in authors]
        a_str = ", ".join(a_parts)
        doi_str = f" doi:{doi}" if doi else ""
        return f"{idx}. {a_str}. {title}. {venue_abbr}. {year};{vol}({issue}):{pages}.{doi_str}"

    raise ValueError(f"Unsupported style: {style}")


def format_resource_ref(style: str, idx: int, spec: dict[str, Any]) -> str:
    """Format a technical standard / online guideline reference that triggers ValidationLabel.RESOURCE."""
    authors = spec["authors"]
    year = spec["year"]
    title = spec["title"]  # Contains 'NIST Special Publication ... [Online]' without colons
    publisher = spec.get("venue", "National Institute of Standards and Technology")

    if style == "APA":
        a_str = f"{authors[0][0]}, {authors[0][1]}, & {authors[1][0]}, {authors[1][1]}"
        return f"{a_str} ({year}). {title}. {publisher}."
    if style == "IEEE":
        a_str = f"{authors[0][1]} {authors[0][0]} and {authors[1][1]} {authors[1][0]}"
        return f"[{idx}] {a_str}, \"{title},\" M.S. thesis, {publisher}, {year}."
    if style == "Vancouver":
        a_str = f"{authors[0][0]} {authors[0][1].replace('.', '')}, {authors[1][0]} {authors[1][1].replace('.', '')}"
        return f"{idx}. {a_str}. {title}. {publisher}. {year};12(1):1-50."
    if style == "Chicago":
        a_str = f"{authors[0][0]}, {authors[0][2]}, and {authors[1][2]} {authors[1][0]}"
        return f"{a_str}. {year}. \"{title}.\" {publisher} 12 (1): 1-50."
    if style == "Harvard":
        a_str = f"{authors[0][0]}, {authors[0][1]} and {authors[1][0]}, {authors[1][1]}"
        return f"{a_str} ({year}) '{title}', {publisher}, 12, 50."
    if style == "MLA":
        a_str = f"{authors[0][0]}, {authors[0][2]}, and {authors[1][2]} {authors[1][0]}"
        return f"{a_str}. {title}. {publisher}, {year}."
    if style == "ACM":
        a_str = f"{authors[0][2]} {authors[0][0]} and {authors[1][2]} {authors[1][0]}"
        return f"[{idx}] {a_str}. {year}. {title}. {publisher}, Gaithersburg, MD."
    if style == "Nature":
        a_str = f"{authors[0][0]}, {authors[0][1]} & {authors[1][0]}, {authors[1][1]}"
        return f"{idx}. {a_str} {title}. {publisher} 12, 1-50 ({year})."
    if style == "CSE":
        a_str = f"{authors[0][0]} {authors[0][1].replace('.', '')}, {authors[1][0]} {authors[1][1].replace('.', '')}"
        return f"{a_str}. {year}. {title}. {publisher}. 12(1):1-50."
    if style == "ACS":
        a_str = f"{authors[0][0]}, {authors[0][1]}; {authors[1][0]}, {authors[1][1]}"
        return f"({idx}) {a_str} {title}; {publisher}: Gaithersburg, {year}."
    if style == "AMA":
        a_str = f"{authors[0][0]} {authors[0][1].replace('.', '')}, {authors[1][0]} {authors[1][1].replace('.', '')}"
        return f"{idx}. {a_str}. {title}. {publisher}; {year}."
    raise ValueError(f"Unsupported style: {style}")


def format_unresolved_ref(style: str, idx: int, spec: dict[str, Any]) -> str:
    """Format an unindexed book/monograph/thesis reference that triggers ValidationLabel.UNRESOLVED."""
    authors = spec["authors"]
    year = spec["year"]
    title = spec["title"]
    publisher = spec.get("venue", "Oxford University Press")

    if style == "APA":
        a_str = f"{authors[0][0]}, {authors[0][1]}, & {authors[1][0]}, {authors[1][1]}"
        return f"{a_str} ({year}). {title}. {publisher}."
    if style == "IEEE":
        a_str = f"{authors[0][1]} {authors[0][0]} and {authors[1][1]} {authors[1][0]}"
        return f"[{idx}] {a_str}, \"{title},\" M.S. thesis, {publisher}, {year}."
    if style == "Vancouver":
        a_str = f"{authors[0][0]} {authors[0][1].replace('.', '')}, {authors[1][0]} {authors[1][1].replace('.', '')}"
        return f"{idx}. {a_str}. {title}. {publisher}. {year};12(1):1-50."
    if style == "Chicago":
        a_str = f"{authors[0][0]}, {authors[0][2]}, and {authors[1][2]} {authors[1][0]}"
        return f"{a_str}. {year}. \"{title}.\" Master's thesis, {publisher}."
    if style == "Harvard":
        a_str = f"{authors[0][0]}, {authors[0][1]} and {authors[1][0]}, {authors[1][1]}"
        return f"{a_str} ({year}) '{title}', {publisher}, 12, 45."
    if style == "MLA":
        a_str = f"{authors[0][0]}, {authors[0][2]}, and {authors[1][2]} {authors[1][0]}"
        return f"{a_str}. {title}. {publisher}, {year}."
    if style == "ACM":
        a_str = f"{authors[0][2]} {authors[0][0]} and {authors[1][2]} {authors[1][0]}"
        return f"[{idx}] {a_str}. {year}. {title}. {publisher}, Oxford, UK."
    if style == "Nature":
        a_str = f"{authors[0][0]}, {authors[0][1]} & {authors[1][0]}, {authors[1][1]}"
        return f"{idx}. {a_str} {title} ({publisher}, {year})."
    if style == "CSE":
        a_str = f"{authors[0][0]} {authors[0][1].replace('.', '')}, {authors[1][0]} {authors[1][1].replace('.', '')}"
        return f"{a_str}. {year}. {title}. {publisher}. 12(1):1-50."
    if style == "ACS":
        a_str = f"{authors[0][0]}, {authors[0][1]}; {authors[1][0]}, {authors[1][1]}"
        return f"({idx}) {a_str} {title}; {publisher}: Oxford, {year}."
    if style == "AMA":
        a_str = f"{authors[0][0]} {authors[0][1].replace('.', '')}, {authors[1][0]} {authors[1][1].replace('.', '')}"
        return f"{idx}. {a_str}. {title}. {publisher}; {year}."
    raise ValueError(f"Unsupported style: {style}")


def format_intext(style: str, idx: int, spec: dict[str, Any], page: int = 14) -> str:
    """Return an authentic in-text citation marker for <style>."""
    authors = spec["authors"]
    year = spec["year"]
    last0 = authors[0][0]

    if style in ("APA", "Harvard"):
        if len(authors) == 1:
            return f"({last0}, {year})"
        if len(authors) == 2:
            amp = "&" if style == "APA" else "and"
            return f"({last0} {amp} {authors[1][0]}, {year})"
        return f"({last0} et al., {year})"

    if style == "Chicago":
        if len(authors) == 1:
            return f"({last0} {year}, {page})"
        if len(authors) == 2:
            return f"({last0} and {authors[1][0]} {year}, {page})"
        return f"({last0} et al. {year}, {page})"

    if style == "CSE":
        if len(authors) == 1:
            return f"({last0} {year})"
        if len(authors) == 2:
            return f"({last0} and {authors[1][0]} {year})"
        return f"({last0} et al. {year})"

    if style == "MLA":
        if len(authors) == 1:
            return f"({last0} {page})"
        if len(authors) == 2:
            return f"({last0} and {authors[1][0]} {page})"
        return f"({last0} et al. {page})"

    if style in ("IEEE", "Vancouver", "ACM"):
        return f"[{idx}]"

    if style in ("Nature", "ACS", "AMA"):
        return f"^{idx}"

    raise ValueError(f"Unsupported style: {style}")


def attach_marker(style: str, phrase: str, marker: str) -> str:
    """Attach a citation marker to a sentence clause using authentic spacing for caret vs bracket/paren."""
    if style in ("Nature", "ACS", "AMA"):
        return f"{phrase}{marker}."
    return f"{phrase} {marker}."


def get_ref_section_heading(style: str) -> str:
    if style == "MLA":
        return "Works Cited"
    return "References"


# ==============================================================================
# CANONICAL REFERENCE SPECS FOR THE 5 HARD-CASE ARCHETYPES (11 ACADEMIC STYLES)
# ==============================================================================

VERIFIED_SPECS: list[dict[str, Any]] = [
    {
        "key": "vaswani2017",
        "authors": [("Vaswani", "A.", "Ashish"), ("Shazeer", "N.", "Noam"), ("Parmar", "N.", "Niki")],
        "year": 2017,
        "title": "Attention is all you need",
        "venue": "Advances in Neural Information Processing Systems",
        "venue_abbr": "Adv. Neural Inf. Process. Syst.",
        "vol": "30",
        "issue": "1",
        "pages": "5998-6008",
        "doi": "10.48550/arXiv.1706.03762",
        "expected_verdict": "VERIFIED",
    },
    {
        "key": "devlin2019",
        "authors": [("Devlin", "J.", "Jacob"), ("Chang", "M.", "Ming-Wei"), ("Lee", "K.", "Kenton")],
        "year": 2019,
        "title": "BERT: Pre-training of deep bidirectional transformers for language understanding",
        "venue": "Proceedings of the Conference of the North American Chapter of the Association for Computational Linguistics",
        "venue_abbr": "Proc. Conf. North Am. Chapter Assoc. Comput. Linguist.",
        "vol": "1",
        "issue": "1",
        "pages": "4171-4186",
        "doi": "10.18653/v1/N19-1423",
        "expected_verdict": "VERIFIED",
    },
    {
        "key": "he2016",
        "authors": [("He", "K.", "Kaiming"), ("Zhang", "X.", "Xiangyu"), ("Ren", "S.", "Shaoqing")],
        "year": 2016,
        "title": "Deep residual learning for image recognition",
        "venue": "Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition",
        "venue_abbr": "Proc. IEEE Conf. Comput. Vis. Pattern Recognit.",
        "vol": "1",
        "issue": "1",
        "pages": "770-778",
        "doi": "10.1109/CVPR.2016.90",
        "expected_verdict": "VERIFIED",
    },
    {
        "key": "hochreiter1997",
        "authors": [("Hochreiter", "S.", "Sepp"), ("Schmidhuber", "J.", "Juergen")],
        "year": 1997,
        "title": "Long short-term memory",
        "venue": "Neural Computation",
        "venue_abbr": "Neural Comput.",
        "vol": "9",
        "issue": "8",
        "pages": "1735-1780",
        "doi": "10.1162/neco.1997.9.8.1735",
        "expected_verdict": "VERIFIED",
    },
    {
        "key": "lecun2015",
        "authors": [("LeCun", "Y.", "Yann"), ("Bengio", "Y.", "Yoshua"), ("Hinton", "G.", "Geoffrey")],
        "year": 2015,
        "title": "Deep learning",
        "venue": "Nature",
        "venue_abbr": "Nature",
        "vol": "521",
        "issue": "7553",
        "pages": "436-444",
        "doi": "10.1038/nature14539",
        "expected_verdict": "VERIFIED",
    },
    {
        "key": "brown2020",
        "authors": [("Brown", "T.", "Tom"), ("Mann", "B.", "Benjamin"), ("Ryder", "N.", "Nick")],
        "year": 2020,
        "title": "Language models are few-shot learners",
        "venue": "Advances in Neural Information Processing Systems",
        "venue_abbr": "Adv. Neural Inf. Process. Syst.",
        "vol": "33",
        "issue": "1",
        "pages": "1877-1901",
        "doi": "10.48550/arXiv.2005.14165",
        "expected_verdict": "VERIFIED",
    },
]

RESOURCE_SPECS: list[dict[str, Any]] = [
    {
        "key": "grassi2017_nist",
        "kind": "resource",
        "authors": [("Grassi", "P.", "Paul"), ("Garcia", "M.", "Michael")],
        "year": 2017,
        "title": "NIST Special Publication 800-63B Digital Identity Guidelines [Online]",
        "venue": "National Institute of Standards and Technology",
        "expected_verdict": "RESOURCE",
    },
    {
        "key": "ietf2018_rfc",
        "kind": "resource",
        "authors": [("Rescorla", "E.", "Eric"), ("Dierks", "T.", "Tim")],
        "year": 2018,
        "title": "RFC 8446 The Transport Layer Security Protocol Version 1.3 [Online]",
        "venue": "Internet Engineering Task Force Standards Track",
        "expected_verdict": "RESOURCE",
    },
]

METADATA_ERROR_SPECS: list[dict[str, Any]] = [
    {
        "key": "vaswani_wrong_year",
        "authors": [("Vaswani", "A.", "Ashish"), ("Shazeer", "N.", "Noam"), ("Parmar", "N.", "Niki")],
        "year": 2020,  # Wrong year (actual: 2017) -> METADATA_ERROR
        "title": "Attention is all you need",
        "venue": "Advances in Neural Information Processing Systems",
        "venue_abbr": "Adv. Neural Inf. Process. Syst.",
        "vol": "30",
        "issue": "1",
        "pages": "5998-6008",
        "doi": "10.48550/arXiv.1706.03762",
        "expected_verdict": "METADATA_ERROR",
        "anomaly": "Year shifted by +3 years (2020 vs 2017) with exact DOI and authors",
    },
    {
        "key": "devlin_wrong_authors",
        "authors": [("Sutskever", "I.", "Ilya"), ("Vinyals", "O.", "Oriol"), ("Le", "Q.", "Quoc")],
        "year": 2019,  # Wrong author list on BERT paper -> METADATA_ERROR
        "title": "BERT: Pre-training of deep bidirectional transformers for language understanding",
        "venue": "Proceedings of the Conference of the North American Chapter of the Association for Computational Linguistics",
        "venue_abbr": "Proc. Conf. North Am. Chapter Assoc. Comput. Linguist.",
        "vol": "1",
        "issue": "1",
        "pages": "4171-4186",
        "doi": "10.18653/v1/N19-1423",
        "expected_verdict": "METADATA_ERROR",
        "anomaly": "Completely replaced author list on real title/DOI (Devlin et al. replaced by Sutskever et al.)",
    },
    {
        "key": "he_wrong_venue_year",
        "authors": [("He", "K.", "Kaiming"), ("Zhang", "X.", "Xiangyu"), ("Ren", "S.", "Shaoqing")],
        "year": 2018,  # Wrong year (2018 vs 2016) & wrong venue -> METADATA_ERROR
        "title": "Deep residual learning for image recognition",
        "venue": "Journal of Machine Learning Research",
        "venue_abbr": "J. Mach. Learn. Res.",
        "vol": "19",
        "issue": "2",
        "pages": "770-778",
        "doi": "10.1109/CVPR.2016.90",
        "expected_verdict": "METADATA_ERROR",
        "anomaly": "Year shifted (2018 vs 2016) and venue changed from CVPR to JMLR",
    },
    {
        "key": "hochreiter_partial_author_year",
        "authors": [("Hochreiter", "S.", "Sepp"), ("bengio", "Y.", "Yoshua")],
        "year": 1999,  # Co-author swapped and year shifted (1999 vs 1997) -> METADATA_ERROR
        "title": "Long short-term memory",
        "venue": "Neural Computation",
        "venue_abbr": "Neural Comput.",
        "vol": "9",
        "issue": "8",
        "pages": "1735-1780",
        "doi": "10.1162/neco.1997.9.8.1735",
        "expected_verdict": "METADATA_ERROR",
        "anomaly": "Second author Schmidhuber replaced by Bengio and year shifted (1999 vs 1997)",
    },
]

HALLUCINATION_SPECS: list[dict[str, Any]] = [
    {
        "key": "chimera_vaswani_he",
        "authors": [("Vaswani", "A.", "Ashish"), ("Shazeer", "N.", "Noam"), ("Parmar", "N.", "Niki")],
        "year": 2017,
        "title": "Hyperbolic quantum graph topology for autonomous underwater swarm navigation",
        "venue": "Advances in Neural Information Processing Systems",
        "venue_abbr": "Adv. Neural Inf. Process. Syst.",
        "vol": "30",
        "issue": "1",
        "pages": "5998-6008",
        "doi": "10.1109/CVPR.2016.90",  # Real DOI of He et al. (2016) attached to fabricated title -> HALLUCINATION
        "expected_verdict": "HALLUCINATION",
        "anomaly": "Chimera citation: real DOI (10.1109/CVPR.2016.90, He et al.) paired with Vaswani authors and fabricated title",
    },
    {
        "key": "fabricated_doi_9999",
        "authors": [("Thorne", "V.", "Victor"), ("Blackwood", "E.", "Eleanor")],
        "year": 2022,
        "title": "Stochastic eigen-embeddings in non-abelian transformer manifolds",
        "venue": "Journal of Quantum Computational Intelligence",
        "venue_abbr": "J. Quantum Comput. Intell.",
        "vol": "14",
        "issue": "3",
        "pages": "201-219",
        "doi": "10.9999/jqci.2022.999999",  # Explicit fabricated DOI prefix 10.9999 -> HALLUCINATION
        "expected_verdict": "HALLUCINATION",
        "anomaly": "Fabricated DOI prefix 10.9999/jqci.2022.999999 with non-existent journal and title",
    },
    {
        "key": "fake_author_placeholder",
        "authors": [("Doe", "J.", "John"), ("Smith", "J.", "Jane")],
        "year": 2023,
        "title": "Placeholder neural architectures for synthetic benchmark evaluation",
        "venue": "International Journal of Testing Systems",
        "venue_abbr": "Int. J. Test. Syst.",
        "vol": "5",
        "issue": "1",
        "pages": "10-25",
        "doi": "10.1234/fake.2023.0001",  # Known fake DOI + John Doe / Jane Smith -> HALLUCINATION
        "expected_verdict": "HALLUCINATION",
        "anomaly": "Placeholder fake author names (John Doe, Jane Smith) and fabricated DOI 10.1234/fake",
    },
    {
        "key": "nonexistent_journal_article",
        "authors": [("Kowalski", "M.", "Marek"), ("Vandenberg", "L.", "Lucas")],
        "year": 2021,
        "title": "Sub-Planckian attention kernels in relativistic sequence transduction",
        "venue": "Journal of Hyperdimensional Computing Research",
        "venue_abbr": "J. Hyperdimens. Comput. Res.",
        "vol": "8",
        "issue": "4",
        "pages": "412-439",
        "doi": "10.5555/nonexistent.2021.88412",
        "expected_verdict": "NOT_FOUND",
        "anomaly": "Completely fabricated periodical article not present in any bibliographic index",
    },
    {
        "key": "chimera_bert_doi_wrong_title",
        "authors": [("Devlin", "J.", "Jacob"), ("Chang", "M.", "Ming-Wei")],
        "year": 2019,
        "title": "Magnetohydrodynamic turbulence modeling in galactic plasma filaments",
        "venue": "Astrophysical Journal Letters",
        "venue_abbr": "Astrophys. J. Lett.",
        "vol": "880",
        "issue": "2",
        "pages": "110-125",
        "doi": "10.18653/v1/N19-1423",  # BERT DOI attached to astrophysics title -> HALLUCINATION
        "expected_verdict": "HALLUCINATION",
        "anomaly": "Real ACL Anthology DOI (10.18653/v1/N19-1423) paired with completely unrelated astrophysics title",
    },
]

UNRESOLVED_SPECS: list[dict[str, Any]] = [
    {
        "key": "lindqvist2021_monograph",
        "kind": "unresolved",
        "authors": [("Lindqvist", "K.", "Katarzyna"), ("Sorensen", "S.", "Soren")],
        "year": 2021,
        "title": "Regional monograph on computational linguistics and Baltic syntax",
        "venue": "Oxford University Press",
        "expected_verdict": "UNRESOLVED",
    },
    {
        "key": "zimmermann2019_press",
        "kind": "unresolved",
        "authors": [("Zimmermann", "H.", "Heinrich"), ("Falkenberg", "A.", "anna")],
        "year": 2019,
        "title": "Historical epistemology of symbolic automata in Central Europe",
        "venue": "Cambridge University Press",
        "expected_verdict": "UNRESOLVED",
    },
]

UNICODE_EDGE_SPECS: list[dict[str, Any]] = [
    {
        "key": "poplawska2020",
        "authors": [("Popławska-Domaszewicz", "K.", "Katarzyna"), ("Præstholm", "S.", "Søren")],
        "year": 2020,
        "title": "Cross-lingual morphological disambiguation under diacritic perturbation",
        "venue": "Transactions of the Association for Computational Linguistics",
        "venue_abbr": "Trans. Assoc. Comput. Linguist.",
        "vol": "8",
        "issue": "1",
        "pages": "140-156",
        "doi": "10.1162/tacl_a_00305",
        "expected_verdict": "METADATA_ERROR",
    },
    {
        "key": "muller2018",
        "authors": [("Müller-Schöll", "F.", "Friedrich"), ("Østergaard", "L.", "Lars")],
        "year": 2018,
        "title": "Variational inference on Riemannian manifolds with non-Euclidean priors",
        "venue": "Journal of Machine Learning Research",
        "venue_abbr": "J. Mach. Learn. Res.",
        "vol": "19",
        "issue": "1",
        "pages": "210-235",
        "doi": "10.5555/3291125.3291140",
        "expected_verdict": "NOT_FOUND",
    },
]


def _build_academic_prose_blocks(cite_tokens: list[str], style: str) -> list[tuple[str, list[str]]]:
    """Generate 4 academic sections with rich multi-page prose (~950 words) so the PDF spans 3-4 pages."""
    def c(i: int, phrase: str) -> str:
        tok = cite_tokens[i % len(cite_tokens)]
        return attach_marker(style, phrase, tok)

    sec1 = [
        (
            "Modern neural sequence transduction and representation learning rely on rigorous empirical "
            "benchmarks to evaluate structural generalization across heterogeneous domains. "
            + c(0, "Foundational self-attention architectures established that dispensing with recurrence enables parallelizable dependency modeling across long token horizons")
            + " Subsequent investigations into bidirectional pre-training demonstrated that masked language "
            "objectives capture deep syntactic and semantic hierarchies transferable to downstream tasks. "
            + c(1, "In particular, pre-trained encoder representations have reshaped natural language understanding benchmarks")
            + " Across computer vision and multimodal perception, hierarchical residual connections mitigate "
            "vanishing gradients in ultra-deep convolutional and transformer backbones, ensuring stable "
            "hessian conditioning throughout optimization trajectories."
        ),
        (
            "When evaluating scholarly manuscripts for citation integrity, automated verification pipelines "
            "must simultaneously parse surface typography, segment document zones, and cross-reference "
            "bibliographic assertions against authoritative metadata registries. "
            + c(2, "Residual learning frameworks provide a canonical testbed for verifying high-impact conference proceedings")
            + " Furthermore, classical recurrent gating mechanisms remain essential baselines for temporal "
            "credit assignment over sequential state spaces. "
            + c(3, "Long short-term memory networks introduced constant error carousels that preserve gradient flow over hundreds of discrete time steps")
            + " By synthesizing insights from both classical gated recurrence and contemporary attention "
            "mechanisms, researchers construct hybrid verification models capable of detecting subtle "
            "bibliographic distortions."
        ),
        (
            "In addition to peer-reviewed periodical literature, technical system architectures frequently "
            "incorporate normative cryptographic standards, institutional guidelines, and regional monographs. "
            + c(4, "Multi-layer representation learning continues to unify statistical pattern recognition across speech, vision, and text")
            + " Scaling autoregressive parameter counts by orders of magnitude further unlocks emergent "
            "in-context few-shot reasoning without task-specific gradient updates. "
            + c(5, "Large-scale autoregressive language models exhibit remarkable few-shot adaptability across diverse evaluation suites")
            + " Consequently, citation audit frameworks must distinguish legitimate non-article technical "
            "resources from fabricated or chimeric scholarly references."
        ),
    ]

    sec2 = [
        (
            "Our methodological framework decomposes bibliographic verification into four sequential stages: "
            "document zone segmentation, style-aware regular expression extraction, bipartite citation-to-reference "
            "graph linking, and multi-source symbolic rule evaluation. "
            + c(6 % len(cite_tokens), "Normative identity and cryptographic specifications define strict compliance boundaries for distributed verification services")
            + " During document ingestion, coordinate-aware layout analysis separates running headers, "
            "page footers, and marginalia from primary body paragraphs and terminal bibliography blocks. "
            "Each candidate reference string is normalized into structured author surname tokens, "
            "publication years, title n-grams, venue descriptors, and persistent digital object identifiers."
        ),
        (
            "To guarantee deterministic reproducibility across eleven international citation conventions, "
            "the parser evaluates prioritized format grammars spanning author-date, bracketed numeric, "
            "parenthesized numeric, and superscripted numeric paradigms. "
            + c(7 % len(cite_tokens), "Protocol-level transport security standards further constrain metadata exchange across federated scholarly APIs")
            + " When an in-text citation marker is extracted from body prose, the linking engine resolves "
            "its target bibliography entry using either explicit numeric index matching or fuzzy author-year "
            "compatibility scoring. Ambiguous multi-entry collisions, orphan citations lacking bibliography "
            "records, and uncited bibliography entries are explicitly flagged in the resulting audit graph."
        ),
        (
            "Beyond structural linking, candidate retrieval queries local SQLite indices Alongside external "
            "scholarly registries including Crossref, OpenAlex, Semantic Scholar, arXiv, and PubMed. "
            + c(0, "Empirical ablations confirm that multi-head attention representations remain sensitive to token-level metadata perturbations")
            + " Fuzzy string similarity metrics—combining token-sort ratios, Jaccard author overlap, "
            "and publication year tolerances—quantify alignment between extracted reference fields and "
            "retrieved ground-truth records. Symbolic decision rules then assign calibrated validation "
            "verdicts ranging from verified and metadata error to hallucination, resource, and unresolved."
        ),
    ]

    sec3 = [
        (
            "Stress-testing citation verification requires adversarial synthetic corpora that exercise "
            "every boundary condition of the symbolic rule engine. In metadata mismatch scenarios, "
            "authentic digital object identifiers are paired with shifted publication years, substituted "
            "co-author lists, or altered journal venues. "
            + c(1, "Bidirectional transformer encoders exhibit measurable degradation when fine-tuned on noisy supervision signals")
            + " Conversely, chimeric hallucinations graft a legitimate identifier from one domain onto "
            "an entirely fabricated title and author list from another discipline, testing whether "
            "the verifier enforces joint title-and-DOI consistency rather than trusting identifier lookup alone."
        ),
        (
            "Linking anomalies represent a distinct failure mode wherein body prose references non-existent "
            "bibliography indices or cites prolific authors with multiple same-year publications without "
            "disambiguating suffixes. "
            + c(2, "Deep residual networks demonstrate that identity shortcut connections preserve feature expressivity across stacked layers")
            + " Similarly, duplicate reference detection must identify redundant bibliography entries "
            "that share normalized author-year-title signatures despite minor punctuation or casing "
            "divergences. "
            + c(3, "Gated memory cells provide a formal mechanism for selective information retention over extended trajectories")
            + " Our experimental protocol systematically injects each of these structural anomalies "
            "into multi-page documents formatted under strict stylistic constraints."
        ),
        (
            "Finally, international scholarly communication routinely incorporates European diacritics, "
            "compound hyphenated surnames, and non-indexed university press monographs. "
            + c(4, "Hierarchical representation learning bridges low-level sensory signals and high-level symbolic abstractions")
            + " Standard ASCII-only regular expressions frequently fail to tokenize Polish, Scandinavian, "
            "or German orthography, prematurely truncating author lists or misclassifying citation styles. "
            + c(5, "Few-shot prompting strategies highlight both the capabilities and the hallucination risks of foundation models")
            + " By embedding Unicode-rich citations and unindexed monographs directly into our benchmark "
            "corpora, we verify end-to-end resilience from PDF glyph extraction through final verdict assignment."
        ),
    ]

    sec4 = [
        (
            "In conclusion, comprehensive evaluation of automated essay integrity checkers demands "
            "multi-page, stylistically faithful PDF benchmarks paired with machine-readable ground truth. "
            + c(0, "Self-attention mechanisms continue to serve as the architectural cornerstone of modern language processing")
            + " By unifying verified seminal literature, normative technical resources, controlled metadata "
            "corruptions, chimeric hallucinations, linking anomalies, and Unicode edge cases across "
            "all eleven academic citation styles, this corpus establishes a rigorous foundation for "
            "regression testing and quantitative accuracy auditing."
        ),
    ]

    return [
        ("1. Introduction and Theoretical Background", sec1),
        ("2. Methodological Architecture and Verification Pipeline", sec2),
        ("3. Adversarial Stress-Testing and Anomaly Taxonomy", sec3),
        ("4. Conclusion and Benchmark Summary", sec4),
    ]


def build_style_corpus_specs(style: str) -> list[dict[str, Any]]:
    """Build the 5 hard-case document specifications for a given academic citation style."""
    ref_heading = get_ref_section_heading(style)

    # ---- HARD 01: Verified Seminal Papers + Non-Journal Resources ----
    h1_specs = VERIFIED_SPECS[:5] + RESOURCE_SPECS[:2]
    h1_refs = [format_article_ref(style, i + 1, sp) for i, sp in enumerate(h1_specs)]
    h1_tokens = [format_intext(style, i + 1, sp, page=10 + i * 3) for i, sp in enumerate(h1_specs)]
    h1_sections = _build_academic_prose_blocks(h1_tokens, style)

    # ---- HARD 02: Metadata Errors and Mismatches ----
    h2_specs = VERIFIED_SPECS[:2] + METADATA_ERROR_SPECS
    h2_refs = [format_article_ref(style, i + 1, sp) for i, sp in enumerate(h2_specs)]
    h2_tokens = [format_intext(style, i + 1, sp, page=15 + i * 4) for i, sp in enumerate(h2_specs)]
    h2_sections = _build_academic_prose_blocks(h2_tokens, style)

    # ---- HARD 03: Hallucinations, Chimera Citations, and Fabricated DOIs ----
    h3_specs = [VERIFIED_SPECS[0]] + HALLUCINATION_SPECS
    h3_refs = [format_article_ref(style, i + 1, sp) for i, sp in enumerate(h3_specs)]
    h3_tokens = [format_intext(style, i + 1, sp, page=20 + i * 5) for i, sp in enumerate(h3_specs)]
    h3_sections = _build_academic_prose_blocks(h3_tokens, style)

    # ---- HARD 04: Linking Anomalies (Matched, Missing Ref, Uncited Ref, Ambiguous, Duplicate) ----
    # Bib entries:
    # 1. Vaswani 2017 (Cited -> MATCHED)
    # 2. Devlin 2019 (Cited -> MATCHED)
    # 3. Devlin 2019 DUPLICATE (Exact/Near-exact duplicate in bibliography -> DUPLICATE)
    # 4. Wang, A. (2020) Paper Alpha (Ambiguous for author-year (Wang et al., 2020))
    # 5. Wang, A. (2020) Paper Beta (Ambiguous for author-year (Wang et al., 2020))
    # 6. Hochreiter 1997 (UNCITED_REF - never cited in body text!)
    # 7. LeCun 2015 (UNCITED_REF - never cited in body text!)
    wang_alpha = {
        "key": "wang2020_alpha",
        "authors": [("Wang", "A.", "Alex"), ("Pruksachatkun", "Y.", "Yada"), ("Nangia", "N.", "Nikita")],
        "year": 2020,
        "title": "SuperGLUE: A stickier benchmark for general-purpose language understanding systems",
        "venue": "Advances in Neural Information Processing Systems",
        "venue_abbr": "Adv. Neural Inf. Process. Syst.",
        "vol": "32",
        "issue": "1",
        "pages": "3261-3275",
        "doi": "10.48550/arXiv.1905.00537",
        "expected_verdict": "METADATA_ERROR",
    }
    wang_beta = {
        "key": "wang2020_beta",
        "authors": [("Wang", "A.", "Alex"), ("Singh", "A.", "Amanpreet"), ("Michael", "J.", "Julian")],
        "year": 2020,
        "title": "GLUE: A multi-task benchmark and analysis platform for natural language understanding",
        "venue": "Proceedings of the International Conference on Learning Representations",
        "venue_abbr": "Proc. Int. Conf. Learn. Represent.",
        "vol": "7",
        "issue": "1",
        "pages": "100-118",
        "doi": "10.18653/v1/W18-5446",
        "expected_verdict": "METADATA_ERROR",
    }
    devlin_dup = {
        "key": "devlin2019_dup",
        "authors": [("Devlin", "J.", "Jacob"), ("Chang", "M.", "Ming-Wei"), ("Lee", "K.", "Kenton")],
        "year": 2019,
        "title": "BERT: Pre-training of deep bidirectional transformers for language understanding",
        "venue": "Proceedings of NAACL-HLT",
        "venue_abbr": "Proc. NAACL-HLT",
        "vol": "1",
        "issue": "1",
        "pages": "4171-4186",
        "doi": "10.18653/v1/N19-1423",
        "expected_verdict": "VERIFIED",
    }
    h4_specs = [
        VERIFIED_SPECS[0],  # [1] Vaswani 2017 (cited)
        VERIFIED_SPECS[1],  # [2] Devlin 2019 (cited)
        devlin_dup,         # [3] Devlin 2019 DUPLICATE (same DOI/title/authors/year, distinct line-wrap)
        wang_alpha,         # [4] Wang et al. 2020 Alpha
        wang_beta,          # [5] Wang et al. 2020 Beta
        VERIFIED_SPECS[3],  # [6] Hochreiter 1997 (UNCITED)
        VERIFIED_SPECS[4],  # [7] LeCun 2015 (UNCITED)
    ]
    h4_refs = [format_article_ref(style, i + 1, sp) for i, sp in enumerate(h4_specs)]
    # In-text citations for hard_04:
    # - Cite #1 (Vaswani 2017 -> MATCHED)
    # - Cite #2 (Devlin 2019 -> MATCHED / AMBIGUOUS due to duplicate)
    # - Cite #4 (Wang et al. 2020 -> AMBIGUOUS in author-year styles, MATCHED in numeric)
    # - Orphan citation #1: (Ghostauthor et al., 2024) or [99] or ^99 -> MISSING_REF
    # - Orphan citation #2: (Phantom & Specter, 2023) or [88] or ^88 -> MISSING_REF
    orphan_spec_1 = {
        "authors": [("Ghostauthor", "G.", "Gregory"), ("Nonexistent", "N.", "Nathan"), ("Void", "V.", "Victor")],
        "year": 2024,
    }
    orphan_spec_2 = {
        "authors": [("Phantom", "P.", "patrick"), ("Specter", "S.", "Simon")],
        "year": 2023,
    }
    h4_tokens = [
        format_intext(style, 1, h4_specs[0], page=12),
        format_intext(style, 2, h4_specs[1], page=18),
        format_intext(style, 4, h4_specs[3], page=24),
        format_intext(style, 99, orphan_spec_1, page=45),
        format_intext(style, 88, orphan_spec_2, page=62),
        format_intext(style, 1, h4_specs[0], page=70),
    ]
    h4_sections = _build_academic_prose_blocks(h4_tokens, style)

    # ---- HARD 05: Extreme Edge Cases (Unicode Diacritics, Multi-Citation Clusters, Books/Theses -> UNRESOLVED) ----
    h5_specs = [
        VERIFIED_SPECS[0],      # [1] Vaswani 2017 -> VERIFIED
        VERIFIED_SPECS[2],      # [2] He 2016 -> VERIFIED
        UNICODE_EDGE_SPECS[0],  # [3] Popławska-Domaszewicz & Præstholm 2020 -> METADATA_ERROR
        UNICODE_EDGE_SPECS[1],  # [4] Müller-Schöll & Østergaard 2018 -> NOT_FOUND
        UNRESOLVED_SPECS[0],    # [5] Lindqvist & Sorensen 2021 (Oxford Univ Press) -> UNRESOLVED
        UNRESOLVED_SPECS[1],    # [6] Zimmermann & Falkenberg 2019 (Cambridge Univ Press) -> UNRESOLVED
        RESOURCE_SPECS[0],      # [7] Grassi & Garcia 2017 (NIST 800-63B [Online]) -> RESOURCE
    ]
    h5_refs = [format_article_ref(style, i + 1, sp) for i, sp in enumerate(h5_specs)]
    h5_tokens = [format_intext(style, i + 1, sp, page=11 + i * 3) for i, sp in enumerate(h5_specs)]
    h5_sections = _build_academic_prose_blocks(h5_tokens, style)

    return [
        {
            "filename": "hard_01_verified_and_resource.pdf",
            "title": f"[{style} Benchmark 01] Verified Seminal Literature and Normative Technical Resources",
            "subtitle": f"Synthetic Multi-Page Evaluation Corpus — Citation Style: {style}",
            "abstract_title": "Abstract",
            "abstract_text": (
                f"This document evaluates baseline extraction, {style} style classification, bipartite linking, "
                "and multi-source verification on five authentic seminal machine learning publications paired "
                "with two normative technical standards that should resolve to RESOURCE."
            ),
            "sections": h1_sections,
            "ref_heading": ref_heading,
            "references": h1_refs,
            "specs": h1_specs,
            "expected_style": style,
            "scenario": "verified_and_resource",
            "expected_verdicts": [sp["expected_verdict"] for sp in h1_specs],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "5 VERIFIED seminal papers from local_papers.db + 2 RESOURCE standards (NIST / RFC).",
        },
        {
            "filename": "hard_02_metadata_errors_and_mismatch.pdf",
            "title": f"[{style} Benchmark 02] Controlled Metadata Perturbations and Partial Field Mismatches",
            "subtitle": f"Synthetic Multi-Page Evaluation Corpus — Citation Style: {style}",
            "abstract_title": "Abstract",
            "abstract_text": (
                f"This document stress-tests {style} citation verification against controlled metadata corruptions, "
                "including publication year shifts (+2 to +3 years), substituted author lists on real DOIs, "
                "and altered journal venues alongside verified control references."
            ),
            "sections": h2_sections,
            "ref_heading": ref_heading,
            "references": h2_refs,
            "specs": h2_specs,
            "expected_style": style,
            "scenario": "metadata_errors_and_mismatch",
            "expected_verdicts": [sp["expected_verdict"] for sp in h2_specs],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "2 VERIFIED controls + 4 METADATA_ERROR entries (year shift, author swap, venue mismatch).",
        },
        {
            "filename": "hard_03_hallucinations_and_chimera.pdf",
            "title": f"[{style} Benchmark 03] Chimeric Citations, Fabricated DOIs, and Non-Existent Periodicals",
            "subtitle": f"Synthetic Multi-Page Evaluation Corpus — Citation Style: {style}",
            "abstract_title": "Abstract",
            "abstract_text": (
                f"This document evaluates {style} hallucination detection on chimeric references (real DOIs "
                "grafted onto fabricated titles), known fake DOI prefixes (10.9999, 10.1234/fake), placeholder "
                "authors (John Doe, Jane Smith), and completely non-existent journal articles."
            ),
            "sections": h3_sections,
            "ref_heading": ref_heading,
            "references": h3_refs,
            "specs": h3_specs,
            "expected_style": style,
            "scenario": "hallucinations_and_chimera",
            "expected_verdicts": [sp["expected_verdict"] for sp in h3_specs],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "1 VERIFIED control + 4 HALLUCINATION entries (chimera DOIs, 10.9999, John Doe) + 1 NOT_FOUND periodical.",
        },
        {
            "filename": "hard_04_linking_anomalies.pdf",
            "title": f"[{style} Benchmark 04] Bipartite Linking Anomalies, Orphan Citations, Duplicates, and Ambiguity",
            "subtitle": f"Synthetic Multi-Page Evaluation Corpus — Citation Style: {style}",
            "abstract_title": "Abstract",
            "abstract_text": (
                f"This document stress-tests {style} in-text-to-bibliography linking and duplicate detection, "
                "incorporating orphan in-text citations (MISSING_REF), uncited bibliography entries (UNCITED_REF), "
                "same-author same-year disambiguation collisions (AMBIGUOUS), and duplicate reference entries."
            ),
            "sections": h4_sections,
            "ref_heading": ref_heading,
            "references": h4_refs,
            "specs": h4_specs,
            "expected_style": style,
            "scenario": "linking_anomalies",
            "expected_verdicts": [sp["expected_verdict"] for sp in h4_specs],
            "expected_mapping_statuses": ["MATCHED", "MISSING_REF", "UNCITED_REF", "AMBIGUOUS"],
            "notes": "Includes 2 orphan in-text citations (MISSING_REF), 2 uncited refs (UNCITED_REF), 1 duplicate ref pair, and same-author-year Wang (2020) entries.",
        },
        {
            "filename": "hard_05_extreme_edge_cases_and_unresolved.pdf",
            "title": f"[{style} Benchmark 05] Unicode Diacritics, Hyphenated Surnames, and Unresolved Monographs",
            "subtitle": f"Synthetic Multi-Page Evaluation Corpus — Citation Style: {style}",
            "abstract_title": "Abstract",
            "abstract_text": (
                f"This document evaluates {style} extraction and symbolic rule abstention on European Unicode "
                "diacritics (Popławska-Domaszewicz, Præstholm, Müller-Schöll, Østergaard), university press "
                "monographs/theses that should trigger UNRESOLVED, and online normative standards (RESOURCE)."
            ),
            "sections": h5_sections,
            "ref_heading": ref_heading,
            "references": h5_refs,
            "specs": h5_specs,
            "expected_style": style,
            "scenario": "extreme_edge_cases_and_unresolved",
            "expected_verdicts": [sp["expected_verdict"] for sp in h5_specs],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "Tests Unicode diacritics, compound surnames, 2 UNRESOLVED university press monographs, 1 RESOURCE, and 2 VERIFIED controls.",
        },
    ]


# ==============================================================================
# VIETNAMESE LEGAL (VN_LEGAL) 5 HARD-CASE ARCHETYPES
# ==============================================================================

def _build_vn_legal_prose_blocks(sentences_with_cites: list[str]) -> list[tuple[str, list[str]]]:
    """Build 4 multi-page Vietnamese legal academic sections (~1050 words) spanning 3-4 pages."""
    def s(idx: int) -> str:
        return sentences_with_cites[idx % len(sentences_with_cites)]

    sec1 = [
        (
            "Trong bối cảnh hoàn thiện nhà nước pháp quyền xã hội chủ nghĩa và hội nhập kinh tế quốc tế sâu rộng, "
            "việc nghiên cứu hệ thống văn bản quy phạm pháp luật Việt Nam đòi hỏi phương pháp tiếp cận liên ngành "
            "giữa lý luận chung về nhà nước và pháp luật với thực tiễn xét xử tại các tòa án nhân dân. "
            + s(0)
            + " Các quy định nền tảng về quyền dân sự, nghĩa vụ hợp đồng và trách nhiệm bồi thường thiệt hại ngoài "
            "hợp đồng đã tạo lập hành lang pháp lý vững chắc cho các chủ thể tham gia giao dịch dân sự và thương mại. "
            + s(1)
            + " Bên cạnh đó, sự phát triển nhanh chóng của thương mại điện tử, kinh tế số và các mô hình quản trị "
            "doanh nghiệp hiện đại đặt ra yêu cầu cấp thiết về việc rà soát tính thống nhất, đồng bộ giữa đạo luật "
            "gốc và hệ thống nghị định, thông tư hướng dẫn thi hành."
        ),
        (
            "Thực tiễn áp dụng pháp luật tại Việt Nam cho thấy mối quan hệ biện chứng giữa văn bản luật do Quốc hội "
            "ban hành và các văn bản dưới luật do Chính phủ, Thủ tướng Chính phủ cùng các Bộ, cơ quan ngang Bộ ban hành. "
            + s(2)
            + " Trong lĩnh vực quản trị doanh nghiệp và đầu tư vốn, việc phân định rõ thẩm quyền của Hội đồng thành viên, "
            "Đại hội đồng cổ đông và người đại diện theo pháp luật giúp phòng ngừa rủi ro tranh chấp nội bộ. "
            + s(3)
            + " Đồng thời, cơ chế bảo vệ quyền và lợi ích hợp pháp của người lao động cũng như quyền sử dụng đất "
            "của tổ chức, cá nhân luôn được đặt dưới sự giám sát chặt chẽ của các cơ quan tư pháp và thanh tra chuyên ngành."
        ),
        (
            "Nghiên cứu này tập trung phân tích cấu trúc trích dẫn học thuật chuẩn mực theo quy định của Khoa Luật — "
            "Trường Đại học Tôn Đức Thắng (TDTU) đối với khóa luận tốt nghiệp, luận văn thạc sĩ và bài báo khoa học pháp lý. "
            + s(4)
            + " Việc chuẩn hóa quy tắc viện dẫn điều, khoản, điểm của đạo luật kết hợp với trích dẫn giáo trình, "
            "bình luận khoa học và tạp chí chuyên ngành không chỉ nâng cao tính liêm chính học thuật mà còn hỗ trợ "
            "hệ thống kiểm tra tự động phát hiện chính xác các lỗi sai lệch siêu dữ liệu hoặc trích dẫn văn bản giả mạo."
        ),
    ]

    sec2 = [
        (
            "Theo chuẩn mực trích dẫn pháp lý tại Việt Nam, mỗi viện dẫn trong phần nội dung bài viết phải chỉ rõ "
            "cấu trúc phân cấp từ điểm, khoản, điều đến tên loại văn bản, số hiệu văn bản hoặc tên đạo luật kèm theo "
            "năm ban hành. "
            + s(5)
            + " Khi phân tích hiệu lực pháp lý theo thời gian và không gian, người nghiên cứu cần đối chiếu kỹ lưỡng "
            "ngày thông qua, ngày có hiệu lực thi hành cũng như các điều khoản chuyển tiếp nhằm tránh viện dẫn các "
            "văn bản đã hết hiệu lực toàn bộ hoặc một phần. "
            + s(6)
            + " Đặc biệt, đối với các nghị định quy định chi tiết thi hành luật, việc kiểm tra tính hợp hiến, hợp pháp "
            "và tính thống nhất với văn bản cấp trên là nguyên tắc bắt buộc trong lập luận khoa học pháp lý."
        ),
        (
            "Song song với hệ thống văn bản quy phạm pháp luật, các công trình nghiên cứu lý luận như giáo trình đại học, "
            "sách chuyên khảo bình luận bộ luật và các bài viết đăng trên Tạp chí Khoa học Pháp lý Việt Nam hay Tạp chí "
            "Nghiên cứu Lập pháp đóng vai trò làm sáng tỏ nội hàm khái niệm và đề xuất kiến nghị hoàn thiện pháp luật. "
            + s(7)
            + " Sự kết hợp hài hòa giữa viện dẫn quy phạm thực định và trích dẫn học thuật theo chuẩn tác giả — năm "
            "hoặc chỉ số đánh số đòi hỏi bộ máy phân tích cú pháp phải nhận diện chính xác cả hai hình thái trích dẫn "
            "trong cùng một tài liệu đa trang."
        ),
        (
            "Để đánh giá toàn diện năng lực của hệ thống kiểm tra tính toàn vẹn trích dẫn, tập dữ liệu thực nghiệm "
            "được thiết kế bao gồm đầy đủ các tình huống phức tạp: văn bản luật hợp lệ, nghị định và thông tư hướng dẫn, "
            "quyết định cá biệt của Thủ tướng Chính phủ, cùng các trường hợp lỗi số hiệu năm ban hành, sai cơ quan ban hành "
            "và các đạo luật hoàn toàn hư cấu do mô hình ngôn ngữ lớn sinh ra. "
            + s(8)
            + " Qua đó, hệ thống có thể phân loại rành mạch giữa nguồn tài nguyên pháp lý hợp lệ (RESOURCE), "
            "tài liệu học thuật đã xác thực (VERIFIED), tài liệu xuất bản nội bộ chưa lập chỉ mục (UNRESOLVED) "
            "và các trích dẫn sai lệch hoặc ảo giác (HALLUCINATION)."
        ),
    ]

    sec3 = [
        (
            "Qua khảo sát thực nghiệm trên các báo cáo nghiên cứu khoa học sinh viên và khóa luận tốt nghiệp ngành Luật, "
            "nhóm lỗi phổ biến thứ nhất liên quan đến sự bất nhất giữa trích dẫn trong bài và danh mục tài liệu tham khảo "
            "cuối bài. Nhiều trường hợp tác giả viện dẫn điều khoản của Bộ luật Lao động hoặc Luật Thương mại trong phần "
            "lập luận nhưng lại bỏ sót không liệt kê văn bản đó trong phần Tài liệu tham khảo, dẫn đến trạng thái thiếu "
            "tài liệu đối chiếu (MISSING_REF). "
            + s(0)
            + " Ngược lại, hiện tượng liệt kê hàng loạt đạo luật, nghị định trong danh mục tài liệu tham khảo nhưng "
            "không hề phân tích hay viện dẫn ở bất kỳ đoạn văn nào trong bài viết tạo ra các mục tài liệu thừa (UNCITED_REF)."
        ),
        (
            "Nhóm lỗi nghiêm trọng thứ hai xuất phát từ việc nhầm lẫn số khóa Quốc hội, năm thông qua đạo luật hoặc "
            "gán ghép sai thẩm quyền ban hành giữa Quốc hội, Ủy ban Thường vụ Quốc hội và Chính phủ. "
            + s(1)
            + " Chẳng hạn, việc ghi sai năm ban hành của Bộ luật Dân sự hoặc Luật Doanh nghiệp làm thay đổi hoàn toàn "
            "bối cảnh áp dụng quy phạm, gây khó khăn cho quá trình thẩm định tính chính xác của luận cứ pháp lý. "
            + s(2)
            + " Hơn nữa, sự xuất hiện của các công cụ tạo sinh văn bản tự động đã làm gia tăng nguy cơ trích dẫn "
            "các bộ luật hoặc nghị định chưa từng tồn tại trong hệ thống pháp luật thực định Việt Nam."
        ),
        (
            "Nhóm thách thức thứ ba liên quan đến các cấu trúc viện dẫn phức hợp trong câu văn học thuật tiếng Việt, "
            "nơi người viết viện dẫn đồng thời nhiều điểm, khoản, điều kèm theo dấu câu tiếng Việt, chữ viết tắt "
            "và các tên riêng có dấu thanh điệu phức tạp. "
            + s(3)
            + " Bộ công cụ tách câu và nhận diện thực thể pháp lý cần bảo toàn nguyên vẹn chuỗi ký tự Unicode chuẩn NFC, "
            "đồng thời liên kết chính xác từng viện dẫn điều khoản về đúng văn bản gốc trong danh mục tài liệu tham khảo."
        ),
    ]

    sec4 = [
        (
            "Tóm lại, việc xây dựng bộ dữ liệu kiểm thử chuyên biệt cho lĩnh vực pháp luật Việt Nam (VN_LEGAL) "
            "theo đúng quy chuẩn trình bày của Trường Đại học Tôn Đức Thắng là bước đi thiết yếu nhằm kiểm chứng "
            "độ tin cậy của hệ thống kiểm tra trích dẫn tự động. "
            + s(4)
            + " Kết quả thực nghiệm trên năm kịch bản điển hình cung cấp cơ sở định lượng vững chắc để tinh chỉnh "
            "thuật toán nhận diện văn bản pháp luật, liên kết trích dẫn hai chiều và phân loại nhãn xác thực một cách "
            "khách quan, chính xác."
        ),
    ]

    return [
        ("1. Đặt vấn đề và Cơ sở lý luận về Hệ thống Pháp luật Việt Nam", sec1),
        ("2. Phương pháp luận Kiểm chứng Trích dẫn Văn bản Quy phạm Pháp luật", sec2),
        ("3. Phân tích Thực trạng Lỗi Trích dẫn và Các Tình huống Biên Phức tạp", sec3),
        ("4. Kết luận và Kiến nghị Hoàn thiện Hệ thống Kiểm định Học thuật", sec4),
    ]


def build_vn_legal_corpus_specs() -> list[dict[str, Any]]:
    """Build the 5 Vietnamese Legal (VN_LEGAL) hard-case PDF specifications."""
    # ---- VN HARD 01: Standard TDTU Law Citation Format (All valid laws + academic refs) ----
    vn1_refs = [
        "1. Bộ luật Dân sự (Bộ luật số 91/2015/QH13) ngày 24/11/2015 của Quốc hội.",
        "2. Luật Doanh nghiệp (Luật số 59/2020/QH14) ngày 17/06/2020 của Quốc hội.",
        "3. Bộ luật Lao động (Bộ luật số 45/2019/QH14) ngày 20/11/2019 của Quốc hội.",
        "4. Luật Đất đai (Luật số 31/2024/QH15) ngày 18/01/2024 của Quốc hội.",
        "5. Nghị định số 01/2021/NĐ-CP ngày 04/01/2021 của Chính phủ về đăng ký doanh nghiệp.",
        "6. Thông tư số 01/2021/TT-BKHĐT ngày 16/03/2021 của Bộ Kế hoạch và Đầu tư hướng dẫn về đăng ký doanh nghiệp.",
        "7. Quyết định số 749/2020/QĐ-TTg của Thủ tướng Chính phủ ngày 03/06/2020 phê duyệt Chương trình Chuyển đổi số quốc gia.",
        "8. Nguyễn, N. Đ. (2020). Giáo trình Luật Dân sự Việt Nam. Nhà xuất bản Đại học Quốc gia TP. Hồ Chí Minh.",
        "9. Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30(1), 5998-6008. https://doi.org/10.48550/arXiv.1706.03762",
    ]
    vn1_sentences = [
        "Nguyên tắc thiện chí, trung thực được xác lập tại khoản 2 Điều 3 Bộ luật Dân sự (2015).",
        "Trách nhiệm bồi thường thiệt hại ngoài hợp đồng được quy định cụ thể tại điểm a khoản 1 Điều 584 Bộ luật Dân sự (2015).",
        "Quyền tự do kinh doanh và lựa chọn loại hình tổ chức được ghi nhận tại Điều 7 Luật Doanh nghiệp (2020).",
        "Tiêu chuẩn bảo vệ quyền lợi người lao động được quy định tại khoản 1 Điều 35 Bộ luật Lao động (2019).",
        "Nguyên tắc sử dụng đất tiết kiệm, hiệu quả được quy định tại Điều 5 Luật Đất đai (2024).",
        "Trình tự kê khai hồ sơ trực tuyến được thực hiện theo Nghị định số 01/2021/NĐ-CP (2021) của Chính phủ.",
        "Biểu mẫu nghiệp vụ đăng ký kinh doanh được áp dụng theo Thông tư số 01/2021/TT-BKHĐT (2021) của Bộ Kế hoạch và Đầu tư.",
        "Định hướng phát triển chính phủ điện tử được ban hành kèm theo Quyết định số 749/2020/QĐ-TTg (2020) của Thủ tướng Chính phủ.",
        "Các học giả pháp lý đã phân tích sâu sắc bản chất của nghĩa vụ dân sự (Nguyễn, 2020) cũng như ứng dụng mô hình học sâu trong xử lý văn bản pháp luật (Vaswani et al., 2017).",
    ]

    # ---- VN HARD 02: Legal Hierarchy Mismatches & Metadata Errors ----
    vn2_refs = [
        # Corrupted year/number on Civil Code (2015 written as 91/2018/QH14)
        "1. Bộ luật Dân sự (Bộ luật số 91/2018/QH14) ngày 24/11/2018 của Quốc hội.",
        # Wrong issuing body on Law on Enterprises (Law issued by Ministry of Finance instead of National Assembly)
        "2. Luật Doanh nghiệp (Luật số 59/2020/QH14) ngày 17/06/2020 của Bộ Tài chính.",
        # Corrupted Decree number & wrong year for Decree 01/2021/NĐ-CP
        "3. Nghị định số 999/2019/NĐ-CP ngày 04/01/2019 của Chính phủ về đăng ký doanh nghiệp.",
        # Valid control law
        "4. Bộ luật Lao động (Bộ luật số 45/2019/QH14) ngày 20/11/2019 của Quốc hội.",
        # Academic paper with metadata error (wrong year 2020 vs 2017 on Vaswani)
        "5. Vaswani, A., Shazeer, N., & Parmar, N. (2020). Attention is all you need. Advances in Neural Information Processing Systems, 30(1), 5998-6008. https://doi.org/10.48550/arXiv.1706.03762",
        # Academic paper with replaced authors on BERT DOI
        "6. Sutskever, I., & Vinyals, O. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. Proceedings of NAACL, 1(1), 4171-4186. https://doi.org/10.18653/v1/N19-1423",
    ]
    vn2_sentences = [
        "Giao dịch dân sự vô hiệu do giả tạo được xem xét theo khoản 1 Điều 124 Bộ luật Dân sự (2018).",
        "Nghĩa vụ của người quản lý công ty được quy định tại Điều 165 Luật Doanh nghiệp (2020).",
        "Thủ tục cấp giấy chứng nhận đăng ký doanh nghiệp dẫn chiếu theo Nghị định số 999/2019/NĐ-CP (2019) của Chính phủ.",
        "Chấm dứt hợp đồng lao động đúng pháp luật được quy định tại Điều 36 Bộ luật Lao động (2019).",
        "Mô hình tự chú ý trong phân tích ngữ nghĩa văn bản pháp lý được đề xuất bởi (Vaswani et al., 2020).",
        "Biểu diễn ngôn ngữ hai chiều hỗ trợ phân loại điều khoản hợp đồng được trình bày trong (Sutskever & Vinyals, 2019).",
        "Nguyên tắc xác lập quyền sở hữu tài sản được viện dẫn tại Điều 158 Bộ luật Dân sự (2018).",
        "Cơ cấu tổ chức công ty cổ phần được thực hiện theo Điều 137 Luật Doanh nghiệp (2020).",
        "Thời giờ làm việc bình thường được kiểm soát theo Điều 105 Bộ luật Lao động (2019).",
    ]

    # ---- VN HARD 03: Hallucinated Vietnamese Laws & Chimera Academic References ----
    vn3_refs = [
        # Completely fabricated futuristic Vietnamese laws
        "1. Luật Trí tuệ nhân tạo và Siêu dữ liệu Quốc gia (Luật số 888/2023/QH15) ngày 15/08/2023 của Quốc hội.",
        "2. Bộ luật Giao dịch Tài sản Vũ trụ và Lượng tử (Bộ luật số 777/2022/QH15) ngày 10/10/2022 của Quốc hội.",
        "3. Nghị định số 555/2024/NĐ-CP ngày 01/02/2024 của Chính phủ về quản lý hợp đồng thông minh liên hành tinh.",
        # Valid control law
        "4. Bộ luật Dân sự (Bộ luật số 91/2015/QH13) ngày 24/11/2015 của Quốc hội.",
        # Chimera academic reference (Real CVPR DOI attached to fabricated Vietnamese legal AI title)
        "5. Vaswani, A., & Shazeer, N. (2022). Quantum blockchain adjudication in interplanetary civil courts. Journal of Legal AI, 12(1), 10-25. https://doi.org/10.1109/CVPR.2016.90",
        # Fabricated 10.9999 DOI
        "6. Doe, J., & Smith, J. (2023). Synthetic jurisprudence in autonomous neural tribunals. International Law Review, 45(2), 100-120. https://doi.org/10.9999/ilr.2023.999999",
    ]
    vn3_sentences = [
        "Trách nhiệm pháp lý của hệ thống tự hành được quy định tại khoản 3 Điều 12 Luật Trí tuệ nhân tạo và Siêu dữ liệu Quốc gia (2023).",
        "Quyền sở hữu đối với tài nguyên ngoài khí quyển được điều chỉnh bởi Điều 45 Bộ luật Giao dịch Tài sản Vũ trụ và Lượng tử (2022).",
        "Cơ chế ký số hợp đồng tự động được thực hiện theo Nghị định số 555/2024/NĐ-CP (2024) của Chính phủ.",
        "Nguyên tắc cơ bản của pháp luật dân sự được quy định tại Điều 3 Bộ luật Dân sự (2015).",
        "Khung lý thuyết xét xử bằng chuỗi khối lượng tử được đề xuất bởi (Vaswani & Shazeer, 2022).",
        "Mô hình tòa án thần kinh tự trị được khảo sát trong nghiên cứu của (Doe & Smith, 2023).",
        "Nghĩa vụ tôn trọng đạo đức xã hội được khẳng định tại khoản 4 Điều 3 Bộ luật Dân sự (2015).",
        "Chế tài xử phạt thuật toán tự sinh được nêu tại Điều 88 Luật Trí tuệ nhân tạo và Siêu dữ liệu Quốc gia (2023).",
        "Thẩm quyền giải quyết tranh chấp tài sản số được quy định tại Nghị định số 555/2024/NĐ-CP (2024).",
    ]

    # ---- VN HARD 04: Vietnamese Legal Linking Anomalies (Orphan laws, Uncited laws, Duplicates) ----
    vn4_refs = [
        # 1. Cited in body -> MATCHED
        "1. Bộ luật Dân sự (Bộ luật số 91/2015/QH13) ngày 24/11/2015 của Quốc hội.",
        # 2. Cited in body -> MATCHED
        "2. Luật Doanh nghiệp (Luật số 59/2020/QH14) ngày 17/06/2020 của Quốc hội.",
        # 3. Duplicate of #2 -> DUPLICATE
        "3. Luật Doanh nghiệp (Luật số 59/2020/QH14) ngày 17/06/2020 của Quốc hội nước Cộng hòa xã hội chủ nghĩa Việt Nam.",
        # 4. Uncited in body -> UNCITED_REF
        "4. Luật Đất đai (Luật số 31/2024/QH15) ngày 18/01/2024 của Quốc hội.",
        # 5. Uncited in body -> UNCITED_REF
        "5. Nghị định số 01/2021/NĐ-CP ngày 04/01/2021 của Chính phủ về đăng ký doanh nghiệp.",
        # 6. Cited academic ref -> MATCHED
        "6. He, K., Zhang, X., & Ren, S. (2016). Deep residual learning for image recognition. Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, 1(1), 770-778. https://doi.org/10.1109/CVPR.2016.90",
    ]
    vn4_sentences = [
        # Matched to Ref #1
        "Hiệu lực của giao dịch dân sự được xác định theo Điều 117 Bộ luật Dân sự (2015).",
        # Matched to Ref #2/#3
        "Quyền và nghĩa vụ của cổ đông phổ thông được quy định tại Điều 115 Luật Doanh nghiệp (2020).",
        # Orphan legal citation #1: Luật Thương mại (2005) (NOT in references -> MISSING_REF)
        "Chế tài phạt vi phạm và bồi thường thiệt hại trong hoạt động thương mại được áp dụng theo Điều 300 Luật Thương mại (2005).",
        # Orphan legal citation #2: Bộ luật Tố tụng dân sự (2015) (NOT in references -> MISSING_REF)
        "Thẩm quyền giải quyết tranh chấp kinh doanh thương mại của Tòa án được xác định theo khoản 1 Điều 30 Bộ luật Tố tụng dân sự (2015).",
        # Orphan legal citation #3: Nghị định số 35/2021/NĐ-CP (2021) (NOT in references -> MISSING_REF)
        "Quy trình lựa chọn nhà đầu tư dự án đối tác công tư được hướng dẫn tại Nghị định số 35/2021/NĐ-CP (2021) của Chính phủ.",
        # Matched to Ref #6
        "Kiến trúc mạng học sâu phần dư hỗ trợ nhận dạng chữ viết tay trên hồ sơ pháp lý (He et al., 2016).",
        # Orphan academic citation (NOT in references -> MISSING_REF)
        "Phương pháp đối sánh văn bản quy phạm pháp luật tự động đã được đề xuất trong (Trần, 2023).",
        "Trách nhiệm dân sự do vi phạm nghĩa vụ được quy định tại Điều 351 Bộ luật Dân sự (2015).",
        "Người đại diện theo pháp luật của doanh nghiệp được quy định tại Điều 12 Luật Doanh nghiệp (2020).",
    ]

    # ---- VN HARD 05: Complex Multi-Clause In-Text Legal Citations & Unresolved Textbooks/Theses ----
    vn5_refs = [
        "1. Bộ luật Dân sự (Bộ luật số 91/2015/QH13) ngày 24/11/2015 của Quốc hội.",
        "2. Bộ luật Hình sự (Bộ luật số 100/2015/QH13) ngày 27/11/2015 của Quốc hội.",
        "3. Luật Sở hữu trí tuệ (Luật số 50/2005/QH11) ngày 29/11/2005 của Quốc hội.",
        "4. Lê, M. H. (2021). Sách chuyên khảo Bình luận khoa học Bộ luật Dân sự về Hợp đồng. Nhà xuất bản Hồng Đức.",
        "5. Phạm, T. P. T. (2022). Pháp luật về bảo vệ dữ liệu cá nhân trong thương mại điện tử. Luận văn Thạc sĩ Luật học, Trường Đại học Tôn Đức Thắng.",
        "6. Lindqvist, K., & Sorensen, S. (2021). Comparative legal informatics in Southeast Asia. Oxford University Press.",
        "7. Devlin, J., Chang, M., & Lee, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. Proceedings of NAACL, 1(1), 4171-4186. https://doi.org/10.18653/v1/N19-1423",
    ]
    vn5_sentences = [
        "Các điều kiện có hiệu lực của hợp đồng và hậu quả pháp lý của hợp đồng vô hiệu được quy định tại điểm a, điểm b khoản 1 Điều 117 và khoản 2 Điều 131 Bộ luật Dân sự (2015).",
        "Cấu thành tội phạm đối với hành vi xâm phạm quyền tác giả, quyền liên quan được xác định theo điểm đ khoản 2 Điều 225 Bộ luật Hình sự (2015).",
        "Quyền nhân thân và quyền tài sản của tác giả đối với tác phẩm khoa học được bảo hộ theo Điều 19 và Điều 20 Luật Sở hữu trí tuệ (2005).",
        "Lý luận về giải thích hợp đồng khi có điều khoản tối nghĩa đã được phân tích chi tiết trong chuyên khảo của (Lê, 2021).",
        "Khung pháp lý bảo vệ quyền riêng tư của người tiêu dùng số tại Việt Nam được đề xuất bởi (Phạm, 2022).",
        "Nghiên cứu so sánh tin học pháp lý tại khu vực Đông Nam Á được tổng hợp trong (Lindqvist & Sorensen, 2021).",
        "Mô hình ngôn ngữ tiền huấn luyện hỗ trợ trích xuất thực thể pháp luật tiếng Việt đạt độ chính xác cao (Devlin et al., 2019).",
        "Thời hiệu khởi kiện về hợp đồng dân sự được áp dụng theo Điều 429 Bộ luật Dân sự (2015).",
        "Nguyên tắc xử lý đối với người dưới mười tám tuổi phạm tội được quy định tại Điều 91 Bộ luật Hình sự (2015).",
    ]

    return [
        {
            "filename": "hard_01_vn_legal_standard_tdtu.pdf",
            "title": "[VN_LEGAL Benchmark 01] Chuẩn Trích dẫn Pháp luật Khoa Luật TDTU và Văn bản Quy phạm Thực định",
            "subtitle": "Báo cáo Nghiên cứu Khoa học Pháp lý Đa trang — Chuẩn Trích dẫn: VN_LEGAL (TDTU Law)",
            "abstract_title": "Tóm tắt",
            "abstract_text": (
                "Tài liệu này kiểm chứng khả năng bóc tách văn bản quy phạm pháp luật Việt Nam (Bộ luật, Luật, "
                "Nghị định, Thông tư, Quyết định của Thủ tướng Chính phủ) kết hợp với giáo trình luật học và "
                "bài báo quốc tế theo đúng quy định trích dẫn của Khoa Luật — Trường Đại học Tôn Đức Thắng."
            ),
            "sections": _build_vn_legal_prose_blocks(vn1_sentences),
            "ref_heading": "Tài liệu tham khảo",
            "references": vn1_refs,
            "expected_style": "APA",
            "legal_style": "VN_LEGAL",
            "scenario": "vn_legal_standard_tdtu",
            "expected_verdicts": [
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "UNRESOLVED",
                "VERIFIED",
            ],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "7 authentic Vietnamese legal documents (RESOURCE) + 1 Vietnamese legal textbook (UNRESOLVED) + 1 VERIFIED paper.",
        },
        {
            "filename": "hard_02_vn_legal_hierarchy_and_metadata_errors.pdf",
            "title": "[VN_LEGAL Benchmark 02] Sai lệch Số hiệu, Năm ban hành, Thẩm quyền Cơ quan và Lỗi Siêu dữ liệu",
            "subtitle": "Báo cáo Nghiên cứu Khoa học Pháp lý Đa trang — Chuẩn Trích dẫn: VN_LEGAL (TDTU Law)",
            "abstract_title": "Tóm tắt",
            "abstract_text": (
                "Tài liệu này kiểm thử khả năng phát hiện sai lệch thông tin văn bản pháp luật (sai năm ban hành "
                "Bộ luật Dân sự 2018 thay vì 2015, gán sai cơ quan ban hành Luật Doanh nghiệp cho Bộ Tài chính, "
                "sai số hiệu Nghị định) kết hợp với các bài báo khoa học bị biến đổi năm xuất bản và tác giả."
            ),
            "sections": _build_vn_legal_prose_blocks(vn2_sentences),
            "ref_heading": "Tài liệu tham khảo",
            "references": vn2_refs,
            "expected_style": "APA",
            "legal_style": "VN_LEGAL",
            "scenario": "vn_legal_hierarchy_and_metadata_errors",
            "expected_verdicts": [
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "METADATA_ERROR",
                "METADATA_ERROR",
            ],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "Tests corrupted Vietnamese legal citations (wrong year/issuing body) + 2 METADATA_ERROR academic papers.",
        },
        {
            "filename": "hard_03_vn_legal_hallucinations_and_fake_laws.pdf",
            "title": "[VN_LEGAL Benchmark 03] Văn bản Luật Hư cấu (Ảo giác AI), Nghị định Giả mạo và Trích dẫn Lai ghép",
            "subtitle": "Báo cáo Nghiên cứu Khoa học Pháp lý Đa trang — Chuẩn Trích dẫn: VN_LEGAL (TDTU Law)",
            "abstract_title": "Tóm tắt",
            "abstract_text": (
                "Tài liệu này đánh giá khả năng phát hiện các đạo luật và nghị định hoàn toàn hư cấu do AI sinh ra "
                "(Luật Trí tuệ nhân tạo số 888/2023/QH15, Bộ luật Giao dịch Tài sản Vũ trụ số 777/2022/QH15) "
                "cùng các bài báo khoa học gắn mã DOI giả mạo (10.9999) hoặc ghép nối DOI thật với tiêu đề giả."
            ),
            "sections": _build_vn_legal_prose_blocks(vn3_sentences),
            "ref_heading": "Tài liệu tham khảo",
            "references": vn3_refs,
            "expected_style": "APA",
            "legal_style": "VN_LEGAL",
            "scenario": "vn_legal_hallucinations_and_fake_laws",
            "expected_verdicts": [
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "HALLUCINATION",
                "HALLUCINATION",
            ],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "Tests 3 fabricated Vietnamese laws + 1 valid Civil Code control + 2 HALLUCINATION academic citations.",
        },
        {
            "filename": "hard_04_vn_legal_linking_anomalies.pdf",
            "title": "[VN_LEGAL Benchmark 04] Bất thường Liên kết Viện dẫn Pháp lý: Thiếu Nguồn, Thừa Nguồn và Trùng lặp",
            "subtitle": "Báo cáo Nghiên cứu Khoa học Pháp lý Đa trang — Chuẩn Trích dẫn: VN_LEGAL (TDTU Law)",
            "abstract_title": "Tóm tắt",
            "abstract_text": (
                "Tài liệu này kiểm thử bộ máy liên kết hai chiều giữa viện dẫn điều khoản trong bài viết và "
                "danh mục Tài liệu tham khảo, bao gồm viện dẫn đạo luật không có trong danh mục (MISSING_REF), "
                "liệt kê luật nhưng không viện dẫn (UNCITED_REF) và trùng lặp mục tài liệu tham khảo (DUPLICATE)."
            ),
            "sections": _build_vn_legal_prose_blocks(vn4_sentences),
            "ref_heading": "Tài liệu tham khảo",
            "references": vn4_refs,
            "expected_style": "APA",
            "legal_style": "VN_LEGAL",
            "scenario": "vn_legal_linking_anomalies",
            "expected_verdicts": [
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "VERIFIED",
            ],
            "expected_mapping_statuses": ["MATCHED", "MISSING_REF", "UNCITED_REF"],
            "notes": "Includes 4 orphan in-text legal/academic citations (MISSING_REF), 2 uncited laws (UNCITED_REF), and 1 duplicate law.",
        },
        {
            "filename": "hard_05_vn_legal_complex_intext_and_unresolved.pdf",
            "title": "[VN_LEGAL Benchmark 05] Viện dẫn Điều Khoản Điểm Phức hợp, Chuyên khảo Nội bộ và Luận văn (UNRESOLVED)",
            "subtitle": "Báo cáo Nghiên cứu Khoa học Pháp lý Đa trang — Chuẩn Trích dẫn: VN_LEGAL (TDTU Law)",
            "abstract_title": "Tóm tắt",
            "abstract_text": (
                "Tài liệu này kiểm thử các cấu trúc viện dẫn pháp lý phức hợp (nhiều điểm, khoản, điều trong cùng "
                "một câu văn tiếng Việt có dấu) kết hợp với sách chuyên khảo, luận văn thạc sĩ luật học và "
                "chuyên khảo nhà xuất bản đại học được kỳ vọng phân loại vào nhãn UNRESOLVED."
            ),
            "sections": _build_vn_legal_prose_blocks(vn5_sentences),
            "ref_heading": "Tài liệu tham khảo",
            "references": vn5_refs,
            "expected_style": "APA",
            "legal_style": "VN_LEGAL",
            "scenario": "vn_legal_complex_intext_and_unresolved",
            "expected_verdicts": [
                "RESOURCE",
                "RESOURCE",
                "RESOURCE",
                "UNRESOLVED",
                "UNRESOLVED",
                "UNRESOLVED",
                "VERIFIED",
            ],
            "expected_mapping_statuses": ["MATCHED"],
            "notes": "Tests compound multi-clause Vietnamese legal citations + 3 UNRESOLVED monographs/theses + 1 VERIFIED paper.",
        },
    ]


# ==============================================================================
# PIPELINE INSPECTION & GROUND-TRUTH GENERATION
# ==============================================================================

def inspect_generated_pdf(pdf_path: Path, doc_spec: dict[str, Any]) -> dict[str, Any]:
    """Verify PDF page count & text extractability with fitz and run extraction/linking components."""
    with fitz.open(str(pdf_path)) as fitz_doc:
        page_count = len(fitz_doc)
        pages_text_lengths = [len(fitz_doc[p].get_text("text").strip()) for p in range(page_count)]

    if not (3 <= page_count <= 5):
        raise RuntimeError(
            f"PDF {pdf_path.name} has {page_count} pages (expected 3-5 pages)."
        )
    if any(length == 0 for length in pages_text_lengths):
        raise RuntimeError(
            f"PDF {pdf_path.name} has an empty page: text lengths={pages_text_lengths}"
        )

    cfg = get_settings()
    cfg.extraction.grobid.enabled = False
    doc_parser = DocumentParser(config=cfg)
    style_detector = StyleDetector()
    linker = CitationLinker()
    dup_detector = DuplicateDetector()

    parsed = doc_parser.parse(str(pdf_path))
    body_citations = parsed.body_citations
    references = parsed.references
    style_analysis = style_detector.detect(body_citations, references)

    for idx, c in enumerate(body_citations):
        c.reference_id = f"occ-{idx + 1:04d}"
    for idx, c in enumerate(references):
        c.reference_id = f"ref-{idx + 1:04d}"

    linking_result = linker.link(body_citations, references)
    duplicates = dup_detector.detect(references)
    status_counts = dict(linking_result.status_counts) if linking_result.status_counts else {}

    return {
        "filename": pdf_path.name,
        "scenario": doc_spec["scenario"],
        "title": doc_spec["title"],
        "page_count": page_count,
        "page_text_char_counts": pages_text_lengths,
        "expected_style_detector_classification": doc_spec["expected_style"],
        "detected_dominant_style": (
            style_analysis.dominant_style.value
            if getattr(style_analysis, "dominant_style", None)
            else getattr(style_analysis, "label", "Unknown")
        ),
        "style_confidence": round(getattr(style_analysis, "confidence", 1.0), 4),
        "expected_reference_count": len(doc_spec["references"]),
        "extracted_reference_count": len(references),
        "expected_intext_citation_count": len(body_citations),
        "extracted_intext_citation_count": len(body_citations),
        "expected_mapping_statuses": doc_spec["expected_mapping_statuses"],
        "actual_linking_summary": {
            "status_counts": status_counts,
            "unmatched_reference_ids": list(linking_result.unmatched_reference_ids),
            "duplicate_group_count": len(duplicates),
        },
        "expected_validation_verdicts": doc_spec["expected_verdicts"],
        "references_ground_truth": [
            {
                "index": idx + 1,
                "raw_reference": raw_ref,
                "expected_validation_label": (
                    doc_spec["expected_verdicts"][idx]
                    if idx < len(doc_spec["expected_verdicts"])
                    else "UNKNOWN"
                ),
            }
            for idx, raw_ref in enumerate(doc_spec["references"])
        ],
        "notes": doc_spec.get("notes", ""),
    }


def main() -> None:
    register_unicode_fonts()

    total_pdfs = 0
    total_gt_files = 0
    summary_rows: list[str] = []

    # 1. Generate 5 hard-case PDFs + ground_truth.json for all 11 academic citation styles
    for style in STYLES:
        out_dir = ROOT_DIR / "style_corpora" / style / "hard_cases"
        out_dir.mkdir(parents=True, exist_ok=True)
        doc_specs = build_style_corpus_specs(style)
        gt_documents: list[dict[str, Any]] = []

        for spec in doc_specs:
            pdf_path = out_dir / spec["filename"]
            render_pdf(
                output_path=pdf_path,
                title=spec["title"],
                subtitle=spec["subtitle"],
                abstract_title=spec["abstract_title"],
                abstract_text=spec["abstract_text"],
                sections=spec["sections"],
                ref_heading=spec["ref_heading"],
                references=spec["references"],
            )
            doc_meta = inspect_generated_pdf(pdf_path, spec)
            gt_documents.append(doc_meta)
            total_pdfs += 1
            summary_rows.append(
                f"  [{style:9s}] {pdf_path.name:46s} | pages={doc_meta['page_count']} "
                f"| refs={doc_meta['extracted_reference_count']}/{doc_meta['expected_reference_count']} "
                f"| intext={doc_meta['extracted_intext_citation_count']} "
                f"| style={doc_meta['detected_dominant_style']}"
            )

        gt_payload = {
            "corpus_style": style,
            "directory": str(out_dir.relative_to(ROOT_DIR)),
            "document_count": len(gt_documents),
            "documents": gt_documents,
        }
        gt_path = out_dir / "ground_truth.json"
        gt_path.write_text(json.dumps(gt_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        total_gt_files += 1

    # 2. Generate 5 hard-case PDFs + ground_truth.json for Vietnamese Legal (VN_LEGAL)
    vn_dir = ROOT_DIR / "vn_legal_reports" / "hard_cases"
    vn_dir.mkdir(parents=True, exist_ok=True)
    vn_specs = build_vn_legal_corpus_specs()
    vn_gt_documents: list[dict[str, Any]] = []

    for spec in vn_specs:
        pdf_path = vn_dir / spec["filename"]
        render_pdf(
            output_path=pdf_path,
            title=spec["title"],
            subtitle=spec["subtitle"],
            abstract_title=spec["abstract_title"],
            abstract_text=spec["abstract_text"],
            sections=spec["sections"],
            ref_heading=spec["ref_heading"],
            references=spec["references"],
        )
        doc_meta = inspect_generated_pdf(pdf_path, spec)
        doc_meta["legal_citation_regime"] = "VN_LEGAL"
        vn_gt_documents.append(doc_meta)
        total_pdfs += 1
        summary_rows.append(
            f"  [VN_LEGAL ] {pdf_path.name:46s} | pages={doc_meta['page_count']} "
            f"| refs={doc_meta['extracted_reference_count']}/{doc_meta['expected_reference_count']} "
            f"| intext={doc_meta['extracted_intext_citation_count']} "
            f"| style={doc_meta['detected_dominant_style']}"
        )

    vn_gt_payload = {
        "corpus_style": "VN_LEGAL",
        "directory": str(vn_dir.relative_to(ROOT_DIR)),
        "document_count": len(vn_gt_documents),
        "documents": vn_gt_documents,
    }
    vn_gt_path = vn_dir / "ground_truth.json"
    vn_gt_path.write_text(
        json.dumps(vn_gt_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    total_gt_files += 1

    print(f"Successfully generated {total_pdfs} PDFs and {total_gt_files} ground_truth.json files:")
    for row in summary_rows:
        print(row)


if __name__ == "__main__":
    main()
