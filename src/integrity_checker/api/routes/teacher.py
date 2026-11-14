"""Teacher routes — class management + dashboard.

All endpoints require teacher or admin role (via ``require_teacher``).
Teachers can only see/modify their own classes; admin bypasses ownership
checks (acts as global teacher).

Phase 3 introduces the API surface; Phase 4 will build the matching UI.
"""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_current_user, get_db, require_teacher
from integrity_checker.billing.plans import get_user_plan_policy
from integrity_checker.db.models import Class, User
from integrity_checker.db.repository import Repository

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)


class ClassResponse(BaseModel):
    id: int
    name: str
    description: str | None
    join_code: str | None = None
    teacher_id: int
    teacher_username: str
    created_at: str
    student_count: int = 0
    essay_count: int = 0


class JoinClassRequest(BaseModel):
    join_code: str = Field(min_length=3, max_length=30)


class SharedHallucinationItem(BaseModel):
    citation_raw: str
    label: str
    student_count: int
    occurrence_count: int
    students: list[str]
    essay_ids: list[int]
    is_shared: bool = False


class TriggeredRuleStat(BaseModel):
    rule_id: str
    count: int


class ClassAnalyticsResponse(BaseModel):
    class_id: int
    class_name: str
    join_code: str | None = None
    total_students: int
    total_essays: int
    failed_essays: int = 0
    queued_essays: int = 0
    avg_cis: float
    recency_5yr_ratio: float
    cis_distribution: dict[str, int]
    verdict_breakdown: dict[str, int]
    top_triggered_rules: list[TriggeredRuleStat]
    shared_hallucinations: list[SharedHallucinationItem]


class AddStudentRequest(BaseModel):
    student_id: int


class StudentInClass(BaseModel):
    id: int
    username: str
    email: str | None
    full_name: str | None
    is_active: bool


class ClassEssaySummary(BaseModel):
    id: int
    filename: str
    uploaded_at: str
    user_id: int | None
    username: str | None
    num_pages: int
    job_status: str = "completed"
    job_error: str | None = None
    job_attempt_count: int = 0
    quota_charged: bool = True
    cis_score: float | None = None


class TeacherDashboardResponse(BaseModel):
    total_classes: int
    total_students: int
    total_essays: int
    pending_reviews: int
    classes: list[ClassResponse]


class MessageResponse(BaseModel):
    message: str


class PendingVerdictItem(BaseModel):
    verdict_id: int
    essay_id: int
    filename: str
    student_username: str | None
    citation_raw: str = ""
    label: str
    confidence: float
    reasoning: str
    validated_at: str
    triggered_rules: list[str] = Field(default_factory=list)
    mismatched_fields: list[str] = Field(default_factory=list)
    composite_label: str | None = None
    numeric_index: int | None = None
    sub_index: str | None = None
    url_status: str | None = None
    url_status_code: int | None = None
    archive_url: str | None = None
    cited_url: str | None = None
    html_meta: dict | None = None
    is_retracted: bool = False
    matched_sources: list[dict] = Field(default_factory=list)
    features: dict[str, Any] = Field(default_factory=dict)


_TEACHER_URL_RE = re.compile(r"https?://[^\s\]\)\,;\"'>]+", re.IGNORECASE)


def _parse_str_list(val: Any) -> list[str]:
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


def _parse_verdict_features(v: Any) -> dict[str, Any]:
    raw = getattr(v, "features", None)
    if raw is None:
        raw = getattr(v, "features_json", None)
    if not raw:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


def _extract_verdict_matched_sources(v: Any, features: dict[str, Any]) -> list[dict]:
    raw_ms = getattr(v, "matched_sources_json", None)
    if raw_ms:
        if isinstance(raw_ms, list):
            return [m for m in raw_ms if isinstance(m, dict)]
        if isinstance(raw_ms, str):
            try:
                parsed = json.loads(raw_ms)
                if isinstance(parsed, list):
                    return [m for m in parsed if isinstance(m, dict)]
            except (json.JSONDecodeError, TypeError):
                pass
    feat_ms = features.get("matched_sources")
    if isinstance(feat_ms, list):
        return [m for m in feat_ms if isinstance(m, dict)]
    return []


