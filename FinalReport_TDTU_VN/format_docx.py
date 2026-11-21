#!/usr/bin/env python3
"""Apply the TDTU thesis layout to a Pandoc-generated DOCX.

Pandoc's LaTeX reader does not execute the commands in ``format.tex``.
Consequently, geometry, fontspec, setspace, and fancyhdr settings are not
carried over by a direct ``pandoc thesis.tex -o thesis.docx`` conversion.
This small post-processor edits the OOXML package without touching the text,
figures, tables, or relationships already present in the document.

Typical usage (the wrapper avoids unsupported custom section macros)::

    pandoc thesis_docx.tex -f latex -t docx -o thesis.raw.docx
    python3 format_docx.py thesis.raw.docx thesis.docx

If you intentionally convert the main source directly, replace
``thesis_docx.tex`` with ``thesis.tex``; the formatter still fixes the Word
layout, but the custom section definitions in ``format.tex`` may already have
been emitted as literal ``3.5ex``/``2.3ex`` text by Pandoc.

The output uses A4 paper, Times New Roman 13 pt body text, 1.5 line spacing,
720 twips (one Word tab / 1.27 cm) first-line indentation, the requested
margins, 16 pt Heading 1 (chapter) text, and a centred PAGE field in the
default header.

The script intentionally does not attempt to interpret arbitrary LaTeX
macros.  For a faithful DOCX conversion, use a DOCX-native source or clean
up unsupported custom macros before running Pandoc, then apply this formatter.
"""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"


def qn(local: str, namespace: str = W) -> str:
    """Return an expanded XML name."""

    return f"{{{namespace}}}{local}"


for prefix, namespace in (
    ("w", W),
    ("r", R),
    ("pr", REL),
    ("ct", CT),
):
    ET.register_namespace(prefix, namespace)


FONT = "Times New Roman"
BODY_HALF_POINTS = "26"  # 13 pt * 2
CHAPTER_HALF_POINTS = "32"  # 16 pt * 2
LINE_TWIPS = "360"  # 1.5 lines = 1.5 * 240
FIRST_LINE_TWIPS = "720"  # one Word tab = 0.5 in = 1.27 cm

# A4 dimensions in twips.
A4_WIDTH = "11906"  # 21 cm
A4_HEIGHT = "16838"  # 29.7 cm
MARGIN_TOP = "1985"  # 3.5 cm
MARGIN_BOTTOM = "1701"  # 3 cm
MARGIN_LEFT = "1985"  # 3.5 cm
MARGIN_RIGHT = "1134"  # 2 cm

BODY_STYLE_IDS = {
    "Normal",
    "BodyText",
    "FirstParagraph",
    "Compact",
    "TextBody",
}
NO_INDENT_STYLE_IDS = {
    "Title",
    "Subtitle",
    "Heading1",
    "Heading2",
    "Heading3",
    "Caption",
    "ImageCaption",
    "Figure",
    "CaptionedFigure",
    "TOC1",
    "TOC2",
    "TOC3",
}


def child(parent: ET.Element, local: str, namespace: str = W) -> ET.Element:
    """Return an existing child or append a new one."""

    name = qn(local, namespace)
    found = parent.find(name)
    if found is None:
        found = ET.SubElement(parent, name)
    return found


def set_font(rpr: ET.Element, size: str = BODY_HALF_POINTS) -> None:
    """Set the four Word font slots while removing theme-font overrides."""

    fonts = child(rpr, "rFonts")
    for attr in tuple(fonts.attrib):
        # Theme attributes (asciiTheme, hAnsiTheme, ...), if left in place,
        # can override the explicit Times New Roman face in Word.
        local_attr = attr.rsplit("}", 1)[-1]
        if local_attr.lower().endswith("theme"):
            del fonts.attrib[attr]
    for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(attr), FONT)

    child(rpr, "sz").set(qn("val"), size)
    child(rpr, "szCs").set(qn("val"), size)


def set_spacing(ppr: ET.Element, *, before: str | None = None, after: str | None = None) -> None:
    spacing = child(ppr, "spacing")
    spacing.set(qn("line"), LINE_TWIPS)
    spacing.set(qn("lineRule"), "auto")
    if before is not None:
        spacing.set(qn("before"), before)
    if after is not None:
        spacing.set(qn("after"), after)


