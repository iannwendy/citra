"""Task 1.5 — untrusted XML is parsed with defusedxml.

A DOCX whose footnotes.xml carries a billion-laughs / external-entity payload
must be rejected or ignored quickly (no expansion, no hang), while normal DOCX
files keep parsing. arXiv Atom responses get the same protection.
"""

from __future__ import annotations

import time
import zipfile
from pathlib import Path

import pytest
from docx import Document as DocxDocument

from integrity_checker.export.docx_exporter import (
    _docx_xml_is_safe,
    _set_cell_background,
    export_auto_healed_docx,
)
from integrity_checker.extraction.docx_parser import DocxParser
from integrity_checker.retrieval.arxiv_client import ArxivClient

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

GOOD_FOOTNOTES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="{W_NS}">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t></w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>Nguyễn Văn A, Kinh tế học (Hà Nội: NXB Trẻ, 2019), 15.</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="2"><w:p><w:r><w:t>Smith, J. (2020). A study of X.</w:t></w:r></w:p></w:footnote>
</w:footnotes>"""

BILLION_LAUGHS = f"""<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<w:footnotes xmlns:w="{W_NS}">
  <w:footnote w:id="1"><w:p><w:r><w:t>&lol9;</w:t></w:r></w:p></w:footnote>
</w:footnotes>"""

XXE = f"""<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<w:footnotes xmlns:w="{W_NS}">
  <w:footnote w:id="1"><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:footnote>
</w:footnotes>"""


def _make_docx(tmp_path: Path, name: str, footnotes_xml: str | None) -> Path:
    base = tmp_path / f"base_{name}.docx"
    d = DocxDocument()
    d.add_heading("Introduction", level=1)
    d.add_paragraph("Prior work matters (Smith, 2020).")
    d.add_heading("References", level=1)
    d.add_paragraph("Smith, J. (2020). A study of X. Journal A, 1(2), 3-4.")
    d.save(str(base))
    if footnotes_xml is None:
        return base
    out = tmp_path / f"{name}.docx"
    with zipfile.ZipFile(base) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            dst.writestr(item, src.read(item))
        dst.writestr("word/footnotes.xml", footnotes_xml)
    return out


class TestDocxParserNotes:
    def test_normal_footnotes_still_parse(self, tmp_path):
        path = _make_docx(tmp_path, "good", GOOD_FOOTNOTES)
        notes = DocxParser._extract_xml_notes(path, "word/footnotes.xml", "footnote")
        assert notes == {
            1: "Nguyễn Văn A, Kinh tế học (Hà Nội: NXB Trẻ, 2019), 15.",
            2: "Smith, J. (2020). A study of X.",
        }

    @pytest.mark.parametrize("payload", [BILLION_LAUGHS, XXE], ids=["billion_laughs", "xxe"])
    def test_entity_payload_ignored_quickly(self, tmp_path, payload):
        path = _make_docx(tmp_path, "evil", payload)
        start = time.monotonic()
        notes = DocxParser._extract_xml_notes(path, "word/footnotes.xml", "footnote")
        assert notes == {}
        assert time.monotonic() - start < 2.0

    def test_full_parse_of_malicious_docx_does_not_hang(self, tmp_path):
        path = _make_docx(tmp_path, "evil_full", BILLION_LAUGHS)
        start = time.monotonic()
        doc = DocxParser().parse(str(path))
        assert time.monotonic() - start < 10.0
        full_text = " ".join(p.text for p in doc.pages)
        assert "Smith" in full_text
        assert "lollollol" not in full_text

    def test_oversized_notes_part_skipped(self, tmp_path, monkeypatch):
        import integrity_checker.extraction.docx_parser as dp

        monkeypatch.setattr(dp, "_MAX_NOTES_XML_BYTES", 100)
        path = _make_docx(tmp_path, "big", GOOD_FOOTNOTES)
        assert DocxParser._extract_xml_notes(path, "word/footnotes.xml", "footnote") == {}


class TestDocxExporterInput:
    def test_safe_docx_accepted(self, tmp_path):
        assert _docx_xml_is_safe(str(_make_docx(tmp_path, "ok", GOOD_FOOTNOTES)))

    def test_malicious_docx_rejected(self, tmp_path):
        assert not _docx_xml_is_safe(str(_make_docx(tmp_path, "bad", BILLION_LAUGHS)))
        assert not _docx_xml_is_safe(str(tmp_path / "missing.docx"))

    def test_auto_healed_export_falls_back_to_clean_doc_for_malicious_input(self, tmp_path):
        evil = _make_docx(tmp_path, "evil_export", BILLION_LAUGHS)
        start = time.monotonic()
        out = export_auto_healed_docx("evil.docx", verdicts=[], original_docx_path=str(evil))
        assert time.monotonic() - start < 10.0
        assert out[:2] == b"PK"
        with zipfile.ZipFile(__import__("io").BytesIO(out)) as zf:
            assert "<!DOCTYPE" not in zf.read("word/document.xml").decode("utf-8", "ignore")

    def test_cell_background_rejects_non_hex(self):
        d = DocxDocument()
        cell = d.add_table(rows=1, cols=1).rows[0].cells[0]
        _set_cell_background(cell, '"/><w:evil/><w:shd w:fill="')
        assert "evil" not in cell._tc.xml
        _set_cell_background(cell, "FEE2E2")
        assert "FEE2E2" in cell._tc.xml


class TestArxivAtom:
    ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models...</summary>
    <author><name>Ashish Vaswani</name></author>
  </entry>
</feed>"""

    def test_normal_atom_parses(self):
        cands = ArxivClient._parse_atom_entries(self.ATOM)
        assert len(cands) == 1
        assert cands[0].title == "Attention Is All You Need"

    def test_entity_payload_returns_no_candidates(self):
        evil = BILLION_LAUGHS.replace("w:footnotes", "feed")
        start = time.monotonic()
        assert ArxivClient._parse_atom_entries(evil) == []
        assert time.monotonic() - start < 2.0

    def test_malformed_xml_returns_empty(self):
        assert ArxivClient._parse_atom_entries("<feed><entry>") == []


@pytest.mark.parametrize(
    "module",
    [
        "integrity_checker.extraction.docx_parser",
        "integrity_checker.retrieval.arxiv_client",
        "integrity_checker.export.docx_exporter",
    ],
)
def test_untrusted_xml_modules_do_not_use_stdlib_etree_parsing(module):
    """Stdlib ElementTree must not be used to parse untrusted XML in these modules."""
    import importlib
    import inspect

    src = inspect.getsource(importlib.import_module(module))
    assert "xml.etree.ElementTree" not in src
    assert "ET.fromstring" not in src and "ET.parse" not in src
    assert "defusedxml" in src
