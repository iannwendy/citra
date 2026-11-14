"""Verdicts endpoint — list verdict + override của 1 essay."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_current_user, get_db
from integrity_checker.db.models import AuditLog, ClassMembership, User
from integrity_checker.db.repository import Repository
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.models.api_schemas import VerdictSchema
from integrity_checker.models.validation import ValidationLabel

router = APIRouter()

_VALID_LABELS = {lbl.value for lbl in ValidationLabel}
_VALID_MAPPING_STATUSES = {st.value for st in CitationMappingStatus}
_CITED_URL_RE = re.compile(r"https?://[^\s\]\)\,;\"'>]+", re.IGNORECASE)


def _parse_json_str_list(val: Any) -> list[str]:
    if not val:
        return []
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    if isinstance(val, str):
        s = val.strip()
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


def _extract_cited_url(
    citation_raw: str | None,
    features: dict[str, Any],
    cit_url: str | None = None,
) -> str | None:
    for candidate in (features.get("cited_url"), features.get("url"), cit_url):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    if citation_raw:
        m = _CITED_URL_RE.search(citation_raw)
        if m:
            return m.group(0).rstrip(".,;)]>\"'")
    return None


def _load_audit_overrides_map(
    session: Session,
    verdict_ids: list[int],
) -> dict[int, dict[str, Any]]:
    if not verdict_ids:
        return {}
    out: dict[int, dict[str, Any]] = {}
    rows = (
        session.query(AuditLog)
        .filter(AuditLog.verdict_id.in_(verdict_ids))
        .order_by(AuditLog.id.asc())
        .all()
    )
    for row in rows:
        entry = out.get(row.verdict_id)
        if entry is None:
            out[row.verdict_id] = {
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
    return out


def _format_dt_or_str(val: Any) -> str | None:
    if val is None:
        return None
    if hasattr(val, "isoformat"):
        return val.isoformat()
    s = str(val).strip()
    return s or None


def _build_verdict_schema(
    r: Any,
    *,
    citation_id: str,
    citation_type: str = "unknown",
    cit_meta: dict[str, Any] | None = None,
    audit_info: dict[str, Any] | None = None,
) -> VerdictSchema:
    raw_features = getattr(r, "features", None)
    if raw_features is None:
        raw_features = getattr(r, "features_json", None)
    features = _load_features_dict(raw_features)
    matched_sources = _load_matched_sources(raw_features)
    if not matched_sources and getattr(r, "matched_sources_json", None):
        matched_sources = _load_matched_sources(
            json.dumps({"matched_sources": json.loads(r.matched_sources_json)})
            if isinstance(r.matched_sources_json, str)
            else ""
        )
    triggered_rules = _parse_json_str_list(getattr(r, "triggered_rules", None))
    mismatched_fields = _parse_json_str_list(getattr(r, "mismatched_fields", None))
    cit_meta = cit_meta or {}

    num_idx = (
        features.get("numeric_index")
        if features.get("numeric_index") is not None
        else cit_meta.get("numeric_index")
    )
    sub_idx = (
        features.get("sub_index")
        if features.get("sub_index") is not None
        else cit_meta.get("sub_index")
    )
    comp_lbl = (
        features.get("composite_label")
        if features.get("composite_label") is not None
        else cit_meta.get("composite_label")
    )
    if comp_lbl is None and num_idx is not None and sub_idx:
        comp_lbl = f"{num_idx}{sub_idx}"

    cited_url = _extract_cited_url(
        getattr(r, "citation_raw", None),
        features,
        cit_url=cit_meta.get("url"),
    )
    html_meta_raw = features.get("html_meta")
    html_meta = html_meta_raw if isinstance(html_meta_raw, dict) else None
    raw_title_sim = features.get("html_meta_title_sim")
    html_meta_title_sim = float(raw_title_sim) if raw_title_sim is not None else None

    is_ovr = bool(getattr(r, "is_overridden", False))
    ovr_note = getattr(r, "override_note", None)
    if ovr_note is None:
        ovr_note = getattr(r, "override_reason", None)
    if ovr_note is None and audit_info:
        ovr_note = audit_info.get("note")

    ovr_by = getattr(r, "overridden_by", None)
    if ovr_by is None and audit_info:
        ovr_by = audit_info.get("user")

    ovr_at = _format_dt_or_str(getattr(r, "overridden_at", None))
    if ovr_at is None and audit_info and audit_info.get("logged_at") is not None:
        ovr_at = _format_dt_or_str(audit_info.get("logged_at"))
    if ovr_at is None and features.get("overridden_at"):
        ovr_at = _format_dt_or_str(features.get("overridden_at"))
    if ovr_at is None and is_ovr:
        ovr_at = _format_dt_or_str(getattr(r, "validated_at", None))

    override_record: dict[str, Any] | None = None
    if is_ovr:
        orig_lbl = (
            (audit_info or {}).get("original_label")
            or features.get("original_label")
            or getattr(r, "original_label", None)
            or r.label
        )
        override_record = {
            "original_label": str(orig_lbl),
            "overridden_label": str(r.label),
            "reason": ovr_note or "",
            "overridden_by": ovr_by or "",
            "overridden_at": ovr_at,
        }

    return VerdictSchema(
        citation_id=citation_id,
        citation_raw=r.citation_raw,
        citation_type=citation_type,
        numeric_index=num_idx,
        sub_index=sub_idx,
        composite_label=comp_lbl,
        cited_url=cited_url,
        label=r.label,
        confidence=r.confidence,
        reasoning=r.reasoning,
        triggered_rules=triggered_rules,
        mismatched_fields=mismatched_fields,
        matched_sources=matched_sources,
        features=features,
        html_meta=html_meta,
        html_meta_title_sim=html_meta_title_sim,
        url_status=features.get("url_status"),
        url_status_code=features.get("url_status_code"),
        archive_url=features.get("archive_url"),
        is_retracted=bool(
            features.get("is_retracted", False)
            or ("R-RETRACTED-PAPER" in triggered_rules)
        ),
        citation_link=_load_citation_link(raw_features),
        mapping_status=r.mapping_status or "matched",
        mapping_confidence=r.mapping_confidence or 0.0,
        style_penalty=r.style_penalty,
        domain_exception=bool(r.domain_exception),
        is_overridden=is_ovr,
        override_note=ovr_note,
        overridden_by=ovr_by if is_ovr or ovr_by else None,
        overridden_at=ovr_at if is_ovr else None,
        override_record=override_record,
    )


class OverrideRequest(BaseModel):
    verdict_id: str | None = None
    new_label: str
    new_mapping_status: str | None = None
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("new_label")
    @classmethod
    def _validate_new_label(cls, v: str) -> str:
        norm = (v or "").strip().lower()
        if norm not in _VALID_LABELS:
            raise ValueError(
                f"Invalid label '{v}'. Must be one of: {sorted(_VALID_LABELS)}"
            )
        return norm

    @field_validator("new_mapping_status")
    @classmethod
    def _validate_new_mapping_status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        norm = v.strip().lower()
        if not norm:
            return None
        if norm not in _VALID_MAPPING_STATUSES:
            raise ValueError(
                f"Invalid mapping_status '{v}'. Must be one of: {sorted(_VALID_MAPPING_STATUSES)}"
            )
        return norm


@router.get("/{essay_id}/verdicts")
def get_verdicts(
    essay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VerdictSchema]:
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    # SECURITY: Mandatory ownership / teacher class check
    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    records = repo.get_verdicts(essay_id)
    citations = repo.get_citations(essay_id)
    citation_types: dict[str, str] = {}
    cit_meta_by_raw: dict[str, dict[str, Any]] = {}
    for c in citations:
        if c.raw_text:
            citation_types.setdefault(c.raw_text, c.citation_type)
            cit_meta_by_raw.setdefault(
                c.raw_text,
                {
                    "numeric_index": getattr(c, "numeric_index", None),
                    "sub_index": getattr(c, "sub_index", None),
                    "composite_label": getattr(c, "composite_label", None),
                    "url": getattr(c, "url", None),
                },
            )
    overridden_ids = [r.id for r in records if getattr(r, "is_overridden", False)]
    audit_map = _load_audit_overrides_map(db, overridden_ids)
    return [
        _build_verdict_schema(
            r,
            citation_id=str(r.id),
            citation_type=citation_types.get(r.citation_raw, "unknown"),
            cit_meta=cit_meta_by_raw.get(r.citation_raw),
            audit_info=audit_map.get(r.id),
        )
        for r in records
    ]


def _load_features_dict(features_json: str | dict | None) -> dict:
    """Parse the features JSON blob safely."""
    if not features_json:
        return {}
    if isinstance(features_json, dict):
        return dict(features_json)
    try:
        data = json.loads(features_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_matched_sources(features_json: str | dict | None) -> list[dict]:
    """Pull matched_sources list from the features JSON blob."""
    if not features_json:
        return []
    if isinstance(features_json, dict):
        matched = features_json.get("matched_sources")
        return matched if isinstance(matched, list) else []
    try:
        data = json.loads(features_json)
    except (json.JSONDecodeError, TypeError):
        return []
    matched = data.get("matched_sources") if isinstance(data, dict) else None
    return matched if isinstance(matched, list) else []


def _load_citation_link(features_json: str | dict | None) -> dict | None:
    """Pull the in-text to bibliography link persisted with the verdict."""
    if not features_json:
        return None
    if isinstance(features_json, dict):
        link = features_json.get("citation_link")
        return link if isinstance(link, dict) else None
    try:
        data = json.loads(features_json)
    except (json.JSONDecodeError, TypeError):
        return None
    link = data.get("citation_link") if isinstance(data, dict) else None
    return link if isinstance(link, dict) else None


@router.post("/{essay_id}/verdicts/{verdict_id}/override")
def override_verdict(
    essay_id: int,
    verdict_id: str,
    body: OverrideRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VerdictSchema:
    """Override a verdict's label/status.

    Persists the override to DB and returns updated verdict.
    """
    repo = Repository(db)

    # SECURITY: Role & ownership check — students ('user') cannot override verdicts
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    if not getattr(current_user, "can_override_verdicts", True):
        raise HTTPException(
            status_code=403,
            detail="Override permission is disabled for this account",
        )

    if current_user.role == "admin":
        pass  # admins override anything
    elif current_user.role == "teacher":
        if essay.user_id == current_user.id:
            pass  # teacher's own uploaded essay
        else:
            # Teacher may override if essay belongs to a student in one of
            # their classes.
            teacher_class_ids = {c.id for c in repo.list_classes_for_teacher(current_user.id)}
            student_class_ids = {
                m.class_id for m in repo.session.query(ClassMembership).filter(
                    ClassMembership.student_id == essay.user_id,
                ).all()
            } if essay.user_id else set()
            if not (teacher_class_ids & student_class_ids):
                raise HTTPException(status_code=403, detail="Access denied")
    else:
        raise HTTPException(status_code=403, detail="Students are not permitted to override verdicts")

    # Parse verdict_id from string (supports raw id "19" or report id "v19")
    try:
        v_id = int(str(verdict_id).lstrip("vV"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid verdict_id") from exc

    # SECURITY (IDOR protection): Ensure the verdict actually belongs to essay_id
    existing_verdict = next(
        (r for r in repo.get_verdicts(essay_id) if r.id == v_id),
        None,
    )
    if existing_verdict is None:
        raise HTTPException(status_code=404, detail="Verdict not found for this essay")

    original_label = existing_verdict.label
    original_mapping_status = existing_verdict.mapping_status
    now_dt = datetime.now(UTC)
    now_iso = now_dt.isoformat()

    # Update DB
    updated = repo.update_verdict(
        verdict_id=v_id,
        new_label=body.new_label,
        override_note=body.reason,
        new_mapping_status=body.new_mapping_status,
        overridden_by=current_user.username,
        essay_id=essay_id,
    )

    if not updated:
        raise HTTPException(status_code=404, detail="Verdict not found")

    if hasattr(updated, "overridden_at"):
        updated.overridden_at = now_dt

    updated_features = _load_features_dict(getattr(updated, "features", None))
    if original_label and not updated_features.get("original_label"):
        updated_features["original_label"] = original_label
    updated_features["overridden_at"] = now_iso
    updated.features = json.dumps(updated_features, ensure_ascii=False)

    # Recalculate essay CIS score so report reflects the override immediately
    repo.recalculate_essay_cis(essay_id)

    # AuditLog: capture original label/status so the override trail is auditable.
    label_changed = original_label is not None and original_label != body.new_label
    mapping_changed = (
        body.new_mapping_status is not None
        and original_mapping_status != body.new_mapping_status
    )
    if original_label is not None and (label_changed or mapping_changed):
        repo.log_audit(
            verdict_id=v_id,
            original_label=original_label,
            new_label=body.new_label,
            user=current_user.username,
            note=body.reason,
        )

    # Commit
    repo.commit()

    audit_map = _load_audit_overrides_map(db, [updated.id])
    citations = repo.get_citations(essay_id)
    cit_meta = None
    cit_type = "unknown"
    for c in citations:
        if c.raw_text == updated.citation_raw:
            cit_type = c.citation_type
            cit_meta = {
                "numeric_index": getattr(c, "numeric_index", None),
                "sub_index": getattr(c, "sub_index", None),
                "composite_label": getattr(c, "composite_label", None),
                "url": getattr(c, "url", None),
            }
            break

    return _build_verdict_schema(
        updated,
        citation_id=f"v{updated.id}",
        citation_type=cit_type,
        cit_meta=cit_meta,
        audit_info=audit_map.get(updated.id),
    )
