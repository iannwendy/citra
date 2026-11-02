"""DOCX export functionality for analysis reports."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from io import BytesIO
from typing import Any

from defusedxml.ElementTree import fromstring as safe_fromstring
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from docx.shared import Pt, RGBColor

_MAX_DOCX_PART_BYTES = 50 * 1024 * 1024
_HEX_COLOR_RE = re.compile(r"^[0-9A-Fa-f]{6}$")


def _docx_xml_is_safe(docx_path: str) -> bool:
    """Validate every XML part of an untrusted .docx with defusedxml.

    Rejects packages whose parts declare DTDs/entities (billion laughs, XXE),
    are malformed, or are oversized (zip bomb) before python-docx opens them.
    """
    import zipfile

    try:
        with zipfile.ZipFile(docx_path, "r") as zf:
            for info in zf.infolist():
                name = info.filename.lower()
                if not (name.endswith(".xml") or name.endswith(".rels")):
                    continue
                if info.file_size > _MAX_DOCX_PART_BYTES:
                    return False
                safe_fromstring(zf.read(info), forbid_dtd=True)
    except Exception:
        return False
    return True


def _set_cell_background(cell, hex_color: str) -> None:
    """Apply background shading color (e.g. 'FEE2E2') to a python-docx table cell."""
    if not _HEX_COLOR_RE.match(str(hex_color or "")):
        return
    try:
        shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
        cell._tc.get_or_add_tcPr().append(shading)
    except Exception:
        pass


_CIS_WEIGHT_KEYS = (
    "verified_ratio",
    "metadata_accuracy",
    "in_text_bib_consistency",
    "format_consistency",
    "identifier_validity",
)


def _resolve_cis_weights(cis_weights: dict[str, float] | None) -> dict[str, float]:
    """Effective CIS weights: explicit (e.g. report ``weights_used``) else settings."""
    from integrity_checker.config import get_settings

    resolved = dict(get_settings().cis.weights.model_dump())
    if cis_weights and isinstance(cis_weights, dict):
        for key in _CIS_WEIGHT_KEYS:
            val = cis_weights.get(key)
            if isinstance(val, int | float):
                resolved[key] = float(val)
    return resolved


def _format_weight(value: float) -> str:
    pct = float(value) * 100.0
    return f"{pct:.0f}%" if abs(pct - round(pct)) < 1e-6 else f"{pct:.1f}%"


def export_report_to_docx(
    filename: str,
    cis_score: float,
    num_citations: int,
    num_verified: int,
    num_metadata_error: int,
    num_suspected: int,
    num_unresolved: int,
    num_resource: int,
    verdicts: list[dict],
    generated_at: str | None = None,
    *,
    essay_id: int = 1,
    cis_components: dict[str, float] | None = None,
    linking_summary: dict[str, int] | None = None,
    style_profile: dict | None = None,
    cis_weights: dict[str, float] | None = None,
) -> bytes:
    """Generate a DOCX report from analysis results.

    Args:
        filename: Name of the analyzed essay
        cis_score: Citation Integrity Score (0-100)
        num_citations: Total number of citations
        num_verified: Number of verified citations
        num_metadata_error: Number with metadata errors
        num_suspected: Number of suspected hallucinations
        num_unresolved: Number of unresolved citations
        num_resource: Number of URL/Resource citations
        verdicts: List of verdict dictionaries
        generated_at: Timestamp string
        cis_weights: CIS weights actually used (report ``weights_used``);
            defaults to ``settings.cis.weights`` so labels never drift.

    Returns:
        bytes: DOCX file content
    """
    doc = Document()

    # Title
    title = doc.add_heading("Essay Integrity Check Report", 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Metadata
    utc_ts = generated_at or datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    doc.add_paragraph()
    meta = doc.add_paragraph()
    meta.add_run("Essay: ").bold = True
    meta.add_run(filename)
    meta = doc.add_paragraph()
    meta.add_run("Generated: ").bold = True
    meta.add_run(utc_ts)
    meta = doc.add_paragraph()
    meta.add_run("System: ").bold = True
    meta.add_run("Essay Integrity Checker (DATN)")

    # Digital Verification Receipt (Chứng chỉ Xác thực Số CITRA) — Task 6.2
    from integrity_checker.api.routes.essays import create_essay_share_token

    share_info = create_essay_share_token(int(essay_id or 1))
    receipt_id = str(share_info["receipt_id"])
    sig_prefix = str(share_info.get("signature_prefix") or "")
    verification_url = str(
        share_info.get("verification_url")
        or f"https://citra.io.vn/verify/share/{share_info['share_token']}"
    )

    doc.add_heading("Digital Verification Receipt (Chứng chỉ Xác thực Số CITRA)", level=2)
    receipt_summary_p = doc.add_paragraph()
    r_rec_lbl = receipt_summary_p.add_run("Receipt ID: ")
    r_rec_lbl.bold = True
    receipt_summary_p.add_run(f"{receipt_id}  |  ")
    r_url_lbl = receipt_summary_p.add_run("Verification URL: ")
    r_url_lbl.bold = True
    receipt_summary_p.add_run(verification_url)

    receipt_table = doc.add_table(rows=5, cols=2)
    receipt_table.style = "Table Grid"
    receipt_rows = [
        ("Receipt ID", receipt_id),
        ("UTC Timestamp", utc_ts),
        ("CIS Score", f"{cis_score:.2f}%"),
        ("HMAC-SHA256 Signature Prefix", sig_prefix),
        ("Verification URL", verification_url),
    ]
    for r_idx, (r_label, r_val) in enumerate(receipt_rows):
        row = receipt_table.rows[r_idx]
        row.cells[0].text = r_label
        row.cells[1].text = r_val
        _set_cell_background(row.cells[0], "EEF2FF")
        for paragraph in row.cells[0].paragraphs:
            for run in paragraph.runs:
                run.font.bold = True

    # CIS Score Section
    doc.add_heading("Citation Integrity Score (CIS)", level=1)

    score_para = doc.add_paragraph()
    score_run = score_para.add_run(f"{cis_score:.2f}%")
    score_run.font.size = Pt(36)
    score_run.font.bold = True

    # Determine score color
    if cis_score >= 90:
        score_run.font.color.rgb = RGBColor(34, 197, 94)  # Green
    elif cis_score >= 70:
        score_run.font.color.rgb = RGBColor(234, 179, 8)  # Yellow
    else:
        score_run.font.color.rgb = RGBColor(239, 68, 68)  # Red

    doc.add_paragraph("(Score represents percentage of citations that passed integrity verification)")

    if style_profile and isinstance(style_profile, dict) and style_profile.get("style"):
        sp_para = doc.add_paragraph()
        sp_para.add_run("Detected Citation Style: ").bold = True
        conf_pct = float(style_profile.get("confidence", 0.0) or 0.0) * 100.0
        sp_para.add_run(f"{style_profile.get('style')} ({conf_pct:.0f}% confidence)")

    if cis_components and isinstance(cis_components, dict):
        doc.add_heading("5-Component CIS Formula Breakdown", level=2)
        comp_table = doc.add_table(rows=1, cols=3)
        comp_table.style = "Table Grid"
        comp_hdr = comp_table.rows[0].cells
        comp_hdr[0].text = "CIS Component"
        comp_hdr[1].text = "Weight"
        comp_hdr[2].text = "Score"
        for cell in comp_hdr:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.bold = True

        weights = _resolve_cis_weights(cis_weights)
        comp_labels = {
            "verified_ratio": "Verified Ratio (Layer 2)",
            "metadata_accuracy": "Metadata Accuracy (Author/Year/Title)",
            "in_text_bib_consistency": "In-Text ↔ Bibliography Consistency (Layer 1)",
            "format_consistency": "Citation Style Consistency",
            "identifier_validity": "Identifier Validity (DOI / CrossRef)",
        }
        comp_rows = [
            (
                comp_labels[key],
                _format_weight(weights.get(key, 0.0)),
                float(cis_components.get(key, 0.0) or 0.0),
            )
            for key in _CIS_WEIGHT_KEYS
        ]
        for label_txt, weight_txt, val in comp_rows:
            r_cells = comp_table.add_row().cells
            r_cells[0].text = label_txt
            r_cells[1].text = weight_txt
            r_cells[2].text = f"{val * 100.0:.1f}%"

    if linking_summary and isinstance(linking_summary, dict):
        doc.add_heading("Layer 1: In-Text ↔ Bibliography Linking Summary", level=2)
        link_table = doc.add_table(rows=1, cols=2)
        link_table.style = "Table Grid"
        lh = link_table.rows[0].cells
        lh[0].text = "Mapping Status"
        lh[1].text = "Count"
        for cell in lh:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.bold = True
        for k, v_cnt in linking_summary.items():
            rc = link_table.add_row().cells
            rc[0].text = k.replace("_", " ").title()
            rc[1].text = str(v_cnt)

    # Summary Statistics
    doc.add_heading("Summary Statistics", level=1)

    stats_table = doc.add_table(rows=8, cols=2)
    stats_table.style = "Table Grid"

    stats_data = [
        ("Total Citations", str(num_citations)),
        ("Verified", f"{num_verified} ({num_verified * 100 / max(num_citations, 1):.1f}%)"),
        ("Metadata Error", f"{num_metadata_error} ({num_metadata_error * 100 / max(num_citations, 1):.1f}%)"),
        ("Suspected Hallucination", f"{num_suspected} ({num_suspected * 100 / max(num_citations, 1):.1f}%)"),
        ("Unresolved", f"{num_unresolved} ({num_unresolved * 100 / max(num_citations, 1):.1f}%)"),
        ("URL/Resource", f"{num_resource} ({num_resource * 100 / max(num_citations, 1):.1f}%)"),
        ("", ""),
        ("Citation Integrity Score", f"{cis_score:.2f}%"),
    ]

    for i, (label, value) in enumerate(stats_data):
        row = stats_table.rows[i]
        row.cells[0].text = label
        row.cells[1].text = value
        if label == "Citation Integrity Score":
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.font.bold = True

    # Verdicts Detail Section
    doc.add_heading("Citation Verdicts", level=1)

    if verdicts:
        # Verdicts table
        table = doc.add_table(rows=1, cols=4)
        table.style = "Table Grid"

        # Header row
        hdr_cells = table.rows[0].cells
        hdr_cells[0].text = "Citation"
        hdr_cells[1].text = "Type"
        hdr_cells[2].text = "Label"
        hdr_cells[3].text = "Confidence"

        for cell in hdr_cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.bold = True

        # Data rows
        for v in verdicts:
            row_cells = table.add_row().cells
            raw_cit = str(v.get("citation_raw", "") or "")
            mismatched = v.get("mismatched_fields") or []
            rules = v.get("triggered_rules") or []
            lbl_lower = str(v.get("label", "") or "").lower()
            details_suffix = ""
            if rules or mismatched:
                parts = []
                if rules:
                    parts.append(f"Rules: {', '.join(str(r) for r in rules)}")
                if mismatched:
                    parts.append(f"Mismatched: {', '.join(str(m) for m in mismatched)}")
                details_suffix = f"\n[{' | '.join(parts)}]"
            row_cells[0].text = raw_cit + details_suffix
            row_cells[1].text = str(v.get("mapping_status") or v.get("citation_type", "unknown"))
            row_cells[2].text = str(v.get("label", "UNKNOWN")).upper()
            row_cells[3].text = f"{float(v.get('confidence', 0) or 0):.2f}"

            if lbl_lower == "suspected_hallucination":
                for cell in row_cells:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.font.color.rgb = RGBColor(220, 38, 38)
                            run.font.bold = True
            elif lbl_lower == "metadata_error":
                for cell in row_cells:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            run.font.color.rgb = RGBColor(220, 38, 38)
                for paragraph in row_cells[2].paragraphs:
                    for run in paragraph.runs:
                        run.font.bold = True
            elif lbl_lower in ("verified", "resource"):
                for paragraph in row_cells[2].paragraphs:
                    for run in paragraph.runs:
                        run.font.color.rgb = RGBColor(22, 163, 74)
                        run.font.bold = True

        # Deep Neuro-Symbolic Evidence & Remediation Section for Flagged / Detailed Verdicts
        detailed_items = [
            v
            for v in verdicts
            if v.get("reasoning")
            or v.get("triggered_rules")
            or v.get("mismatched_fields")
            or (v.get("features") or {}).get("best_evidence_sentence")
        ]
        if detailed_items:
            doc.add_heading("Neuro-Symbolic Diagnostic Trace & Evidence", level=1)
            for idx, v in enumerate(detailed_items, 1):
                p = doc.add_paragraph()
                lbl_str = str(v.get("label", "UNKNOWN")).upper()
                lbl_lower = lbl_str.lower()
                r_num = p.add_run(f"[{idx}] {v.get('citation_raw', '')}\n")
                r_num.bold = True
                if lbl_lower in ("suspected_hallucination", "metadata_error"):
                    r_num.font.color.rgb = RGBColor(220, 38, 38)
                map_str = str(v.get("mapping_status", "matched"))
                r_verdict = p.add_run(
                    f"Verdict: {lbl_str} (Confidence: {float(v.get('confidence', 0) or 0):.2f}) | Layer-1 Mapping: {map_str}\n"
                )
                if lbl_lower in ("suspected_hallucination", "metadata_error"):
                    r_verdict.font.color.rgb = RGBColor(220, 38, 38)
                    r_verdict.bold = True
                rules = v.get("triggered_rules") or []
                if rules:
                    p.add_run(f"Triggered Symbolic Rules: {', '.join(str(r) for r in rules)}\n")
                mismatched = v.get("mismatched_fields") or []
                if mismatched:
                    r_mm = p.add_run(f"Mismatched Metadata Fields: {', '.join(str(m) for m in mismatched)}\n")
                    r_mm.font.color.rgb = RGBColor(185, 28, 28)
                if v.get("reasoning"):
                    p.add_run(f"Diagnostic Reasoning: {v.get('reasoning')}\n")
                feats = v.get("features") if isinstance(v.get("features"), dict) else {}
                ev_sent = feats.get("best_evidence_sentence")
                if ev_sent:
                    p.add_run(f"SBERT Best Evidence Sentence: \"{ev_sent}\"\n")
                intent = feats.get("citation_intent")
                stance = feats.get("stance_label") or feats.get("citation_stance")
                xl_det = feats.get("cross_lingual_detected")
                bridged = feats.get("bridged_concepts") or []
                xl_title_det = feats.get("cross_lingual_title_detected")
                xl_title_sim = float(feats.get("cross_lingual_title_sim", 0.0) or 0.0)
                if intent or stance or xl_det:
                    xl_note = (
                        f" | Cross-Lingual Bridge (VI↔EN): {', '.join(str(b) for b in bridged[:4])}"
                        if xl_det and bridged
                        else (" | Cross-Lingual Bridge (VI↔EN): Active" if xl_det else "")
                    )
                    p.add_run(
                        f"Discourse Analysis: Intent={intent or 'background'}, Stance={stance or 'neutral'}{xl_note}\n"
                    )
                if xl_title_det:
                    p.add_run(
                        f"Cross-Lingual Title Translation Match (VI↔EN): {xl_title_sim * 100:.0f}% similarity to canonical English title\n"
                    )

        # 1-Click Auto-Remediated Bibliography & BibTeX Section
        try:
            from integrity_checker.export.bibliography_formatter import (
                build_remediated_bibliography,
            )

            rem_data = build_remediated_bibliography(essay_id=0, verdicts=verdicts, style="apa")
            rem_entries = rem_data.get("entries") or []
            if rem_entries:
                doc.add_heading("Auto-Remediated Bibliography & BibTeX Studio", level=1)
                for e in rem_entries:
                    p_rem = doc.add_paragraph()
                    e_lbl = str(e.get("label", "")).lower()
                    if e.get("is_hallucination") or e_lbl == "suspected_hallucination":
                        r_warn = p_rem.add_run(
                            f"[{e['index']}] [CẢNH BÁO ĐỎ — SUSPECTED HALLUCINATION / NGUỒN BỊA ĐẶT: CẦN LOẠI BỎ]\n"
                        )
                        r_warn.bold = True
                        r_warn.font.color.rgb = RGBColor(220, 38, 38)
                        r_orig = p_rem.add_run(f"Original in Manuscript: {e.get('original_raw', '')}\n")
                        r_orig.font.color.rgb = RGBColor(220, 38, 38)
                    elif e.get("is_error") or e_lbl == "metadata_error":
                        r_fix = p_rem.add_run(
                            f"[{e['index']}] [METADATA ERROR AUTO-REPAIRED — Repaired fields: {', '.join(e.get('diff_fields') or ['metadata'])}]\n"
                        )
                        r_fix.bold = True
                        r_fix.font.color.rgb = RGBColor(185, 28, 28)
                        r_before = p_rem.add_run(f"Before (Error): {e.get('original_raw', '')}\n")
                        r_before.font.color.rgb = RGBColor(220, 38, 38)
                        r_after = p_rem.add_run(f"After (Standardized APA): {e.get('apa', '')}\n")
                        r_after.bold = True
                        r_after.font.color.rgb = RGBColor(22, 163, 74)
                        r_bib = p_rem.add_run(f"BibTeX:\n{e.get('bibtex', '')}")
                        r_bib.font.size = Pt(8.5)
                    else:
                        r_ok = p_rem.add_run(f"[{e['index']}] [VERIFIED & STANDARDIZED]\n")
                        r_ok.bold = True
                        r_ok.font.color.rgb = RGBColor(22, 163, 74)
                        p_rem.add_run(f"{e.get('apa', '')}\n")
                        r_bib = p_rem.add_run(f"BibTeX:\n{e.get('bibtex', '')}")
                        r_bib.font.size = Pt(8.5)
        except Exception:
            pass

    else:
        doc.add_paragraph("No citation verdicts available.")

    # Legend
    doc.add_heading("Label Legend", level=1)

    legend_table = doc.add_table(rows=6, cols=2)
    legend_table.style = "Table Grid"

    legend_data = [
        ("VERIFIED", "Citation verified successfully through academic databases"),
        ("METADATA_ERROR", "Citation found but metadata (author, title, year) doesn't match"),
        ("SUSPECTED_HALLUCINATION", "Citation appears to be fabricated or non-existent"),
        ("UNRESOLVED", "Insufficient evidence to determine citation validity"),
        ("RESOURCE", "Citation is a URL/web resource (not academic paper)"),
        ("", ""),
    ]

    for i, (label, desc) in enumerate(legend_data):
        if i >= len(legend_table.rows):
            break
        row = legend_table.rows[i]
        row.cells[0].text = label
        row.cells[1].text = desc
        if label == "VERIFIED":
            row.cells[0].paragraphs[0].runs[0].font.color.rgb = RGBColor(34, 197, 94)
        elif label == "METADATA_ERROR":
            row.cells[0].paragraphs[0].runs[0].font.color.rgb = RGBColor(234, 179, 8)
        elif label == "SUSPECTED_HALLUCINATION":
            row.cells[0].paragraphs[0].runs[0].font.color.rgb = RGBColor(239, 68, 68)

    # Disclaimer
    doc.add_paragraph()
    disclaimer = doc.add_paragraph()
    disclaimer_run = disclaimer.add_run(
        "DISCLAIMER: This report is a decision-support tool only. "
        "Final judgment on citation integrity requires expert human review. "
        "The system may produce false positives or false negatives."
    )
    disclaimer_run.font.size = Pt(9)
    disclaimer_run.font.italic = True

    # Save to bytes
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


def export_auto_healed_docx(
    essay_filename: str,
    verdicts: list[dict[str, Any]],
    style: str = "apa",
    original_docx_path: str | None = None,
) -> bytes:
    """Export an Auto-Healed Word (.docx) manuscript or standardized bibliography package.

    If ``original_docx_path`` points to an existing ``.docx`` file on disk, heals
    ``METADATA_ERROR`` bibliography paragraphs in-place, flags ``SUSPECTED_HALLUCINATION``
    paragraphs in red, and appends a structured Before -> After Change Log table.
    Otherwise (e.g. for ``.pdf`` uploads), generates a clean Word ``.docx`` containing
    the ready-to-paste Auto-Healed Bibliography, Before -> After Change Log table,
    and BibTeX appendix.
    """
    from pathlib import Path

    from integrity_checker.export.bibliography_formatter import build_remediated_bibliography

    norm_style = "ieee" if (style or "").strip().lower() == "ieee" else "apa"
    rem_data = build_remediated_bibliography(essay_id=0, verdicts=verdicts, style=norm_style)
    entries: list[dict[str, Any]] = rem_data.get("entries") or []

    in_place_healed_count = 0
    used_original_docx = False
    doc = None

    if original_docx_path:
        orig_path = Path(original_docx_path)
        if (
            orig_path.is_file()
            and orig_path.suffix.lower() == ".docx"
            and _docx_xml_is_safe(str(orig_path))
        ):
            try:
                doc = Document(str(orig_path))
                used_original_docx = True
            except Exception:
                doc = None
                used_original_docx = False

    if doc is None:
        doc = Document()
        title = doc.add_heading("CITRA Auto-Healed Bibliography & Change Log", level=0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        sub = doc.add_paragraph()
        sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_sub = sub.add_run(
            f"Source Manuscript: {essay_filename}  |  Target Style: {norm_style.upper()}"
        )
        r_sub.italic = True
        r_sub.font.color.rgb = RGBColor(100, 116, 139)
    else:
        # Heal matching paragraphs in-place in the original .docx
        for para in doc.paragraphs:
            p_text = (para.text or "").strip()
            if len(p_text) < 15:
                continue
            p_lower = p_text.lower()
            for entry in entries:
                orig_raw = str(entry.get("original_raw") or "").strip()
                cited_title = str((entry.get("cited") or {}).get("title") or "").strip()
                matched = False
                if orig_raw and len(orig_raw) >= 18 and orig_raw[:45].lower() in p_lower or cited_title and len(cited_title) >= 18 and cited_title.lower() in p_lower:
                    matched = True
                if not matched:
                    continue

                healed_text = str(entry.get(norm_style) or entry.get("formatted") or "")
                if entry.get("is_hallucination"):
                    para.clear()
                    r_flag = para.add_run(
                        f"[CẢNH BÁO ĐỎ CITRA — NGHI VẤN NGUỒN BỊA ĐẶT / HALLUCINATION (CẦN XÓA)]: {p_text}"
                    )
                    r_flag.bold = True
                    r_flag.font.color.rgb = RGBColor(220, 38, 38)
                    in_place_healed_count += 1
                elif entry.get("is_error") and healed_text:
                    para.clear()
                    r_healed = para.add_run(healed_text)
                    r_healed.font.color.rgb = RGBColor(21, 128, 61)
                    r_tag = para.add_run(
                        f"  [Auto-Healed by CITRA: {', '.join(entry.get('diff_fields') or ['metadata'])}]"
                    )
                    r_tag.bold = True
                    r_tag.font.size = Pt(9)
                    r_tag.font.color.rgb = RGBColor(22, 163, 74)
                    in_place_healed_count += 1
                break

        doc.add_page_break()
        doc.add_heading("CITRA Auto-Remediation Appendix & Change Log", level=1)

    # Summary KPI paragraph
    total_cnt = int(rem_data.get("total_entries", len(entries)))
    repaired_cnt = int(rem_data.get("remediated_count", rem_data.get("repaired_count", 0)))
    hallucinated_cnt = int(rem_data.get("hallucination_count", rem_data.get("hallucinated_count", 0)))
    verified_cnt = max(0, total_cnt - repaired_cnt - hallucinated_cnt)

    kpi_p = doc.add_paragraph()
    kpi_run = kpi_p.add_run(
        f"Summary: {total_cnt} Total References  •  "
        f"{verified_cnt} Verified  •  "
        f"{repaired_cnt} Auto-Healed Metadata Errors  •  "
        f"{hallucinated_cnt} Flagged Hallucinations"
        + (f"  •  {in_place_healed_count} Paragraphs Healed In-Place" if used_original_docx else "")
    )
    kpi_run.bold = True

    # Section 1: Standardized Auto-Healed Reference List (Ready to Paste)
    doc.add_heading(
        f"1. Standardized Reference List ({norm_style.upper()}) — Auto-Healed",
        level=1,
    )
    if entries:
        for e in entries:
            p_ref = doc.add_paragraph()
            formatted_ref = str(e.get(norm_style) or e.get("formatted") or "")
            if e.get("is_hallucination"):
                r_bad = p_ref.add_run(
                    f"[REMOVE — SUSPECTED HALLUCINATION] {e.get('original_raw') or formatted_ref}"
                )
                r_bad.bold = True
                r_bad.font.color.rgb = RGBColor(220, 38, 38)
            elif e.get("is_error"):
                r_good = p_ref.add_run(formatted_ref)
                r_good.bold = True
                r_good.font.color.rgb = RGBColor(21, 128, 61)
                r_note = p_ref.add_run(
                    f"  [Auto-Healed: {', '.join(e.get('diff_fields') or ['metadata'])}]"
                )
                r_note.italic = True
                r_note.font.size = Pt(9)
                r_note.font.color.rgb = RGBColor(21, 128, 61)
            else:
                p_ref.add_run(formatted_ref)
    else:
        doc.add_paragraph("No bibliography entries found.")

    # Section 2: Before -> After Change Log Table
    doc.add_heading("2. Before → After Auto-Remediation Change Log", level=1)
    if entries:
        table = doc.add_table(rows=1, cols=5)
        table.style = "Table Grid"
        headers = [
            "#",
            "Status",
            "Repaired Fields",
            "Before (Original in Manuscript)",
            f"After (Canonical {norm_style.upper()})",
        ]
        for col_idx, h_text in enumerate(headers):
            cell = table.rows[0].cells[col_idx]
            cell.text = h_text
            if cell.paragraphs and cell.paragraphs[0].runs:
                cell.paragraphs[0].runs[0].bold = True

        for e in entries:
            row_cells = table.add_row().cells
            row_cells[0].text = str(e.get("index", ""))
            if e.get("is_hallucination"):
                status_str = "HALLUCINATION (REMOVE)"
            elif e.get("is_error"):
                status_str = "AUTO-HEALED"
            else:
                status_str = "VERIFIED"
            row_cells[1].text = status_str
            diff_fields = e.get("diff_fields") or []
            row_cells[2].text = ", ".join(str(f) for f in diff_fields) if diff_fields else "—"
            row_cells[3].text = str(e.get("original_raw") or "")
            row_cells[4].text = (
                "[DO NOT CITE — UNVERIFIED / FABRICATED SOURCE]"
                if e.get("is_hallucination")
                else str(e.get(norm_style) or e.get("formatted") or "")
            )
    else:
        doc.add_paragraph("No remediation changes recorded.")

    # Section 3: BibTeX Export Block
    combined_bibtex = str(rem_data.get("combined_bibtex") or "").strip()
    if combined_bibtex:
        doc.add_heading("3. Standardized BibTeX Entries (.bib)", level=1)
        p_bib = doc.add_paragraph()
        r_bib = p_bib.add_run(combined_bibtex)
        r_bib.font.size = Pt(8.5)

    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()
