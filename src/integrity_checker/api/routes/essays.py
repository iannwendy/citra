"""Essays endpoints — upload PDF và analyze."""

from __future__ import annotations

import asyncio
import inspect
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_current_user, get_db, get_pipeline, require_admin
from integrity_checker.api.progress import get_pipeline_admission_controller, get_tracker
from integrity_checker.billing.plans import ensure_user_quota_current, get_user_plan_policy
from integrity_checker.config import PROJECT_ROOT, is_test_runtime
from integrity_checker.db.models import CitationRecord, User, VerdictRecord
from integrity_checker.db.repository import Repository
from integrity_checker.models.api_schemas import EssayUploadResponse
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline
from integrity_checker.retrieval.http_pool import close_loop_http_clients

router = APIRouter()

UPLOADS_DIR = PROJECT_ROOT / "data" / "essays" / "uploads"


ALLOWED_UPLOAD_EXTENSIONS = (".pdf", ".docx", ".bib", ".ris")

_QUOTA_CLAIM_LOCK = threading.Lock()


def _claim_monthly_upload_slot_and_create_essay(
    db: Session,
    current_user: User,
    *,
    filename: str,
    num_pages: int,
    class_id: int | None = None,
    structured_error: bool = False,
) -> Any:
    """Atomically enforce & increment monthly_uploads_used and insert the EssayRecord.

    Prevents concurrent uploads (e.g. Batch Check BATCH_CONCURRENCY=3) from reading a
    stale monthly_uploads_used snapshot, losing increments, or bypassing plan limits.
    """
    with _QUOTA_CLAIM_LOCK:
        # Release any stale implicit read snapshot opened by get_current_user
        db.expire(current_user)
        db.commit()

        fresh_user = db.get(User, current_user.id)
        if fresh_user is None:
            raise HTTPException(status_code=401, detail="User not found")

        if ensure_user_quota_current(fresh_user):
            db.commit()
            db.refresh(fresh_user)

        policy = get_user_plan_policy(fresh_user)
        limit = int(policy.max_uploads_per_month)

        res = db.execute(
            update(User)
            .where(
                User.id == fresh_user.id,
                func.coalesce(User.monthly_uploads_used, 0) < limit,
            )
            .values(monthly_uploads_used=func.coalesce(User.monthly_uploads_used, 0) + 1)
            .execution_options(synchronize_session=False)
        )
        if (res.rowcount or 0) != 1:
            db.rollback()
            db.refresh(fresh_user)
            used_now = int(fresh_user.monthly_uploads_used or limit)
            msg = (
                f"Monthly upload quota reached ({used_now}/{limit} documents "
                f"on the {policy.name} plan). Please upgrade to Pro or Ultra to continue analyzing manuscripts."
            )
            if structured_error:
                raise HTTPException(
                    status_code=402,
                    detail={
                        "code": "MONTHLY_QUOTA_EXCEEDED",
                        "message": msg,
                        "used": used_now,
                        "limit": limit,
                        "current_tier": policy.tier,
                    },
                )
            raise HTTPException(status_code=402, detail=msg)

        repo = Repository(db)
        essay = repo.create_essay_with_user(
            filename=filename,
            num_pages=num_pages,
            user_id=fresh_user.id,
            class_id=class_id,
        )
        repo.commit()
        db.refresh(essay)
        db.refresh(current_user)
        return essay


def _get_persisted_upload_path(essay_id: int, ext: str | None = None) -> Path:
    """Return persistent path on disk for an uploaded essay PDF, DOCX, BIB, or RIS."""
    if ext in ALLOWED_UPLOAD_EXTENSIONS:
        return UPLOADS_DIR / f"{essay_id}{ext}"
    for cand_ext in (".docx", ".bib", ".ris", ".pdf"):
        candidate = UPLOADS_DIR / f"{essay_id}{cand_ext}"
        if candidate.is_file():
            return candidate
    return UPLOADS_DIR / f"{essay_id}.pdf"


# ---------------------------------------------------------------------------
# Background pipeline task
# ---------------------------------------------------------------------------

async def _run_pipeline_task(
    essay_id: int,
    tmp_path: str,
    user_id: int,
    pipeline: IntegrityPipeline,
    cleanup_file: bool = True,
) -> None:
    """Background task: run full pipeline and persist results to DB.

    This function lives at module level so it can be registered with
    FastAPI's BackgroundTasks — it receives its own DB session via
    ``get_session()`` to avoid carrying the request's session across
    thread/async boundaries.
    """
    from integrity_checker.db.session import get_session
    from integrity_checker.logging import get_logger

    logger = get_logger(__name__)
    tracker = get_tracker()

    def _progress_to_threadlocal(step_key: str, step_index: int, stats: dict) -> None:
        """Called from the worker thread — tracker.update is thread-safe via
        its own lock, so cross-thread updates are fine."""
        tracker.update(
            essay_id,
            status="processing",
            queue_position=None,
            step=step_key,
            step_index=step_index,
            **stats,
        )

    try:
        async with get_pipeline_admission_controller().acquire(essay_id, tracker=tracker) as admitted:
            if not admitted:
                logger.info(f"Queued essay {essay_id} was cancelled before pipeline execution")
                return

            max_citations: int | None = None
            allow_serpapi: bool | None = None
            if user_id:
                policy_session = get_session()
                try:
                    user_obj = Repository(policy_session).get_user_by_id(user_id)
                    if user_obj is not None:
                        policy = get_user_plan_policy(user_obj)
                        max_citations = policy.max_citations_per_essay
                        allow_serpapi = policy.allow_serpapi_fallback
                finally:
                    policy_session.close()

            # Offload heavy CPU work to the default executor so the event loop
            # stays free to serve other requests (status polls, etc.).
            # run_in_executor requires a sync callable; we wrap run_async in a
            # sync runner that creates its own event loop in the worker thread.
            loop = asyncio.get_running_loop()

            def _run_pipeline_sync() -> Any:
                call_kwargs: dict[str, Any] = {
                    "essay_id": essay_id,
                    "progress_callback": _progress_to_threadlocal,
                }
                sig_params = inspect.signature(pipeline.run_async).parameters
                has_var_kw = any(
                    p.kind == inspect.Parameter.VAR_KEYWORD for p in sig_params.values()
                )
                if "max_citations" in sig_params or has_var_kw:
                    call_kwargs["max_citations"] = max_citations
                if "allow_serpapi" in sig_params or has_var_kw:
                    call_kwargs["allow_serpapi"] = allow_serpapi

                async def _runner() -> Any:
                    try:
                        return await pipeline.run_async(tmp_path, **call_kwargs)
                    finally:
                        await close_loop_http_clients()

                return asyncio.run(_runner())

            report = await loop.run_in_executor(None, _run_pipeline_sync)

        # Guard against completely unreadable / corrupted files that yielded 0 pages and 0 citations
        if int(getattr(report, "num_pages", 0) or 0) == 0 and not getattr(report, "extracted_citations", None):
            sp_raw = getattr(report, "style_profile", None)
            diag = sp_raw.get("document_diagnostics", {}) if isinstance(sp_raw, dict) else {}
            p_warns = diag.get("parser_warnings", []) if isinstance(diag, dict) else []
            if any("failed" in str(w).lower() for w in p_warns):
                raise ValueError("Document file is corrupted or unreadable.")

        # Persist to DB using a fresh session BEFORE marking tracker complete
        session = get_session()
        try:
            repo = Repository(session)
            # Update essay with page count (may have been 0 on creation)
            essay = repo.get_essay(essay_id)
            if essay:
                essay.num_pages = report.num_pages

            # Persist every extracted occurrence/entry so the Citations and
            # References tabs reflect the real document, not the deduped
            # verification set. Clear any partial rows from an interrupted run first.
            session.query(CitationRecord).filter(CitationRecord.essay_id == essay_id).delete()
            session.query(VerdictRecord).filter(VerdictRecord.essay_id == essay_id).delete()
            repo.add_citations(essay_id, report.extracted_citations)
            repo.add_verdicts(essay_id, report.verdicts)

            # Persist full pipeline output for GET /report
            style_profile_dict = None
            if report.style_profile:
                sp = report.style_profile
                if isinstance(sp, dict):
                    evidence = sp.get("evidence", {}) if isinstance(sp.get("evidence"), dict) else {}
                    style_profile_dict = {
                        "style": sp.get("style", "UNKNOWN"),
                        "confidence": sp.get("confidence", 0.0),
                        "apa_count": sp.get("apa_count", 0),
                        "ieee_count": sp.get("ieee_count", 0),
                        "mixed_count": sp.get("mixed_count", 0),
                        "numeric_count": sp.get("numeric_count", 0),
                        "features": evidence.get("features", {}),
                        "ratios": evidence.get("ratios", {}),
                        "explanation": evidence.get("explanation", ""),
                        "document_diagnostics": sp.get("document_diagnostics"),
                        "citations_truncated_by_plan": bool(sp.get("citations_truncated_by_plan", False)),
                    }
                else:
                    style_profile_dict = {
                        "style": sp.style.value if hasattr(sp.style, "value") else str(sp.style),
                        "confidence": sp.confidence,
                        "apa_count": getattr(sp, "apa_count", 0),
                        "ieee_count": getattr(sp, "ieee_count", 0),
                        "mixed_count": getattr(sp, "mixed_count", 0),
                        "numeric_count": getattr(sp, "numeric_count", 0),
                        "features": getattr(sp, "evidence", {}).get("features", {}) if hasattr(sp, "evidence") else {},
                        "ratios": getattr(sp, "evidence", {}).get("ratios", {}) if hasattr(sp, "evidence") else {},
                        "explanation": getattr(sp, "evidence", {}).get("explanation", "") if hasattr(sp, "evidence") else "",
                    }

            cis_dict = None
            if report.cis:
                cis_obj = report.cis
                if isinstance(cis_obj, dict):
                    components = cis_obj.get("components", {})
                    if not isinstance(components, dict):
                        components = {}
                    cis_dict = {
                        "score": cis_obj.get("score", 0.0),
                        "components": components,
                        "weights_used": cis_obj.get("weights_used", {}) or {},
                        "num_citations": cis_obj.get("num_citations", 0),
                        "num_unresolved": cis_obj.get("num_unresolved", 0),
                        "disclaimer": cis_obj.get("disclaimer", ""),
                    }
                else:
                    comp = cis_obj.components
                    if not isinstance(comp, dict):
                        comp = {
                            attr: getattr(comp, attr)
                            for attr in dir(comp)
                            if not attr.startswith("_")
                            and not callable(getattr(comp, attr, None))
                            and attr in [
                                "verified_ratio",
                                "metadata_accuracy",
                                "in_text_bib_consistency",
                                "format_consistency",
                                "identifier_validity",
                            ]
                        }
                    cis_dict = {
                        "score": cis_obj.score,
                        "components": comp,
                        "weights_used": getattr(cis_obj, "weights_used", {}) or {},
                        "num_citations": getattr(cis_obj, "num_citations", 0),
                        "num_unresolved": getattr(cis_obj, "num_unresolved", 0),
                        "disclaimer": getattr(cis_obj, "disclaimer", ""),
                    }

            repo.update_essay_pipeline_output(
                essay_id,
                style_profile=style_profile_dict,
                cis=cis_dict,
            )
            repo.commit()
        finally:
            session.close()

        tracker.complete(essay_id)
        logger.info(f"Pipeline complete for essay {essay_id}")

    except Exception as exc:
        logger.exception(f"Pipeline failed for essay {essay_id}: {exc}")
        raw_err = str(exc)
        if "disk I/O error" in raw_err:
            safe_err = "Transient database disk I/O error"
        elif "corrupted or unreadable" in raw_err:
            safe_err = "Document file is corrupted or unreadable."
        else:
            safe_err = "Analysis failed due to an internal processing error."
        tracker.fail(essay_id, safe_err)
    finally:
        if cleanup_file:
            Path(tmp_path).unlink(missing_ok=True)  # noqa: ASYNC240 - tiny local unlink in cleanup


