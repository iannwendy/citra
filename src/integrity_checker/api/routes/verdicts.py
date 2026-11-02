"""Verdicts endpoint — list verdict + override của 1 essay."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_current_user, get_db
from integrity_checker.db.models import ClassMembership, User
from integrity_checker.db.repository import Repository
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.models.api_schemas import VerdictSchema
from integrity_checker.models.validation import ValidationLabel

router = APIRouter()

_VALID_LABELS = {lbl.value for lbl in ValidationLabel}
_VALID_MAPPING_STATUSES = {st.value for st in CitationMappingStatus}


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
    citation_types = {c.raw_text: c.citation_type for c in repo.get_citations(essay_id)}
    return [
        VerdictSchema(
            citation_id=str(r.id),
            citation_raw=r.citation_raw,
            citation_type=citation_types.get(r.citation_raw, "unknown"),
            label=r.label,
            confidence=r.confidence,
            reasoning=r.reasoning,
            triggered_rules=json.loads(r.triggered_rules or "[]"),
            mismatched_fields=json.loads(r.mismatched_fields or "[]"),
            # Read matched_sources from the features JSON blob persisted by add_verdicts.
            # Pre-fix rows that lack this key default to [].
            matched_sources=_load_matched_sources(r.features),
            features=_load_features_dict(r.features),
            url_status=_load_features_dict(r.features).get("url_status"),
            url_status_code=_load_features_dict(r.features).get("url_status_code"),
            archive_url=_load_features_dict(r.features).get("archive_url"),
            is_retracted=bool(
                _load_features_dict(r.features).get("is_retracted", False)
                or ("R-RETRACTED-PAPER" in json.loads(r.triggered_rules or "[]"))
            ),
            citation_link=_load_citation_link(r.features),
            mapping_status=r.mapping_status or "matched",
            mapping_confidence=r.mapping_confidence or 0.0,
            style_penalty=r.style_penalty,
            domain_exception=bool(r.domain_exception),
            is_overridden=bool(r.is_overridden),
        )
        for r in records
    ]


def _load_features_dict(features_json: str | None) -> dict:
    """Parse the features JSON blob safely."""
    if not features_json:
        return {}
    try:
        data = json.loads(features_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_matched_sources(features_json: str | None) -> list[dict]:
    """Pull matched_sources list from the features JSON blob."""
    if not features_json:
        return []
    try:
        data = json.loads(features_json)
    except (json.JSONDecodeError, TypeError):
        return []
    matched = data.get("matched_sources") if isinstance(data, dict) else None
    return matched if isinstance(matched, list) else []


def _load_citation_link(features_json: str | None) -> dict | None:
    """Pull the in-text to bibliography link persisted with the verdict."""
    if not features_json:
        return None
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

    # Return updated verdict
    return VerdictSchema(
        citation_id=f"v{updated.id}",
        citation_raw=updated.citation_raw,
        label=updated.label,
        confidence=updated.confidence,
        reasoning=updated.reasoning,
        triggered_rules=json.loads(updated.triggered_rules or "[]"),
        mismatched_fields=json.loads(updated.mismatched_fields or "[]"),
        matched_sources=_load_matched_sources(updated.features),
        features=_load_features_dict(updated.features),
        url_status=_load_features_dict(updated.features).get("url_status"),
        url_status_code=_load_features_dict(updated.features).get("url_status_code"),
        archive_url=_load_features_dict(updated.features).get("archive_url"),
        is_retracted=bool(
            _load_features_dict(updated.features).get("is_retracted", False)
            or ("R-RETRACTED-PAPER" in json.loads(updated.triggered_rules or "[]"))
        ),
        citation_link=_load_citation_link(updated.features),
        mapping_status=updated.mapping_status or "matched",
        mapping_confidence=updated.mapping_confidence or 0.0,
        style_penalty=updated.style_penalty,
        domain_exception=bool(updated.domain_exception),
        is_overridden=bool(updated.is_overridden),
    )
