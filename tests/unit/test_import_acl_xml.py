"""Regression tests for the ACL Anthology XML importer.

These cover the two ACL-importer bugs found during the 2026-09 data audit
(the audit notes were removed from the repo after all of P1-P6 were resolved):

1. Only the first ``<volume>`` of each file was read, dropping ~35% of the
   corpus (44,904 of 127,851 papers).
2. Author names were built by concatenating ``itertext()`` twice, producing
   duplicated/garbled names such as ``"WarrenWeaver WarrenWeaver"``.

Also verifies abstract extraction, which was added so the paper knowledge
base is not 100% abstract-free.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.import_acl_xml import _parse_xml_file

MULTI_VOLUME_XML = """<?xml version='1.0' encoding='UTF-8'?>
<collection id="2019.ws">
  <volume id="1" type="proceedings">
    <meta>
      <booktitle>Proceedings of Workshop One</booktitle>
      <year>2019</year>
      <venue>ws</venue>
    </meta>
    <paper id="1">
      <title>First Volume Paper</title>
      <author><first>Warren</first><last>Weaver</last></author>
      <abstract>An abstract about translation.</abstract>
      <doi>10.18653/v1/W19-1001</doi>
    </paper>
    <paper id="2">
      <title>Second Paper In First Volume</title>
      <author><first>Ada</first><last>Lovelace</last></author>
    </paper>
  </volume>
  <volume id="2" type="proceedings">
    <meta>
      <booktitle>Proceedings of Workshop Two</booktitle>
      <year>2019</year>
      <venue>ws</venue>
    </meta>
    <paper id="1">
      <title>Second Volume Paper</title>
      <author><first>Alan</first><last>Turing</last></author>
    </paper>
    <paper id="2">
      <title>Another Second Volume Paper</title>
      <author><first>Grace</first><last>Hopper</last></author>
    </paper>
  </volume>
</collection>
"""


def _write(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "sample.xml"
    path.write_text(content, encoding="utf-8")
    return path


def test_all_volumes_are_parsed(tmp_path: Path) -> None:
    """Every <volume> must contribute its papers (bug 1)."""
    papers = _parse_xml_file(_write(tmp_path, MULTI_VOLUME_XML))
    titles = {p.title for p in papers}
    assert titles == {
        "First Volume Paper",
        "Second Paper In First Volume",
        "Second Volume Paper",
        "Another Second Volume Paper",
    }
    assert len(papers) == 4


def test_authors_are_not_duplicated(tmp_path: Path) -> None:
    """First/last names must be read separately (bug 2)."""
    papers = _parse_xml_file(_write(tmp_path, MULTI_VOLUME_XML))
    by_title = {p.title: p for p in papers}
    assert by_title["First Volume Paper"].authors == ["Warren Weaver"]
    assert by_title["Second Volume Paper"].authors == ["Alan Turing"]
    # Regression guard: the old implementation produced doubled strings.
    for paper in papers:
        for author in paper.authors:
            assert "WarrenWeaver" not in author
            assert author.strip() == author


def test_per_volume_metadata_is_used(tmp_path: Path) -> None:
    papers = _parse_xml_file(_write(tmp_path, MULTI_VOLUME_XML))
    for paper in papers:
        assert paper.year == 2019
        assert paper.venue == "ws"
        assert paper.source == "acl"


def test_abstract_is_extracted(tmp_path: Path) -> None:
    papers = _parse_xml_file(_write(tmp_path, MULTI_VOLUME_XML))
    by_title = {p.title: p for p in papers}
    assert by_title["First Volume Paper"].abstract == "An abstract about translation."
    assert by_title["Second Paper In First Volume"].abstract is None


def test_author_full_name_attribute_fallback(tmp_path: Path) -> None:
    xml = """<?xml version='1.0' encoding='UTF-8'?>
    <collection id="1999.x">
      <volume id="1">
        <meta><year>1999</year><venue>x</venue></meta>
        <paper id="1">
          <title>Legacy Author Format</title>
          <author full_name="Jane Q. Public"/>
        </paper>
      </volume>
    </collection>
    """
    papers = _parse_xml_file(_write(tmp_path, xml))
    assert len(papers) == 1
    assert papers[0].authors == ["Jane Q. Public"]


@pytest.mark.skipif(
    not Path("data/acl_data/data/xml").is_dir(),
    reason="ACL XML corpus is not present",
)
def test_real_corpus_loses_no_papers() -> None:
    """The parser must return at least one paper per <paper> element in file."""
    import re

    xml_dir = Path("data/acl_data/data/xml")
    files = sorted(xml_dir.glob("*.xml"))
    assert files, "expected ACL XML files"

    sample = files[:30]
    for xml_file in sample:
        raw = len(re.findall(r"<paper\b", xml_file.read_text(encoding="utf-8", errors="ignore")))
        if not raw:
            continue
        parsed = _parse_xml_file(xml_file)
        assert len(parsed) == raw, f"{xml_file.name}: parsed {len(parsed)} of {raw}"