# ---------------------------------------------------------------------------
# Upload security constants & helpers
# ---------------------------------------------------------------------------

MAX_PDF_UPLOAD_BYTES = int(os.getenv("MAX_PDF_UPLOAD_BYTES", str(25 * 1024 * 1024)))
_UPLOAD_CHUNK_SIZE = 64 * 1024


def _sanitize_upload_filename(raw_name: str) -> str:
    """Strip path traversal components and control characters from uploaded filename."""
    base = Path(raw_name.replace("\\", "/")).name
    cleaned = "".join(ch for ch in base if ch >= " " and ch != "\x7f").strip()
    lower = cleaned.lower()
    if lower.endswith(".docx"):
        ext = ".docx"
    elif lower.endswith(".bib"):
        ext = ".bib"
    elif lower.endswith(".ris"):
        ext = ".ris"
    else:
        ext = ".pdf"
    if not cleaned or cleaned.startswith("."):
        cleaned = (
            f"essay{cleaned}"
            if lower.endswith(ALLOWED_UPLOAD_EXTENSIONS)
            else f"document{ext}"
        )
    if len(cleaned) > 200:
        stem = cleaned[: -len(ext)][: 200 - len(ext)]
        cleaned = f"{stem}{ext}"
    return cleaned


async def _read_pdf_upload_bounded(file: UploadFile, max_bytes: int | None = None) -> bytes:
    """Read upload stream in chunks, aborting immediately if size exceeds max_bytes."""
    limit = max_bytes if max_bytes is not None else MAX_PDF_UPLOAD_BYTES
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"PDF file too large. Maximum allowed size is {max(1, limit // (1024 * 1024))}MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=EssayUploadResponse)
async def upload_essay(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    class_id: int | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    pipeline: IntegrityPipeline = Depends(get_pipeline),
) -> EssayUploadResponse:
    """Upload PDF or DOCX → save → return essay_id immediately.

    The actual analysis runs in the background and the ProcessingScreen
    polls ``GET /essays/{id}/status`` for live progress.
    """
    raw_filename = (file.filename or "").strip()
    lower_name = raw_filename.lower()
    if not raw_filename or not lower_name.endswith(ALLOWED_UPLOAD_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOCX, BibTeX (.bib), and RIS (.ris) files allowed",
        )
    if lower_name.endswith(".docx"):
        upload_ext = ".docx"
    elif lower_name.endswith(".bib"):
        upload_ext = ".bib"
    elif lower_name.endswith(".ris"):
        upload_ext = ".ris"
    else:
        upload_ext = ".pdf"

    policy = get_user_plan_policy(current_user)

    # Respect module-level MAX_PDF_UPLOAD_BYTES if monkeypatched in tests (< 25MB),
    # otherwise enforce the user's subscription plan file size limit.
    default_env_bytes = 25 * 1024 * 1024
    effective_max_bytes = (
        min(policy.max_file_size_bytes, MAX_PDF_UPLOAD_BYTES)
        if default_env_bytes != MAX_PDF_UPLOAD_BYTES
        else policy.max_file_size_bytes
    )

    safe_filename = _sanitize_upload_filename(raw_filename)
    content = await _read_pdf_upload_bounded(file, max_bytes=effective_max_bytes)

    if not content:
        raise HTTPException(status_code=400, detail="Uploaded document file is empty")

    detected_pages = 1 if upload_ext in (".bib", ".ris") else 0
    if upload_ext == ".pdf":
        if b"%PDF-" not in content[:1024]:
            raise HTTPException(status_code=400, detail="Invalid PDF file: missing %PDF- header")
        try:
            import fitz

            with fitz.open(stream=content, filetype="pdf") as pdf_doc:
                detected_pages = len(pdf_doc)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="Invalid or corrupted PDF file: unable to parse PDF structure",
            ) from exc
        if detected_pages <= 0:
            raise HTTPException(
                status_code=400,
                detail="Invalid or empty PDF file: document contains 0 readable pages",
            )
    elif upload_ext == ".docx":
        if not content.startswith(b"PK\x03\x04"):
            raise HTTPException(
                status_code=400,
                detail="Invalid DOCX file: missing OOXML PK archive header",
            )
    elif upload_ext == ".bib":
        try:
            bib_text = content.decode("utf-8").strip()
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="Invalid BibTeX file: must be valid UTF-8 text",
            ) from exc
        if not bib_text or "@" not in bib_text:
            raise HTTPException(
                status_code=400,
                detail="Invalid BibTeX file: missing @entry definitions",
            )
    elif upload_ext == ".ris":
        import re as _re

        try:
            ris_text = content.decode("utf-8").strip()
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="Invalid RIS file: must be valid UTF-8 text",
            ) from exc
        if not ris_text or not _re.search(r"(?:^|\n)\s*TY\s+-", ris_text):
            raise HTTPException(
                status_code=400,
                detail="Invalid RIS file: missing TY  - record header",
            )

    if detected_pages > policy.max_pages_per_pdf:
        raise HTTPException(
            status_code=402,
            detail=(
                f"PDF page limit exceeded ({detected_pages} pages uploaded; maximum allowed on "
                f"the {policy.name} plan is {policy.max_pages_per_pdf} pages). Please upgrade to Pro or Ultra."
            ),
        )

    repo = Repository(db)
    if class_id is not None:
        cls = repo.get_class(class_id)
        if not cls:
            raise HTTPException(status_code=404, detail="Class not found")
        if current_user.role == "teacher" and cls.teacher_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not your class")
        if current_user.role == "user":
            enrolled_ids = {c.id for c in repo.list_classes_for_student(current_user.id)}
            if class_id not in enrolled_ids:
                raise HTTPException(status_code=403, detail="Not enrolled in this class")

    # Atomically claim 1 monthly upload slot and create essay record
    essay = _claim_monthly_upload_slot_and_create_essay(
        db,
        current_user,
        filename=safe_filename,
        num_pages=detected_pages,
        class_id=class_id,
        structured_error=False,
    )

    if is_test_runtime():
        with tempfile.NamedTemporaryFile(delete=False, suffix=upload_ext) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        cleanup_file = True
    else:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        persisted_path = _get_persisted_upload_path(essay.id, ext=upload_ext)
        persisted_path.write_bytes(content)
        tmp_path = str(persisted_path)
        cleanup_file = False

    # Initialize real-time progress tracker so GET /status returns something useful
    tracker = get_tracker()
    init_state = tracker.init(essay.id)

    # Register background pipeline — runs after response is sent to client
    background_tasks.add_task(
        _run_pipeline_task,
        essay.id,
        tmp_path,
        current_user.id,
        pipeline,
        cleanup_file,
    )

    upload_summary: dict[str, Any] = {"status": init_state.status}
    if init_state.queue_position is not None:
        upload_summary["queue_position"] = init_state.queue_position

    return EssayUploadResponse(
        essay_id=essay.id,
        filename=essay.filename,
        num_pages=0,  # Updated by background task once pipeline finishes
        num_citations=0,
        citations=[],
        summary=upload_summary,
    )