def set_first_line(ppr: ET.Element, twips: str | None) -> None:
    ind = child(ppr, "ind")
    if twips is None:
        ind.attrib.pop(qn("firstLine"), None)
    else:
        ind.set(qn("firstLine"), twips)
        # A hanging indent and a first-line indent are mutually exclusive.
        ind.attrib.pop(qn("hanging"), None)


def style_id(paragraph: ET.Element) -> str:
    ppr = paragraph.find(qn("pPr"))
    if ppr is None:
        return ""
    pstyle = ppr.find(qn("pStyle"))
    return "" if pstyle is None else pstyle.get(qn("val"), "")


def has_numbering(paragraph: ET.Element) -> bool:
    ppr = paragraph.find(qn("pPr"))
    return ppr is not None and ppr.find(qn("numPr")) is not None


def in_table(paragraph: ET.Element, document: ET.Element) -> bool:
    """Check whether a paragraph is nested in a table cell.

    ElementTree has no parent pointers.  Tables are few compared with
    paragraphs in a thesis, so collecting cell paragraphs once is simpler and
    less error-prone than maintaining a custom parent map.
    """

    return any(paragraph is p for p in document.findall(".//" + qn("tc") + "//" + qn("p")))


def patch_styles(styles: ET.Element) -> None:
    """Set document defaults and the common Pandoc paragraph styles."""

    defaults = child(styles, "docDefaults")
    rpr_default = child(defaults, "rPrDefault")
    set_font(child(rpr_default, "rPr"))

    ppr_default = child(defaults, "pPrDefault")
    ppr = child(ppr_default, "pPr")
    set_spacing(ppr, before="0", after="0")

    for style in styles.findall(qn("style")):
        sid = style.get(qn("styleId"), "")
        if style.get(qn("type")) == "paragraph":
            style_ppr = child(style, "pPr")
            set_spacing(style_ppr)
            if sid in BODY_STYLE_IDS:
                set_first_line(style_ppr, FIRST_LINE_TWIPS)
            elif sid in NO_INDENT_STYLE_IDS:
                set_first_line(style_ppr, None)

        # Patch every character style too.  This catches linked character
        # styles used by Pandoc for emphasis, captions, and hyperlinks.
        style_rpr = child(style, "rPr")
        set_font(style_rpr, CHAPTER_HALF_POINTS if sid == "Heading1" else BODY_HALF_POINTS)

        if sid in {"Heading1", "Heading2", "Heading3"}:
            color = child(style_rpr, "color")
            for attr in tuple(color.attrib):
                local_attr = attr.rsplit("}", 1)[-1]
                if local_attr.lower().startswith("theme"):
                    del color.attrib[attr]
            color.set(qn("val"), "000000")


def cover_run_size(paragraph_index: int, run: ET.Element) -> str:
    """Restore the intended hierarchy on the two cover pages."""

    text = "".join(node.text or "" for node in run.findall(".//" + qn("t"))).strip()
    if "HỆ THỐNG CHẤM ĐIỂM" in text or "AUTOMATED ESSAY GRADING" in text:
        return "44"  # 22 pt
    if text in ("ĐỒ ÁN TỐT NGHIỆP", "NGÀNH: KỸ THUẬT PHẦN MỀM", "GRADUATION PROJECT", "MAJOR: SOFTWARE ENGINEERING"):
        return "40"  # 20 pt
    return "28"  # 14 pt


def patch_paragraph(
    paragraph: ET.Element, document: ET.Element, paragraph_index: int
) -> None:
    sid = style_id(paragraph)
    ppr = child(paragraph, "pPr")
    set_spacing(ppr)
    table_paragraph = in_table(paragraph, document)
    is_cover = paragraph_index in (0, 1)

    if is_cover:
        set_first_line(ppr, None)
        child(ppr, "jc").set(qn("val"), "center")
    elif table_paragraph:
        # Table cells should remain aligned to the cell edge; a first-line
        # indent is intended for prose paragraphs, not tabular labels/values.
        set_first_line(ppr, None)
    elif sid in BODY_STYLE_IDS or (not sid and not has_numbering(paragraph)):
        set_first_line(ppr, FIRST_LINE_TWIPS)
    elif sid in NO_INDENT_STYLE_IDS or has_numbering(paragraph):
        # Keep existing left/hanging/list indentation, but explicitly clear a
        # style-level first-line indent for headings, lists, and table cells.
        set_first_line(ppr, None)

    size = CHAPTER_HALF_POINTS if sid == "Heading1" else BODY_HALF_POINTS
    for run in paragraph.findall(".//" + qn("r")):
        if is_cover:
            size = cover_run_size(paragraph_index, run)
        run_rpr = child(run, "rPr")
        set_font(run_rpr, size)


