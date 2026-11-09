"""Report endpoint — export JSON / CSV / PDF / DOCX (v1.2 schema)."""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime
from html import escape
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_current_user, get_db
from integrity_checker.api.progress import get_tracker
from integrity_checker.billing.plans import get_user_plan_policy
from integrity_checker.config import get_settings
from integrity_checker.db.models import User
from integrity_checker.db.repository import Repository
from integrity_checker.export.bibliography_formatter import build_remediated_bibliography
from integrity_checker.export.docx_exporter import export_auto_healed_docx, export_report_to_docx
from integrity_checker.pipeline.integrity_pipeline import _serialize_citation_link

router = APIRouter()


@router.get("/{essay_id}/report")
def get_report(
    essay_id: int,
    format: str = "json",
    auto_heal: bool = False,
    style: str = "apa",
    compare_with: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Export report theo format: json | csv | pdf | docx (supports auto_heal=true)."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    # SECURITY: Mandatory ownership / teacher class check
    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    # Subscription plan export format check (Basic allows json only; Pro/Ultra unlock pdf, docx, csv)
    if format in ("pdf", "docx", "csv"):
        policy = get_user_plan_policy(current_user)
        if format not in policy.allowed_export_formats:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Exporting reports in {format.upper()} format is a Pro / Ultra feature. "
                    f"Your current plan is {policy.name}. Please upgrade to unlock academic exports."
                ),
            )

    # If the pipeline is still running, return 425 so the frontend knows to keep polling.
    tracker = get_tracker()
    state = tracker.get(essay_id)
    if state is not None and state.status == "processing":
        persisted = tracker.load_persisted_snapshot(essay_id, essay_record=essay)
        if essay.cis_json and persisted is None:
            tracker.clear(essay_id)
        else:
            return JSONResponse(
                status_code=425,
                content={"detail": "Analysis in progress", "retry_after": 3},
                headers={"Retry-After": "3"},
            )

    verdicts = repo.get_verdicts(essay_id)

    if format == "csv":
        return _csv_response(essay.filename, verdicts)
    if format == "json":
        return _json_response(
            essay.filename,
            essay,
            verdicts,
            repo.get_citations(essay_id),
            repo=repo,
            compare_with=compare_with,
        )
    if format == "pdf":
        return _pdf_response(essay.filename, essay, verdicts)
    if format == "docx":
        if auto_heal:
            return _healed_docx_response(essay.filename, essay, verdicts, style=style)
        return _docx_response(essay.filename, essay, verdicts)
    raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")


