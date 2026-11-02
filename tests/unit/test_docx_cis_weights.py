"""Task 1.4 — DOCX report CIS weight labels reflect the real CIS weights.

Previously hardcoded 35/25/20/10/10 (sum 100 but wrong) while settings use
35/25/25/10/5. Labels now come from ``settings.cis.weights`` (or the report's
``weights_used``).
"""

from __future__ import annotations

from io import BytesIO

from docx import Document

from integrity_checker.config import get_settings
from integrity_checker.export.docx_exporter import export_report_to_docx

COMPONENTS = {
    "verified_ratio": 0.8,
    "metadata_accuracy": 0.9,
    "in_text_bib_consistency": 0.7,
    "format_consistency": 1.0,
    "identifier_validity": 0.5,
}


def _weight_column(docx_bytes: bytes) -> dict[str, str]:
    doc = Document(BytesIO(docx_bytes))
    for table in doc.tables:
        header = [c.text for c in table.rows[0].cells]
        if header[:2] == ["CIS Component", "Weight"]:
            return {row.cells[0].text: row.cells[1].text for row in table.rows[1:]}
    raise AssertionError("CIS component table not found")


def _export(**kwargs) -> bytes:
    return export_report_to_docx(
        filename="essay.pdf", cis_score=81.0, num_citations=4, num_verified=3,
        num_metadata_error=1, num_suspected=0, num_unresolved=0, num_resource=0,
        verdicts=[], cis_components=COMPONENTS, **kwargs,
    )


def test_default_labels_match_settings_weights():
    weights = _weight_column(_export())
    assert list(weights.values()) == ["35%", "25%", "25%", "10%", "5%"]
    assert weights["In-Text ↔ Bibliography Consistency (Layer 1)"] == "25%"
    assert weights["Identifier Validity (DOI / CrossRef)"] == "5%"


def test_labels_follow_settings_object():
    w = get_settings().cis.weights
    weights = list(_weight_column(_export()).values())
    expected = [w.verified_ratio, w.metadata_accuracy, w.in_text_bib_consistency,
                w.format_consistency, w.identifier_validity]
    assert weights == [f"{round(v * 100)}%" for v in expected]
    assert sum(int(x.rstrip("%")) for x in weights) == 100


def test_report_weights_used_override_labels():
    custom = {"verified_ratio": 0.40, "metadata_accuracy": 0.20,
              "in_text_bib_consistency": 0.20, "format_consistency": 0.125,
              "identifier_validity": 0.075}
    weights = list(_weight_column(_export(cis_weights=custom)).values())
    assert weights == ["40%", "20%", "20%", "12.5%", "7.5%"]


def test_partial_or_invalid_weights_fall_back_to_settings():
    weights = list(_weight_column(
        _export(cis_weights={"verified_ratio": "bogus", "format_consistency": 0.15})
    ).values())
    assert weights == ["35%", "25%", "25%", "15%", "5%"]


def test_scores_column_unchanged():
    doc = Document(BytesIO(_export()))
    table = next(t for t in doc.tables if t.rows[0].cells[0].text == "CIS Component")
    scores = [row.cells[2].text for row in table.rows[1:]]
    assert scores == ["80.0%", "90.0%", "70.0%", "100.0%", "50.0%"]