@router.get("/{essay_id}/status")
def get_essay_status(
    essay_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return real-time pipeline progress for the ProcessingScreen.

    Returns a snapshot of the in-memory ProgressState.  If the tracker has no
    entry (task finished or server restarted), falls back to checking the DB:
    - Verdicts written → status=completed
    - No verdicts yet → auto-resume if uploaded PDF is on disk, else processing
    """
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    persisted_pdf = _get_persisted_upload_path(essay_id)

    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    tracker = get_tracker()
    state = tracker.get(essay_id)

    if state is not None:
        # Auto-retry at most once if a prior background run failed solely due to transient sqlite I/O error
        if (
            state.status == "failed"
            and state.error
            and "disk I/O error" in state.error
            and not is_test_runtime()
            and persisted_pdf.is_file()
            and tracker.can_auto_retry(essay_id)
        ):
            resumed_state = tracker.init(essay_id, is_retry=True)
            background_tasks.add_task(
                _run_pipeline_task,
                essay.id,
                str(persisted_pdf),
                essay.user_id or current_user.id,
                get_pipeline(),
                False,
            )
            return resumed_state.to_snapshot()
        return state.to_snapshot()

    # No tracker entry — fall back to DB state (verdicts/CIS or persisted progress snapshot)
    verdicts = repo.get_verdicts(essay_id)
    persisted_snap = tracker.load_persisted_snapshot(essay_id, essay)
    if (
        verdicts
        or essay.cis_json is not None
        or (persisted_snap is not None and persisted_snap.get("status") == "completed")
    ):
        extracted = repo.get_citations(essay_id)
        doc_diag = None
        if essay.style_profile_json:
            try:
                import json as _json
                sp_parsed = _json.loads(essay.style_profile_json)
                if isinstance(sp_parsed, dict):
                    doc_diag = sp_parsed.get("document_diagnostics")
            except Exception:
                doc_diag = None
        # Pipeline completed (possibly via cache hit, prior run, or another worker)
        return {
            "status": "completed",
            "step": "done",
            "step_index": 7,
            "total_steps": 8,
            "message": "Analysis complete",
            "citations_found": sum(c.citation_type in {"in_text", "numeric"} for c in extracted),
            "references_found": sum(c.citation_type == "reference_list" for c in extracted),
            "linked": sum(v.mapping_status == "matched" for v in verdicts),
            "sources_queried": (persisted_snap or {}).get("sources_queried", {}),
            "elapsed_seconds": float((persisted_snap or {}).get("elapsed_seconds", 0.0) or 0.0),
            "finished_at": (persisted_snap or {}).get("finished_at"),
            "error": None,
            "queue_position": None,
            "document_diagnostics": doc_diag,
        }

    if persisted_snap is not None and persisted_snap.get("status") in (
        "failed",
        "processing",
        "queued",
    ):
        return persisted_snap

    # Server restarted before background analysis finished: auto-resume at most once
    # if the uploaded PDF is persisted on disk.
    persisted_pdf = _get_persisted_upload_path(essay_id)
    if not is_test_runtime() and persisted_pdf.is_file() and tracker.can_auto_retry(essay_id):
        resumed_state = tracker.init(essay_id, is_retry=True)
        background_tasks.add_task(
            _run_pipeline_task,
            essay.id,
            str(persisted_pdf),
            essay.user_id or current_user.id,
            get_pipeline(),
            False,
        )
        return resumed_state.to_snapshot()

    # No tracker and no verdicts — either queued or server restarted mid-run
    return {
        "status": "processing",
        "step": "parsing",
        "step_index": 0,
        "total_steps": 8,
        "message": "Processing...",
        "citations_found": 0,
        "references_found": 0,
        "linked": 0,
        "sources_queried": {},
        "elapsed_seconds": 0.0,
        "finished_at": None,
        "error": None,
        "queue_position": None,
    }


@router.post("/{essay_id}/reanalyze")
async def reanalyze_essay(
    essay_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    pipeline: IntegrityPipeline = Depends(get_pipeline),
) -> dict[str, Any]:
    """Re-run the verification pipeline in-place for an existing essay if its file is persisted on disk."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    lower_fname = str(essay.filename or "").lower()
    if lower_fname.endswith(".docx"):
        ext = ".docx"
    elif lower_fname.endswith(".bib"):
        ext = ".bib"
    elif lower_fname.endswith(".ris"):
        ext = ".ris"
    else:
        ext = ".pdf"
    persisted_path = _get_persisted_upload_path(essay_id, ext=ext)
    if not persisted_path.is_file():
        found_alt = None
        for alt_ext in ALLOWED_UPLOAD_EXTENSIONS:
            alt_path = _get_persisted_upload_path(essay_id, ext=alt_ext)
            if alt_path.is_file():
                found_alt = alt_path
                break
        if found_alt is not None:
            persisted_path = found_alt
        else:
            raise HTTPException(status_code=404, detail="Persisted document file not found on disk")

    tracker = get_tracker()
    tracker.init(essay_id, is_retry=True)
    if is_test_runtime():
        await _run_pipeline_task(
            essay.id,
            str(persisted_path),
            essay.user_id or current_user.id,
            pipeline,
            False,
        )
        return {"status": "completed", "essay_id": essay.id}

    background_tasks.add_task(
        _run_pipeline_task,
        essay.id,
        str(persisted_path),
        essay.user_id or current_user.id,
        pipeline,
        False,
    )
    return {"status": "processing", "essay_id": essay.id}


def _serialize_essay_summary(
    repo: Repository,
    e: Any,
    dupes: list[int],
    verdicts_by_essay: dict[int, list[VerdictRecord]] | None = None,
    in_text_counts_by_essay: dict[int, int] | None = None,
) -> dict[str, Any]:
    """Serialize essay summary with aggregated CIS and citation counts."""
    import json

    verdicts = (
        verdicts_by_essay.get(e.id, [])
        if verdicts_by_essay is not None
        else repo.get_verdicts(e.id)
    )
    if in_text_counts_by_essay is not None:
        in_text_count = in_text_counts_by_essay.get(e.id, 0)
    else:
        citations = repo.get_citations(e.id)
        in_text_count = sum(1 for c in citations if c.citation_type in {"in_text", "numeric"})
    num_citations = in_text_count or len(verdicts)
    num_verdicts = len(verdicts)
    num_verified = sum(1 for v in verdicts if v.label == "verified" or v.is_overridden)

    cis_score: float | None = None
    if e.cis_json:
        try:
            cis_dict = json.loads(e.cis_json)
            if isinstance(cis_dict, dict) and cis_dict.get("score") is not None:
                cis_score = float(cis_dict["score"])
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

    if cis_score is None and verdicts:
        academic = [v for v in verdicts if v.label != "resource"]
        if academic:
            verified_academic = sum(1 for v in academic if v.label == "verified")
            cis_score = round((verified_academic / len(academic)) * 100.0, 1)

    return {
        "id": e.id,
        "filename": e.filename,
        "num_pages": e.num_pages,
        "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None,
        "user_id": e.user_id,
        "duplicate_ids": dupes,
        "cis_score": cis_score,
        "num_citations": num_citations,
        "num_verdicts": num_verdicts,
        "num_verified": num_verified,
    }


def _serialize_essay_summaries_batch(
    repo: Repository,
    grouped: list[tuple[Any, list[int]]],
) -> list[dict[str, Any]]:
    """Batch-load verdicts and in-text citation counts for all canonical essays in 2 queries."""
    if not grouped:
        return []
    from sqlalchemy import func

    essay_ids = [e.id for e, _ in grouped]
    verdicts_by_essay: dict[int, list[VerdictRecord]] = {eid: [] for eid in essay_ids}
    for v in (
        repo.session.query(VerdictRecord)
        .filter(VerdictRecord.essay_id.in_(essay_ids))
        .all()
    ):
        verdicts_by_essay.setdefault(v.essay_id, []).append(v)

    in_text_counts_by_essay = {
        row[0]: int(row[1] or 0)
        for row in repo.session.query(
            CitationRecord.essay_id, func.count(CitationRecord.id)
        )
        .filter(
            CitationRecord.essay_id.in_(essay_ids),
            CitationRecord.citation_type.in_(["in_text", "numeric"]),
        )
        .group_by(CitationRecord.essay_id)
        .all()
    }

    return [
        _serialize_essay_summary(
            repo,
            e,
            dupes,
            verdicts_by_essay=verdicts_by_essay,
            in_text_counts_by_essay=in_text_counts_by_essay,
        )
        for e, dupes in grouped
    ]


@router.get("", response_model=list[dict])
def list_essays(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List essays for current user (or all for admin).

    Re-uploaded copies of the same file are collapsed into a single entry.
    The underlying duplicate ids are returned in ``duplicate_ids`` so the UI
    can offer cleanup without hiding the fact that they exist.
    """
    from integrity_checker.db.models import Class, ClassMembership

    repo = Repository(db)

    if current_user.role == "admin":
        grouped = repo.get_all_essays_deduped()
    elif current_user.role == "teacher":
        visible_ids = {current_user.id}
        for (student_id,) in (
            db.query(ClassMembership.student_id)
            .join(Class, Class.id == ClassMembership.class_id)
            .filter(Class.teacher_id == current_user.id)
            .all()
        ):
            visible_ids.add(student_id)
        grouped = repo.get_all_essays_deduped(user_ids=list(visible_ids))
    else:
        grouped = repo.get_all_essays_deduped(user_id=current_user.id)

    return _serialize_essay_summaries_batch(repo, grouped)


@router.get("/all", response_model=list[dict])
def list_all_essays(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List all essays (admin only), collapsing duplicate uploads."""
    repo = Repository(db)
    grouped = repo.get_all_essays_deduped()

    return _serialize_essay_summaries_batch(repo, grouped)


@router.get("/stats")
def get_essay_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Return aggregated essay & citation verdict stats for current_user (Contract C2)."""
    from sqlalchemy import func

    from integrity_checker.db.models import Class, ClassMembership

    repo = Repository(db)
    if current_user.role == "admin":
        grouped = repo.get_all_essays_deduped()
    elif current_user.role == "teacher":
        visible_ids = {current_user.id}
        for (student_id,) in (
            db.query(ClassMembership.student_id)
            .join(Class, Class.id == ClassMembership.class_id)
            .filter(Class.teacher_id == current_user.id)
            .all()
        ):
            visible_ids.add(student_id)
        grouped = repo.get_all_essays_deduped(user_ids=list(visible_ids))
    else:
        grouped = repo.get_all_essays_deduped(user_id=current_user.id)

    essay_ids = [e.id for e, _ in grouped]
    counts: dict[str, int] = {
        "verified": 0,
        "metadata_error": 0,
        "suspected_hallucination": 0,
        "unresolved": 0,
        "resource": 0,
    }
    if not essay_ids:
        return {
            "total_essays": 0,
            "total_citations": 0,
            **counts,
        }

    for label, cnt in (
        db.query(VerdictRecord.label, func.count(VerdictRecord.id))
        .filter(VerdictRecord.essay_id.in_(essay_ids))
        .group_by(VerdictRecord.label)
        .all()
    ):
        if label in counts:
            counts[str(label)] = int(cnt or 0)

    total_verdicts = sum(counts.values())
    if total_verdicts > 0:
        total_citations = total_verdicts
    else:
        total_citations = int(
            db.query(func.count(CitationRecord.id))
            .filter(CitationRecord.essay_id.in_(essay_ids))
            .scalar()
            or 0
        )

    return {
        "total_essays": len(essay_ids),
        "total_citations": total_citations,
        **counts,
    }


# ---------------------------------------------------------------------------
# Phase 6.1: Cryptographic Shareable Verification Links & Digital Receipt API
# ---------------------------------------------------------------------------

def generate_qr_matrix(data: str) -> list[list[int]]:
    """Generate an ISO/IEC 18004 QR Code matrix (1=dark, 0=light) for camera scanning."""
    from reportlab.graphics.barcode import qrencoder

    clean_data = (data or "https://citra.io.vn").strip()
    if "|http" in clean_data:
        clean_data = clean_data.split("|", 1)[-1].strip()
    qr = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)
    qr.addData(qrencoder.QR8bitByte(clean_data))
    qr.make()
    return [[1 if cell else 0 for cell in row] for row in qr.modules]


def create_essay_share_token(essay_id: int, expires_days: int | float = 30) -> dict[str, Any]:
    """Create an HMAC-SHA256 signed shareable verification token and Digital Receipt ID."""
    import hashlib
    import hmac
    from datetime import UTC, datetime, timedelta

    from integrity_checker.config import get_settings

    eid = int(essay_id)
    exp_dt = datetime.now(UTC) + timedelta(days=float(expires_days))
    exp_unix = int(exp_dt.timestamp())
    secret = (get_settings().auth.jwt_secret or "change-me-in-production-use-env-var").encode()
    payload = f"citra:share:{eid}:{exp_unix}".encode()
    hmac_hex = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    sig24 = hmac_hex[:24]
    token = f"sh_{eid}_{exp_unix}_{sig24}"
    receipt_id = f"CITRA-{eid:05d}-{hmac_hex[:8].upper()}"
    verification_url = f"https://citra.io.vn/verify/share/{token}"
    return {
        "essay_id": eid,
        "share_token": token,
        "share_url": f"/verify/share/{token}",
        "verification_url": verification_url,
        "qr_matrix": generate_qr_matrix(verification_url),
        "receipt_id": receipt_id,
        "signature_prefix": sig24,
        "expires_at": exp_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def verify_essay_share_token(token: str) -> int:
    """Verify HMAC-SHA256 signature and expiration of a share token, returning essay_id."""
    import hashlib
    import hmac
    from datetime import UTC, datetime

    from integrity_checker.config import get_settings

    raw = (token or "").strip()
    parts = raw.split("_")
    if len(parts) != 4 or parts[0] != "sh":
        raise HTTPException(status_code=403, detail="Invalid share token format")
    _, essay_id_str, exp_str, sig_part = parts
    if not essay_id_str.isdigit() or not exp_str.lstrip("-").isdigit() or len(sig_part) != 24:
        raise HTTPException(status_code=403, detail="Invalid share token structure")

    essay_id = int(essay_id_str)
    exp_unix = int(exp_str)
    secret = (get_settings().auth.jwt_secret or "change-me-in-production-use-env-var").encode()
    payload = f"citra:share:{essay_id}:{exp_unix}".encode()
    expected_hex = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig_part.lower(), expected_hex[:24].lower()):
        raise HTTPException(status_code=403, detail="Invalid or tampered share token signature")

    now_unix = int(datetime.now(UTC).timestamp())
    if exp_unix < now_unix:
        raise HTTPException(status_code=403, detail="Share token has expired")
    return essay_id


@router.post("/{essay_id}/share")
def create_essay_share_link(
    essay_id: int,
    expires_days: int = 30,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Generate a cryptographic HMAC-SHA256 shareable verification link (owner, teacher, or admin)."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")
    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")
    clamped_days = max(1, min(365, int(expires_days or 30)))
    return create_essay_share_token(essay.id, expires_days=clamped_days)


@router.get("/shared/{share_token}")
def get_shared_essay_report(
    share_token: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Public (unauthenticated) verification report for a cryptographically signed share token."""
    import json
    from datetime import UTC, datetime

    from integrity_checker.config import get_settings

    essay_id = verify_essay_share_token(share_token)
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    parts = share_token.strip().split("_")
    exp_unix = int(parts[2])
    sig_part = parts[3]
    receipt_id = f"CITRA-{essay.id:05d}-{sig_part[:8].upper()}"
    expires_at = datetime.fromtimestamp(exp_unix, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    verdicts = sorted(repo.get_verdicts(essay.id), key=lambda v: v.id or 0)
    citations = repo.get_citations(essay.id)
    in_text_count = sum(1 for c in citations if c.citation_type in {"in_text", "numeric"})
    num_citations = in_text_count or len(verdicts)

    verdict_counts: dict[str, int] = {
        "verified": 0,
        "metadata_error": 0,
        "suspected_hallucination": 0,
        "unresolved": 0,
        "resource": 0,
    }
    public_verdicts: list[dict[str, Any]] = []
    for idx, v in enumerate(verdicts, start=1):
        lbl = str(v.label or "unresolved").lower()
        if lbl in verdict_counts:
            verdict_counts[lbl] += 1
        try:
            features_dict = json.loads(v.features or "{}")
        except Exception:
            features_dict = {}
        try:
            triggered_rules = json.loads(v.triggered_rules or "[]")
        except Exception:
            triggered_rules = []
        try:
            mismatched_fields = json.loads(v.mismatched_fields or "[]")
        except Exception:
            mismatched_fields = []
        matched_sources = features_dict.get("matched_sources", [])
        if not isinstance(matched_sources, list):
            matched_sources = []
        matched_source = matched_sources[0] if matched_sources else None
        ref_id = f"ref-{idx:04d}"
        public_verdicts.append({
            "reference_id": ref_id,
            "citation_id": f"v{v.id}",
            "raw_text": v.citation_raw,
            "citation_raw": v.citation_raw,
            "label": lbl,
            "confidence": float(v.confidence or 0.0),
            "mapping_status": v.mapping_status or "matched",
            "explanation": v.reasoning or "",
            "reasoning": v.reasoning or "",
            "triggered_rules": triggered_rules,
            "mismatched_fields": mismatched_fields,
            "matched_source": matched_source,
            "matched_sources": matched_sources,
        })

    style_profile_dict = None
    if essay.style_profile_json:
        try:
            style_profile_dict = json.loads(essay.style_profile_json)
        except Exception:
            style_profile_dict = None
    if not isinstance(style_profile_dict, dict):
        style_profile_dict = {
            "style": "UNKNOWN",
            "confidence": 0.0,
            "apa_count": 0,
            "ieee_count": 0,
            "mixed_count": 0,
            "features": {},
            "ratios": {},
            "explanation": "",
        }

    cis_dict = None
    if essay.cis_json:
        try:
            cis_dict = json.loads(essay.cis_json)
        except Exception:
            cis_dict = None
    academic_total = sum(1 for v in verdicts if v.label != "resource")
    verified_cnt = verdict_counts["verified"]
    matched_cnt = sum(1 for v in verdicts if (v.mapping_status or "matched") == "matched")
    if not isinstance(cis_dict, dict):
        fallback_score = round((verified_cnt / academic_total * 100.0) if academic_total > 0 else 0.0, 1)
        cis_dict = {
            "score": fallback_score,
            "components": {
                "verified_ratio": round(verified_cnt / academic_total, 4) if academic_total > 0 else 0.0,
                "metadata_accuracy": round(verified_cnt / academic_total, 4) if academic_total > 0 else 0.0,
                "in_text_bib_consistency": round(matched_cnt / academic_total, 4) if academic_total > 0 else 0.0,
                "format_consistency": 1.0 if academic_total > 0 else 0.0,
                "identifier_validity": round(verified_cnt / academic_total, 4) if academic_total > 0 else 0.0,
            },
            "weights_used": {},
            "num_citations": academic_total,
            "num_unresolved": verdict_counts["unresolved"],
            "disclaimer": get_settings().disclaimer.long,
        }
    elif "components" not in cis_dict or not isinstance(cis_dict.get("components"), dict):
        cis_dict["components"] = {
            "verified_ratio": round(verified_cnt / academic_total, 4) if academic_total > 0 else 0.0,
            "metadata_accuracy": 0.0,
            "in_text_bib_consistency": round(matched_cnt / academic_total, 4) if academic_total > 0 else 0.0,
            "format_consistency": 0.0,
            "identifier_validity": 0.0,
        }

    created_iso = (
        essay.uploaded_at.isoformat()
        if essay.uploaded_at
        else datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    verification_url = f"https://citra.io.vn/verify/share/{share_token}"
    return {
        "essay_id": essay.id,
        "filename": essay.filename,
        "created_at": created_iso,
        "num_pages": essay.num_pages or 0,
        "num_citations": num_citations,
        "cis": cis_dict,
        "style_profile": style_profile_dict,
        "receipt_id": receipt_id,
        "share_token": share_token,
        "share_url": f"/verify/share/{share_token}",
        "verification_url": verification_url,
        "qr_matrix": generate_qr_matrix(verification_url),
        "signature_prefix": sig_part,
        "verified_at": created_iso,
        "expires_at": expires_at,
        "disclaimer": get_settings().disclaimer.long,
        "verdict_counts": verdict_counts,
        "verdicts": public_verdicts,
    }


@router.get("/{essay_id}")
def get_essay(
    essay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Lấy essay + verdicts từ DB."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    # Ownership / teacher class check
    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "id": essay.id,
        "filename": essay.filename,
        "num_pages": essay.num_pages,
        "uploaded_at": essay.uploaded_at.isoformat() if essay.uploaded_at else None,
        "user_id": essay.user_id,
    }


@router.delete("/{essay_id}")
def delete_essay(
    essay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Xóa essay (owner hoặc admin)."""
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    # Ownership check
    if current_user.role != "admin" and essay.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Clean up queued admission slot, progress tracker, and persisted PDF / DOCX / BIB / RIS
    get_pipeline_admission_controller().cancel(essay_id)
    get_tracker().clear(essay_id)
    for ext_to_clean in ALLOWED_UPLOAD_EXTENSIONS:
        _get_persisted_upload_path(essay_id, ext=ext_to_clean).unlink(missing_ok=True)

    db.delete(essay)
    db.commit()

    return {"message": f"Essay {essay_id} deleted"}


@router.get("/{essay_id}/page-preview/{page_num}")
def get_essay_page_preview(
    essay_id: int,
    page_num: int,
    highlight: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Render an interactive PNG page preview with bounding-box citation highlighting (Sprint 3.3)."""
    import fitz

    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    pdf_path = _get_persisted_upload_path(essay_id, ext=".pdf")
    if not pdf_path.is_file() and essay.filename:
        fname_only = Path(essay.filename).name
        direct_root = PROJECT_ROOT / fname_only
        if direct_root.is_file() and direct_root.suffix.lower() == ".pdf":
            pdf_path = direct_root
        else:
            for candidate_dir in (
                PROJECT_ROOT / "data" / "demo",
                PROJECT_ROOT / "data" / "essays",
                PROJECT_ROOT / "style_corpora",
                PROJECT_ROOT / "vn_legal_reports",
                PROJECT_ROOT / "20-theses",
                PROJECT_ROOT / "tdtu_github_reports",
                PROJECT_ROOT / "TDTU-MidtermReport",
            ):
                if candidate_dir.is_dir():
                    matches = list(candidate_dir.rglob(fname_only))
                    if matches and matches[0].suffix.lower() == ".pdf":
                        pdf_path = matches[0]
                        break

    import html as _html
    import re as _re

    citations = repo.get_citations(essay_id)
    verdicts = repo.get_verdicts(essay_id)

    def _find_rects_for_query(page_obj, q_str: str) -> list:
        q_s = (q_str or "").strip()
        if not q_s:
            return []
        q_no_num = _re.sub(r"^\s*(?:\[\d+\]|\d+[\.\)])\s*", "", q_s).strip()
        # For bibliography entries (> 40 chars), match full text block(s) on the page so wrapped lines are included
        if len(q_s) > 40:
            blocks = page_obj.get_text("blocks")
            prefix_low = q_no_num[:58].lower()
            raw_prefix_low = q_s[:58].lower()
            matched_block_rects = []
            for b_i, b in enumerate(blocks):
                b_txt = _re.sub(r"\s+", " ", (b[4] or "").strip())
                b_txt_low = b_txt.lower()
                b_no_num_low = _re.sub(r"^\s*(?:\[\d+\]|\d+[\.\)])\s*", "", b_txt_low).strip()
                if len(b_no_num_low) < 22:
                    continue
                cmp_len = min(len(prefix_low), len(b_no_num_low))
                raw_cmp_len = min(len(raw_prefix_low), len(b_txt_low))
                if (prefix_low and b_no_num_low.startswith(prefix_low[:cmp_len])) or (
                    raw_prefix_low and b_txt_low.startswith(raw_prefix_low[:raw_cmp_len])
                ):
                    matched_block_rects.append(fitz.Rect(b[:4]))
                    # Check if the immediately following block is a hanging-indent continuation of this reference
                    if b_i + 1 < len(blocks):
                        b_next = blocks[b_i + 1]
                        if b_next[0] > b[0] + 8 and 0 <= (b_next[1] - b[3]) <= 16:
                            matched_block_rects.append(fitz.Rect(b_next[:4]))
            if matched_block_rects:
                return matched_block_rects
        for cand_q in (
            q_s[:68],
            q_no_num[:60],
            q_no_num[:34],
        ):
            if cand_q and len(cand_q) >= 3:
                found_r = page_obj.search_for(cand_q)
                if found_r:
                    return found_r
        # Try quoted title or sentence segment
        m_quote = _re.search(r"[\"\u201c]([^\"\u201d]{8,65})[\"\u201d]", q_no_num)
        if m_quote:
            found_r = page_obj.search_for(m_quote.group(1)[:48])
            if found_r:
                return found_r
        # Try leading bracket number [N] if present on this page
        m_num = _re.match(r"^\s*(\[\d+\])", q_s)
        if m_num:
            # Check if there is an in-text citation on this page with that [N]
            for cit_rec in citations:
                if (cit_rec.page_num or 1) == page_num and m_num.group(1) in (cit_rec.raw_text or ""):
                    ctx_s = (getattr(cit_rec, "context", None) or "").strip()
                    if ctx_s:
                        found_r = page_obj.search_for(ctx_s[:48])
                        if found_r:
                            return found_r
                    found_r = page_obj.search_for(m_num.group(1))
                    if found_r:
                        return found_r
        # Try first author surname / distinctive token (>= 4 chars) only for short in-text queries
        if len(q_s) <= 40:
            m_tok = _re.search(r"[A-Za-zÀ-ỹ]{4,}", q_no_num)
            if m_tok and m_tok.group(0).lower() not in {"luật", "nghị", "định", "quốc", "chính", "thông", "quyết"}:
                found_r = page_obj.search_for(m_tok.group(0))
                if found_r:
                    return found_r
        return []

    if pdf_path.is_file():
        import numpy as _np

        doc = fitz.open(str(pdf_path))
        try:
            target_idx = max(0, min(len(doc) - 1, page_num - 1))
            page = doc[target_idx]

            # 1. Collect all text regions for suspected_hallucination & metadata_error citations on this page
            # so we ONLY color the text glyphs in RED ("chỉ tô đỏ text thôi, không đóng khung xung quanh")
            all_red_text_rects: list[fitz.Rect] = []
            ref_records_sorted = sorted(
                [c for c in citations if getattr(c, "citation_type", "") == "reference_list"],
                key=lambda c: c.id,
            )
            ref_link_by_raw = {
                (r.raw_text or "").strip(): f"ref-{i + 1:04d}"
                for i, r in enumerate(ref_records_sorted)
            }
            for v in verdicts:
                v_lbl = (v.label or "").lower()
                if v_lbl not in ("suspected_hallucination", "metadata_error"):
                    continue
                err_rects = _find_rects_for_query(page, v.citation_raw or "")
                ref_tag = ref_link_by_raw.get((v.citation_raw or "").strip())
                if ref_tag:
                    for cit_rec in citations:
                        if getattr(cit_rec, "citation_type", "") == "reference_list":
                            continue
                        if (cit_rec.page_num or 1) != (target_idx + 1):
                            continue
                        link_json_s = getattr(cit_rec, "citation_link_json", None) or ""
                        if ref_tag in link_json_s:
                            raw_in_text = (cit_rec.raw_text or "").strip()
                            if raw_in_text:
                                err_rects.extend(_find_rects_for_query(page, raw_in_text))
                all_red_text_rects.extend(err_rects[:14])

            # 2. Check the active query selected by the user
            active_non_err_rects: list[fitz.Rect] = []
            if highlight and highlight.strip():
                q = highlight.strip()
                rects = _find_rects_for_query(page, q)
                is_active_err = False
                q_low = q.lower()
                for v in verdicts:
                    v_raw_low = (v.citation_raw or "").lower()
                    if (q_low in v_raw_low or v_raw_low[:35] in q_low) and (v.label or "").lower() in (
                        "suspected_hallucination",
                        "metadata_error",
                    ):
                        is_active_err = True
                        break
                if rects:
                    if is_active_err:
                        all_red_text_rects.extend(rects[:12])
                    else:
                        active_non_err_rects.extend(rects[:12])

            scale = 1.5
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            if all_red_text_rects or active_non_err_rects:
                arr = _np.frombuffer(pix.samples, dtype=_np.uint8).reshape(pix.height, pix.width, 3).copy()
                # Recolor ONLY the text pixels inside all_red_text_rects to red (#dc2626) without any box/border
                for r in all_red_text_rects:
                    x0 = max(0, int((r.x0 - 1.5) * scale))
                    y0 = max(0, int((r.y0 - 1.5) * scale))
                    x1 = min(pix.width, int((r.x1 + 1.5) * scale))
                    y1 = min(pix.height, int((r.y1 + 1.5) * scale))
                    if x1 <= x0 or y1 <= y0:
                        continue
                    roi = arr[y0:y1, x0:x1].astype(_np.float32)
                    darkness = _np.clip((255.0 - roi.mean(axis=2)) / 255.0, 0.0, 1.0)
                    mask = darkness > 0.06
                    if _np.any(mask):
                        # Map dark text pixels smoothly to vivid red RGB(220, 38, 38) while keeping white background pure white
                        boosted = _np.clip(darkness * 1.15, 0.0, 1.0)
                        roi[:, :, 0] = _np.where(mask, 255.0 - boosted * (255.0 - 220.0), roi[:, :, 0])
                        roi[:, :, 1] = _np.where(mask, 255.0 - boosted * (255.0 - 28.0), roi[:, :, 1])
                        roi[:, :, 2] = _np.where(mask, 255.0 - boosted * (255.0 - 28.0), roi[:, :, 2])
                        arr[y0:y1, x0:x1] = _np.clip(roi, 0, 255).astype(_np.uint8)
                # Recolor active non-error query text to indigo RGB(67, 56, 202) without any box/border
                for r in active_non_err_rects:
                    x0 = max(0, int((r.x0 - 1.5) * scale))
                    y0 = max(0, int((r.y0 - 1.5) * scale))
                    x1 = min(pix.width, int((r.x1 + 1.5) * scale))
                    y1 = min(pix.height, int((r.y1 + 1.5) * scale))
                    if x1 <= x0 or y1 <= y0:
                        continue
                    roi = arr[y0:y1, x0:x1].astype(_np.float32)
                    darkness = _np.clip((255.0 - roi.mean(axis=2)) / 255.0, 0.0, 1.0)
                    mask = darkness > 0.06
                    if _np.any(mask):
                        boosted = _np.clip(darkness * 1.15, 0.0, 1.0)
                        roi[:, :, 0] = _np.where(mask, 255.0 - boosted * (255.0 - 67.0), roi[:, :, 0])
                        roi[:, :, 1] = _np.where(mask, 255.0 - boosted * (255.0 - 56.0), roi[:, :, 1])
                        roi[:, :, 2] = _np.where(mask, 255.0 - boosted * (255.0 - 202.0), roi[:, :, 2])
                        arr[y0:y1, x0:x1] = _np.clip(roi, 0, 255).astype(_np.uint8)
                recolored_pix = fitz.Pixmap(fitz.csRGB, pix.width, pix.height, arr.tobytes(), False)
                png_bytes = recolored_pix.tobytes("png")
            else:
                png_bytes = pix.tobytes("png")
        finally:
            doc.close()
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )

    # Dynamic high-DPI virtual page preview for .docx or synthetic/seeded essays without raw PDF on disk
    doc = fitz.open()
    try:
        page = doc.new_page(width=595, height=842)
        page.insert_text(
            fitz.Point(48, 52),
            f"CITRA Document Inspector  |  {essay.filename}",
            fontsize=11,
            fontname="helv",
            color=(0.12, 0.16, 0.28),
        )
        page.insert_text(
            fitz.Point(48, 68),
            f"Virtual Page Reconstruction — Page {max(1, page_num)} of {max(1, essay.num_pages or 1)} (Red Text = Flagged Errors & Hallucinations)",
            fontsize=8.5,
            color=(0.38, 0.43, 0.54),
        )

        # Render verdicts and citations cleanly with text-only red coloring for errors & hallucinations
        y = 96.0
        items_to_draw: list[tuple[str, str, str]] = []
        for v in verdicts:
            if len(items_to_draw) >= 8:
                break
            v_lbl = (v.label or "unresolved").lower()
            v_raw = (v.citation_raw or "").strip()
            items_to_draw.append((v_raw[:240], v_lbl, v_raw.lower()))
        if not items_to_draw:
            for idx, c in enumerate(citations[:8], start=1):
                ctx = (getattr(c, "context", None) or c.raw_text or "").strip()
                items_to_draw.append((f"[{idx}] {ctx[:220]}", "verified", ctx.lower()))

        for block_text, item_lbl, _match_low in items_to_draw[:8]:
            is_halluc = item_lbl == "suspected_hallucination"
            is_meta_err = item_lbl == "metadata_error"

            # Only color the text in red — do NOT draw any box or border frame around it
            if is_halluc:
                badge_html = '<span style="color: #dc2626; font-weight: bold;">[NGUỒN BỊA ĐẶT / SUSPECTED HALLUCINATION]</span> '
                text_color = "#dc2626"
                font_weight = "600"
            elif is_meta_err:
                badge_html = '<span style="color: #dc2626; font-weight: bold;">[LỖI METADATA / METADATA ERROR]</span> '
                text_color = "#dc2626"
                font_weight = "600"
            elif item_lbl in ("verified", "resource"):
                badge_html = '<span style="color: #15803d; font-weight: bold;">[VERIFIED]</span> '
                text_color = "#1e293b"
                font_weight = "normal"
            else:
                badge_html = f'<span style="color: #475569; font-weight: bold;">[{_html.escape(item_lbl.upper())}]</span> '
                text_color = "#1e293b"
                font_weight = "normal"

            page.insert_htmlbox(
                fitz.Rect(48, y, 548, y + 66),
                f'<div style="font-family: serif; font-size: 9.2pt; color: {text_color}; font-weight: {font_weight}; line-height: 1.4;">{badge_html}{_html.escape(block_text)}</div>',
            )
            y += 74.0
            if y > 755:
                break

        pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        png_bytes = pix.tobytes("png")
    finally:
        doc.close()

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=120"},
    )


# ---------------------------------------------------------------------------
# P3 Killer Feature #1: Live Citation Sandbox & Synthetic PDF Manuscript Studio
# ---------------------------------------------------------------------------

def _extract_author_surname(author_name: str) -> str:
    """Extract clean surname from 'First Middle Surname' or 'Surname, First'."""
    import re

    clean = (author_name or "").strip()
    if not clean:
        return "Author"
    if "," in clean:
        surname = clean.split(",", 1)[0].strip()
    else:
        parts = [p for p in clean.split() if p]
        surname = parts[-1] if parts else clean
    surname_clean = re.sub(r"[^A-Za-zÀ-ÿ\-']", "", surname)
    return surname_clean or "Author"


def _format_author_apa_single(author_name: str) -> str:
    """Format 'Ashish Vaswani' -> 'Vaswani, A.' for APA bibliography."""
    clean = (author_name or "").strip()
    if not clean:
        return "Author, A."
    if "," in clean:
        parts = [p.strip() for p in clean.split(",", 1)]
        surname = parts[0]
        given = parts[1] if len(parts) > 1 else ""
        initials = " ".join(f"{w[0].upper()}." for w in given.split() if w)
        return f"{surname}, {initials}".strip(", ") if initials else f"{surname}, A."
    tokens = [t for t in clean.split() if t]
    if len(tokens) == 1:
        return f"{tokens[0]}, A."
    surname = tokens[-1]
    initials = " ".join(f"{t[0].upper()}." for t in tokens[:-1] if t)
    return f"{surname}, {initials}"


def _format_authors_apa_block(authors: list[str]) -> str:
    """Format list of authors into APA bibliography author string."""
    cleaned = [a.strip() for a in (authors or []) if str(a).strip()]
    if not cleaned:
        return "Author, A."
    formatted = [_format_author_apa_single(a) for a in cleaned[:6]]
    if len(formatted) == 1:
        return formatted[0]
    if len(formatted) == 2:
        return f"{formatted[0]}, & {formatted[1]}"
    return ", ".join(formatted[:-1]) + f", & {formatted[-1]}"


def _format_authors_ieee_block(authors: list[str]) -> str:
    """Format list of authors into IEEE bibliography author string."""
    cleaned = [a.strip() for a in (authors or []) if str(a).strip()]
    if not cleaned:
        return "A. Author"
    out: list[str] = []
    for a in cleaned[:6]:
        if "," in a:
            parts = [p.strip() for p in a.split(",", 1)]
            surname = parts[0]
            given = parts[1] if len(parts) > 1 else "A."
            initials = " ".join(f"{w[0].upper()}." for w in given.split() if w)
            out.append(f"{initials} {surname}".strip())
        else:
            tokens = [t for t in a.split() if t]
            if len(tokens) == 1:
                out.append(f"A. {tokens[0]}")
            else:
                initials = " ".join(f"{t[0].upper()}." for t in tokens[:-1] if t)
                out.append(f"{initials} {tokens[-1]}")
    if len(out) == 1:
        return out[0]
    if len(out) == 2:
        return f"{out[0]} and {out[1]}"
    return ", ".join(out[:-1]) + f", and {out[-1]}"


def _format_in_text_marker_apa(authors: list[str], year_str: str) -> str:
    """Format APA in-text citation marker: (Surname, Year), (S1 & S2, Year), or (S1 et al., Year)."""
    cleaned = [a.strip() for a in (authors or []) if str(a).strip()]
    yr = (year_str or "2020").strip() or "2020"
    if not cleaned:
        return f"(Author, {yr})"
    s1 = _extract_author_surname(cleaned[0])
    if len(cleaned) == 1:
        return f"({s1}, {yr})"
    if len(cleaned) == 2:
        s2 = _extract_author_surname(cleaned[1])
        return f"({s1} & {s2}, {yr})"
    return f"({s1} et al., {yr})"


def _format_sandbox_ref_entry(
    item: dict[str, Any],
    style: str = "apa",
    ref_number: int = 1,
) -> str:
    """Format an editable sandbox paper item into a canonical APA or IEEE reference line."""
    authors = item.get("authors") or []
    if isinstance(authors, str):
        authors = [a.strip() for a in authors.split(",") if a.strip()]
    authors_text = str(item.get("authors_text") or "").strip()
    if authors_text:
        if ";" in authors_text:
            authors = [a.strip() for a in authors_text.split(";") if a.strip()]
        else:
            authors = [a.strip() for a in authors_text.split(",") if a.strip()]

    year_str = str(item.get("year") or "2020").strip() or "2020"
    raw_title = str(item.get("title") or "Untitled Computational Linguistics Study").strip()
    # Replace internal periods so APA parser does not split title early
    clean_title = raw_title.rstrip(".").replace(". ", ": ")
    venue = str(
        item.get("venue")
        or "Proceedings of the Annual Meeting of the Association for Computational Linguistics (ACL)"
    ).strip().rstrip(".")
    doi = str(item.get("doi") or "").strip()
    if doi.lower().startswith("https://doi.org/"):
        doi = doi[16:].strip()
    elif doi.lower().startswith("doi:"):
        doi = doi[4:].strip()

    norm_style = "ieee" if (style or "").strip().lower() == "ieee" else "apa"
    if norm_style == "ieee":
        auth_ieee = _format_authors_ieee_block(authors)
        doi_suffix = f", doi: {doi}." if doi else "."
        return f'[{ref_number}] {auth_ieee}, "{clean_title}," {venue}, {year_str}{doi_suffix}'

    auth_apa = _format_authors_apa_block(authors)
    doi_suffix = f" https://doi.org/{doi}" if doi else ""
    return f"{auth_apa} ({year_str}). {clean_title}. {venue}.{doi_suffix}"


def _build_context_sentence_for_paper(title: str, abstract: str | None, idx: int) -> str:
    """Generate a natural academic sentence for embedding the in-text citation in the PDF body."""
    if abstract and len(abstract.strip()) > 45:
        first_sent = abstract.strip().split(". ")[0].strip().rstrip(".")
        if 40 <= len(first_sent) <= 220:
            return first_sent
    templates = [
        f"Recent advances in computational linguistics have demonstrated the effectiveness of neural architectures regarding {title.lower()}",
        f"Empirical evaluations across benchmark datasets confirm significant improvements when modeling {title.lower()}",
        f"Prior foundational investigations established rigorous theoretical formulations for {title.lower()}",
        f"Methodological developments in representation learning have increasingly focused on {title.lower()}",
        f"Cross-domain experiments highlight the scalability and generalization capacity of approaches addressing {title.lower()}",
    ]
    return templates[idx % len(templates)]


@router.get("/sandbox/acl-sample")
def sample_acl_papers_for_sandbox(
    count: int = 12,
    style: str = "apa",
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Sample 10-20 random papers from the local ACL database (128K+ papers) for interactive live testing."""
    from integrity_checker.database import LocalDatabase

    safe_count = max(5, min(int(count or 12), 25))
    local_db = LocalDatabase()
    sampled = local_db.sample_random_papers(count=safe_count, prefer_with_doi=True)
    stats = local_db.get_stats()
    total_db_papers = int(stats.get("total_papers", 0) or len(sampled))

    items: list[dict[str, Any]] = []
    for idx, p in enumerate(sampled, start=1):
        authors_list = [str(a).strip() for a in (p.authors or []) if str(a).strip()]
        authors_text = "; ".join(authors_list)
        year_str = str(p.year or 2020)
        venue_str = (
            str(p.venue).strip()
            if p.venue and str(p.venue).strip()
            else "Proceedings of the Association for Computational Linguistics (ACL)"
        )
        doi_str = str(p.doi or "").strip()
        context_sent = _build_context_sentence_for_paper(p.title, p.abstract, idx)
        item_dict: dict[str, Any] = {
            "index": idx,
            "paper_id": p.id,
            "title": p.title.strip().rstrip("."),
            "authors": authors_list,
            "authors_text": authors_text,
            "year": year_str,
            "venue": venue_str,
            "doi": doi_str,
            "abstract": (p.abstract or "")[:500],
            "source": p.source or "acl",
            "cite_in_text": True,
            "include_in_references": True,
            "in_text_year_override": "",
            "in_text_context": context_sent,
            "mutation_preset": "clean",
            "original": {
                "title": p.title.strip().rstrip("."),
                "authors_text": authors_text,
                "year": year_str,
                "venue": venue_str,
                "doi": doi_str,
            },
        }
        item_dict["preview_in_text_apa"] = _format_in_text_marker_apa(authors_list, year_str)
        item_dict["preview_reference"] = _format_sandbox_ref_entry(item_dict, style=style, ref_number=idx)
        items.append(item_dict)

    return {
        "count": len(items),
        "style": style,
        "database_total_papers": total_db_papers,
        "items": items,
    }


def _synthesize_academic_manuscript_pdf(
    title: str,
    author_name: str,
    style: str,
    items: list[dict[str, Any]],
) -> tuple[bytes, int, list[str], list[str]]:
    """Build a multi-page academic PDF manuscript containing body sections with in-text citations + References."""
    import io
    from html import escape

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    norm_style = "ieee" if (style or "").strip().lower() == "ieee" else "apa"
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2.2 * cm,
        rightMargin=2.2 * cm,
        topMargin=2.2 * cm,
        bottomMargin=2.2 * cm,
    )
    styles = getSampleStyleSheet()
    title_st = ParagraphStyle(
        "MsTitle",
        parent=styles["Heading1"],
        fontName="Times-Bold",
        fontSize=15,
        leading=19,
        spaceAfter=8,
    )
    meta_st = ParagraphStyle(
        "MsMeta",
        parent=styles["Normal"],
        fontName="Times-Italic",
        fontSize=10,
        leading=13,
        spaceAfter=12,
    )
    h1_st = ParagraphStyle(
        "MsH1",
        parent=styles["Heading2"],
        fontName="Times-Bold",
        fontSize=12,
        leading=15,
        spaceBefore=12,
        spaceAfter=6,
    )
    body_st = ParagraphStyle(
        "MsBody",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=10.5,
        leading=15,
        spaceAfter=8,
    )
    ref_st = ParagraphStyle(
        "MsRef",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=10,
        leading=14,
        leftIndent=14,
        firstLineIndent=-14,
        spaceAfter=6,
    )

    elements: list[Any] = []
    safe_doc_title = (
        title or "Empirical Evaluation of Neural Language Representations in Computational Linguistics"
    ).strip()
    # Avoid words that trigger _ESSAY_TITLE_INDICATORS in CitationExtractor
    elements.append(Paragraph(escape(safe_doc_title), title_st))
    elements.append(
        Paragraph(
            escape(f"{author_name or 'CITRA Sandbox Research Group'} — Academic Manuscript"),
            meta_st,
        )
    )

    # Assign reference numbers for items included in the bibliography
    ref_entries_list: list[tuple[int, dict[str, Any], str]] = []
    item_to_ref_num: dict[int, int] = {}
    next_ref_num = 1
    for idx, it in enumerate(items):
        inc_ref = bool(it.get("include_in_references", True))
        if inc_ref:
            ref_line = _format_sandbox_ref_entry(it, style=norm_style, ref_number=next_ref_num)
            ref_entries_list.append((next_ref_num, it, ref_line))
            item_to_ref_num[idx] = next_ref_num
            next_ref_num += 1

    # Collect body sentences with in-text markers
    in_text_markers_emitted: list[str] = []
    body_paragraphs_by_sec: list[list[str]] = [[], [], []]
    orphan_num = next_ref_num + 4

    for idx, it in enumerate(items):
        if not bool(it.get("cite_in_text", True)):
            continue
        authors_raw = it.get("authors") or []
        if isinstance(authors_raw, str):
            authors_raw = [a.strip() for a in authors_raw.split(",") if a.strip()]
        authors_txt = str(it.get("authors_text") or "").strip()
        if authors_txt:
            if ";" in authors_txt:
                authors_raw = [a.strip() for a in authors_txt.split(";") if a.strip()]
            else:
                authors_raw = [a.strip() for a in authors_txt.split(",") if a.strip()]

        override_yr = str(it.get("in_text_year_override") or "").strip()
        cite_yr = override_yr if override_yr else (str(it.get("year") or "2020").strip() or "2020")

        if norm_style == "ieee":
            if idx in item_to_ref_num:
                r_num = item_to_ref_num[idx]
            else:
                r_num = orphan_num
                orphan_num += 1
            marker = f"[{r_num}]"
        else:
            marker = _format_in_text_marker_apa(authors_raw, cite_yr)

        in_text_markers_emitted.append(marker)
        ctx = str(it.get("in_text_context") or "").strip().rstrip(".")
        if not ctx:
            ctx = _build_context_sentence_for_paper(str(it.get("title") or "neural models"), None, idx)
        sentence = f"{ctx} {marker}. Furthermore, quantitative analyses confirm that these findings hold consistently across multiple evaluation benchmarks and experimental configurations."
        body_paragraphs_by_sec[idx % 3].append(sentence)

    section_titles = [
        "1. Research Motivation and Problem Formulation",
        "2. Theoretical Framework and Literature Analysis",
        "3. Experimental Methodology and Quantitative Findings",
    ]
    default_filler = (
        "Modern natural language processing systems rely heavily on contextual representations, "
        "self-attention mechanisms, and rigorous empirical validation across standardized corpora. "
        "Ensuring bilateral consistency between in-text claims and bibliographic records is essential "
        "for reproducible scientific communication."
    )

    for sec_idx, sec_heading in enumerate(section_titles):
        elements.append(Paragraph(escape(sec_heading), h1_st))
        sec_sents = body_paragraphs_by_sec[sec_idx]
        if not sec_sents:
            elements.append(Paragraph(escape(default_filler), body_st))
        else:
            # Group 2-3 cited sentences per paragraph for realistic academic density
            for i in range(0, len(sec_sents), 2):
                chunk = " ".join(sec_sents[i : i + 2])
                elements.append(Paragraph(escape(chunk), body_st))

    # Bibliography section
    elements.append(Spacer(1, 0.35 * cm))
    elements.append(Paragraph("References", h1_st))
    formatted_refs_only: list[str] = []
    for _, _, ref_line in ref_entries_list:
        formatted_refs_only.append(ref_line)
        elements.append(Paragraph(escape(ref_line), ref_st))

    doc.build(elements)
    pdf_bytes = buf.getvalue()

    num_pages = 1
    try:
        import fitz
        fdoc = fitz.open(stream=pdf_bytes, filetype="pdf")
        num_pages = max(1, len(fdoc))
        fdoc.close()
    except Exception:
        num_pages = 1

    return pdf_bytes, num_pages, in_text_markers_emitted, formatted_refs_only


@router.post("/sandbox/generate-pdf")
async def generate_sandbox_pdf_manuscript(
    payload: dict[str, Any],
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    pipeline: IntegrityPipeline = Depends(get_pipeline),
) -> Any:
    """Synthesize a complete academic PDF manuscript (Body with In-Text Citations + References) from edited ACL papers.

    Supports both direct PDF download (``download_only=true``) and full end-to-end
    pipeline execution (``run_verification=true``) to verify Layer 1 (In-text <-> Refs)
    and Layer 2 (Multi-database metadata & hallucination check).
    """
    import base64

    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng chọn hoặc tạo ít nhất 1 bài báo trong danh sách Sandbox.",
        )

    style = str(payload.get("style") or "apa").strip().lower()
    doc_title = str(
        payload.get("title")
        or "Empirical Evaluation of Neural Language Representations in Computational Linguistics"
    ).strip()
    author_name = str(payload.get("author_name") or current_user.username or "CITRA Researcher").strip()
    download_only = bool(payload.get("download_only", False))
    run_verification = bool(payload.get("run_verification", not download_only))
    custom_filename = str(payload.get("filename") or "").strip()

    pdf_bytes, num_pages, in_text_markers, ref_lines = _synthesize_academic_manuscript_pdf(
        title=doc_title,
        author_name=author_name,
        style=style,
        items=items[:25],
    )

    if not custom_filename:
        safe_style = "IEEE" if style == "ieee" else "APA"
        custom_filename = f"CITRA_ACL_Sandbox_{safe_style}_{len(items)}refs.pdf"
    elif not custom_filename.lower().endswith(".pdf"):
        custom_filename = f"{custom_filename}.pdf"

    if download_only and not run_verification:
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{custom_filename}"',
            },
        )

    # Atomically claim 1 monthly upload slot & launch full IntegrityPipeline
    essay = _claim_monthly_upload_slot_and_create_essay(
        db,
        current_user,
        filename=custom_filename,
        num_pages=num_pages,
        structured_error=True,
    )

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    persisted_path = _get_persisted_upload_path(essay.id, ext=".pdf")
    persisted_path.write_bytes(pdf_bytes)

    tracker = get_tracker()
    tracker.init(essay.id)

    background_tasks.add_task(
        _run_pipeline_task,
        essay.id,
        str(persisted_path),
        current_user.id,
        pipeline,
        False,
    )

    return {
        "essay_id": essay.id,
        "filename": essay.filename,
        "num_pages": num_pages,
        "in_text_count": len(in_text_markers),
        "references_count": len(ref_lines),
        "in_text_markers_preview": in_text_markers[:25],
        "references_preview": ref_lines[:25],
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        "status": "processing",
    }


@router.post("/sandbox/verify")
async def verify_sandbox_citations_instant(
    payload: dict[str, Any],
    current_user: User = Depends(get_current_user),
    pipeline: IntegrityPipeline = Depends(get_pipeline),
) -> dict[str, Any]:
    """Instant 3-second live citation & Layer-1/Layer-2 verification without leaving UploadPage."""
    import time

    from integrity_checker.export.bibliography_formatter import build_remediated_bibliography
    from integrity_checker.extraction.base import Document, Page
    from integrity_checker.models.citation import Citation, CitationStyle, CitationType

    t0 = time.monotonic()
    style = str(payload.get("style") or "apa").strip().lower()
    lang_code = str(payload.get("lang") or "vi").strip().lower()
    is_en = lang_code.startswith("en")
    items = payload.get("items")
    raw_references_text = str(payload.get("references_text") or "").strip()
    claim_context = str(payload.get("claim_context") or "").strip()

    parsed_citations: list[Citation] = []
    layer1_statuses: list[dict[str, Any]] = []

    if isinstance(items, list) and items:
        for idx, it in enumerate(items[:20], start=1):
            ref_line = _format_sandbox_ref_entry(it, style=style, ref_number=idx)
            authors_raw = it.get("authors") or []
            if isinstance(authors_raw, str):
                authors_raw = [a.strip() for a in authors_raw.split(",") if a.strip()]
            authors_txt = str(it.get("authors_text") or "").strip()
            if authors_txt:
                if ";" in authors_txt:
                    authors_raw = [a.strip() for a in authors_txt.split(";") if a.strip()]
                else:
                    authors_raw = [a.strip() for a in authors_txt.split(",") if a.strip()]
            year_val: int | None = None
            try:
                year_val = int(str(it.get("year") or "").strip()[:4])
            except Exception:
                year_val = None

            doi_val = str(it.get("doi") or "").strip() or None
            if doi_val and doi_val.lower().startswith("https://doi.org/"):
                doi_val = doi_val[16:].strip()

            cite_in_text = bool(it.get("cite_in_text", True))
            inc_in_refs = bool(it.get("include_in_references", True))
            override_yr = str(it.get("in_text_year_override") or "").strip()

            if not inc_in_refs and cite_in_text:
                l1_status = "missing_reference"
                l1_note = (
                    "Cited in manuscript body (In-text) but missing corresponding entry in References."
                    if is_en
                    else "Có trích dẫn trong bài (In-text) nhưng thiếu mục tương ứng trong References."
                )
            elif inc_in_refs and not cite_in_text:
                l1_status = "uncited_reference"
                l1_note = (
                    "Listed in References section but never cited in manuscript body."
                    if is_en
                    else "Nằm trong mục References cuối bài nhưng không được trích dẫn trong nội dung bài viết."
                )
            elif override_yr and override_yr != str(it.get("year") or "").strip():
                l1_status = "in_text_mismatch"
                l1_note = (
                    f"Publication year mismatch between In-text ({override_yr}) and Reference ({it.get('year')})."
                    if is_en
                    else f"Lệch năm xuất bản giữa In-text ({override_yr}) và Reference ({it.get('year')})."
                )
            else:
                l1_status = "matched"
                l1_note = (
                    "Exact bidirectional match between In-text citation and Reference entry."
                    if is_en
                    else "Khớp hai chiều hoàn hảo giữa In-text citation và Reference entry."
                )

            cit = Citation(
                raw_text=ref_line,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE if style == "ieee" else CitationStyle.APA,
                authors=authors_raw,
                year=str(year_val) if year_val is not None else None,
                title=str(it.get("title") or "").strip() or None,
                venue=str(it.get("venue") or "").strip() or None,
                doi=doi_val,
                page_num=1,
                context=str(it.get("in_text_context") or claim_context or "").strip() or None,
                mapping_status=l1_status,
                mapping_confidence=1.0 if l1_status == "matched" else 0.65,
            )
            parsed_citations.append(cit)
            layer1_statuses.append({"status": l1_status, "note": l1_note})
    elif raw_references_text:
        fake_doc = Document(
            file_path="sandbox.pdf",
            num_pages=1,
            pages=[
                Page(
                    page_num=1,
                    text=f"References\n{raw_references_text}\n",
                    has_text_layer=True,
                )
            ],
            parser_used="sandbox",
        )
        parsed_citations = pipeline.ref_parser.parse_reference_section(fake_doc)
        if not parsed_citations:
            for line in [ln.strip() for ln in raw_references_text.splitlines() if len(ln.strip()) > 12][:15]:
                parsed_citations.append(
                    Citation(
                        raw_text=line,
                        citation_type=CitationType.REFERENCE_LIST,
                        style=CitationStyle.APA,
                        page_num=1,
                        context=claim_context or None,
                        mapping_status="matched",
                        mapping_confidence=1.0,
                    )
                )
        for c in parsed_citations:
            if claim_context:
                c.context = claim_context
            layer1_statuses.append(
                {
                    "status": "matched",
                    "note": (
                        "Direct bibliography verification."
                        if is_en
                        else "Kiểm tra trực tiếp danh mục tham khảo."
                    ),
                }
            )
    else:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please enter or select at least 1 citation to verify."
                if is_en
                else "Vui lòng nhập hoặc chọn ít nhất 1 trích dẫn để kiểm tra."
            ),
        )

    parsed_citations = parsed_citations[:20]
    sem = asyncio.Semaphore(8)

    async def _retrieve_one(c: Citation):
        from integrity_checker.models.source import SourceResult

        async with sem:
            rules_obj = getattr(getattr(pipeline, "checker", None), "rules", None)
            if c.doi and rules_obj is not None and hasattr(rules_obj, "_is_fabricated_doi"):
                try:
                    if rules_obj._is_fabricated_doi(c.doi) is True:
                        return SourceResult(
                            citation_raw=c.raw_text,
                            candidates=[],
                            sources_queried=["local_db", "crossref", "openalex"],
                            sources_succeeded=[],
                            sources_failed={
                                "crossref": "No results for fabricated DOI",
                                "openalex": "No results for fabricated DOI",
                            },
                        )
                except Exception:
                    pass
            orch = getattr(pipeline, "orchestrator", None)
            if getattr(orch, "_local_db", None) is not None and callable(getattr(orch, "_lookup_local_db", None)):
                try:
                    local_hit = orch._lookup_local_db(c)
                    if isinstance(local_hit, SourceResult) and local_hit.candidates:
                        return local_hit
                    if c.title and hasattr(orch._local_db, "search_by_title"):
                        from integrity_checker.models.source import SourceCandidate
                        from integrity_checker.retrieval.utils import title_similarity

                        title_hits = orch._local_db.search_by_title(c.title, limit=3) or []
                        for p in title_hits:
                            if p.title and title_similarity(c.title, p.title) >= 0.92:
                                cand = SourceCandidate(
                                    source_name="local_db",
                                    found=True,
                                    doi=p.doi,
                                    title=p.title,
                                    authors=p.authors,
                                    year=str(p.year) if p.year else None,
                                    venue=p.venue,
                                    url=(p.external_ids or {}).get("url") if p.external_ids else None,
                                    abstract=p.abstract,
                                    external_ids=p.external_ids or {},
                                    confidence=0.90,
                                    cached=True,
                                    paper_id=p.id,
                                )
                                return SourceResult(
                                    citation_raw=c.raw_text,
                                    candidates=[cand],
                                    sources_queried=["local_db"],
                                    sources_succeeded=["local_db"],
                                    sources_failed={},
                                )
                except Exception:
                    pass
            try:
                return await asyncio.wait_for(pipeline.orchestrator.retrieve(c), timeout=5.0)
            except TimeoutError:
                return SourceResult(
                    citation_raw=c.raw_text,
                    candidates=[],
                    sources_queried=["local_db", "crossref", "openalex"],
                    sources_succeeded=[],
                    sources_failed={
                        "crossref": "No results for query",
                        "openalex": "No results for query",
                    },
                )

    source_results = await asyncio.gather(*(_retrieve_one(c) for c in parsed_citations))

    verdict_items: list[dict[str, Any]] = []
    raw_verdict_dicts_for_remediation: list[dict[str, Any]] = []

    for idx, (citation, source) in enumerate(zip(parsed_citations, source_results, strict=False), start=1):
        used_local = "local_db" in (source.sources_succeeded or [])
        verdict = pipeline.checker.check(
            citation,
            source,
            citation_context=citation.context,
            api_exhausted=bool(getattr(source, "api_exhausted", False)),
            used_local_db=used_local,
        )
        l1_info = layer1_statuses[idx - 1] if idx - 1 < len(layer1_statuses) else {"status": "matched", "note": ""}
        best = source.best_candidate()
        matched_src = None
        if best:
            matched_src = {
                "source_name": best.source_name,
                "title": best.title,
                "authors": best.authors,
                "year": best.year,
                "venue": best.venue,
                "doi": best.doi,
                "url": best.url,
                "abstract": best.abstract,
            }
        v_dict = {
            "index": idx,
            "citation_raw": citation.raw_text,
            "cited_title": citation.title,
            "cited_authors": citation.authors,
            "cited_year": citation.year,
            "cited_venue": citation.venue,
            "cited_doi": citation.doi,
            "label": verdict.label.value if hasattr(verdict.label, "value") else str(verdict.label),
            "confidence": round(float(verdict.confidence or 0.0), 3),
            "mapping_status": l1_info["status"],
            "mapping_note": l1_info["note"],
            "reasoning": verdict.reasoning,
            "triggered_rules": list(verdict.triggered_rules or []),
            "mismatched_fields": list(verdict.mismatched_fields or []),
            "matched_source": matched_src,
            "matched_sources": [matched_src] if matched_src else [],
            "sources_succeeded": list(source.sources_succeeded or []),
            "used_local_db": used_local,
        }
        verdict_items.append(v_dict)
        raw_verdict_dicts_for_remediation.append(v_dict)

    remediation = build_remediated_bibliography(
        essay_id=0,
        verdicts=raw_verdict_dicts_for_remediation,
        style=style,
    )
    elapsed = round(time.monotonic() - t0, 2)

    verified_cnt = sum(1 for v in verdict_items if v["label"] == "verified")
    meta_err_cnt = sum(1 for v in verdict_items if v["label"] == "metadata_error")
    halluc_cnt = sum(1 for v in verdict_items if v["label"] == "suspected_hallucination")
    l1_issue_cnt = sum(1 for v in verdict_items if v["mapping_status"] != "matched")

    return {
        "elapsed_seconds": elapsed,
        "total": len(verdict_items),
        "summary": {
            "verified": verified_cnt,
            "metadata_error": meta_err_cnt,
            "suspected_hallucination": halluc_cnt,
            "layer1_linking_issues": l1_issue_cnt,
        },
        "results": verdict_items,
        "remediation": remediation,
    }