@router.get("/{essay_id}/export-healed-docx")
def export_healed_docx_endpoint(
    essay_id: int,
    style: str = "apa",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Download an Auto-Healed Word (.docx) with repaired references & Before->After Change Log."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    policy = get_user_plan_policy(current_user)
    if "docx" not in policy.allowed_export_formats and current_user.role == "user":
        raise HTTPException(
            status_code=402,
            detail=(
                "Auto-Healed Word (.docx) Export is a Pro / Ultra feature. "
                f"Your current plan is {policy.name}. Please upgrade to unlock automated Word remediation."
            ),
        )

    verdicts = repo.get_verdicts(essay_id)
    return _healed_docx_response(essay.filename, essay, verdicts, style=style)


@router.get("/{essay_id}/revision-diff")
def get_revision_diff(
    essay_id: int,
    compare_with: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Compare this essay submission against a previous revision (v1 -> v2 delta)."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    verdicts = repo.get_verdicts(essay_id)
    diff = _compute_revision_diff(repo, essay, verdicts, compare_with_id=compare_with)
    if diff is None:
        return {
            "has_previous_revision": False,
            "current_essay_id": essay.id,
            "current_filename": essay.filename,
            "available_revisions": [],
        }
    return diff


@router.get("/{essay_id}/remediate")
def remediate_bibliography(
    essay_id: int,
    style: str = "apa",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Generate 1-Click Auto-Remediated Bibliography in APA, IEEE, TDTU, BibTeX, or RIS (Pro / Ultra / Teacher / Admin)."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    policy = get_user_plan_policy(current_user)
    if policy.tier == "basic" and current_user.role == "user":
        raise HTTPException(
            status_code=402,
            detail=(
                "1-Click Bibliography Auto-Remediation & BibTeX/RIS Studio is a Pro / Ultra feature. "
                f"Your current plan is {policy.name}. Please upgrade to unlock automated reference repair."
            ),
        )

    verdicts = repo.get_verdicts(essay_id)
    citations = repo.get_citations(essay_id)
    return build_remediated_bibliography(essay_id=essay_id, verdicts=verdicts, style=style, citations=citations)


def _deserialize_citation_link_json(json_str: str | None) -> dict[str, Any] | None:
    """Read citation_link_json column (v1.8) into the FIRST link's dict."""
    links = _deserialize_citation_links_json(json_str)
    return links[0] if links else None


def _deserialize_citation_links_json(json_str: str | None) -> list[dict[str, Any]]:
    """Read citation_link_json column into a LIST of link dicts (v1.9).

    v1.8 stored a single object; rows written before that upgrade must keep
    working, so a bare dict is read as a one-element list. Returns ``[]`` when
    the column is NULL/empty/unparseable.
    """
    if not json_str:
        return []
    try:
        data = json.loads(json_str)
    except (json.JSONDecodeError, TypeError):
        return []
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    return []


def _serialize_extracted_citation(c) -> dict[str, Any]:
    """One row of the API's ``extracted_citations`` payload.

    Reads the linking layer persisted in v1.8 on ``CitationRecord``, preferring
    the in-memory attributes of a freshly produced report. Emits BOTH the
    lossless ``citation_links`` list (v1.9 — an occurrence may cite several
    references, "[9, 10]") and the single ``citation_link`` scalar so older
    consumers keep working.
    """
    all_links = _deserialize_citation_links_json(
        getattr(c, "citation_link_json", None)
    )
    # A freshly produced report holds live CitationLink objects that are richer
    # than the persisted subset, so prefer them when present.
    live_links = getattr(c, "citation_links", None)
    if live_links:
        all_links = [_serialize_citation_link(link) for link in live_links]
    elif not all_links:
        live_one = _serialize_citation_link(getattr(c, "citation_link", None))
        if live_one:
            all_links = [live_one]

    first_link = all_links[0] if all_links else None
    return {
        "id": c.id,
        "raw_text": c.raw_text,
        "citation_type": c.citation_type,
        "style": c.style,
        "page_num": c.page_num,
        "confidence": c.confidence,
        # NEW v1.16 — surrounding PDF text, so the Document Inspector can
        # show the sentence the citation appears in.
        "context": getattr(c, "context", None),
        # NEW v1.7/v1.8 — linking layer for UI Citations tab.
        "mapping_status": getattr(c, "mapping_status", None)
        or (first_link or {}).get("status"),
        "mapping_confidence": getattr(c, "mapping_confidence", 0.0),
        # v1.9 — the lossless LIST; the scalar below is kept for older readers.
        "citation_links": all_links,
        "citation_link": _serialize_citation_link(getattr(c, "citation_link", None))
        or first_link,
    }


def _compute_in_text_citation_index(
    citations: list,
) -> tuple[dict[str, dict[str, Any]], dict[int, str]]:
    """Index in-text citations by their link's reference_id.

    Returns:
        in_text_by_ref: maps ``ref-NNNN`` → {count, pages[]} (de-duped pages).
        ref_link_by_record_id: maps a reference CitationRecord.id → the
            ``ref-NNNN`` string used by the linker for the same position in
            the bibliography (so the frontend can look up "Ref #3" given
            ``citation_link.reference_id``).
    """
    in_text_by_ref: dict[str, dict[str, Any]] = {}
    for c in citations:
        if c.citation_type not in {"in_text", "numeric"}:
            continue
        # v1.9 — one occurrence may cite SEVERAL references ("[9, 10]"), so
        # every link must be counted. Reading only link_dict[0] left ref #9
        # with a "cited in text" count that was short by one.
        for link_dict in _deserialize_citation_links_json(
            getattr(c, "citation_link_json", None)
        ):
            ref_link_id = link_dict.get("reference_id")
            if not ref_link_id:
                continue
            entry = in_text_by_ref.setdefault(
                ref_link_id, {"count": 0, "pages": []}
            )
            entry["count"] += 1
            if getattr(c, "page_num", 0):
                entry["pages"].append(c.page_num)

    # Map each reference DB row (insertion order = bibliography order) to the
    # synthetic ``ref-NNNN`` id the linker uses for it.
    #
    # The linker numbers references 1-BASED — ``_run_linking`` does
    # ``f"ref-{idx + 1:04d}"`` over the bibliography — so row i is ``ref-(i+1)``.
    # This must match, otherwise every ``cited_in_text_count`` / ``cited_on_pages``
    # lands on the neighbouring reference (off by one).
    ref_records_sorted = sorted(
        [c for c in citations if c.citation_type == "reference_list"],
        key=lambda c: c.id,
    )
    ref_link_by_record_id = {
        r.id: f"ref-{i + 1:04d}" for i, r in enumerate(ref_records_sorted)
    }

    return in_text_by_ref, ref_link_by_record_id


_CSV_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _sanitize_csv_cell(val: Any) -> Any:
    """Neutralize spreadsheet formula injection in CSV string cells."""
    if isinstance(val, str) and val.startswith(_CSV_DANGEROUS_PREFIXES):
        return f"'{val}"
    return val


def _safe_content_disposition(filename: str, suffix: str) -> str:
    """Sanitize filename for Content-Disposition header (prevent CR/LF and quote injection)."""
    safe_ascii = "".join(
        ch if (32 <= ord(ch) < 127 and ch not in ('"', "\\", ";", "\r", "\n")) else "_"
        for ch in (filename or "essay")
    ).strip() or "essay"
    return f'attachment; filename="{safe_ascii}.{suffix}"'


def _csv_response(filename: str, verdicts: list) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    # v1.2 CSV: include both integrity + source layers
    writer.writerow([
        "citation_raw", "label", "confidence",
        "mapping_status", "mapping_confidence",
        "reasoning", "triggered_rules", "mismatched_fields",
        "is_overridden", "style_penalty", "domain_exception"
    ])
    for v in verdicts:
        writer.writerow([
            _sanitize_csv_cell(v.citation_raw),
            _sanitize_csv_cell(v.label),
            f"{v.confidence:.4f}",
            _sanitize_csv_cell(v.mapping_status or "matched"),
            f"{v.mapping_confidence:.4f}",
            _sanitize_csv_cell(v.reasoning),
            _sanitize_csv_cell(v.triggered_rules),
            _sanitize_csv_cell(v.mismatched_fields),
            "1" if v.is_overridden else "0",
            f"{v.style_penalty:.4f}" if v.style_penalty else "",
            "1" if v.domain_exception else "0",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": _safe_content_disposition(filename, "report.csv")
        },
    )


def _is_sandbox_manuscript(filename: str | None) -> bool:
    """Return True if the filename belongs to a synthetic Live Sandbox run."""
    raw = (filename or "").strip().lower()
    return (
        raw.startswith("citra_acl_sandbox")
        or "acl_sandbox" in raw
        or raw in {"sandbox.pdf", "sandbox"}
    )


def _normalize_manuscript_stem(filename: str | None) -> str:
    """Normalize a filename to its base stem for automatic v1 -> v2 revision matching."""
    import re
    from pathlib import Path

    raw = Path(filename or "essay").stem.lower().strip()
    cleaned = re.sub(
        r"(?:[_\-\s]+(?:v\d+(?:\.\d+)?|rev\d*|version\d*|draft\d*|final|fixed|remediated|updated|corrected|revised|edited|healed|auto[_\-\s]*healed|clean|copy)|\s*\(\d+\))+$",
        "",
        raw,
        flags=re.IGNORECASE,
    ).strip(" _-")
    return cleaned or raw or "essay"


def _is_same_manuscript_family(stem_a: str, stem_b: str) -> bool:
    """Check whether two normalized manuscript stems represent revisions of the same paper."""
    a = (stem_a or "").strip().lower()
    b = (stem_b or "").strip().lower()
    if not a or not b or a == "essay" or b == "essay":
        return False
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= 12 and (
        longer.startswith(f"{shorter}_")
        or longer.startswith(f"{shorter}-")
        or longer.startswith(f"{shorter} ")
    ):
        return True
    return False


def _verdict_canonical_key(citation_raw: str | None) -> str:
    """Build a stable matching key for comparing citations across manuscript revisions."""
    import re

    text = (citation_raw or "").strip().lower()
    if not text:
        return ""
    doi_m = re.search(r"10\.\d{4,9}/[^\s,;)\]]+", text)
    if doi_m:
        return f"doi:{doi_m.group(0).rstrip('.')}"
    words = re.findall(r"[a-z0-9]{3,}", text)
    return " ".join(words[:14])


def _extract_essay_cis_score(essay_row, verdicts_rows: list) -> float:
    """Extract CIS score from essay row JSON or fallback to verified ratio."""
    if getattr(essay_row, "cis_json", None):
        try:
            parsed = json.loads(essay_row.cis_json)
            if isinstance(parsed, dict) and parsed.get("score") is not None:
                return round(float(parsed["score"]), 1)
        except Exception:
            pass
    academic = [v for v in verdicts_rows if getattr(v, "label", "") != "resource"]
    if not academic:
        return 0.0
    ver = sum(1 for v in academic if getattr(v, "label", "") == "verified")
    return round((ver / len(academic)) * 100.0, 1)


def _compute_revision_diff(
    repo: Repository,
    essay,
    current_verdicts: list,
    compare_with_id: int | None = None,
) -> dict[str, Any] | None:
    """Compute v1 -> v2 revision delta against a prior essay submission of the same manuscript."""
    # Synthetic Live Sandbox runs are standalone test manuscripts, not v1 -> v2 revisions
    if compare_with_id is None and _is_sandbox_manuscript(getattr(essay, "filename", None)):
        return None

    try:
        if essay.user_id is not None:
            candidates = repo.get_user_essays(essay.user_id)
        else:
            candidates = repo.get_all_essays()
    except Exception:
        return None

    other_essays = [e for e in candidates if e.id != essay.id]
    if not other_essays:
        return None

    cur_stem = _normalize_manuscript_stem(essay.filename)
    available_revisions: list[dict[str, Any]] = []
    chosen_prev = None

    # Sort older/other essays by uploaded_at descending; only include revisions of the same manuscript
    for cand in other_essays:
        is_explicit_target = compare_with_id is not None and cand.id == compare_with_id
        if not is_explicit_target and _is_sandbox_manuscript(getattr(cand, "filename", None)):
            continue
        cand_verdicts = repo.get_verdicts(cand.id)
        if not cand_verdicts and not getattr(cand, "cis_json", None):
            continue
        cand_stem = _normalize_manuscript_stem(cand.filename)
        is_same_stem = _is_same_manuscript_family(cur_stem, cand_stem)
        if not is_same_stem and not is_explicit_target:
            continue
        if cand.id > essay.id and not is_explicit_target:
            continue
        cand_cis = _extract_essay_cis_score(cand, cand_verdicts)
        available_revisions.append({
            "essay_id": cand.id,
            "filename": cand.filename,
            "uploaded_at": cand.uploaded_at.isoformat() if cand.uploaded_at else None,
            "cis_score": cand_cis,
            "num_verdicts": len(cand_verdicts),
            "is_same_stem": is_same_stem,
        })
        if is_explicit_target:
            chosen_prev = (cand, cand_verdicts, cand_cis, is_same_stem)

    if not available_revisions:
        return None

    if chosen_prev is None:
        # Only match the most recent older essay belonging to the same manuscript family
        prior_same_stem = [
            e for e in other_essays
            if not _is_sandbox_manuscript(getattr(e, "filename", None))
            and _is_same_manuscript_family(cur_stem, _normalize_manuscript_stem(e.filename))
            and e.id < essay.id
        ]
        target_cand = prior_same_stem[0] if prior_same_stem else None
        if target_cand is not None:
            tv = repo.get_verdicts(target_cand.id)
            if tv or getattr(target_cand, "cis_json", None):
                ts = _normalize_manuscript_stem(target_cand.filename)
                chosen_prev = (
                    target_cand,
                    tv,
                    _extract_essay_cis_score(target_cand, tv),
                    _is_same_manuscript_family(cur_stem, ts),
                )

    if chosen_prev is None:
        return None

    prev_essay, prev_verdicts, cis_before, is_same_stem = chosen_prev
    cis_after = _extract_essay_cis_score(essay, current_verdicts)
    cis_delta = round(cis_after - cis_before, 1)

    def _count_labels(v_list: list) -> dict[str, int]:
        return {
            "total": len(v_list),
            "verified": sum(1 for v in v_list if getattr(v, "label", "") == "verified"),
            "metadata_error": sum(1 for v in v_list if getattr(v, "label", "") == "metadata_error"),
            "suspected_hallucination": sum(
                1 for v in v_list if getattr(v, "label", "") == "suspected_hallucination"
            ),
            "unresolved": sum(1 for v in v_list if getattr(v, "label", "") == "unresolved"),
        }

    counts_before = _count_labels(prev_verdicts)
    counts_after = _count_labels(current_verdicts)
    counts_delta = {
        k: counts_after[k] - counts_before[k]
        for k in ("total", "verified", "metadata_error", "suspected_hallucination", "unresolved")
    }

    prev_by_key = {_verdict_canonical_key(v.citation_raw): v for v in prev_verdicts if _verdict_canonical_key(v.citation_raw)}
    cur_by_key = {_verdict_canonical_key(v.citation_raw): v for v in current_verdicts if _verdict_canonical_key(v.citation_raw)}

    resolved_issues: list[dict[str, Any]] = []
    persisting_issues: list[dict[str, Any]] = []
    new_issues: list[dict[str, Any]] = []
    citation_changes: list[dict[str, Any]] = []

    issue_labels = {"metadata_error", "suspected_hallucination", "unresolved"}

    for key, pv in prev_by_key.items():
        p_lbl = str(getattr(pv, "label", "")).lower()
        cv = cur_by_key.get(key)
        if cv is not None:
            c_lbl = str(getattr(cv, "label", "")).lower()
            if p_lbl in issue_labels and c_lbl == "verified":
                item = {
                    "citation_raw": cv.citation_raw,
                    "before_label": p_lbl,
                    "after_label": c_lbl,
                    "transition": "fixed",
                }
                resolved_issues.append(item)
                citation_changes.append(item)
            elif p_lbl in issue_labels and c_lbl in issue_labels:
                item = {
                    "citation_raw": cv.citation_raw,
                    "before_label": p_lbl,
                    "after_label": c_lbl,
                    "transition": "unchanged_issue",
                }
                persisting_issues.append(item)
                citation_changes.append(item)
            elif p_lbl == "verified" and c_lbl in issue_labels:
                item = {
                    "citation_raw": cv.citation_raw,
                    "before_label": p_lbl,
                    "after_label": c_lbl,
                    "transition": "regressed",
                }
                new_issues.append(item)
                citation_changes.append(item)
        else:
            if p_lbl == "suspected_hallucination":
                item = {
                    "citation_raw": pv.citation_raw,
                    "before_label": p_lbl,
                    "after_label": "removed",
                    "transition": "removed_hallucination",
                }
                resolved_issues.append(item)
                citation_changes.append(item)
            elif p_lbl == "metadata_error":
                # Likely repaired to a new canonical string if total metadata_error decreased
                if counts_after["metadata_error"] < counts_before["metadata_error"]:
                    item = {
                        "citation_raw": pv.citation_raw,
                        "before_label": p_lbl,
                        "after_label": "verified",
                        "transition": "fixed_and_reformatted",
                    }
                    resolved_issues.append(item)
                    citation_changes.append(item)

    for key, cv in cur_by_key.items():
        if key not in prev_by_key:
            c_lbl = str(getattr(cv, "label", "")).lower()
            if c_lbl in issue_labels:
                item = {
                    "citation_raw": cv.citation_raw,
                    "before_label": "none",
                    "after_label": c_lbl,
                    "transition": "new_issue",
                }
                new_issues.append(item)
                citation_changes.append(item)

    return {
        "has_previous_revision": True,
        "is_same_manuscript_family": is_same_stem,
        "previous_essay_id": prev_essay.id,
        "previous_filename": prev_essay.filename,
        "previous_uploaded_at": prev_essay.uploaded_at.isoformat() if prev_essay.uploaded_at else None,
        "current_essay_id": essay.id,
        "current_filename": essay.filename,
        "current_uploaded_at": essay.uploaded_at.isoformat() if essay.uploaded_at else None,
        "cis_before": cis_before,
        "cis_after": cis_after,
        "cis_delta": cis_delta,
        "counts_before": counts_before,
        "counts_after": counts_after,
        "counts_delta": counts_delta,
        "resolved_issues_count": len(resolved_issues),
        "persisting_issues_count": len(persisting_issues),
        "new_issues_count": len(new_issues),
        "resolved_issues": resolved_issues[:20],
        "persisting_issues": persisting_issues[:20],
        "new_issues": new_issues[:20],
        "citation_changes": citation_changes[:30],
        "available_revisions": available_revisions[:15],
    }


def _extract_document_diagnostics(
    essay,
    style_profile_dict: dict[str, Any] | None,
    citations: list,
    verdicts: list,
) -> dict[str, Any]:
    """Build or recover Scanned PDF Guardrail diagnostics for the report payload."""
    diag = (
        dict(style_profile_dict.get("document_diagnostics"))
        if isinstance(style_profile_dict, dict)
        and isinstance(style_profile_dict.get("document_diagnostics"), dict)
        else {}
    )
    if diag and "is_scanned_pdf" in diag:
        return diag

    is_docx = str(getattr(essay, "filename", "") or "").lower().endswith(".docx")
    num_pages = int(getattr(essay, "num_pages", 0) or 0)
    has_no_extractions = len(citations) == 0 and len(verdicts) == 0
    is_scanned = bool(not is_docx and num_pages > 0 and has_no_extractions)
    return {
        "is_scanned_pdf": is_scanned,
        "scanned_pages_count": num_pages if is_scanned else 0,
        "total_extractable_chars": 0 if is_scanned else -1,
        "avg_chars_per_page": 0.0 if is_scanned else -1.0,
        "warning_code": "SCANNED_PDF_DETECTED" if is_scanned else None,
        "warning_message": (
            "Phát hiện tài liệu PDF dạng ảnh quét (Scanned/Image-only PDF) thiếu lớp văn bản số hóa (Text Layer). "
            "Vui lòng chuyển đổi qua OCR hoặc tải lên bản gốc .docx / PDF xuất trực tiếp từ Word/LaTeX để đạt độ chính xác kiểm chứng trích dẫn tối đa."
            if is_scanned
            else None
        ),
        "parser_warnings": ["SCANNED_PDF_DETECTED"] if is_scanned else [],
    }


def _json_response(
    filename: str,
    essay,
    verdicts: list,
    citations: list | None = None,
    repo: Repository | None = None,
    compare_with: int | None = None,
) -> StreamingResponse:
    import re as _re

    settings = get_settings()
    citations = citations or []

    # Filter legacy false-positive noise tokens (e.g. "(Round 1)", "[0000-0000-0000-0000]")
    _legacy_noise_intext_re = _re.compile(
        r"^(?:\(\s*(?:Round|Cycle|Iteration|Pass|Tier|Split|Cluster|Stage|Step|Phase|Part|Level|Group|Fold|Batch|Epoch|Layer|Block|Module|Section|Table|Fig(?:ure)?|Appendix|Model|Method|Case|Type|Class|Grade|Rank|Score|Item|Point|Rule|Task|Topic|Sample|User|Comment|Label|Prompt|Query)s?\s+\d+\s*\)|\[\s*0[\d\s,\-\u2013\u2014]*\])$",
        _re.IGNORECASE,
    )
    citations = [
        c
        for c in citations
        if not (
            getattr(c, "citation_type", None) in {"in_text", "numeric"}
            and _legacy_noise_intext_re.match((getattr(c, "raw_text", "") or "").strip())
        )
    ]

    # Build linking summary
    linking_summary = {
        "matched": 0,
        "missing_reference": 0,
        "uncited_reference": 0,
        "in_text_mismatch": 0,
        "duplicate_reference": 0,
        "ambiguous_mapping": 0,
        "style_inconsistent": 0,
        "unresolved": 0,
    }
    verdict_list = []
    citation_types = {c.raw_text: c.citation_type for c in citations}
    _non_matched_intext_statuses = (
        "missing_reference",
        "in_text_mismatch",
        "ambiguous_mapping",
        "style_inconsistent",
        "unresolved",
    )
    for c in citations:
        if getattr(c, "citation_type", None) in {"in_text", "numeric"}:
            raw_link_json = getattr(c, "citation_link_json", None)
            counted_from_json = False
            if raw_link_json:
                try:
                    parsed_links = json.loads(raw_link_json)
                    if isinstance(parsed_links, dict):
                        parsed_links = [parsed_links]
                    if isinstance(parsed_links, list) and parsed_links:
                        counted_from_json = True
                        for pl in parsed_links:
                            if isinstance(pl, dict):
                                l_status = pl.get("status")
                                if l_status in _non_matched_intext_statuses:
                                    linking_summary[l_status] = linking_summary.get(l_status, 0) + 1
                except Exception:  # noqa: BLE001
                    counted_from_json = False
            if not counted_from_json:
                c_status = getattr(c, "mapping_status", None)
                if c_status in _non_matched_intext_statuses:
                    linking_summary[c_status] = linking_summary.get(c_status, 0) + 1

    for v in verdicts:
        status = v.mapping_status or "matched"
        linking_summary[status] = linking_summary.get(status, 0) + 1

        # Reconstruct matched_sources from the features JSON blob (written there by
        # repository.add_verdicts).  If absent (pre-fix rows), fall back to an
        # empty list so the UI never receives undefined.
        features_dict = json.loads(v.features or "{}")
        matched_sources = features_dict.get("matched_sources", [])

        verdict_list.append({
            "citation_id": f"v{v.id}",
            "citation_raw": v.citation_raw,
            "citation_type": citation_types.get(v.citation_raw, "unknown"),
            # NEW v1.16 — surrounding PDF text, so the Document Inspector can
            # show the sentence the citation appears in.
            "context": v.context,
            "citation_link": features_dict.get("citation_link"),
            # Integrity layer
            "mapping_status": status,
            "mapping_confidence": v.mapping_confidence,
            "style_penalty": v.style_penalty,
            "domain_exception": bool(v.domain_exception),
            # Source layer
            "label": v.label,
            "confidence": v.confidence,
            "reasoning": v.reasoning,
            "triggered_rules": json.loads(v.triggered_rules or "[]"),
            "mismatched_fields": json.loads(v.mismatched_fields or "[]"),
            "features": features_dict,
            "url_status": features_dict.get("url_status"),
            "url_status_code": features_dict.get("url_status_code"),
            "archive_url": features_dict.get("archive_url"),
            "is_retracted": bool(
                features_dict.get("is_retracted", False)
                or ("R-RETRACTED-PAPER" in json.loads(v.triggered_rules or "[]"))
            ),
            "matched_sources": matched_sources,
            # Override
            "is_overridden": bool(v.is_overridden),
            "override_note": v.override_note,
        })

    # Ưu tiên dùng CIS đầy đủ từ pipeline (lưu DB) — fallback về simple estimation
    in_text_count = sum(
        1 for c in citations if c.citation_type in {"in_text", "numeric"}
    )
    reference_count = sum(1 for c in citations if c.citation_type == "reference_list")
    total = in_text_count or len(verdicts)
    academic_verdicts = [v for v in verdicts if v.label != "resource"]
    academic_total = len(academic_verdicts)
    verified = sum(1 for v in academic_verdicts if v.label == "verified")

    style_profile_dict = None
    cis_dict = None
    if essay.style_profile_json:
        try:
            style_profile_dict = json.loads(essay.style_profile_json)
        except (json.JSONDecodeError, TypeError):
            pass
    if essay.cis_json:
        try:
            cis_dict = json.loads(essay.cis_json)
        except (json.JSONDecodeError, TypeError):
            pass

    if cis_dict is None:
        # Fallback: simple estimation
        cis_score = round((verified / academic_total * 100) if academic_total > 0 else 0, 1)
        cis_dict = {
            "score": cis_score,
            "components": {
                "verified_ratio": verified / academic_total if academic_total > 0 else 0,
                "metadata_accuracy": 0,
                "in_text_bib_consistency": linking_summary["matched"] / academic_total if academic_total > 0 else 0,
                "format_consistency": 0,
                "identifier_validity": 0,
            },
            "weights_used": {},
            "num_citations": academic_total,
            "num_unresolved": sum(1 for v in academic_verdicts if v.label == "unresolved"),
            "disclaimer": "",
        }

    # v1.2 schema: trả về flat fields (essay_id, filename, num_pages, num_citations)
    # ở top-level để frontend `AnalysisReport` interface map 1-1.
    # Giữ `essay` nested để không phá clients khác (CSV/PDF export, scripts).
    # NEW v1.8 — index in-text citations for the References tab
    # ("cited in text" indicator) and the Citations tab (Linked Reference).
    in_text_by_ref, ref_link_by_record_id = _compute_in_text_citation_index(citations)

    payload = {
        "essay_id": essay.id,
        "filename": essay.filename,
        "num_pages": essay.num_pages,
        "num_citations": total,
        "num_references": reference_count,
        "extracted_citations": [
            _serialize_extracted_citation(c)
            for c in citations
            if c.citation_type in {"in_text", "numeric"}
        ],
        "essay": {
            "id": essay.id,
            "filename": essay.filename,
            "num_pages": essay.num_pages,
            "uploaded_at": essay.uploaded_at.isoformat() if essay.uploaded_at else None,
        },
        "style_profile": style_profile_dict,
        "linking_summary": linking_summary,
        "verdicts": verdict_list,
        "references": [
            {
                "id": c.id,
                "raw_text": c.raw_text,
                "citation_type": c.citation_type,
                "style": c.style,
                "authors": json.loads(c.authors or "[]"),
                "year": c.year,
                "title": c.title,
                "venue": c.venue,
                "doi": c.doi,
                "url": c.url,
                "page_num": c.page_num,
                "confidence": c.confidence,
                # NEW v1.16 — surrounding PDF text (borrowed from the in-text
                # occurrence that cites this entry, when there is one).
                "context": getattr(c, "context", None),
                # NEW v1.8 — "cited in text" indicator for the References tab
                "cited_in_text_count": in_text_by_ref.get(
                    ref_link_by_record_id.get(c.id, ""), {"count": 0}
                )["count"],
                "cited_on_pages": sorted(set(
                    in_text_by_ref.get(
                        ref_link_by_record_id.get(c.id, ""), {"pages": []}
                    )["pages"]
                )),
            }
            for c in citations
            if c.citation_type == "reference_list"
        ],
        "cis": cis_dict,
        "document_diagnostics": _extract_document_diagnostics(
            essay, style_profile_dict, citations, verdicts
        ),
        "revision_diff": (
            _compute_revision_diff(repo, essay, verdicts, compare_with_id=compare_with)
            if repo is not None
            else None
        ),
        "disclaimer": settings.disclaimer.long,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    return StreamingResponse(
        iter([body]),
        media_type="application/json",
        headers={
            "Content-Disposition": _safe_content_disposition(filename, "report.json")
        },
    )


def _build_qr_seal_drawing(seed: str, size: float = 68.0) -> Any:
    """Build a genuine ISO/IEC 18004 camera-scannable ReportLab vector QR seal with 4-module quiet zone."""
    from reportlab.graphics.shapes import Drawing, Rect

    from integrity_checker.api.routes.essays import generate_qr_matrix

    matrix = generate_qr_matrix(seed)
    dim = len(matrix)
    quiet = 4
    total_dim = dim + 2 * quiet
    cell = size / total_dim
    drawing = Drawing(size, size)
    drawing.add(
        Rect(
            0,
            0,
            size,
            size,
            fillColor=colors.white,
            strokeColor=colors.HexColor("#cbd5e1"),
            strokeWidth=0.6,
        )
    )

    dark_color = colors.HexColor("#0f172a")
    for r in range(dim):
        for c in range(dim):
            if matrix[r][c]:
                drawing.add(
                    Rect(
                        (c + quiet) * cell,
                        (total_dim - 1 - (r + quiet)) * cell,
                        cell,
                        cell,
                        fillColor=dark_color,
                        strokeColor=dark_color,
                        strokeWidth=0.06,
                    )
                )
    return drawing


def _generate_pdf_bytes(essay, verdicts: list) -> bytes:
    """Generate PDF report bytes with tamper-evident Digital Verification Receipt & QR seal."""
    from integrity_checker.api.routes.essays import create_essay_share_token

    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=16,
        spaceAfter=12,
    )
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=12,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontSize=10,
        spaceAfter=6,
    )
    receipt_style = ParagraphStyle(
        'ReceiptBody',
        parent=styles['Normal'],
        fontSize=8.5,
        leading=11,
        spaceAfter=2,
    )
    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontSize=8,
        leading=9,
        spaceAfter=0,
        wordWrap='LTR',
    )
    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=table_cell_style,
        textColor=colors.whitesmoke,
        fontName='Helvetica-Bold',
    )

    elements: list[Any] = []

    # Title
    elements.append(Paragraph("Citation Integrity Report", title_style))
    elements.append(Spacer(1, 0.3 * cm))

    # Essay info (escape filename to prevent ReportLab XML/HTML tag injection & SSRF)
    essay_id_val = int(getattr(essay, "id", 1) or 1)
    utc_now_str = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    elements.append(Paragraph(f"<b>File:</b> {escape(essay.filename or '')}", body_style))
    elements.append(Paragraph(f"<b>Essay ID:</b> {essay_id_val}", body_style))
    elements.append(Paragraph(f"<b>Pages:</b> {essay.num_pages}", body_style))
    elements.append(Paragraph(f"<b>Generated:</b> {utc_now_str}", body_style))

    # Digital Verification Receipt & Vector QR Seal (Task 6.2)
    share_info = create_essay_share_token(essay_id_val)
    receipt_id = str(share_info["receipt_id"])
    sig_prefix = str(share_info.get("signature_prefix") or "")
    verification_url = str(
        share_info.get("verification_url")
        or f"https://citra.io.vn/verify/share/{share_info['share_token']}"
    )

    qr_drawing = _build_qr_seal_drawing(verification_url, size=68.0)
    receipt_text_block = [
        Paragraph("<b>CITRA Digital Verification Receipt (HMAC-SHA256)</b>", receipt_style),
        Paragraph(f"<b>Receipt ID:</b> {escape(receipt_id)}", receipt_style),
        Paragraph(f"<b>HMAC-SHA256 Signature Prefix:</b> {escape(sig_prefix)}", receipt_style),
        Paragraph(f"<b>Verification URL:</b> {escape(verification_url)}", receipt_style),
    ]
    receipt_box = Table(
        [[receipt_text_block, qr_drawing]],
        colWidths=[13.8 * cm, 2.8 * cm],
    )
    receipt_box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#6366f1")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 0), (1, 0), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    elements.append(Spacer(1, 0.25 * cm))
    elements.append(receipt_box)
    elements.append(Spacer(1, 0.4 * cm))

    # Summary stats
    total = len(verdicts)
    verified = sum(1 for v in verdicts if v.label == "verified")
    metadata_error = sum(1 for v in verdicts if v.label == "metadata_error")
    suspected = sum(1 for v in verdicts if v.label == "suspected_hallucination")
    unresolved = sum(1 for v in verdicts if v.label == "unresolved")

    matched = sum(1 for v in verdicts if v.mapping_status == "matched")
    missing_ref = sum(1 for v in verdicts if v.mapping_status == "missing_reference")
    mismatched = sum(1 for v in verdicts if v.mapping_status == "in_text_mismatch")

    cis_score_val = None
    cis_comps: dict[str, float] = {}
    if essay.cis_json:
        try:
            parsed_cis = json.loads(essay.cis_json)
            if isinstance(parsed_cis, dict):
                cis_score_val = parsed_cis.get("score")
                cis_comps = parsed_cis.get("components") or {}
        except Exception:
            pass
    if cis_score_val is not None:
        elements.append(
            Paragraph(
                f"<b>Citation Integrity Score (CIS):</b> {float(cis_score_val):.1f} / 100",
                heading_style,
            )
        )
        if cis_comps:
            comp_str = (
                f"Verified Ratio: {float(cis_comps.get('verified_ratio', 0))*100:.0f}% | "
                f"Metadata Accuracy: {float(cis_comps.get('metadata_accuracy', 0))*100:.0f}% | "
                f"Layer-1 Consistency: {float(cis_comps.get('in_text_bib_consistency', 0))*100:.0f}% | "
                f"Format Consistency: {float(cis_comps.get('format_consistency', 0))*100:.0f}% | "
                f"DOI Validity: {float(cis_comps.get('identifier_validity', 0))*100:.0f}%"
            )
            elements.append(Paragraph(escape(comp_str), body_style))
        elements.append(Spacer(1, 0.3 * cm))

    elements.append(Paragraph("Summary", heading_style))

    summary_data = [
        ["Metric", "Count", "Percentage"],
        ["Total Citations", str(total), "100%"],
        ["--- Source Layer ---", "", ""],
        ["Verified", str(verified), f"{verified/total*100:.1f}%" if total > 0 else "0%"],
        ["Metadata Error", str(metadata_error), f"{metadata_error/total*100:.1f}%" if total > 0 else "0%"],
        ["Suspected Hallucination", str(suspected), f"{suspected/total*100:.1f}%" if total > 0 else "0%"],
        ["Unresolved", str(unresolved), f"{unresolved/total*100:.1f}%" if total > 0 else "0%"],
        ["--- Integrity Layer ---", "", ""],
        ["Matched", str(matched), f"{matched/total*100:.1f}%" if total > 0 else "0%"],
        ["Missing Reference", str(missing_ref), f"{missing_ref/total*100:.1f}%" if total > 0 else "0%"],
        ["In-Text Mismatch", str(mismatched), f"{mismatched/total*100:.1f}%" if total > 0 else "0%"],
    ]

    summary_table = Table(summary_data, colWidths=[5 * cm, 3 * cm, 3 * cm])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2563eb')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#dcfce7')),  # Total
        ('BACKGROUND', (0, 3), (-1, 3), colors.HexColor('#f3f4f6')),  # Separator
        ('BACKGROUND', (0, 7), (-1, 7), colors.HexColor('#f3f4f6')),  # Separator
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 0.5 * cm))

    # Verdict details table
    elements.append(Paragraph("Citation Details", heading_style))

    verdict_data = [[
        Paragraph("#", table_header_style),
        Paragraph("Citation Raw", table_header_style),
        Paragraph("Source Status", table_header_style),
        Paragraph("Mapping Status", table_header_style),
        Paragraph("Confidence", table_header_style),
    ]]

    for i, v in enumerate(verdicts, 1):
        source_status = _format_label(v.label)
        mapping_status = _format_mapping_status(v.mapping_status or "matched")
        confidence = f"{v.confidence * 100:.0f}%"

        verdict_data.append([
            Paragraph(str(i), table_cell_style),
            Paragraph(escape(v.citation_raw), table_cell_style),
            Paragraph(escape(source_status), table_cell_style),
            Paragraph(escape(mapping_status), table_cell_style),
            Paragraph(escape(confidence), table_cell_style),
        ])

    verdict_table = Table(
        verdict_data,
        colWidths=[1 * cm, 6 * cm, 3 * cm, 3 * cm, 2 * cm],
        repeatRows=1,
    )
    verdict_table_styles = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#374151')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (1, 1), (1, -1), 'LEFT'),  # Left align citation text
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]
    for row_idx, v in enumerate(verdicts, 1):
        raw_lbl = (v.label or "").lower()
        status_label = _format_label(v.label)
        if raw_lbl in ("verified", "resource") or status_label in ("Verified", "Valid"):
            verdict_table_styles.append(('TEXTCOLOR', (2, row_idx), (2, row_idx), colors.HexColor('#15803d')))
        elif raw_lbl == "metadata_error" or status_label == "Metadata Error" or raw_lbl == "suspected_hallucination" or status_label in ("Suspected", "Suspected Hallucination"):
            verdict_table_styles.append(('TEXTCOLOR', (1, row_idx), (2, row_idx), colors.HexColor('#dc2626')))
    verdict_table.setStyle(TableStyle(verdict_table_styles))
    elements.append(verdict_table)

    # Build PDF
    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()