def patch_document(document: ET.Element) -> None:
    """Patch all paragraphs/runs and add section geometry/header references."""

    for paragraph_index, paragraph in enumerate(document.findall(".//" + qn("p"))):
        patch_paragraph(paragraph, document, paragraph_index)

    for sect_pr in document.findall(".//" + qn("sectPr")):
        # Remove generated geometry/header references so rerunning the script
        # is idempotent.
        for tag in ("headerReference", "pgSz", "pgMar"):
            for node in sect_pr.findall(qn(tag)):
                sect_pr.remove(node)

        header_ref = ET.Element(
            qn("headerReference"),
            {qn("type"): "default", qn("id", R): "rIdTDTUHeader"},
        )
        pg_sz = ET.Element(
            qn("pgSz"),
            {qn("w"): A4_WIDTH, qn("h"): A4_HEIGHT},
        )
        pg_mar = ET.Element(
            qn("pgMar"),
            {
                qn("top"): MARGIN_TOP,
                qn("bottom"): MARGIN_BOTTOM,
                qn("left"): MARGIN_LEFT,
                qn("right"): MARGIN_RIGHT,
                # Keep the header in the upper margin while leaving body text
                # at the required 3.5 cm top margin.
                qn("header"): "720",
                qn("footer"): "720",
                qn("gutter"): "0",
            },
        )

        # CT_SectPr requires headerReference(s), then pgSz, then pgMar.
        sect_pr.insert(0, header_ref)
        sect_pr.insert(1, pg_sz)
        sect_pr.insert(2, pg_mar)


def patch_relationships(rels: ET.Element) -> None:
    for relationship in rels.findall(qn("Relationship", REL)):
        if relationship.get("Type", "").endswith("/header") and relationship.get("Id") == "rIdTDTUHeader":
            return
    ET.SubElement(
        rels,
        qn("Relationship", REL),
        {
            "Id": "rIdTDTUHeader",
            "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
            "Target": "header1.xml",
        },
    )


def patch_content_types(content_types: ET.Element) -> None:
    part_name = "/word/header1.xml"
    for override in content_types.findall(qn("Override", CT)):
        if override.get("PartName") == part_name:
            return
    ET.SubElement(
        content_types,
        qn("Override", CT),
        {
            "PartName": part_name,
            "ContentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
        },
    )


def make_header() -> bytes:
    """Build a centred Times New Roman PAGE field."""

    header = ET.Element(qn("hdr"))
    paragraph = ET.SubElement(header, qn("p"))
    ppr = ET.SubElement(paragraph, qn("pPr"))
    ET.SubElement(ppr, qn("jc"), {qn("val"): "center"})

    field = ET.SubElement(paragraph, qn("fldSimple"), {qn("instr"): " PAGE "})
    run = ET.SubElement(field, qn("r"))
    set_font(ET.SubElement(run, qn("rPr")))
    ET.SubElement(run, qn("t")).text = "1"

    return ET.tostring(header, encoding="UTF-8", xml_declaration=True)


def serialize(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True)


def format_docx(source: Path, output: Path) -> None:
    with zipfile.ZipFile(source, "r") as zin:
        entries = {name: zin.read(name) for name in zin.namelist()}

    styles = ET.fromstring(entries["word/styles.xml"])
    patch_styles(styles)
    entries["word/styles.xml"] = serialize(styles)

    document = ET.fromstring(entries["word/document.xml"])
    patch_document(document)
    entries["word/document.xml"] = serialize(document)

    rels_name = "word/_rels/document.xml.rels"
    rels = ET.fromstring(entries[rels_name])
    patch_relationships(rels)
    entries[rels_name] = serialize(rels)

    content_types = ET.fromstring(entries["[Content_Types].xml"])
    patch_content_types(content_types)
    entries["[Content_Types].xml"] = serialize(content_types)
    entries["word/header1.xml"] = make_header()

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Pandoc-generated input DOCX")
    parser.add_argument("output", type=Path, help="formatted output DOCX")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.source.resolve() == args.output.resolve():
        raise SystemExit("source and output must differ (use a temporary output, then replace the source)")
    format_docx(args.source, args.output)


if __name__ == "__main__":
    main()
