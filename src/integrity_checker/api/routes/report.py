"""Report endpoint — export JSON / CSV / PDF / DOCX (v1.2 schema)."""

from __future__ import annotations

import csv
import importlib.util
import io
import json
import os
import re
from datetime import UTC, datetime
from html import escape
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from rapidfuzz import fuzz
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
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
from integrity_checker.db.models import AuditLog, User
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

    # If the pipeline is still queued/running, return 425 so the frontend knows to keep polling.
    worker_mode = os.getenv("CITRA_WORKER_MODE", "inline").strip().lower() or "inline"
    tracker = get_tracker()
    state = None if worker_mode == "web_only" else tracker.get(essay_id)
    sql_job_status = getattr(essay, "job_status", None)

    if (state is not None and state.status in ("queued", "processing")) or sql_job_status in (
        "queued",
        "processing",
    ):
        if (
            state is not None
            and essay.cis_json
            and tracker.load_persisted_snapshot(essay_id, essay_record=essay) is None
            and sql_job_status not in ("queued", "processing")
        ):
            tracker.clear(essay_id)
            state = None
        else:
            return JSONResponse(
                status_code=425,
                content={"detail": "Analysis in progress", "retry_after": 3},
                headers={"Retry-After": "3"},
            )

    verdicts = repo.get_verdicts(essay_id)
    if (
        format == "json"
        and essay.cis_json is None
        and not verdicts
        and ((state is not None and state.status == "failed") or sql_job_status == "failed")
    ):
        job_err = getattr(essay, "job_error", None)
        detail_msg = (
            f"Analysis failed before report generation: {job_err}"
            if job_err
            else "Analysis failed before report generation"
        )
        return JSONResponse(
            status_code=425,
            content={
                "detail": detail_msg,
                "message": job_err or "Analysis failed before report generation",
                "job_status": "failed",
                "job_error": job_err,
                "quota_charged": bool(getattr(essay, "quota_charged", False)),
                "retry_after": 1,
            },
            headers={"Retry-After": "1"},
        )

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
            norm_style = (style or "apa").strip().lower()
            if norm_style not in {"apa", "ieee", "tdtu"}:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported bibliography style '{style}'. Allowed styles: apa, ieee, tdtu.",
                )
            return _healed_docx_response(essay.filename, essay, verdicts, style=norm_style)
        return _docx_response(essay.filename, essay, verdicts)
    raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")