def _extract_cis_score_from_json(cis_json: str | None) -> float | None:
    if not cis_json:
        return None
    try:
        parsed = json.loads(cis_json)
        if isinstance(parsed, dict) and parsed.get("score") is not None:
            return float(parsed["score"])
    except (ValueError, TypeError):
        return None
    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _class_to_response(
    cls: Class,
    repo: Repository,
    *,
    essay_count: int | None = None,
    student_count: int | None = None,
    teacher_username: str | None = None,
) -> ClassResponse:
    if student_count is None:
        student_count = repo.count_students_in_class(cls.id)
    # If caller already computed essay_count (to avoid duplicate query), reuse it.
    if essay_count is None:
        essay_count = len(repo.get_class_essays(cls.id))
    if teacher_username is None:
        teacher = repo.get_user_by_id(cls.teacher_id)
        teacher_username = teacher.username if teacher else "unknown"
    if not cls.join_code:
        cls.join_code = repo._generate_join_code()
        repo.commit()
    return ClassResponse(
        id=cls.id,
        name=cls.name,
        description=cls.description,
        join_code=cls.join_code,
        teacher_id=cls.teacher_id,
        teacher_username=teacher_username,
        created_at=cls.created_at.isoformat() if cls.created_at else "",
        student_count=student_count,
        essay_count=essay_count,
    )


def _student_to_response(student: User) -> StudentInClass:
    return StudentInClass(
        id=student.id,
        username=student.username,
        email=student.email,
        full_name=student.full_name,
        is_active=bool(student.is_active),
    )


def _ensure_teacher_owns_class(teacher: User, cls: Class) -> None:
    """403 nếu teacher không phụ trách class này. Admin bypass."""
    if teacher.role == "admin":
        return
    if cls.teacher_id != teacher.id:
        raise HTTPException(status_code=403, detail="Not your class")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/classes", response_model=list[ClassResponse])