def _pdf_response(filename: str, essay, verdicts: list) -> StreamingResponse:
    """Generate PDF report with 2-layer analysis and Digital Verification Receipt."""
    pdf_bytes = _generate_pdf_bytes(essay, verdicts)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": _safe_content_disposition(filename, "report.pdf")
        },
    )


def _docx_response(filename: str, essay, verdicts: list) -> StreamingResponse:
    """Generate DOCX report with 2-layer analysis."""
    import json

    # Compute statistics
    total = len(verdicts)
    verified = sum(1 for v in verdicts if v.label == "verified")
    metadata_error = sum(1 for v in verdicts if v.label == "metadata_error")
    suspected = sum(1 for v in verdicts if v.label == "suspected_hallucination")
    unresolved = sum(1 for v in verdicts if v.label == "unresolved")
    resource = sum(1 for v in verdicts if v.label == "resource")

    # Get CIS score from essay
    cis_score = 0.0
    cis_components = None
    cis_weights_used = None
    style_profile = None
    if essay.cis_json:
        try:
            cis_dict = json.loads(essay.cis_json)
            cis_score = cis_dict.get("score", 0.0)
            cis_components = cis_dict.get("components")
            cis_weights_used = cis_dict.get("weights_used")
        except (json.JSONDecodeError, TypeError):
            pass
    if essay.style_profile_json:
        try:
            style_profile = json.loads(essay.style_profile_json)
        except (json.JSONDecodeError, TypeError):
            pass

    linking_summary: dict[str, int] = {}
    # Build verdict list
    verdict_list = []
    for v in verdicts:
        features_dict = json.loads(v.features or "{}")
        m_status = v.mapping_status or "matched"
        linking_summary[m_status] = linking_summary.get(m_status, 0) + 1
        verdict_list.append({
            "citation_raw": v.citation_raw,
            "citation_type": getattr(v, "citation_type", None) or "reference_list",
            "mapping_status": m_status,
            "label": v.label,
            "confidence": v.confidence,
            "reasoning": v.reasoning,
            "triggered_rules": json.loads(v.triggered_rules or "[]"),
            "mismatched_fields": json.loads(v.mismatched_fields or "[]"),
            "features": features_dict,
            "matched_sources": features_dict.get("matched_sources", []),
        })

    docx_bytes = export_report_to_docx(
        filename=filename,
        cis_score=cis_score,
        num_citations=total,
        num_verified=verified,
        num_metadata_error=metadata_error,
        num_suspected=suspected,
        num_unresolved=unresolved,
        num_resource=resource,
        verdicts=verdict_list,
        generated_at=datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC"),
        essay_id=int(getattr(essay, "id", 1) or 1),
        cis_components=cis_components,
        linking_summary=linking_summary,
        style_profile=style_profile,
        cis_weights=cis_weights_used,
    )

    return StreamingResponse(
        iter([docx_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": _safe_content_disposition(filename, "report.docx")
        },
    )


def _healed_docx_response(
    filename: str,
    essay,
    verdicts: list,
    style: str = "apa",
) -> StreamingResponse:
    """Generate an Auto-Healed Word (.docx) with repaired references & Before->After Change Log."""
    from pathlib import Path

    verdict_list = []
    for v in verdicts:
        features_dict = json.loads(v.features or "{}")
        verdict_list.append({
            "citation_raw": v.citation_raw,
            "citation_type": getattr(v, "citation_type", None) or "reference_list",
            "mapping_status": v.mapping_status or "matched",
            "label": v.label,
            "confidence": v.confidence,
            "reasoning": v.reasoning,
            "triggered_rules": json.loads(v.triggered_rules or "[]"),
            "mismatched_fields": json.loads(v.mismatched_fields or "[]"),
            "features": features_dict,
            "matched_sources": features_dict.get("matched_sources", []),
        })

    orig_docx_path: str | None = None
    try:
        from integrity_checker.config import PROJECT_ROOT

        for candidate_path in (
            PROJECT_ROOT / "data" / "essays" / "uploads" / f"{essay.id}.docx",
            Path("data/essays/uploads") / f"{essay.id}.docx",
            Path("data/uploads") / f"{essay.id}_{essay.filename}",
        ):
            if candidate_path.is_file() and candidate_path.suffix.lower() == ".docx":
                orig_docx_path = str(candidate_path)
                break
    except Exception:
        orig_docx_path = None

    docx_bytes = export_auto_healed_docx(
        essay_filename=filename,
        verdicts=verdict_list,
        style=style,
        original_docx_path=orig_docx_path,
    )
    stem = Path(filename or "essay").stem
    return StreamingResponse(
        iter([docx_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": _safe_content_disposition(
                f"{stem}_auto_healed", "docx"
            )
        },
    )


def _format_label(label: str) -> str:
    """Format validation label for display."""
    labels = {
        "verified": "Verified",
        "metadata_error": "Metadata Error",
        "suspected_hallucination": "Suspected",
        "unresolved": "Unresolved",
        "resource": "URL Resource",
    }
    return labels.get(label, label.title())


def _format_mapping_status(status: str) -> str:
    """Format mapping status for display."""
    statuses = {
        "matched": "Matched",
        "missing_reference": "Missing Ref",
        "uncited_reference": "Uncited Ref",
        "in_text_mismatch": "Mismatch",
        "duplicate_reference": "Duplicate",
        "ambiguous_mapping": "Ambiguous",
        "style_inconsistent": "Style Issue",
        "unresolved": "Unresolved",
    }
    return statuses.get(status, status.title())