@router.get("/{essay_id}/export-healed-docx")
def export_healed_docx_endpoint(
    essay_id: int,
    style: str = Query("apa"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Download an Auto-Healed Word (.docx) with repaired references & Before->After Change Log."""
    norm_style = (style or "apa").strip().lower()
    if norm_style not in {"apa", "ieee", "tdtu"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported bibliography style '{style}'. Allowed styles: apa, ieee, tdtu.",
        )

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
    return _healed_docx_response(essay.filename, essay, verdicts, style=norm_style)


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
        "numeric_index": getattr(c, "numeric_index", None),
        "sub_index": getattr(c, "sub_index", None),
        "composite_label": getattr(c, "composite_label", None),
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


_CITED_URL_RE = re.compile(r"https?://[^\s\]\)\,;\"'>]+", re.IGNORECASE)
_COMPOSITE_BRACKET_PREFIX_RE = re.compile(
    r"^\s*(?:\[\s*\d+[a-z]?\s*\]|\d+[a-z]?[\.\)])\s*",
    re.IGNORECASE,
)
_SUB_INDEX_PREFIX_RE = re.compile(
    r"^\s*(?:\([a-z]\)|[a-z]\))\s*",
    re.IGNORECASE,
)
_SIM_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "into", "doi", "http", "https",
    "org", "www", "vol", "issue", "pages", "press", "proc", "proceedings",
})


def _load_verdict_features(v: Any) -> dict[str, Any]:
    raw = getattr(v, "features", None)
    if raw is None:
        raw = getattr(v, "features_json", None)
    if raw is None and isinstance(v, dict):
        raw = v.get("features") or v.get("features_json")
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return {}


def _load_verdict_rules(v: Any) -> list[str]:
    raw = getattr(v, "triggered_rules", None)
    if raw is None and isinstance(v, dict):
        raw = v.get("triggered_rules")
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()]
            except (json.JSONDecodeError, TypeError):
                return []
        return [x.strip() for x in s.split(",") if x.strip()]
    return []


def _extract_verdict_composite_label(v: Any) -> str | None:
    direct = getattr(v, "composite_label", None)
    if direct is None and isinstance(v, dict):
        direct = v.get("composite_label")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    feats = _load_verdict_features(v)
    comp = feats.get("composite_label")
    if isinstance(comp, str) and comp.strip():
        return comp.strip()
    num_idx = getattr(v, "numeric_index", None)
    if num_idx is None:
        num_idx = feats.get("numeric_index")
    sub_idx = getattr(v, "sub_index", None)
    if sub_idx is None:
        sub_idx = feats.get("sub_index")
    if num_idx is not None and sub_idx:
        return f"{num_idx}{sub_idx}"
    return None


def _csv_response(filename: str, verdicts: list) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    # v1.2 CSV: include both integrity + source layers (+ trailing composite_label)
    writer.writerow([
        "citation_raw", "label", "confidence",
        "mapping_status", "mapping_confidence",
        "reasoning", "triggered_rules", "mismatched_fields",
        "is_overridden", "style_penalty", "domain_exception",
        "composite_label",
    ])
    for v in verdicts:
        comp_lbl = _extract_verdict_composite_label(v)
        raw_cit = v.citation_raw or ""
        if (
            comp_lbl
            and raw_cit
            and not raw_cit.startswith(_CSV_DANGEROUS_PREFIXES)
            and not raw_cit.lstrip().startswith(f"[{comp_lbl}]")
        ):
            raw_cit_cell = f"[{comp_lbl}] {raw_cit}"
        else:
            raw_cit_cell = raw_cit
        writer.writerow([
            _sanitize_csv_cell(raw_cit_cell),
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
            _sanitize_csv_cell(comp_lbl or ""),
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


def _strip_leading_citation_markers(raw_text: str) -> str:
    """Strip leading [14a], 14., and (a) / a) markers from a bibliography entry."""
    cleaned = _COMPOSITE_BRACKET_PREFIX_RE.sub("", raw_text or "")
    cleaned = _SUB_INDEX_PREFIX_RE.sub("", cleaned)
    return cleaned.strip()


def _verdict_canonical_key(citation_or_verdict: Any) -> str:
    """Build a Unicode-aware matching key for comparing citations across manuscript revisions."""
    if isinstance(citation_or_verdict, str) or citation_or_verdict is None:
        raw_str = citation_or_verdict or ""
    elif isinstance(citation_or_verdict, dict):
        raw_str = str(citation_or_verdict.get("citation_raw") or "")
    else:
        raw_str = str(getattr(citation_or_verdict, "citation_raw", "") or "")

    text = _strip_leading_citation_markers(raw_str).lower()
    if not text:
        return ""
    doi_m = re.search(r"10\.\d{4,9}/[^\s,;)\]]+", text)
    if doi_m:
        return f"doi:{doi_m.group(0).rstrip('.')}"
    words = re.findall(r"[^\W_]{3,}", text, flags=re.UNICODE)
    if not words:
        words = re.findall(r"[^\W_]{2,}", text, flags=re.UNICODE)
    return " ".join(words[:14])


def _normalize_for_revision_similarity(raw_text: str | None) -> tuple[str, set[str]]:
    """Normalize a citation string (stripping prefixes, URLs, DOIs) for bipartite similarity matching."""
    text = _strip_leading_citation_markers(raw_text or "").lower()
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"(?:doi:\s*)?10\.\d{4,9}/\S+", " ", text)
    tokens_all = re.findall(r"[^\W_]+", text, flags=re.UNICODE)
    clean_str = " ".join(tokens_all)
    substantive = {
        tok
        for tok in tokens_all
        if len(tok) >= 3 and not tok.isdigit() and tok not in _SIM_STOPWORDS
    }
    return clean_str, substantive


def _revision_citation_similarity(pv: Any, cv: Any) -> float:
    """Compute similarity [0..1] between an unmatched v1 verdict and unmatched v2 verdict."""
    p_raw = getattr(pv, "citation_raw", "") or ""
    c_raw = getattr(cv, "citation_raw", "") or ""
    p_clean, p_toks = _normalize_for_revision_similarity(p_raw)
    c_clean, c_toks = _normalize_for_revision_similarity(c_raw)
    if not p_clean or not c_clean:
        return 0.0
    min_tok_len = min(len(p_toks), len(c_toks))
    if min_tok_len < 2:
        return 0.0
    overlap = len(p_toks & c_toks)
    if overlap == 0:
        return 0.0
    union = len(p_toks | c_toks)
    jacc = overlap / union if union else 0.0
    containment = overlap / min_tok_len
    tsr = fuzz.token_set_ratio(p_clean, c_clean) / 100.0
    blended = 0.55 * tsr + 0.45 * containment
    if containment >= 0.80 and overlap >= 3:
        return max(jacc, blended, tsr)
    return max(jacc, blended)


def _build_verdict_key_map(v_list: list) -> dict[str, Any]:
    """Index verdicts by canonical key without dropping composite siblings or duplicates."""
    mapping: dict[str, Any] = {}
    for v in v_list:
        base_key = _verdict_canonical_key(v)
        comp_lbl = _extract_verdict_composite_label(v)
        if not base_key:
            if comp_lbl:
                base_key = f"comp:{comp_lbl.lower()}"
            else:
                continue
        if base_key not in mapping:
            mapping[base_key] = v
            continue
        # Collision in the same essay (e.g. composite siblings [14a] and [14b]):
        # disambiguate both if they carry distinct composite_labels, else append #N.
        existing_v = mapping[base_key]
        existing_comp = _extract_verdict_composite_label(existing_v)
        if existing_comp and comp_lbl and existing_comp.lower() != comp_lbl.lower():
            rekey_existing = f"{base_key}#comp:{existing_comp.lower()}"
            if rekey_existing not in mapping:
                del mapping[base_key]
                mapping[rekey_existing] = existing_v
            cand_key = f"{base_key}#comp:{comp_lbl.lower()}"
            if cand_key not in mapping:
                mapping[cand_key] = v
                continue
        suffix = 2
        while f"{base_key}#{suffix}" in mapping:
            suffix += 1
        mapping[f"{base_key}#{suffix}"] = v
    return mapping


def _normalize_verdict_label(v: Any) -> str:
    lbl = str(getattr(v, "label", "") or "").strip().lower()
    if lbl == "unverified":
        return "unresolved"
    return lbl


def _extract_essay_cis_score(essay_row, verdicts_rows: list) -> float:
    """Extract CIS score from essay row JSON or fallback to verified ratio."""
    if getattr(essay_row, "cis_json", None):
        try:
            parsed = json.loads(essay_row.cis_json)
            if isinstance(parsed, dict) and parsed.get("score") is not None:
                return round(float(parsed["score"]), 1)
        except Exception:
            pass
    academic = [v for v in verdicts_rows if _normalize_verdict_label(v) != "resource"]
    if not academic:
        return 0.0
    ver = sum(1 for v in academic if _normalize_verdict_label(v) == "verified")
    return round((ver / len(academic)) * 100.0, 1)


def _is_eligible_revision_essay(cand: Any, *, is_explicit_target: bool = False) -> bool:
    """Return False for failed/in-flight essays or incomplete DB rows with cis_json=None."""
    if is_explicit_target:
        return True
    job_st = str(getattr(cand, "job_status", None) or "").strip().lower()
    if job_st in {"failed", "queued", "processing"}:
        return False
    if getattr(cand, "cis_json", None) is None:
        return False
    return True


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

    # Sort older/other essays by id descending; skip failed/in-flight/uncompleted essays
    sorted_others = sorted(other_essays, key=lambda e: int(getattr(e, "id", 0) or 0), reverse=True)
    for cand in sorted_others:
        is_explicit_target = compare_with_id is not None and cand.id == compare_with_id
        if not is_explicit_target and _is_sandbox_manuscript(getattr(cand, "filename", None)):
            continue
        if not _is_eligible_revision_essay(cand, is_explicit_target=is_explicit_target):
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
        # Match the most recent completed older essay belonging to the same manuscript family
        prior_same_stem = [
            e for e in sorted_others
            if not _is_sandbox_manuscript(getattr(e, "filename", None))
            and _is_eligible_revision_essay(e, is_explicit_target=False)
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
        norm_labels = [_normalize_verdict_label(v) for v in v_list]
        return {
            "total": len(v_list),
            "verified": sum(1 for lbl in norm_labels if lbl == "verified"),
            "metadata_error": sum(1 for lbl in norm_labels if lbl == "metadata_error"),
            "incomplete_metadata": sum(
                1 for v in v_list if "R-INCOMPLETE-METADATA" in _load_verdict_rules(v)
            ),
            "suspected_hallucination": sum(
                1 for lbl in norm_labels if lbl == "suspected_hallucination"
            ),
            "unresolved": sum(1 for lbl in norm_labels if lbl == "unresolved"),
            "resource": sum(1 for lbl in norm_labels if lbl == "resource"),
        }

    counts_before = _count_labels(prev_verdicts)
    counts_after = _count_labels(current_verdicts)
    counts_delta = {
        k: counts_after[k] - counts_before[k]
        for k in (
            "total",
            "verified",
            "metadata_error",
            "incomplete_metadata",
            "suspected_hallucination",
            "unresolved",
            "resource",
        )
    }

    prev_by_key = _build_verdict_key_map(prev_verdicts)
    cur_by_key = _build_verdict_key_map(current_verdicts)

    # Pass 1: exact canonical key matches
    matched_pairs: list[tuple[Any, Any]] = []
    matched_prev_keys: set[str] = set()
    matched_cur_keys: set[str] = set()

    for pk, pv in prev_by_key.items():
        if pk in cur_by_key:
            matched_pairs.append((pv, cur_by_key[pk]))
            matched_prev_keys.add(pk)
            matched_cur_keys.add(pk)

    # Pass 2: greedy bipartite similarity fallback (>= 0.68) for repaired R-INCOMPLETE-METADATA / fixed DOIs
    unmatched_prev_keys = [pk for pk in prev_by_key if pk not in matched_prev_keys]
    unmatched_cur_keys = [ck for ck in cur_by_key if ck not in matched_cur_keys]
    if unmatched_prev_keys and unmatched_cur_keys:
        sim_candidates: list[tuple[float, str, str]] = []
        for pk in unmatched_prev_keys:
            pv = prev_by_key[pk]
            for ck in unmatched_cur_keys:
                cv = cur_by_key[ck]
                sim = _revision_citation_similarity(pv, cv)
                if sim >= 0.68:
                    sim_candidates.append((sim, pk, ck))
        sim_candidates.sort(key=lambda item: item[0], reverse=True)
        for _sim, pk, ck in sim_candidates:
            if pk in matched_prev_keys or ck in matched_cur_keys:
                continue
            matched_pairs.append((prev_by_key[pk], cur_by_key[ck]))
            matched_prev_keys.add(pk)
            matched_cur_keys.add(ck)

    resolved_issues: list[dict[str, Any]] = []
    persisting_issues: list[dict[str, Any]] = []
    new_issues: list[dict[str, Any]] = []
    citation_changes: list[dict[str, Any]] = []

    non_issue_labels = {"verified", "resource"}
    issue_labels = {"metadata_error", "suspected_hallucination", "unresolved"}

    for pv, cv in matched_pairs:
        p_lbl = _normalize_verdict_label(pv)
        c_lbl = _normalize_verdict_label(cv)
        comp_lbl = _extract_verdict_composite_label(cv) or _extract_verdict_composite_label(pv)
        if p_lbl in issue_labels and c_lbl in non_issue_labels:
            item = {
                "citation_raw": cv.citation_raw,
                "composite_label": comp_lbl,
                "before_label": p_lbl,
                "after_label": c_lbl,
                "transition": "fixed",
            }
            resolved_issues.append(item)
            citation_changes.append(item)
        elif p_lbl in issue_labels and c_lbl in issue_labels:
            item = {
                "citation_raw": cv.citation_raw,
                "composite_label": comp_lbl,
                "before_label": p_lbl,
                "after_label": c_lbl,
                "transition": "unchanged_issue",
            }
            persisting_issues.append(item)
            citation_changes.append(item)
        elif p_lbl in non_issue_labels and c_lbl in issue_labels:
            item = {
                "citation_raw": cv.citation_raw,
                "composite_label": comp_lbl,
                "before_label": p_lbl,
                "after_label": c_lbl,
                "transition": "regressed",
            }
            new_issues.append(item)
            citation_changes.append(item)

    for pk, pv in prev_by_key.items():
        if pk in matched_prev_keys:
            continue
        p_lbl = _normalize_verdict_label(pv)
        comp_lbl = _extract_verdict_composite_label(pv)
        if p_lbl == "suspected_hallucination":
            item = {
                "citation_raw": pv.citation_raw,
                "composite_label": comp_lbl,
                "before_label": p_lbl,
                "after_label": "removed",
                "transition": "removed_hallucination",
            }
            resolved_issues.append(item)
            citation_changes.append(item)
        elif p_lbl == "metadata_error":
            already_resolved_meta = sum(
                1 for r in resolved_issues if r["before_label"] == "metadata_error"
            )
            net_meta_drop = counts_before["metadata_error"] - counts_after["metadata_error"]
            if net_meta_drop > already_resolved_meta:
                item = {
                    "citation_raw": pv.citation_raw,
                    "composite_label": comp_lbl,
                    "before_label": p_lbl,
                    "after_label": "verified",
                    "transition": "fixed_and_reformatted",
                }
                resolved_issues.append(item)
                citation_changes.append(item)

    for ck, cv in cur_by_key.items():
        if ck not in matched_cur_keys:
            c_lbl = _normalize_verdict_label(cv)
            if c_lbl in issue_labels:
                item = {
                    "citation_raw": cv.citation_raw,
                    "composite_label": _extract_verdict_composite_label(cv),
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
    """Build or recover Scanned PDF Guardrail & encoding/OCR diagnostics for the report payload."""
    diag = (
        dict(style_profile_dict.get("document_diagnostics"))
        if isinstance(style_profile_dict, dict)
        and isinstance(style_profile_dict.get("document_diagnostics"), dict)
        else {}
    )
    if diag and "is_scanned_pdf" in diag:
        diag.setdefault("ocr_pages_recovered", [])
        diag.setdefault("legacy_encoding_detected", None)
        diag.setdefault("legacy_encoding_pages_count", 0)
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
        "ocr_pages_recovered": [],
        "legacy_encoding_detected": None,
        "legacy_encoding_pages_count": 0,
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
    cit_composite_by_raw: dict[str, tuple[int | None, str | None, str | None]] = {}
    for c in citations:
        if getattr(c, "raw_text", None) and c.raw_text not in cit_composite_by_raw:
            cit_composite_by_raw[c.raw_text] = (
                getattr(c, "numeric_index", None),
                getattr(c, "sub_index", None),
                getattr(c, "composite_label", None),
            )
    verdict_meta_by_raw: dict[str, dict[str, Any]] = {}
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

    # Batch-load override audit logs when repository session is available
    audit_overrides: dict[int, dict[str, Any]] = {}
    overridden_ids = [
        int(v.id)
        for v in verdicts
        if getattr(v, "is_overridden", False) and getattr(v, "id", None) is not None
    ]
    if overridden_ids and repo is not None and hasattr(repo, "session"):
        try:
            audit_rows = (
                repo.session.query(AuditLog)
                .filter(AuditLog.verdict_id.in_(overridden_ids))
                .order_by(AuditLog.id.asc())
                .all()
            )
            for row in audit_rows:
                entry = audit_overrides.get(row.verdict_id)
                if entry is None:
                    audit_overrides[row.verdict_id] = {
                        "original_label": row.original_label,
                        "user": row.user,
                        "note": row.note,
                        "logged_at": row.logged_at,
                    }
                else:
                    entry["user"] = row.user or entry.get("user")
                    if row.note is not None:
                        entry["note"] = row.note
                    if row.logged_at is not None:
                        entry["logged_at"] = row.logged_at
        except Exception:  # noqa: BLE001
            audit_overrides = {}

    cit_url_by_raw: dict[str, str] = {}
    for c in citations:
        if getattr(c, "raw_text", None) and getattr(c, "url", None) and c.raw_text not in cit_url_by_raw:
            cit_url_by_raw[c.raw_text] = str(c.url)

    for v in verdicts:
        status = v.mapping_status or "matched"
        linking_summary[status] = linking_summary.get(status, 0) + 1

        # Reconstruct matched_sources from the features JSON blob (written there by
        # repository.add_verdicts).  If absent (pre-fix rows), fall back to an
        # empty list so the UI never receives undefined.
        features_dict = _load_verdict_features(v)
        matched_sources = features_dict.get("matched_sources", [])
        fallback_num, fallback_sub, fallback_comp = cit_composite_by_raw.get(
            v.citation_raw, (None, None, None)
        )
        v_num_idx = (
            features_dict.get("numeric_index")
            if features_dict.get("numeric_index") is not None
            else fallback_num
        )
        v_sub_idx = (
            features_dict.get("sub_index")
            if features_dict.get("sub_index") is not None
            else fallback_sub
        )
        v_comp_lbl = (
            features_dict.get("composite_label")
            if features_dict.get("composite_label") is not None
            else fallback_comp
        )
        if v_comp_lbl is None and v_num_idx is not None and v_sub_idx:
            v_comp_lbl = f"{v_num_idx}{v_sub_idx}"

        has_scholarly_cand = bool(features_dict.get("has_scholarly_candidate", True))
        features_dict.setdefault("has_scholarly_candidate", has_scholarly_cand)
        features_dict.setdefault("html_meta", None)
        features_dict.setdefault("html_meta_title_sim", None)
        if v_num_idx is not None and features_dict.get("numeric_index") is None:
            features_dict["numeric_index"] = v_num_idx
        if v_sub_idx is not None and features_dict.get("sub_index") is None:
            features_dict["sub_index"] = v_sub_idx
        if v_comp_lbl is not None and features_dict.get("composite_label") is None:
            features_dict["composite_label"] = v_comp_lbl

        cited_url: str | None = None
        for url_cand in (
            features_dict.get("cited_url"),
            features_dict.get("url"),
            cit_url_by_raw.get(v.citation_raw or ""),
        ):
            if isinstance(url_cand, str) and url_cand.strip():
                cited_url = url_cand.strip()
                break
        if cited_url is None and v.citation_raw:
            url_m = _CITED_URL_RE.search(v.citation_raw)
            if url_m:
                cited_url = url_m.group(0).rstrip(".,;)]>\"'")

        if v.citation_raw and v.citation_raw not in verdict_meta_by_raw:
            verdict_meta_by_raw[v.citation_raw] = {
                "html_meta": features_dict.get("html_meta"),
                "html_meta_title_sim": features_dict.get("html_meta_title_sim"),
                "has_scholarly_candidate": has_scholarly_cand,
            }

        triggered_rules_list = _load_verdict_rules(v)
        is_ovr = bool(getattr(v, "is_overridden", False))
        audit_info = audit_overrides.get(getattr(v, "id", -1))
        ovr_note = getattr(v, "override_note", None)
        if ovr_note is None:
            ovr_note = getattr(v, "override_reason", None)
        if ovr_note is None and audit_info:
            ovr_note = audit_info.get("note")

        ovr_by = getattr(v, "overridden_by", None)
        if ovr_by is None and audit_info:
            ovr_by = audit_info.get("user")

        raw_ovr_at = (
            getattr(v, "overridden_at", None)
            or (audit_info.get("logged_at") if audit_info else None)
            or features_dict.get("overridden_at")
            or (getattr(v, "validated_at", None) if is_ovr else None)
        )
        if raw_ovr_at is not None and hasattr(raw_ovr_at, "isoformat"):
            ovr_at = raw_ovr_at.isoformat()
        elif raw_ovr_at is not None:
            ovr_at = str(raw_ovr_at).strip() or None
        else:
            ovr_at = None

        override_record: dict[str, Any] | None = None
        if is_ovr:
            orig_lbl = (
                (audit_info or {}).get("original_label")
                or features_dict.get("original_label")
                or getattr(v, "original_label", None)
                or v.label
            )
            override_record = {
                "original_label": str(orig_lbl),
                "overridden_label": str(v.label),
                "reason": ovr_note or "",
                "overridden_by": ovr_by or "",
                "overridden_at": ovr_at,
            }

        verdict_list.append({
            "citation_id": f"v{v.id}",
            "citation_raw": v.citation_raw,
            "citation_type": citation_types.get(v.citation_raw, "unknown"),
            "numeric_index": v_num_idx,
            "sub_index": v_sub_idx,
            "composite_label": v_comp_lbl,
            "cited_url": cited_url,
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
            "triggered_rules": triggered_rules_list,
            "mismatched_fields": json.loads(v.mismatched_fields or "[]")
            if isinstance(v.mismatched_fields, str)
            else list(v.mismatched_fields or []),
            "features": features_dict,
            "html_meta": features_dict.get("html_meta"),
            "html_meta_title_sim": features_dict.get("html_meta_title_sim"),
            "has_scholarly_candidate": has_scholarly_cand,
            "url_status": features_dict.get("url_status"),
            "url_status_code": features_dict.get("url_status_code"),
            "archive_url": features_dict.get("archive_url"),
            "is_retracted": bool(
                features_dict.get("is_retracted", False)
                or ("R-RETRACTED-PAPER" in triggered_rules_list)
            ),
            "matched_sources": matched_sources,
            # Override
            "is_overridden": is_ovr,
            "override_note": ovr_note,
            "overridden_by": ovr_by if is_ovr or ovr_by else None,
            "overridden_at": ovr_at if is_ovr else None,
            "override_record": override_record,
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
                "numeric_index": getattr(c, "numeric_index", None),
                "sub_index": getattr(c, "sub_index", None),
                "composite_label": getattr(c, "composite_label", None),
                "html_meta": verdict_meta_by_raw.get(c.raw_text, {}).get("html_meta"),
                "html_meta_title_sim": verdict_meta_by_raw.get(c.raw_text, {}).get(
                    "html_meta_title_sim"
                ),
                "has_scholarly_candidate": verdict_meta_by_raw.get(c.raw_text, {}).get(
                    "has_scholarly_candidate", True
                ),
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


_PDF_UNICODE_FONTS_CACHE: tuple[str, str] | None = None


def _register_unicode_pdf_fonts() -> tuple[str, str]:
    """Idempotently register Unicode-capable TTF fonts (CitraSans / CitraSans-Bold) for ReportLab."""
    global _PDF_UNICODE_FONTS_CACHE
    registered = set(pdfmetrics.getRegisteredFontNames())
    if (
        _PDF_UNICODE_FONTS_CACHE is not None
        and _PDF_UNICODE_FONTS_CACHE[0] in registered
        and _PDF_UNICODE_FONTS_CACHE[1] in registered
    ):
        return _PDF_UNICODE_FONTS_CACHE

    candidates: list[tuple[Path, Path, Path | None, Path | None]] = []

    # 1. matplotlib bundled DejaVuSans (full Vietnamese & scholarly Unicode support)
    try:
        mpl_spec = importlib.util.find_spec("matplotlib")
        if mpl_spec and mpl_spec.origin:
            mpl_ttf = Path(mpl_spec.origin).resolve().parent / "mpl-data" / "fonts" / "ttf"
            candidates.append(
                (
                    mpl_ttf / "DejaVuSans.ttf",
                    mpl_ttf / "DejaVuSans-Bold.ttf",
                    mpl_ttf / "DejaVuSans-Oblique.ttf",
                    mpl_ttf / "DejaVuSans-BoldOblique.ttf",
                )
            )
    except Exception:  # noqa: BLE001
        pass

    # 2. System DejaVuSans (Docker / Linux)
    dejavu_dir = Path("/usr/share/fonts/truetype/dejavu")
    candidates.append(
        (
            dejavu_dir / "DejaVuSans.ttf",
            dejavu_dir / "DejaVuSans-Bold.ttf",
            dejavu_dir / "DejaVuSans-Oblique.ttf",
            dejavu_dir / "DejaVuSans-BoldOblique.ttf",
        )
    )

    # 3. macOS fallback TTFs
    mac_supp = Path("/System/Library/Fonts/Supplemental")
    candidates.append(
        (
            mac_supp / "Arial.ttf",
            mac_supp / "Arial Bold.ttf",
            mac_supp / "Arial Italic.ttf",
            mac_supp / "Arial Bold Italic.ttf",
        )
    )
    arial_uni = Path("/Library/Fonts/Arial Unicode.ttf")
    candidates.append((arial_uni, arial_uni, None, None))

    for reg_path, bold_path, ital_path, bold_ital_path in candidates:
        if not (reg_path.is_file() and bold_path.is_file()):
            continue
        try:
            pdfmetrics.registerFont(TTFont("CitraSans", str(reg_path)))
            pdfmetrics.registerFont(TTFont("CitraSans-Bold", str(bold_path)))
            italic_name = "CitraSans"
            bold_italic_name = "CitraSans-Bold"
            if ital_path is not None and ital_path.is_file():
                pdfmetrics.registerFont(TTFont("CitraSans-Italic", str(ital_path)))
                italic_name = "CitraSans-Italic"
            if bold_ital_path is not None and bold_ital_path.is_file():
                pdfmetrics.registerFont(TTFont("CitraSans-BoldItalic", str(bold_ital_path)))
                bold_italic_name = "CitraSans-BoldItalic"
            pdfmetrics.registerFontFamily(
                "CitraSans",
                normal="CitraSans",
                bold="CitraSans-Bold",
                italic=italic_name,
                boldItalic=bold_italic_name,
            )
            _PDF_UNICODE_FONTS_CACHE = ("CitraSans", "CitraSans-Bold")
            return _PDF_UNICODE_FONTS_CACHE
        except Exception:  # noqa: BLE001
            continue

    _PDF_UNICODE_FONTS_CACHE = ("Helvetica", "Helvetica-Bold")
    return _PDF_UNICODE_FONTS_CACHE


def _generate_pdf_bytes(essay, verdicts: list, citations: list | None = None) -> bytes:
    """Generate PDF report bytes with Unicode TTF fonts, Digital Verification Receipt & QR seal."""
    from integrity_checker.api.routes.essays import create_essay_share_token

    font_reg, font_bold = _register_unicode_pdf_fonts()
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
        fontName=font_bold,
        fontSize=16,
        spaceAfter=12,
    )
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontName=font_bold,
        fontSize=12,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontName=font_reg,
        fontSize=10,
        spaceAfter=6,
    )
    diag_style = ParagraphStyle(
        'DiagBody',
        parent=styles['Normal'],
        fontName=font_reg,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#334155"),
        spaceAfter=6,
    )
    receipt_style = ParagraphStyle(
        'ReceiptBody',
        parent=styles['Normal'],
        fontName=font_reg,
        fontSize=8.5,
        leading=11,
        spaceAfter=2,
    )
    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName=font_reg,
        fontSize=8,
        leading=9,
        spaceAfter=0,
        wordWrap='LTR',
    )
    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=table_cell_style,
        textColor=colors.whitesmoke,
        fontName=font_bold,
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
    elements.append(Paragraph(f"<b>Pages:</b> {getattr(essay, 'num_pages', 0)}", body_style))
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
                ("FONTNAME", (0, 0), (-1, -1), font_reg),
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

    # Document Diagnostics note (if present)
    style_profile_dict = None
    if getattr(essay, "style_profile_json", None):
        try:
            style_profile_dict = json.loads(essay.style_profile_json)
        except (json.JSONDecodeError, TypeError):
            style_profile_dict = None
    diag = _extract_document_diagnostics(
        essay, style_profile_dict, citations or [], verdicts
    )
    diag_notes: list[str] = []
    if diag.get("parser_used"):
        diag_notes.append(f"Parser: {diag['parser_used']}")
    ocr_pages = diag.get("ocr_pages_recovered")
    if ocr_pages:
        ocr_count = len(ocr_pages) if isinstance(ocr_pages, list) else int(ocr_pages)
        diag_notes.append(f"OCR Pages Recovered: {ocr_count}")
    if diag.get("legacy_encoding_detected"):
        enc_pages = diag.get("legacy_encoding_pages_count", 0)
        diag_notes.append(
            f"Legacy Encoding Transcoded: {diag['legacy_encoding_detected']}"
            + (f" ({enc_pages} page(s))" if enc_pages else "")
        )
    if diag.get("warning_message"):
        diag_notes.append(str(diag["warning_message"]))
    if diag_notes:
        elements.append(Paragraph("Document Diagnostics", heading_style))
        elements.append(
            Paragraph(escape(" | ".join(diag_notes)), diag_style)
        )
        elements.append(Spacer(1, 0.25 * cm))

    # Summary stats
    total = len(verdicts)
    verified = sum(1 for v in verdicts if _normalize_verdict_label(v) == "verified")
    metadata_error = sum(1 for v in verdicts if _normalize_verdict_label(v) == "metadata_error")
    incomplete_meta = sum(
        1 for v in verdicts if "R-INCOMPLETE-METADATA" in _load_verdict_rules(v)
    )
    suspected = sum(
        1 for v in verdicts if _normalize_verdict_label(v) == "suspected_hallucination"
    )
    unresolved = sum(1 for v in verdicts if _normalize_verdict_label(v) == "unresolved")
    resource = sum(1 for v in verdicts if _normalize_verdict_label(v) == "resource")

    matched = sum(1 for v in verdicts if getattr(v, "mapping_status", None) == "matched")
    missing_ref = sum(
        1 for v in verdicts if getattr(v, "mapping_status", None) == "missing_reference"
    )
    mismatched = sum(
        1 for v in verdicts if getattr(v, "mapping_status", None) == "in_text_mismatch"
    )

    cis_score_val = None
    cis_comps: dict[str, float] = {}
    if getattr(essay, "cis_json", None):
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
        ["Incomplete Metadata", str(incomplete_meta), f"{incomplete_meta/total*100:.1f}%" if total > 0 else "0%"],
        ["Suspected Hallucination", str(suspected), f"{suspected/total*100:.1f}%" if total > 0 else "0%"],
        ["Unresolved", str(unresolved), f"{unresolved/total*100:.1f}%" if total > 0 else "0%"],
        ["Resource", str(resource), f"{resource/total*100:.1f}%" if total > 0 else "0%"],
        ["--- Integrity Layer ---", "", ""],
        ["Matched", str(matched), f"{matched/total*100:.1f}%" if total > 0 else "0%"],
        ["Missing Reference", str(missing_ref), f"{missing_ref/total*100:.1f}%" if total > 0 else "0%"],
        ["In-Text Mismatch", str(mismatched), f"{mismatched/total*100:.1f}%" if total > 0 else "0%"],
    ]

    summary_styles: list[tuple] = [
        ('FONTNAME', (0, 0), (-1, -1), font_reg),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2563eb')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('FONTNAME', (0, 0), (-1, 0), font_bold),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#dcfce7')),
    ]
    for r_idx, row in enumerate(summary_data):
        if row[0].startswith("---"):
            summary_styles.append(
                ('BACKGROUND', (0, r_idx), (-1, r_idx), colors.HexColor('#f3f4f6'))
            )

    summary_table = Table(summary_data, colWidths=[5 * cm, 3 * cm, 3 * cm])
    summary_table.setStyle(TableStyle(summary_styles))
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
        comp_lbl = _extract_verdict_composite_label(v)
        idx_display = f"[{comp_lbl}]" if comp_lbl else str(i)
        raw_cit = v.citation_raw or ""
        if comp_lbl and not raw_cit.lstrip().startswith(f"[{comp_lbl}]"):
            cit_display = f"[{comp_lbl}] {raw_cit}"
        else:
            cit_display = raw_cit

        v_rules = _load_verdict_rules(v)
        if "R-INCOMPLETE-METADATA" in v_rules:
            source_status = "Incomplete Metadata"
        else:
            source_status = _format_label(_normalize_verdict_label(v))
        mapping_status = _format_mapping_status(getattr(v, "mapping_status", None) or "matched")
        confidence = f"{(getattr(v, 'confidence', 0.0) or 0.0) * 100:.0f}%"

        verdict_data.append([
            Paragraph(escape(idx_display), table_cell_style),
            Paragraph(escape(cit_display), table_cell_style),
            Paragraph(escape(source_status), table_cell_style),
            Paragraph(escape(mapping_status), table_cell_style),
            Paragraph(escape(confidence), table_cell_style),
        ])

    verdict_table = Table(
        verdict_data,
        colWidths=[1.3 * cm, 5.7 * cm, 3 * cm, 3 * cm, 2 * cm],
        repeatRows=1,
    )
    verdict_table_styles = [
        ('FONTNAME', (0, 0), (-1, -1), font_reg),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#374151')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('FONTNAME', (0, 0), (-1, 0), font_bold),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('ALIGN', (1, 1), (1, -1), 'LEFT'),  # Left align citation text
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]
    for row_idx, v in enumerate(verdicts, 1):
        raw_lbl = _normalize_verdict_label(v)
        status_label = _format_label(raw_lbl)
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
    # Compute statistics
    total = len(verdicts)
    verified = sum(1 for v in verdicts if _normalize_verdict_label(v) == "verified")
    metadata_error = sum(1 for v in verdicts if _normalize_verdict_label(v) == "metadata_error")
    suspected = sum(1 for v in verdicts if _normalize_verdict_label(v) == "suspected_hallucination")
    unresolved = sum(1 for v in verdicts if _normalize_verdict_label(v) == "unresolved")
    resource = sum(1 for v in verdicts if _normalize_verdict_label(v) == "resource")

    # Get CIS score from essay
    cis_score = 0.0
    cis_components = None
    cis_weights_used = None
    style_profile = None
    if getattr(essay, "cis_json", None):
        try:
            cis_dict = json.loads(essay.cis_json)
            cis_score = cis_dict.get("score", 0.0)
            cis_components = cis_dict.get("components")
            cis_weights_used = cis_dict.get("weights_used")
        except (json.JSONDecodeError, TypeError):
            pass
    if getattr(essay, "style_profile_json", None):
        try:
            style_profile = json.loads(essay.style_profile_json)
        except (json.JSONDecodeError, TypeError):
            pass

    linking_summary: dict[str, int] = {}
    verdict_list = []
    for v in verdicts:
        features_dict = _load_verdict_features(v)
        comp_lbl = _extract_verdict_composite_label(v)
        m_status = v.mapping_status or "matched"
        linking_summary[m_status] = linking_summary.get(m_status, 0) + 1
        verdict_list.append({
            "citation_raw": v.citation_raw,
            "citation_type": getattr(v, "citation_type", None) or "reference_list",
            "numeric_index": features_dict.get("numeric_index"),
            "sub_index": features_dict.get("sub_index"),
            "composite_label": comp_lbl,
            "mapping_status": m_status,
            "label": _normalize_verdict_label(v),
            "confidence": v.confidence,
            "reasoning": v.reasoning,
            "triggered_rules": _load_verdict_rules(v),
            "mismatched_fields": json.loads(v.mismatched_fields or "[]")
            if isinstance(v.mismatched_fields, str)
            else list(v.mismatched_fields or []),
            "features": features_dict,
            "url_status": features_dict.get("url_status"),
            "url_status_code": features_dict.get("url_status_code"),
            "archive_url": features_dict.get("archive_url"),
            "html_meta": features_dict.get("html_meta"),
            "html_meta_title_sim": features_dict.get("html_meta_title_sim"),
            "matched_sources": features_dict.get("matched_sources", []),
        })

    doc_diag = _extract_document_diagnostics(essay, style_profile, [], verdicts)

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
        document_diagnostics=doc_diag,
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
    verdict_list = []
    for v in verdicts:
        features_dict = _load_verdict_features(v)
        comp_lbl = _extract_verdict_composite_label(v)
        verdict_list.append({
            "citation_raw": v.citation_raw,
            "citation_type": getattr(v, "citation_type", None) or "reference_list",
            "numeric_index": features_dict.get("numeric_index"),
            "sub_index": features_dict.get("sub_index"),
            "composite_label": comp_lbl,
            "mapping_status": v.mapping_status or "matched",
            "label": _normalize_verdict_label(v),
            "confidence": v.confidence,
            "reasoning": v.reasoning,
            "triggered_rules": _load_verdict_rules(v),
            "mismatched_fields": json.loads(v.mismatched_fields or "[]")
            if isinstance(v.mismatched_fields, str)
            else list(v.mismatched_fields or []),
            "features": features_dict,
            "html_meta": features_dict.get("html_meta"),
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