def list_my_classes(
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Teacher: list classes mình phụ trách. Admin: list all."""
    repo = Repository(db)
    if teacher.role == "admin":
        classes = repo.list_all_classes()
    else:
        classes = repo.list_classes_for_teacher(teacher.id)
    # Batch-fetch student counts and teacher usernames to eliminate N+1 queries
    class_ids = [c.id for c in classes]
    student_counts = repo.count_students_by_class_ids(class_ids)
    teachers_by_id = repo.get_users_by_ids({c.teacher_id for c in classes})
    return [
        _class_to_response(
            c,
            repo,
            essay_count=len(repo.get_class_essays(c.id)),
            student_count=student_counts.get(c.id, 0),
            teacher_username=(
                teachers_by_id[c.teacher_id].username
                if c.teacher_id in teachers_by_id
                else "unknown"
            ),
        )
        for c in classes
    ]


@router.post("/classes", response_model=ClassResponse, status_code=201)
def create_class(
    request: ClassCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Teacher tạo class mới (admin cũng OK)."""
    repo = Repository(db)
    policy = get_user_plan_policy(teacher)
    if teacher.role != "admin" and len(repo.list_teacher_classes(teacher.id)) >= policy.max_classes:
        raise HTTPException(
            status_code=402,
            detail={
                "message": (
                    f"Your {policy.name} plan allows up to {policy.max_classes} classes. "
                    "Upgrade to Ultra for unlimited classes."
                ),
                "code": "CLASS_LIMIT_EXCEEDED",
                "limit": policy.max_classes,
                "current_tier": policy.tier,
                "required_tier": "ultra",
            },
        )
    if repo.get_class_by_name(request.name):
        raise HTTPException(status_code=400, detail="Class name already exists")
    cls = repo.create_class(
        name=request.name,
        teacher_id=teacher.id,
        description=request.description,
    )
    repo.commit()
    return _class_to_response(cls, repo)


@router.post("/classes/{class_id}/regenerate-code", response_model=ClassResponse)
def regenerate_class_code(
    class_id: int,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Regenerate a fresh CITRA-XXXX join code for a class."""
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    updated = repo.regenerate_class_join_code(class_id)
    repo.commit()
    return _class_to_response(updated or cls, repo)


@router.get("/enrolled-classes", response_model=list[ClassResponse])
def list_enrolled_classes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List classes that the current student is enrolled in (or taught classes for teacher/admin)."""
    repo = Repository(db)
    if current_user.role == "admin":
        classes = repo.list_all_classes()
    elif current_user.role == "teacher":
        classes = repo.list_classes_for_teacher(current_user.id)
    else:
        classes = repo.list_classes_for_student(current_user.id)
    class_ids = [c.id for c in classes]
    student_counts = repo.count_students_by_class_ids(class_ids)
    teachers_by_id = repo.get_users_by_ids({c.teacher_id for c in classes})
    return [
        _class_to_response(
            c,
            repo,
            essay_count=len(repo.get_class_essays(c.id)),
            student_count=student_counts.get(c.id, 0),
            teacher_username=(
                teachers_by_id[c.teacher_id].username
                if c.teacher_id in teachers_by_id
                else "unknown"
            ),
        )
        for c in classes
    ]


@router.post("/classes/join", response_model=ClassResponse)
def join_class_by_code(
    request: JoinClassRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allow a student (role='user') to self-enroll in a class using its CITRA-XXXX join_code."""
    repo = Repository(db)
    cls = repo.get_class_by_join_code(request.join_code)
    if not cls:
        raise HTTPException(
            status_code=404,
            detail="Invalid class join code. Please check the code with your instructor.",
        )
    if current_user.role != "user":
        raise HTTPException(
            status_code=400,
            detail="Only student accounts can self-enroll using a class join code.",
        )
    repo.add_student_to_class(cls.id, current_user.id)
    repo.commit()
    return _class_to_response(cls, repo)


@router.get("/students", response_model=list[StudentInClass])
def list_available_students(
    q: str | None = None,
    limit: int = 20,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """List enrolled students or search users with role='user' by query >= 2 chars (Contract C1)."""
    repo = Repository(db)
    safe_limit = max(1, min(50, limit))
    students = repo.search_students_for_teacher(
        teacher_id=teacher.id,
        q=q,
        limit=safe_limit,
    )
    return [_student_to_response(s) for s in students]


@router.get("/classes/{class_id}/students", response_model=list[StudentInClass])
def list_class_students(
    class_id: int,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """List students trong class. Enforce: teacher chỉ xem class mình phụ trách."""
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    students = repo.list_students_in_class(class_id)
    return [_student_to_response(s) for s in students]


@router.post("/classes/{class_id}/students", response_model=MessageResponse)
def add_student_to_class(
    class_id: int,
    request: AddStudentRequest,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Add student to class. Idempotent."""
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    student = repo.get_user_by_id(request.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if student.role != "user":
        raise HTTPException(
            status_code=400,
            detail="Only users with role 'user' can be added as students",
        )
    repo.add_student_to_class(class_id, request.student_id)
    repo.commit()
    return MessageResponse(message=f"Student {student.username} added to class {cls.name}")


@router.delete(
    "/classes/{class_id}/students/{student_id}", response_model=MessageResponse,
)
def remove_student_from_class(
    class_id: int,
    student_id: int,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Remove student from class."""
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    if not repo.remove_student_from_class(class_id, student_id):
        raise HTTPException(status_code=404, detail="Student is not in this class")
    repo.commit()
    return MessageResponse(message="Student removed from class")


@router.get("/classes/{class_id}/essays", response_model=list[ClassEssaySummary])
def list_class_essays(
    class_id: int,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """List essays của students trong class."""
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    essays = repo.get_class_essays(class_id)
    students_by_id = repo.get_users_by_ids(
        {essay.user_id for essay in essays if essay.user_id is not None}
    )
    out: list[ClassEssaySummary] = []
    for essay in essays:
        student = students_by_id.get(essay.user_id) if essay.user_id else None
        raw_qc = getattr(essay, "quota_charged", None)
        out.append(
            ClassEssaySummary(
                id=essay.id,
                filename=essay.filename,
                uploaded_at=essay.uploaded_at.isoformat() if essay.uploaded_at else "",
                user_id=essay.user_id,
                username=student.username if student else None,
                num_pages=essay.num_pages,
                job_status=getattr(essay, "job_status", None) or "completed",
                job_error=getattr(essay, "job_error", None),
                job_attempt_count=int(getattr(essay, "job_attempt_count", 0) or 0),
                quota_charged=True if raw_qc is None else bool(raw_qc),
                cis_score=_extract_cis_score_from_json(getattr(essay, "cis_json", None)),
            )
        )
    return out


@router.get("/dashboard", response_model=TeacherDashboardResponse)
def teacher_dashboard(
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Aggregated stats cho 1 teacher (admin sees their own subset, no
    global admin dashboard — that's Phase 4)."""
    repo = Repository(db)
    if teacher.role == "admin":
        classes = repo.list_all_classes()
    else:
        classes = repo.list_classes_for_teacher(teacher.id)
    # Compute essay lists, student counts, and teachers ONCE in batch
    class_ids = [c.id for c in classes]
    essays_per_class: dict[int, list] = {
        c.id: repo.get_class_essays(c.id) for c in classes
    }
    student_counts = repo.count_students_by_class_ids(class_ids)
    teachers_by_id = repo.get_users_by_ids({c.teacher_id for c in classes})
    total_students = sum(student_counts.get(c.id, 0) for c in classes)
    total_essays = sum(len(essays_per_class[c.id]) for c in classes)
    all_class_essay_ids = {
        e.id for c in classes for e in essays_per_class[c.id]
    }
    pending_reviews = repo.count_pending_reviews_by_essay_ids(all_class_essay_ids)
    return TeacherDashboardResponse(
        total_classes=len(classes),
        total_students=total_students,
        total_essays=total_essays,
        pending_reviews=pending_reviews,
        classes=[
            _class_to_response(
                c,
                repo,
                essay_count=len(essays_per_class[c.id]),
                student_count=student_counts.get(c.id, 0),
                teacher_username=(
                    teachers_by_id[c.teacher_id].username
                    if c.teacher_id in teachers_by_id
                    else "unknown"
                ),
            )
            for c in classes
        ],
    )


@router.get("/classes/{class_id}/pending-reviews", response_model=list[PendingVerdictItem])
def list_pending_reviews(
    class_id: int,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """List non-overridden verdicts (``metadata_error`` or
    ``suspected_hallucination``) across all essays owned by students
    enrolled in this class. Used by the teacher pending-reviews UI.
    """
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    verdicts = repo.list_pending_reviews_for_class(class_id)
    essays_by_id = repo.get_essays_by_ids({v.essay_id for v in verdicts})
    students_by_id = repo.get_users_by_ids(
        {
            e.user_id
            for e in essays_by_id.values()
            if e.user_id is not None
        }
    )
    out: list[PendingVerdictItem] = []
    for v in verdicts:
        essay = essays_by_id.get(v.essay_id)
        student = (
            students_by_id.get(essay.user_id)
            if essay and essay.user_id
            else None
        )
        rules = _parse_str_list(getattr(v, "triggered_rules", None))
        mismatched = _parse_str_list(getattr(v, "mismatched_fields", None))
        features = _parse_verdict_features(v)
        matched_sources = _extract_verdict_matched_sources(v, features)
        raw_cit = v.citation_raw or ""

        num_idx = features.get("numeric_index")
        sub_idx = features.get("sub_index")
        comp_lbl = features.get("composite_label")
        if comp_lbl is None and num_idx is not None and sub_idx:
            comp_lbl = f"{num_idx}{sub_idx}"

        cited_url = features.get("cited_url") or features.get("url")
        if not cited_url and raw_cit:
            url_m = _TEACHER_URL_RE.search(raw_cit)
            if url_m:
                cited_url = url_m.group(0).rstrip(".,;)]>\"'")

        html_meta_raw = features.get("html_meta")
        html_meta = html_meta_raw if isinstance(html_meta_raw, dict) else None
        is_retracted = bool(
            features.get("is_retracted", False) or ("R-RETRACTED-PAPER" in rules)
        )

        out.append(
            PendingVerdictItem(
                verdict_id=v.id,
                essay_id=v.essay_id,
                filename=essay.filename if essay else "",
                student_username=student.username if student else None,
                citation_raw=raw_cit,
                label=v.label,
                confidence=v.confidence,
                reasoning=v.reasoning or "",
                validated_at=v.validated_at.isoformat() if v.validated_at else "",
                triggered_rules=rules,
                mismatched_fields=mismatched,
                composite_label=comp_lbl,
                numeric_index=num_idx,
                sub_index=sub_idx,
                url_status=features.get("url_status"),
                url_status_code=features.get("url_status_code"),
                archive_url=features.get("archive_url"),
                cited_url=cited_url,
                html_meta=html_meta,
                is_retracted=is_retracted,
                matched_sources=matched_sources,
                features=features,
            )
        )
    return out


_CSV_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _sanitize_csv_cell(val):
    """Neutralize spreadsheet formula injection in CSV string cells."""
    if isinstance(val, str) and val.startswith(_CSV_DANGEROUS_PREFIXES):
        return f"'{val}"
    return val


@router.get("/classes/{class_id}/export.csv")
def export_class_csv(
    class_id: int,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Stream a CSV of all (essay, verdict) pairs in the class.

    Columns: ``filename, student, verdict_id, label, confidence,
    validated_at, is_overridden, job_status, composite_label,
    triggered_rules, citation_raw``. Essays with no verdicts still produce
    one row with empty verdict fields, so the data-row count equals
    ``len(essays)`` and the total line count equals ``len(essays) + 1``
    (header).
    """
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    essays = repo.get_class_essays(class_id)
    students_by_id = repo.get_users_by_ids(
        {essay.user_id for essay in essays if essay.user_id is not None}
    )
    verdicts_by_essay = repo.get_verdicts_by_essay_ids([e.id for e in essays])
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "filename",
            "student",
            "verdict_id",
            "label",
            "confidence",
            "validated_at",
            "is_overridden",
            "job_status",
            "composite_label",
            "triggered_rules",
            "citation_raw",
        ]
    )
    for essay in essays:
        student = students_by_id.get(essay.user_id) if essay.user_id else None
        student_name = student.username if student else ""
        e_job_status = getattr(essay, "job_status", None) or "completed"
        verdicts = verdicts_by_essay.get(essay.id, [])
        if not verdicts:
            # Essay with no verdicts still gets a row so the teacher sees
            # every uploaded file in the export.
            writer.writerow([
                _sanitize_csv_cell(essay.filename),
                _sanitize_csv_cell(student_name),
                "", "", "", "", "",
                _sanitize_csv_cell(e_job_status),
                "", "", "",
            ])
            continue
        for v in verdicts:
            v_features = _parse_verdict_features(v)
            comp_lbl = str(v_features.get("composite_label") or "")
            rules_str = "; ".join(_parse_str_list(getattr(v, "triggered_rules", None)))
            writer.writerow(
                [
                    _sanitize_csv_cell(essay.filename),
                    _sanitize_csv_cell(student_name),
                    v.id,
                    _sanitize_csv_cell(v.label),
                    v.confidence,
                    v.validated_at.isoformat() if v.validated_at else "",
                    "yes" if v.is_overridden else "no",
                    _sanitize_csv_cell(e_job_status),
                    _sanitize_csv_cell(comp_lbl),
                    _sanitize_csv_cell(rules_str),
                    _sanitize_csv_cell(v.citation_raw or ""),
                ]
            )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="class_{class_id}.csv"',
        },
    )


@router.get("/classes/{class_id}/analytics", response_model=ClassAnalyticsResponse)
def get_class_analytics(
    class_id: int,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """Compute cohort integrity analytics, 5-year recency ratio, top triggered rules,
    and shared hallucination detection across all manuscripts in a class.
    """
    repo = Repository(db)
    cls = repo.get_class(class_id)
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_teacher_owns_class(teacher, cls)
    if not cls.join_code:
        cls.join_code = repo._generate_join_code()
        repo.commit()

    essays = repo.get_class_essays(class_id)
    student_count = repo.count_students_in_class(class_id)
    students_by_id = repo.get_users_by_ids(
        {e.user_id for e in essays if e.user_id is not None}
    )
    verdicts_by_essay = repo.get_verdicts_by_essay_ids([e.id for e in essays])

    failed_essays = 0
    queued_essays = 0
    cis_scores: list[float] = []
    cis_dist = {"excellent": 0, "good": 0, "fair": 0, "poor": 0}
    verdict_breakdown = {
        "verified": 0,
        "metadata_error": 0,
        "suspected_hallucination": 0,
        "unresolved": 0,
        "resource": 0,
        "incomplete_metadata": 0,
    }
    rule_counts: dict[str, int] = {}
    current_year = datetime.now(UTC).year
    years_found: list[int] = []

    # Group flagged citations by normalized text to detect shared AI hallucinations across students
    flagged_groups: dict[str, dict] = {}

    for essay in essays:
        verdicts = verdicts_by_essay.get(essay.id, [])
        student_obj = students_by_id.get(essay.user_id) if essay.user_id else None
        student_name = student_obj.username if student_obj else f"user_{essay.user_id or 'anon'}"

        e_job_status = (getattr(essay, "job_status", None) or "completed").strip().lower()
        if e_job_status == "failed":
            failed_essays += 1
        elif e_job_status in ("queued", "processing"):
            queued_essays += 1

        # CIS score extraction (exclude non-completed essays with cis_json is None from avg_cis)
        e_cis: float | None = None
        if not (e_job_status in ("failed", "queued", "processing") and getattr(essay, "cis_json", None) is None):
            e_cis = _extract_cis_score_from_json(getattr(essay, "cis_json", None))
            if e_cis is None and verdicts:
                acad = [v for v in verdicts if v.label != "resource"]
                if acad:
                    ver_cnt = sum(1 for v in acad if v.label == "verified" or v.is_overridden)
                    e_cis = round((ver_cnt / len(acad)) * 100.0, 1)

        if e_cis is not None:
            cis_scores.append(e_cis)
            if e_cis >= 85.0:
                cis_dist["excellent"] += 1
            elif e_cis >= 70.0:
                cis_dist["good"] += 1
            elif e_cis >= 50.0:
                cis_dist["fair"] += 1
            else:
                cis_dist["poor"] += 1

        for v in verdicts:
            raw_lbl = "verified" if v.is_overridden else (v.label or "unresolved").strip().lower()
            lbl = "unresolved" if raw_lbl == "unverified" else raw_lbl
            verdict_breakdown[lbl] = verdict_breakdown.get(lbl, 0) + 1

            # Extract year for 5-year recency ratio
            ym = re.search(r"\b(19\d{2}|20\d{2})\b", v.citation_raw or "")
            if ym:
                yr = int(ym.group(1))
                if 1900 <= yr <= current_year + 1:
                    years_found.append(yr)

            # Triggered rules
            rules = _parse_str_list(getattr(v, "triggered_rules", None))
            for r_str in rules:
                rule_counts[r_str] = rule_counts.get(r_str, 0) + 1
            if not v.is_overridden and "R-INCOMPLETE-METADATA" in rules:
                verdict_breakdown["incomplete_metadata"] += 1

            # Flagged citations for shared hallucination detector
            if lbl in ("suspected_hallucination", "metadata_error", "unresolved", "unverified"):
                raw_clean = " ".join((v.citation_raw or "").split()).strip()
                norm_key = raw_clean.lower()
                norm_key = re.sub(r"^\[\s*\d+[a-z]?\s*\]\s*", "", norm_key, flags=re.IGNORECASE)
                norm_key = re.sub(r"^\d+[a-z]?[.)]\s*", "", norm_key, flags=re.IGNORECASE)
                norm_key = re.sub(
                    r"^(?:\(\s*[a-z]\s*\)|[a-z][.)])\s*",
                    "",
                    norm_key,
                    flags=re.IGNORECASE,
                )
                norm_key = norm_key[:160]
                if len(norm_key) >= 12:
                    grp = flagged_groups.setdefault(
                        norm_key,
                        {
                            "citation_raw": raw_clean,
                            "label": lbl,
                            "students": set(),
                            "essay_ids": set(),
                            "occurrence_count": 0,
                        },
                    )
                    if lbl == "suspected_hallucination":
                        grp["label"] = "suspected_hallucination"
                    grp["students"].add(student_name)
                    grp["essay_ids"].add(essay.id)
                    grp["occurrence_count"] += 1

    avg_cis = round(sum(cis_scores) / len(cis_scores), 1) if cis_scores else 0.0
    recent_cnt = sum(1 for y in years_found if y >= current_year - 5)
    recency_ratio = round((recent_cnt / len(years_found)) * 100.0, 1) if years_found else 0.0

    top_rules = [
        TriggeredRuleStat(rule_id=rid, count=cnt)
        for rid, cnt in sorted(rule_counts.items(), key=lambda x: (-x[1], x[0]))[:8]
    ]

    shared_list: list[SharedHallucinationItem] = []
    for grp in sorted(
        flagged_groups.values(),
        key=lambda g: (
            -len(g["students"]),
            0 if g["label"] == "suspected_hallucination" else 1,
            -g["occurrence_count"],
        ),
    )[:10]:
        s_list = sorted(grp["students"])
        e_list = sorted(grp["essay_ids"])
        shared_list.append(
            SharedHallucinationItem(
                citation_raw=grp["citation_raw"],
                label=grp["label"],
                student_count=len(s_list),
                occurrence_count=grp["occurrence_count"],
                students=s_list,
                essay_ids=e_list,
                is_shared=len(e_list) >= 2,
            )
        )

    return ClassAnalyticsResponse(
        class_id=cls.id,
        class_name=cls.name,
        join_code=cls.join_code,
        total_students=student_count,
        total_essays=len(essays),
        failed_essays=failed_essays,
        queued_essays=queued_essays,
        avg_cis=avg_cis,
        recency_5yr_ratio=recency_ratio,
        cis_distribution=cis_dist,
        verdict_breakdown=verdict_breakdown,
        top_triggered_rules=top_rules,
        shared_hallucinations=shared_list,
    )
