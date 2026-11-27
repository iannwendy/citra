"""Essays endpoints — upload PDF và analyze."""

from __future__ import annotations

import asyncio
import inspect
import io
import json
import math
import os
import re
import threading
import time
import urllib.parse
import zipfile
from collections import OrderedDict
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, update
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_current_user, get_db, get_pipeline, require_admin
from integrity_checker.api.job_recovery import QUOTA_LEDGER_LOCK, refund_upload_quota_once
from integrity_checker.api.progress import (
    MAX_AUTO_RETRIES,
    compute_sqlite_fifo_queue_position,
    get_pipeline_admission_controller,
    get_tracker,
    refresh_live_snapshot_elapsed,
)
from integrity_checker.billing.plans import ensure_user_quota_current, get_user_plan_policy
from integrity_checker.config import PROJECT_ROOT, is_test_runtime
from integrity_checker.db.models import CitationRecord, EssayRecord, User, VerdictRecord
from integrity_checker.db.repository import Repository
from integrity_checker.models.api_schemas import EssayUploadResponse
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline
from integrity_checker.retrieval.http_pool import close_loop_http_clients

router = APIRouter()

UPLOADS_DIR = PROJECT_ROOT / "data" / "essays" / "uploads"
_DEFAULT_UPLOADS_DIR = UPLOADS_DIR


ALLOWED_UPLOAD_EXTENSIONS = (".pdf", ".docx", ".bib", ".ris")

_QUOTA_CLAIM_LOCK = QUOTA_LEDGER_LOCK

SANDBOX_VERIFY_MAX_REQUESTS: int = int(
    os.getenv("CITRA_SANDBOX_VERIFY_MAX_REQUESTS", "10")
)
SANDBOX_VERIFY_WINDOW_SECONDS: float = float(
    os.getenv("CITRA_SANDBOX_VERIFY_WINDOW_SECONDS", "60")
)
_SANDBOX_VERIFY_MAX_BUCKET_KEYS: int = 4096
_sandbox_verify_rate_lock = threading.Lock()
_sandbox_verify_rate_buckets: OrderedDict[int, list[float]] = OrderedDict()
_background_retry_tasks: set[asyncio.Task[Any]] = set()

PUBLIC_SANDBOX_MAX_REQUESTS: int = int(
    os.getenv("CITRA_PUBLIC_SANDBOX_MAX_REQUESTS", "6")
)
PUBLIC_SANDBOX_WINDOW_SECONDS: float = float(
    os.getenv("CITRA_PUBLIC_SANDBOX_WINDOW_SECONDS", "60")
)
PUBLIC_SANDBOX_MAX_CHARS: int = 1500
PUBLIC_SANDBOX_MAX_REFERENCES: int = 3
_PUBLIC_SANDBOX_MAX_BUCKET_KEYS: int = 4096
_public_sandbox_rate_lock = threading.Lock()
_public_sandbox_rate_buckets: dict[str, list[float]] = {}

SSE_POLL_INTERVAL_SECONDS: float = 1.0
SSE_HEARTBEAT_INTERVAL_SECONDS: float = 15.0
SSE_DISCONNECT_CHECK_SECONDS: float = 0.25
SSE_RESPONSE_HEADERS: dict[str, str] = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _get_worker_mode() -> str:
    """Return configured worker execution mode ('inline', 'web_only', or 'worker_only')."""
    mode = os.getenv("CITRA_WORKER_MODE", "inline").strip().lower()
    if mode in {"web_only", "worker_only", "inline"}:
        return mode
    return "inline"


def _claim_monthly_upload_slot_and_create_essay(
    db: Session,
    current_user: User,
    *,
    filename: str,
    num_pages: int,
    class_id: int | None = None,
    structured_error: bool = False,
    upload_content: bytes | None = None,
    upload_ext: str = ".pdf",
) -> Any:
    """Atomically enforce & increment monthly_uploads_used, persist upload bytes, and insert EssayRecord.

    Prevents concurrent uploads (e.g. Batch Check BATCH_CONCURRENCY=3) from reading a
    stale monthly_uploads_used snapshot, losing increments, bypassing plan limits, or
    charging quota if persisting upload bytes to disk fails.
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
        if (getattr(res, "rowcount", 0) or 0) != 1:
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
        essay.job_status = "queued"
        essay.quota_charged = 1
        essay.job_attempt_count = 0
        essay.job_heartbeat_at = datetime.now(UTC)
        essay.job_error = None

        if upload_content is not None:
            try:
                _persist_upload_bytes(essay.id, upload_ext, upload_content)
            except Exception:
                failed_eid = essay.id
                db.rollback()
                db.expire_all()
                if failed_eid is not None:
                    try:
                        _get_persisted_upload_path(failed_eid, ext=upload_ext).unlink(
                            missing_ok=True
                        )
                    except OSError:
                        pass
                raise

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


def _persist_upload_bytes(essay_id: int, ext: str, content: bytes) -> Path:
    """Persist uploaded document bytes under UPLOADS_DIR for worker/recovery access."""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    persisted_path = _get_persisted_upload_path(essay_id, ext=ext)
    persisted_path.write_bytes(content)
    return persisted_path


def _clear_persisted_progress_snapshot(essay: EssayRecord) -> None:
    """Strip any stale _progress_snapshot from essay.style_profile_json before re-queuing."""
    if not essay.style_profile_json:
        return
    try:
        import json as _json

        parsed = _json.loads(essay.style_profile_json)
        if isinstance(parsed, dict) and "_progress_snapshot" in parsed:
            parsed.pop("_progress_snapshot", None)
            essay.style_profile_json = _json.dumps(parsed) if parsed else None
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Background pipeline task
# ---------------------------------------------------------------------------

async def _run_pipeline_task(
    essay_id: int,
    tmp_path: str,
    user_id: int,
    pipeline: IntegrityPipeline,
    cleanup_file: bool = True,
    *,
    bypass_report_cache: bool = False,
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
    last_hb_mono = 0.0
    last_hb_step: str | None = None

    def _progress_to_threadlocal(step_key: str, step_index: int, stats: dict) -> None:
        """Called from the worker thread — tracker.update is thread-safe via
        its own lock, so cross-thread updates are fine."""
        nonlocal last_hb_mono, last_hb_step
        tracker.update(
            essay_id,
            status="processing",
            queue_position=None,
            step=step_key,
            step_index=step_index,
            **stats,
        )
        now_mono = time.monotonic()
        if step_key != last_hb_step or (now_mono - last_hb_mono) >= 5.0:
            last_hb_step = step_key
            last_hb_mono = now_mono
            hb_session = None
            try:
                hb_session = get_session()
                hb_session.execute(
                    update(EssayRecord)
                    .where(EssayRecord.id == essay_id)
                    .values(job_heartbeat_at=datetime.now(UTC))
                    .execution_options(synchronize_session=False)
                )
                hb_session.commit()
            except Exception:
                if hb_session is not None:
                    try:
                        hb_session.rollback()
                    except Exception:
                        pass
            finally:
                if hb_session is not None:
                    try:
                        hb_session.close()
                    except Exception:
                        pass

    keep_file_for_retry = False
    try:
        async with get_pipeline_admission_controller().acquire(
            essay_id, tracker=tracker
        ) as admitted:
            if not admitted:
                tracker.clear(essay_id)
                logger.info(
                    f"Queued essay {essay_id} was cancelled before pipeline execution"
                )
                return

            status_session = get_session()
            try:
                essay_row = status_session.get(EssayRecord, essay_id)
                if essay_row is not None:
                    essay_row.job_status = "processing"
                    essay_row.job_heartbeat_at = datetime.now(UTC)
                    essay_row.job_error = None
                    status_session.commit()
            finally:
                status_session.close()

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
            loop = asyncio.get_running_loop()

            def _run_pipeline_sync(
                _max_cit: int | None = max_citations,
                _allow_serp: bool | None = allow_serpapi,
                _path: str = tmp_path,
            ) -> Any:
                call_kwargs: dict[str, Any] = {
                    "essay_id": essay_id,
                    "progress_callback": _progress_to_threadlocal,
                }
                sig_params = inspect.signature(pipeline.run_async).parameters
                has_var_kw = any(
                    p.kind == inspect.Parameter.VAR_KEYWORD
                    for p in sig_params.values()
                )
                if "max_citations" in sig_params or has_var_kw:
                    call_kwargs["max_citations"] = _max_cit
                if "allow_serpapi" in sig_params or has_var_kw:
                    call_kwargs["allow_serpapi"] = _allow_serp
                if bypass_report_cache and (
                    "bypass_report_cache" in sig_params or has_var_kw
                ):
                    call_kwargs["bypass_report_cache"] = True

                async def _runner() -> Any:
                    try:
                        try:
                            return await pipeline.run_async(_path, **call_kwargs)
                        except TypeError as type_exc:
                            if (
                                "bypass_report_cache" in call_kwargs
                                and "bypass_report_cache" in str(type_exc)
                            ):
                                fallback_kwargs = dict(call_kwargs)
                                fallback_kwargs.pop("bypass_report_cache", None)
                                return await pipeline.run_async(
                                    _path, **fallback_kwargs
                                )
                            raise
                    finally:
                        await close_loop_http_clients()

                return asyncio.run(_runner())

            report = await loop.run_in_executor(None, _run_pipeline_sync)

        # Guard against completely unreadable / corrupted files that yielded 0 pages and 0 citations
        if int(getattr(report, "num_pages", 0) or 0) == 0 and not getattr(
            report, "extracted_citations", None
        ):
            sp_raw = getattr(report, "style_profile", None)
            diag = (
                sp_raw.get("document_diagnostics", {})
                if isinstance(sp_raw, dict)
                else {}
            )
            p_warns = diag.get("parser_warnings", []) if isinstance(diag, dict) else []
            if any("failed" in str(w).lower() for w in p_warns):
                raise ValueError("Document file is corrupted or unreadable.")

        # Persist to DB using a fresh session BEFORE marking tracker complete
        session = get_session()
        try:
            repo = Repository(session)
            essay = repo.get_essay(essay_id)
            if essay:
                essay.num_pages = report.num_pages

            session.query(CitationRecord).filter(
                CitationRecord.essay_id == essay_id
            ).delete()
            session.query(VerdictRecord).filter(
                VerdictRecord.essay_id == essay_id
            ).delete()
            repo.add_citations(essay_id, report.extracted_citations)
            repo.add_verdicts(essay_id, report.verdicts)

            style_profile_dict = None
            if report.style_profile:
                sp = report.style_profile
                if isinstance(sp, dict):
                    evidence = (
                        sp.get("evidence", {})
                        if isinstance(sp.get("evidence"), dict)
                        else {}
                    )
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
                        "citations_truncated_by_plan": bool(
                            sp.get("citations_truncated_by_plan", False)
                        ),
                    }
                else:
                    style_profile_dict = {
                        "style": sp.style.value
                        if hasattr(sp.style, "value")
                        else str(sp.style),
                        "confidence": sp.confidence,
                        "apa_count": getattr(sp, "apa_count", 0),
                        "ieee_count": getattr(sp, "ieee_count", 0),
                        "mixed_count": getattr(sp, "mixed_count", 0),
                        "numeric_count": getattr(sp, "numeric_count", 0),
                        "features": getattr(sp, "evidence", {}).get("features", {})
                        if hasattr(sp, "evidence")
                        else {},
                        "ratios": getattr(sp, "evidence", {}).get("ratios", {})
                        if hasattr(sp, "evidence")
                        else {},
                        "explanation": getattr(sp, "evidence", {}).get(
                            "explanation", ""
                        )
                        if hasattr(sp, "evidence")
                        else "",
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
                            and attr
                            in [
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

            report_diagnostics: dict[str, Any] | None = (
                style_profile_dict.get("document_diagnostics")
                if isinstance(style_profile_dict, dict)
                else None
            )
            if report_diagnostics is None:
                raw_rep_diag = getattr(report, "document_diagnostics", None)
                if isinstance(raw_rep_diag, dict):
                    report_diagnostics = raw_rep_diag

            repo.update_essay_pipeline_output(
                essay_id,
                style_profile=style_profile_dict,
                cis=cis_dict,
            )
            if essay:
                essay.job_status = "completed"
                essay.job_heartbeat_at = datetime.now(UTC)
                essay.job_error = None
            repo.commit()
        finally:
            session.close()

        tracker.complete(essay_id, document_diagnostics=report_diagnostics)
        logger.info(f"Pipeline complete for essay {essay_id}")

    except Exception as exc:
        logger.exception(f"Pipeline failed for essay {essay_id}: {exc}")
        raw_err = str(exc)
        raw_err_low = raw_err.lower()
        if "disk i/o error" in raw_err_low:
            safe_err = "Transient database disk I/O error"
        elif "corrupted or unreadable" in raw_err_low:
            safe_err = "Document file is corrupted or unreadable."
        else:
            safe_err = "Analysis failed due to an internal processing error."

        eligible_for_in_process_retry = (
            _get_worker_mode() == "inline"
            and "disk i/o error" in raw_err_low
            and not is_test_runtime()
            and _get_persisted_upload_path(essay_id).is_file()
            and tracker.can_auto_retry(essay_id)
        )
        keep_file_for_retry = eligible_for_in_process_retry
        quota_charged_after_fail = True
        if not eligible_for_in_process_retry:
            try:
                err_session = get_session()
                try:
                    refunded = refund_upload_quota_once(err_session, essay_id, safe_err)
                    failed_row = err_session.get(EssayRecord, essay_id)
                    quota_charged_after_fail = (
                        False
                        if refunded
                        else bool(getattr(failed_row, "quota_charged", False))
                    )
                finally:
                    err_session.close()
            except Exception as refund_exc:
                logger.warning(
                    f"Could not persist quota refund for failed essay {essay_id}: {refund_exc}"
                )
        tracker.fail(essay_id, safe_err, quota_charged=quota_charged_after_fail)
    finally:
        if cleanup_file and not keep_file_for_retry:
            Path(tmp_path).unlink(missing_ok=True)  # noqa: ASYNC240 - tiny local unlink in cleanup


def _estimate_docx_pages(content: bytes) -> int:
    """Estimate page count of a safe .docx archive from app.xml, explicit breaks, and text length."""
    from defusedxml.ElementTree import fromstring as safe_fromstring

    word_ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    app_pages = 1
    break_pages = 1
    char_pages = 1
    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
            names = set(zf.namelist())
            if "docProps/app.xml" in names:
                app_root = safe_fromstring(
                    zf.read("docProps/app.xml"),
                    forbid_dtd=True,
                    forbid_entities=True,
                    forbid_external=True,
                )
                for elem in app_root.iter():
                    if elem.tag.endswith("Pages") and elem.text and elem.text.strip().isdigit():
                        app_pages = max(1, int(elem.text.strip()))
                        break
            if "word/document.xml" in names:
                doc_root = safe_fromstring(
                    zf.read("word/document.xml"),
                    forbid_dtd=True,
                    forbid_entities=True,
                    forbid_external=True,
                )
                page_breaks = 0
                total_chars = 0
                for elem in doc_root.iter():
                    if elem.tag == f"{word_ns}br":
                        br_type = (
                            elem.attrib.get(f"{word_ns}type")
                            or elem.attrib.get("type")
                            or ""
                        ).lower()
                        if br_type == "page":
                            page_breaks += 1
                    elif elem.tag == f"{word_ns}t" and elem.text:
                        total_chars += len(elem.text)
                break_pages = 1 + page_breaks
                char_pages = max(1, math.ceil(total_chars / 3200)) if total_chars > 0 else 1
    except Exception:
        return 1
    return max(1, app_pages, break_pages, char_pages)

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

    def _validate_and_claim_upload_sync() -> EssayRecord:
        detected_pages = 1 if upload_ext in (".bib", ".ris") else 0
        if upload_ext == ".pdf":
            if b"%PDF-" not in content[:1024]:
                raise HTTPException(
                    status_code=400, detail="Invalid PDF file: missing %PDF- header"
                )
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
            from integrity_checker.export.docx_exporter import _docx_xml_is_safe

            if not _docx_xml_is_safe(io.BytesIO(content)):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid or unsafe DOCX file: failed OOXML security validation",
                )
            detected_pages = _estimate_docx_pages(content)
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

        return _claim_monthly_upload_slot_and_create_essay(
            db,
            current_user,
            filename=safe_filename,
            num_pages=detected_pages,
            class_id=class_id,
            structured_error=False,
            upload_content=content,
            upload_ext=upload_ext,
        )

    essay = await asyncio.to_thread(_validate_and_claim_upload_sync)

    persisted_path = _get_persisted_upload_path(essay.id, ext=upload_ext)
    if _get_worker_mode() == "web_only":
        get_tracker().clear(essay.id)
        return EssayUploadResponse(
            essay_id=essay.id,
            filename=essay.filename,
            num_pages=0,
            num_citations=0,
            citations=[],
            summary={"status": "queued"},
        )

    tmp_path = str(persisted_path)
    cleanup_file = bool(is_test_runtime() and UPLOADS_DIR == _DEFAULT_UPLOADS_DIR)

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

    worker_mode = _get_worker_mode()
    tracker = get_tracker()
    state = None if worker_mode == "web_only" else tracker.get(essay_id)
    raw_qc = getattr(essay, "quota_charged", True)
    quota_charged_bool = True if raw_qc is None else bool(raw_qc)

    if state is not None:
        # Auto-retry at most once if a prior background run failed solely due to transient sqlite I/O error
        if (
            worker_mode == "inline"
            and state.status == "failed"
            and state.error
            and "disk i/o error" in state.error.lower()
            and not is_test_runtime()
            and persisted_pdf.is_file()
            and (
                resumed_state := tracker.try_claim_auto_retry(
                    essay_id, min_prior_retries=int(state.retry_count or 0)
                )
            )
            is not None
        ):
            background_tasks.add_task(
                _run_pipeline_task,
                essay.id,
                str(persisted_pdf),
                essay.user_id or current_user.id,
                get_pipeline(),
                False,
            )
            resumed_snap = dict(resumed_state.to_snapshot())
            resumed_snap["quota_charged"] = quota_charged_bool
            return resumed_snap
        latest_state = tracker.get(essay_id) or state
        if latest_state.status == "failed" and getattr(essay, "job_status", None) == "processing":
            fail_reason = (
                latest_state.error
                or essay.job_error
                or "Analysis failed due to an internal processing error."
            )
            refunded = refund_upload_quota_once(db, essay_id, fail_reason)
            refreshed_row = db.get(EssayRecord, essay_id)
            quota_charged_bool = (
                False
                if refunded
                else (
                    True
                    if getattr(refreshed_row, "quota_charged", False) is None
                    else bool(getattr(refreshed_row, "quota_charged", False))
                )
            )
            tracker.update(essay_id, quota_charged=quota_charged_bool)
        live_snap = dict(latest_state.to_snapshot())
        if live_snap.get("status") == "queued" and live_snap.get("queue_position") is None:
            live_snap["queue_position"] = compute_sqlite_fifo_queue_position(db, essay_id)
        live_snap["quota_charged"] = quota_charged_bool
        return live_snap

    # No tracker entry — fall back to DB state (queued job, verdicts/CIS, or persisted snapshot)
    persisted_snap = tracker.load_persisted_snapshot(essay_id, essay)
    if getattr(essay, "job_status", None) == "queued":
        if persisted_snap is not None and persisted_snap.get("status") == "queued":
            snap = dict(refresh_live_snapshot_elapsed(persisted_snap))
            if snap.get("queue_position") is None:
                snap["queue_position"] = compute_sqlite_fifo_queue_position(db, essay_id)
            snap["quota_charged"] = quota_charged_bool
            return snap
        q_pos = compute_sqlite_fifo_queue_position(db, essay_id)
        return {
            "status": "queued",
            "step": "queued",
            "step_index": 0,
            "total_steps": 8,
            "message": f"Queued for analysis (position #{q_pos})...",
            "citations_found": 0,
            "references_found": 0,
            "linked": 0,
            "sources_queried": {},
            "elapsed_seconds": 0.0,
            "finished_at": None,
            "error": None,
            "queue_position": q_pos,
            "quota_charged": quota_charged_bool,
        }

    if getattr(essay, "job_status", None) == "processing":
        if persisted_snap is not None and persisted_snap.get("status") == "failed":
            fail_err = str(
                persisted_snap.get("error")
                or essay.job_error
                or "Analysis failed due to an internal processing error."
            )
            prior_retries = int(persisted_snap.get("retry_count") or 0)
            if (
                worker_mode == "inline"
                and "disk i/o error" in fail_err.lower()
                and not is_test_runtime()
                and persisted_pdf.is_file()
                and (
                    resumed_state := tracker.try_claim_auto_retry(
                        essay_id, min_prior_retries=prior_retries
                    )
                )
                is not None
            ):
                background_tasks.add_task(
                    _run_pipeline_task,
                    essay.id,
                    str(persisted_pdf),
                    essay.user_id or current_user.id,
                    get_pipeline(),
                    False,
                )
                resumed_snap = dict(resumed_state.to_snapshot())
                resumed_snap["quota_charged"] = quota_charged_bool
                return resumed_snap

            concurrent_state = None if worker_mode == "web_only" else tracker.get(essay_id)
            if concurrent_state is not None and concurrent_state.status in (
                "queued",
                "processing",
                "completed",
            ):
                live_snap = dict(concurrent_state.to_snapshot())
                live_snap["quota_charged"] = quota_charged_bool
                return live_snap

            refunded = refund_upload_quota_once(db, essay_id, fail_err)
            refreshed_essay = db.get(EssayRecord, essay_id)
            final_qc = (
                False
                if refunded
                else (
                    True
                    if getattr(refreshed_essay, "quota_charged", False) is None
                    else bool(getattr(refreshed_essay, "quota_charged", False))
                )
            )
            failed_snap: dict[str, Any] = {
                "status": "failed",
                "step": persisted_snap.get("step", "parsing"),
                "step_index": int(persisted_snap.get("step_index", 0) or 0),
                "total_steps": 8,
                "message": f"Failed: {fail_err}",
                "citations_found": int(persisted_snap.get("citations_found", 0) or 0),
                "references_found": int(persisted_snap.get("references_found", 0) or 0),
                "linked": int(persisted_snap.get("linked", 0) or 0),
                "sources_queried": persisted_snap.get("sources_queried", {}),
                "elapsed_seconds": float(persisted_snap.get("elapsed_seconds", 0.0) or 0.0),
                "finished_at": persisted_snap.get("finished_at"),
                "error": fail_err,
                "retry_count": prior_retries,
                "queue_position": None,
                "quota_charged": final_qc,
            }
            if "document_diagnostics" in persisted_snap:
                failed_snap["document_diagnostics"] = persisted_snap.get("document_diagnostics")
            return failed_snap
        if persisted_snap is not None and persisted_snap.get("status") in (
            "processing",
            "queued",
        ):
            snap = dict(refresh_live_snapshot_elapsed(persisted_snap))
            snap["quota_charged"] = quota_charged_bool
            return snap
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
            "quota_charged": quota_charged_bool,
        }

    verdicts = repo.get_verdicts(essay_id)
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
            "quota_charged": quota_charged_bool,
            "document_diagnostics": doc_diag,
        }

    if getattr(essay, "job_status", None) == "failed":
        fail_err = (
            essay.job_error
            or (persisted_snap or {}).get("error")
            or "Analysis failed due to an internal processing error."
        )
        return {
            "status": "failed",
            "step": (persisted_snap or {}).get("step", "parsing"),
            "step_index": int((persisted_snap or {}).get("step_index", 0) or 0),
            "total_steps": 8,
            "message": f"Failed: {fail_err}",
            "citations_found": int((persisted_snap or {}).get("citations_found", 0) or 0),
            "references_found": int((persisted_snap or {}).get("references_found", 0) or 0),
            "linked": int((persisted_snap or {}).get("linked", 0) or 0),
            "sources_queried": (persisted_snap or {}).get("sources_queried", {}),
            "elapsed_seconds": float((persisted_snap or {}).get("elapsed_seconds", 0.0) or 0.0),
            "finished_at": (persisted_snap or {}).get("finished_at"),
            "error": fail_err,
            "queue_position": None,
            "quota_charged": quota_charged_bool,
        }

    if persisted_snap is not None and persisted_snap.get("status") in (
        "failed",
        "processing",
        "queued",
    ):
        snap = dict(refresh_live_snapshot_elapsed(persisted_snap))
        if snap.get("status") == "queued" and snap.get("queue_position") is None:
            snap["queue_position"] = compute_sqlite_fifo_queue_position(db, essay_id)
        snap["quota_charged"] = quota_charged_bool
        return snap

    # Server restarted before background analysis finished: auto-resume at most once
    # if the uploaded PDF is persisted on disk.
    persisted_pdf = _get_persisted_upload_path(essay_id)
    if (
        worker_mode == "inline"
        and not is_test_runtime()
        and persisted_pdf.is_file()
        and (resumed_state := tracker.try_claim_auto_retry(essay_id)) is not None
    ):
        background_tasks.add_task(
            _run_pipeline_task,
            essay.id,
            str(persisted_pdf),
            essay.user_id or current_user.id,
            get_pipeline(),
            False,
        )
        resumed_snap = dict(resumed_state.to_snapshot())
        resumed_snap["quota_charged"] = quota_charged_bool
        return resumed_snap

    # No tracker and no verdicts — either queued or server restarted mid-run
    is_queued = getattr(essay, "job_status", None) == "queued"
    fallback_q_pos = (
        compute_sqlite_fifo_queue_position(db, essay_id) if is_queued else None
    )
    return {
        "status": "queued" if is_queued else "processing",
        "step": "queued" if is_queued else "parsing",
        "step_index": 0,
        "total_steps": 8,
        "message": (
            f"Queued for analysis (position #{fallback_q_pos})..."
            if is_queued
            else "Processing..."
        ),
        "citations_found": 0,
        "references_found": 0,
        "linked": 0,
        "sources_queried": {},
        "elapsed_seconds": 0.0,
        "finished_at": None,
        "error": None,
        "queue_position": fallback_q_pos,
        "quota_charged": quota_charged_bool,
    }


@router.get("/{essay_id}/events")
async def stream_essay_events(
    essay_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Stream real-time Server-Sent Events (SSE) progress frames for an essay.

    Authenticates strictly via ``Authorization: Bearer <token>`` (never query-string
    tokens), enforces ownership/class access prior to opening the stream, releases
    the request-scoped SQLite session immediately, and streams unbuffered SSE frames.
    """
    repo = Repository(db)
    essay = repo.get_essay(essay_id)
    if not essay:
        raise HTTPException(status_code=404, detail="Essay not found")

    if not repo.can_user_access_essay(current_user, essay):
        raise HTTPException(status_code=403, detail="Access denied")

    essay_user_id = essay.user_id or current_user.id

    # Release the request-scoped DB connection before opening a long-lived SSE stream
    db.close()

    tracker = get_tracker()
    poll_interval = max(0.01, float(SSE_POLL_INTERVAL_SECONDS))
    heartbeat_interval = max(0.02, float(SSE_HEARTBEAT_INTERVAL_SECONDS))
    disconnect_interval = max(0.01, float(SSE_DISCONNECT_CHECK_SECONDS))

    async def _event_stream() -> AsyncIterator[str]:
        sub_iter = tracker.subscribe(
            essay_id,
            poll_interval=poll_interval,
            heartbeat_interval=heartbeat_interval,
        )
        next_task: asyncio.Task[dict[str, Any]] | None = None
        last_frame_at = time.monotonic()

        try:
            while True:
                if await request.is_disconnected():
                    break
                if next_task is None:
                    next_task = asyncio.create_task(sub_iter.__anext__())

                remaining_hb = max(0.0, heartbeat_interval - (time.monotonic() - last_frame_at))
                wait_timeout = min(remaining_hb, disconnect_interval)
                done, _ = await asyncio.wait({next_task}, timeout=wait_timeout)

                if done:
                    try:
                        snapshot = next_task.result()
                    except StopAsyncIteration:
                        next_task = None
                        break
                    next_task = None

                    if snapshot.get("status") == "failed":
                        persisted_pdf = _get_persisted_upload_path(essay_id)
                        snap_retry = int(snapshot.get("retry_count") or 0)
                        if (
                            _get_worker_mode() == "inline"
                            and "disk i/o error" in str(snapshot.get("error") or "").lower()
                            and not is_test_runtime()
                            and persisted_pdf.is_file()
                            and (
                                resumed_state := tracker.try_claim_auto_retry(
                                    essay_id, min_prior_retries=snap_retry
                                )
                            )
                            is not None
                        ):
                            await sub_iter.aclose()
                            retry_task = asyncio.create_task(
                                _run_pipeline_task(
                                    essay_id,
                                    str(persisted_pdf),
                                    essay_user_id,
                                    get_pipeline(),
                                    False,
                                )
                            )
                            _background_retry_tasks.add(retry_task)
                            retry_task.add_done_callback(_background_retry_tasks.discard)
                            sub_iter = tracker.subscribe(
                                essay_id,
                                poll_interval=poll_interval,
                                heartbeat_interval=heartbeat_interval,
                            )
                            resumed_snap = dict(resumed_state.to_snapshot())
                            yield f"data: {json.dumps(resumed_snap, ensure_ascii=False)}\n\n"
                            last_frame_at = time.monotonic()
                            continue

                        cur_state = tracker.get(essay_id)
                        if cur_state is not None and (
                            cur_state.status in ("queued", "processing", "completed")
                            or cur_state.retry_count > snap_retry
                        ):
                            await sub_iter.aclose()
                            sub_iter = tracker.subscribe(
                                essay_id,
                                poll_interval=poll_interval,
                                heartbeat_interval=heartbeat_interval,
                            )
                            continue

                        if _get_worker_mode() == "inline" and snapshot.get("quota_charged") is True:
                            def _ensure_failed_refund_sync(
                                _snap_err: Any = snapshot.get("error"),
                            ) -> bool | None:
                                from integrity_checker.db.session import get_session

                                s_ref = get_session()
                                try:
                                    e_row = s_ref.get(EssayRecord, essay_id)
                                    if (
                                        e_row is not None
                                        and getattr(e_row, "job_status", None) == "processing"
                                    ):
                                        err_msg = str(
                                            _snap_err
                                            or e_row.job_error
                                            or "Analysis failed due to an internal processing error."
                                        )
                                        refunded = refund_upload_quota_once(
                                            s_ref, essay_id, err_msg
                                        )
                                        e_after = s_ref.get(EssayRecord, essay_id)
                                        return (
                                            False
                                            if refunded
                                            else bool(getattr(e_after, "quota_charged", False))
                                        )
                                    return None
                                finally:
                                    s_ref.close()

                            updated_qc = await asyncio.to_thread(_ensure_failed_refund_sync)
                            if updated_qc is not None:
                                snapshot = dict(snapshot)
                                snapshot["quota_charged"] = updated_qc

                    yield f"data: {json.dumps(snapshot, ensure_ascii=False)}\n\n"
                    last_frame_at = time.monotonic()
                    if snapshot.get("status") in ("completed", "failed"):
                        break
                else:
                    if await request.is_disconnected():
                        break
                    if (time.monotonic() - last_frame_at) >= heartbeat_interval:
                        yield ": keepalive\n\n"
                        last_frame_at = time.monotonic()
        finally:
            if next_task is not None and not next_task.done():
                next_task.cancel()
                try:
                    await next_task
                except (asyncio.CancelledError, StopAsyncIteration):
                    pass
            await sub_iter.aclose()

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers=dict(SSE_RESPONSE_HEADERS),
    )


def _is_essay_genuinely_inflight(essay: EssayRecord) -> bool:
    """Return True if an essay is actively queued or processing.

    In inline mode, if an in-memory ProgressState already exists for this essay
    yet the admission controller neither holds an active slot nor a waiter for it,
    the prior background task already exited without syncing DB state (e.g. mocked
    in tests or cancelled early) and should be allowed to re-run.
    """
    status = getattr(essay, "job_status", None)
    if status not in ("queued", "processing"):
        return False
    if _get_worker_mode() in {"web_only", "worker_only"}:
        return True
    eid = int(essay.id)
    if get_pipeline_admission_controller().is_inflight(eid):
        return True
    tracker = get_tracker()
    if tracker.get(eid) is not None:
        return False
    persisted_snap = tracker.load_persisted_snapshot(eid, essay)
    if persisted_snap is not None and persisted_snap.get("status") in ("failed", "completed"):
        return False
    return True


@router.post("/{essay_id}/reanalyze")
async def reanalyze_essay(
    essay_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    pipeline: IntegrityPipeline = Depends(get_pipeline),
) -> dict[str, Any]:
    """Re-run the verification pipeline in-place for an existing essay if its file is persisted on disk."""
    def _prepare_reanalyze_sync() -> tuple[EssayRecord | None, Path | None, dict[str, Any] | None]:
        repo = Repository(db)
        essay_obj = repo.get_essay(essay_id)
        if not essay_obj:
            raise HTTPException(status_code=404, detail="Essay not found")

        if not repo.can_user_access_essay(current_user, essay_obj):
            raise HTTPException(status_code=403, detail="Access denied")

        if _is_essay_genuinely_inflight(essay_obj):
            return None, None, {"status": essay_obj.job_status, "essay_id": essay_obj.id}

        lower_fname = str(essay_obj.filename or "").lower()
        if lower_fname.endswith(".docx"):
            ext = ".docx"
        elif lower_fname.endswith(".bib"):
            ext = ".bib"
        elif lower_fname.endswith(".ris"):
            ext = ".ris"
        else:
            ext = ".pdf"
        resolved_path = _get_persisted_upload_path(essay_id, ext=ext)
        if not resolved_path.is_file():
            found_alt = None
            for alt_ext in ALLOWED_UPLOAD_EXTENSIONS:
                alt_path = _get_persisted_upload_path(essay_id, ext=alt_ext)
                if alt_path.is_file():
                    found_alt = alt_path
                    break
            if found_alt is not None:
                resolved_path = found_alt
            else:
                raise HTTPException(
                    status_code=404, detail="Persisted document file not found on disk"
                )

        needs_quota_reclaim = (
            getattr(essay_obj, "job_status", None) == "failed"
            and not bool(getattr(essay_obj, "quota_charged", True))
            and getattr(essay_obj, "cis_json", None) is None
        )
        if needs_quota_reclaim:
            with _QUOTA_CLAIM_LOCK:
                db.expire(current_user)
                db.expire(essay_obj)
                db.commit()

                fresh_essay = db.get(EssayRecord, essay_id)
                if fresh_essay is None:
                    raise HTTPException(status_code=404, detail="Essay not found")
                if _is_essay_genuinely_inflight(fresh_essay):
                    return None, None, {
                        "status": fresh_essay.job_status,
                        "essay_id": fresh_essay.id,
                    }

                if (
                    getattr(fresh_essay, "job_status", None) == "failed"
                    and not bool(getattr(fresh_essay, "quota_charged", True))
                    and getattr(fresh_essay, "cis_json", None) is None
                ):
                    quota_owner_id = (
                        fresh_essay.user_id
                        if fresh_essay.user_id is not None
                        else current_user.id
                    )
                    quota_user = db.get(User, quota_owner_id) or db.get(User, current_user.id)
                    if quota_user is None:
                        raise HTTPException(status_code=401, detail="User not found")
                    if quota_user.role != "admin":
                        if ensure_user_quota_current(quota_user):
                            db.commit()
                            db.refresh(quota_user)
                        policy = get_user_plan_policy(quota_user)
                        limit = int(policy.max_uploads_per_month)
                        res = db.execute(
                            update(User)
                            .where(
                                User.id == quota_user.id,
                                func.coalesce(User.monthly_uploads_used, 0) < limit,
                            )
                            .values(
                                monthly_uploads_used=func.coalesce(
                                    User.monthly_uploads_used, 0
                                )
                                + 1
                            )
                            .execution_options(synchronize_session=False)
                        )
                        if (getattr(res, "rowcount", 0) or 0) != 1:
                            db.rollback()
                            db.refresh(quota_user)
                            used_now = int(quota_user.monthly_uploads_used or limit)
                            msg = (
                                f"Monthly upload quota reached ({used_now}/{limit} documents "
                                f"on the {policy.name} plan). Please upgrade to Pro or Ultra to continue analyzing manuscripts."
                            )
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
                    fresh_essay.quota_charged = 1
                    db.commit()
                    db.refresh(fresh_essay)
                    db.refresh(quota_user)
                    if quota_user.id != current_user.id:
                        db.refresh(current_user)
                essay_obj = fresh_essay

        if _get_worker_mode() in {"web_only", "worker_only"}:
            _clear_persisted_progress_snapshot(essay_obj)
            essay_obj.job_status = "queued"
            essay_obj.job_heartbeat_at = datetime.now(UTC)
            essay_obj.job_error = None
            db.commit()
            get_tracker().clear(essay_id)
            return None, None, {"status": essay_obj.job_status, "essay_id": essay_obj.id}

        peek_queued = (
            get_pipeline_admission_controller().peek_queue_position_if_saturated()
            is not None
        )
        _clear_persisted_progress_snapshot(essay_obj)
        essay_obj.job_status = "queued" if peek_queued else "processing"
        essay_obj.job_heartbeat_at = datetime.now(UTC)
        essay_obj.job_error = None
        db.commit()

        tracker = get_tracker()
        init_state = tracker.init(essay_id, is_retry=True)
        if (
            init_state.status in ("queued", "processing")
            and essay_obj.job_status != init_state.status
        ):
            db.refresh(essay_obj)
            essay_obj.job_status = init_state.status
            db.commit()
        return essay_obj, resolved_path, None

    maybe_essay, maybe_path, early_resp = await asyncio.to_thread(_prepare_reanalyze_sync)
    if early_resp is not None or maybe_essay is None or maybe_path is None:
        return early_resp or {"status": "processing", "essay_id": essay_id}
    essay = maybe_essay
    persisted_path = maybe_path
    if is_test_runtime():
        await _run_pipeline_task(
            essay.id,
            str(persisted_path),
            essay.user_id or current_user.id,
            pipeline,
            False,
            bypass_report_cache=True,
        )
        await asyncio.to_thread(db.refresh, essay)
        return {"status": essay.job_status or "completed", "essay_id": essay.id}

    background_tasks.add_task(
        _run_pipeline_task,
        essay.id,
        str(persisted_path),
        essay.user_id or current_user.id,
        pipeline,
        False,
        bypass_report_cache=True,
    )
    return {"status": essay.job_status, "essay_id": essay.id}


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
    num_verified = sum(1 for v in verdicts if v.label == "verified")

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

    raw_qc = getattr(e, "quota_charged", True)
    effective_job_status = getattr(e, "job_status", None) or "completed"
    effective_job_error = getattr(e, "job_error", None)
    if effective_job_status == "processing" and getattr(e, "id", None) is not None:
        tracker = get_tracker()
        in_mem = None if _get_worker_mode() == "web_only" else tracker.get(int(e.id))
        failed_err: str | None = None
        retry_cnt = 0
        is_snap_failed = False
        if in_mem is not None:
            if in_mem.status == "failed":
                is_snap_failed = True
                failed_err = in_mem.error
                retry_cnt = int(in_mem.retry_count or 0)
        else:
            persisted_snap = tracker.load_persisted_snapshot(int(e.id), e)
            if persisted_snap is not None and persisted_snap.get("status") == "failed":
                is_snap_failed = True
                failed_err = str(persisted_snap.get("error") or "") or None
                retry_cnt = int(persisted_snap.get("retry_count") or 0)

        if is_snap_failed:
            can_still_retry = (
                _get_worker_mode() == "inline"
                and bool(failed_err and "disk i/o error" in failed_err.lower())
                and not is_test_runtime()
                and _get_persisted_upload_path(int(e.id)).is_file()
                and retry_cnt < MAX_AUTO_RETRIES
            )
            if not can_still_retry:
                effective_job_status = "failed"
                if not effective_job_error and failed_err:
                    effective_job_error = failed_err

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
        "job_status": effective_job_status,
        "job_error": effective_job_error,
        "job_attempt_count": int(getattr(e, "job_attempt_count", 0) or 0),
        "quota_charged": True if raw_qc is None else bool(raw_qc),
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
    repo = Repository(db)

    if current_user.role == "admin":
        grouped = repo.get_all_essays_deduped()
    elif current_user.role == "teacher":
        grouped = repo.get_all_essays_deduped(teacher_id=current_user.id)
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

    repo = Repository(db)
    if current_user.role == "admin":
        grouped = repo.get_all_essays_deduped(completed_only=True)
    elif current_user.role == "teacher":
        grouped = repo.get_all_essays_deduped(
            teacher_id=current_user.id, completed_only=True
        )
    else:
        grouped = repo.get_all_essays_deduped(
            user_id=current_user.id, completed_only=True
        )

    essay_ids = [
        e.id
        for e, _ in grouped
        if e.id is not None and (getattr(e, "job_status", None) or "completed") == "completed"
    ]
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
            "incomplete_metadata": 0,
        }

    for label, cnt in (
        db.query(VerdictRecord.label, func.count(VerdictRecord.id))
        .filter(VerdictRecord.essay_id.in_(essay_ids))
        .group_by(VerdictRecord.label)
        .all()
    ):
        if label in counts:
            counts[str(label)] = int(cnt or 0)

    incomplete_metadata_count = 0
    for (raw_rules,) in (
        db.query(VerdictRecord.triggered_rules)
        .filter(
            VerdictRecord.essay_id.in_(essay_ids),
            VerdictRecord.triggered_rules.like("%R-INCOMPLETE-METADATA%"),
        )
        .all()
    ):
        try:
            parsed_rules = json.loads(raw_rules or "[]")
            if isinstance(parsed_rules, list) and "R-INCOMPLETE-METADATA" in parsed_rules:
                incomplete_metadata_count += 1
        except Exception:
            if "R-INCOMPLETE-METADATA" in str(raw_rules or ""):
                incomplete_metadata_count += 1

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
        "incomplete_metadata": incomplete_metadata_count,
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
    cit_by_raw: dict[str, Any] = {}
    for c_rec in citations:
        if getattr(c_rec, "raw_text", None) and c_rec.raw_text not in cit_by_raw:
            cit_by_raw[c_rec.raw_text] = c_rec
    in_text_count = sum(1 for c in citations if c.citation_type in {"in_text", "numeric"})
    num_citations = in_text_count or len(verdicts)

    verdict_counts: dict[str, int] = {
        "verified": 0,
        "metadata_error": 0,
        "suspected_hallucination": 0,
        "unresolved": 0,
        "resource": 0,
        "incomplete_metadata": 0,
    }
    public_verdicts: list[dict[str, Any]] = []
    for idx, v in enumerate(verdicts, start=1):
        lbl = str(v.label or "unresolved").lower()
        if lbl in verdict_counts and lbl != "incomplete_metadata":
            verdict_counts[lbl] += 1
        try:
            features_dict = json.loads(v.features or "{}")
            if not isinstance(features_dict, dict):
                features_dict = {}
        except Exception:
            features_dict = {}
        try:
            triggered_rules = json.loads(v.triggered_rules or "[]")
            if not isinstance(triggered_rules, list):
                triggered_rules = []
        except Exception:
            triggered_rules = []
        if "R-INCOMPLETE-METADATA" in triggered_rules:
            verdict_counts["incomplete_metadata"] += 1
        try:
            mismatched_fields = json.loads(v.mismatched_fields or "[]")
            if not isinstance(mismatched_fields, list):
                mismatched_fields = []
        except Exception:
            mismatched_fields = []
        matched_sources = features_dict.get("matched_sources", [])
        if not isinstance(matched_sources, list):
            matched_sources = []
        matched_source = matched_sources[0] if matched_sources else None
        matched_cit_rec = cit_by_raw.get(v.citation_raw)
        cited_url = (
            features_dict.get("cited_url")
            or features_dict.get("checked_url")
            or (getattr(matched_cit_rec, "url", None) if matched_cit_rec is not None else None)
        )
        numeric_index = (
            features_dict["numeric_index"]
            if features_dict.get("numeric_index") is not None
            else (
                getattr(matched_cit_rec, "numeric_index", None)
                if matched_cit_rec is not None
                else None
            )
        )
        sub_index = (
            features_dict["sub_index"]
            if features_dict.get("sub_index") is not None
            else (
                getattr(matched_cit_rec, "sub_index", None)
                if matched_cit_rec is not None
                else None
            )
        )
        composite_label = (
            features_dict["composite_label"]
            if features_dict.get("composite_label") is not None
            else (
                getattr(matched_cit_rec, "composite_label", None)
                if matched_cit_rec is not None
                else None
            )
        )
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
            "features": features_dict,
            "url_status": features_dict.get("url_status"),
            "url_status_code": features_dict.get("url_status_code"),
            "archive_url": features_dict.get("archive_url"),
            "cited_url": cited_url,
            "is_retracted": bool(
                features_dict.get("is_retracted", False)
                or ("R-RETRACTED-PAPER" in triggered_rules)
            ),
            "html_meta": features_dict.get("html_meta"),
            "html_meta_title_sim": features_dict.get("html_meta_title_sim"),
            "numeric_index": numeric_index,
            "sub_index": sub_index,
            "composite_label": composite_label,
            "citation_link": features_dict.get("citation_link"),
        })

    style_profile_dict = None
    if essay.style_profile_json:
        try:
            style_profile_dict = json.loads(essay.style_profile_json)
            if isinstance(style_profile_dict, dict):
                style_profile_dict.pop("_progress_snapshot", None)
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

    document_diagnostics: dict[str, Any] | None = None
    raw_diag_col = getattr(essay, "diagnostics_json", None)
    if raw_diag_col:
        if isinstance(raw_diag_col, dict):
            document_diagnostics = raw_diag_col
        elif isinstance(raw_diag_col, str):
            try:
                parsed_diag = json.loads(raw_diag_col)
                if isinstance(parsed_diag, dict):
                    document_diagnostics = parsed_diag
            except Exception:
                document_diagnostics = None
    if document_diagnostics is None and isinstance(style_profile_dict, dict):
        sp_diag = style_profile_dict.get("document_diagnostics")
        if isinstance(sp_diag, dict):
            document_diagnostics = sp_diag
    if document_diagnostics is None and isinstance(cis_dict, dict):
        cis_diag = cis_dict.get("document_diagnostics")
        if isinstance(cis_diag, dict):
            document_diagnostics = cis_diag

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
        "document_diagnostics": document_diagnostics,
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

    raw_qc = getattr(essay, "quota_charged", True)
    return {
        "id": essay.id,
        "filename": essay.filename,
        "num_pages": essay.num_pages,
        "uploaded_at": essay.uploaded_at.isoformat() if essay.uploaded_at else None,
        "user_id": essay.user_id,
        "job_status": getattr(essay, "job_status", None) or "completed",
        "job_error": getattr(essay, "job_error", None),
        "job_attempt_count": int(getattr(essay, "job_attempt_count", 0) or 0),
        "quota_charged": True if raw_qc is None else bool(raw_qc),
    }


@router.delete("/{essay_id}")
def delete_essay(
    essay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Xóa essay (owner hoặc admin), hoàn trả quota nếu bài đang queued chưa xử lý."""
    from integrity_checker.db.models import AuditLog

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

    # Refund monthly upload slot if deleting an unstarted queued essay that charged quota
    if (
        getattr(essay, "job_status", None) == "queued"
        and bool(getattr(essay, "quota_charged", 0))
        and getattr(essay, "cis_json", None) is None
    ):
        refund_upload_quota_once(
            db, essay_id, "Queued upload cancelled and deleted by user."
        )
        essay = repo.get_essay(essay_id)

    for ext_to_clean in ALLOWED_UPLOAD_EXTENSIONS:
        _get_persisted_upload_path(essay_id, ext=ext_to_clean).unlink(missing_ok=True)

    verdict_ids = [
        row[0]
        for row in db.query(VerdictRecord.id)
        .filter(VerdictRecord.essay_id == essay_id)
        .all()
    ]
    if verdict_ids:
        db.query(AuditLog).filter(AuditLog.verdict_id.in_(verdict_ids)).delete(
            synchronize_session=False
        )
    db.query(VerdictRecord).filter(VerdictRecord.essay_id == essay_id).delete(
        synchronize_session=False
    )
    db.query(CitationRecord).filter(CitationRecord.essay_id == essay_id).delete(
        synchronize_session=False
    )
    if essay is not None:
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

    # SECURITY: Strictly load ONLY the persisted file keyed by essay_id; never search disk by untrusted filename.
    pdf_path = _get_persisted_upload_path(essay_id, ext=".pdf")

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
                badge_html = '<span style="color: #dc2626; font-weight: bold;">[CHƯA TÌM THẤY NGUỒN / SOURCE NOT FOUND]</span> '
                text_color = "#dc2626"
                font_weight = "600"
            elif is_meta_err:
                badge_html = '<span style="color: #dc2626; font-weight: bold;">[SAI LỆCH THÔNG TIN / DETAILS MISMATCH]</span> '
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


def _sanitize_sandbox_pdf_filename(raw_name: str, fallback_name: str) -> str:
    """Sanitize untrusted sandbox custom_filename against path traversal, CR/LF, and quote injection."""
    cleaned_input = (raw_name or "").replace("\\", "/").strip()
    if not cleaned_input:
        return fallback_name
    base = Path(cleaned_input).name
    safe = "".join(
        ch
        for ch in base
        if ch >= " " and ch != "\x7f" and ch not in ('"', "'", "\\", "/", ";", ":", "\r", "\n")
    ).strip(" .")
    if not safe:
        return fallback_name
    if safe.lower().endswith(".pdf"):
        stem = safe[:-4].strip(" .")
    else:
        stem = safe
    if not stem:
        return fallback_name
    stem = stem[:160]
    return f"{stem}.pdf"


def _rfc5987_pdf_content_disposition(filename: str) -> str:
    """Build RFC 5987 Content-Disposition header with safe ASCII fallback and UTF-8 filename*."""
    ascii_safe = "".join(
        ch if (32 <= ord(ch) < 127 and ch not in ('"', "\\", ";", "\r", "\n")) else "_"
        for ch in (filename or "sandbox.pdf")
    ).strip(" _") or "sandbox.pdf"
    if not ascii_safe.lower().endswith(".pdf"):
        ascii_safe = f"{ascii_safe}.pdf"
    encoded_utf8 = urllib.parse.quote(filename or ascii_safe, safe="")
    return f"attachment; filename=\"{ascii_safe}\"; filename*=UTF-8''{encoded_utf8}"


def _synthesize_academic_manuscript_pdf(
    title: str,
    author_name: str,
    style: str,
    items: list[dict[str, Any]],
) -> tuple[bytes, int, list[str], list[str]]:
    """Build a multi-page academic PDF manuscript containing body sections with in-text citations + References."""
    from html import escape

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    from integrity_checker.api.routes.report import _register_unicode_pdf_fonts

    font_reg, font_bold = _register_unicode_pdf_fonts()
    registered = set(pdfmetrics.getRegisteredFontNames())
    font_italic = "CitraSans-Italic" if "CitraSans-Italic" in registered else font_reg

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
        fontName=font_bold,
        fontSize=15,
        leading=19,
        spaceAfter=8,
    )
    meta_st = ParagraphStyle(
        "MsMeta",
        parent=styles["Normal"],
        fontName=font_italic,
        fontSize=10,
        leading=13,
        spaceAfter=12,
    )
    h1_st = ParagraphStyle(
        "MsH1",
        parent=styles["Heading2"],
        fontName=font_bold,
        fontSize=12,
        leading=15,
        spaceBefore=12,
        spaceAfter=6,
    )
    body_st = ParagraphStyle(
        "MsBody",
        parent=styles["Normal"],
        fontName=font_reg,
        fontSize=10.5,
        leading=15,
        spaceAfter=8,
    )
    ref_st = ParagraphStyle(
        "MsRef",
        parent=styles["Normal"],
        fontName=font_reg,
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

    _enforce_sandbox_verify_rate_limit(current_user)

    lang_code = str(payload.get("lang") or "vi").strip().lower()
    is_en_req = lang_code.startswith("en")
    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please select or add at least 1 reference to check."
                if is_en_req
                else "Vui lòng chọn hoặc nhập ít nhất 1 tài liệu để kiểm tra."
            ),
        )

    bounded_items: list[dict[str, Any]] = []
    for raw_it in items[:25]:
        if not isinstance(raw_it, dict):
            continue
        it_copy = dict(raw_it)
        for field_key, max_len in (
            ("title", 300),
            ("authors_text", 300),
            ("venue", 200),
            ("in_text_context", 600),
            ("doi", 150),
            ("url", 500),
            ("year", 20),
        ):
            if isinstance(it_copy.get(field_key), str):
                it_copy[field_key] = it_copy[field_key][:max_len]
        bounded_items.append(it_copy)

    if not bounded_items:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please select or add at least 1 reference to check."
                if is_en_req
                else "Vui lòng chọn hoặc nhập ít nhất 1 tài liệu để kiểm tra."
            ),
        )

    style = str(payload.get("style") or "apa").strip().lower()
    doc_title = str(
        payload.get("title")
        or "Empirical Evaluation of Neural Language Representations in Computational Linguistics"
    ).strip()[:300]
    author_name = str(
        payload.get("author_name") or current_user.username or "CITRA Researcher"
    ).strip()[:120]
    download_only = bool(payload.get("download_only", False))
    run_verification = bool(payload.get("run_verification", not download_only))
    custom_filename = str(payload.get("filename") or "").strip()[:180]

    pdf_bytes, num_pages, in_text_markers, ref_lines = await asyncio.to_thread(
        _synthesize_academic_manuscript_pdf,
        title=doc_title,
        author_name=author_name,
        style=style,
        items=bounded_items,
    )

    policy = get_user_plan_policy(current_user)
    if len(pdf_bytes) > policy.max_file_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Generated PDF exceeds your {policy.name} plan file size limit "
                f"({policy.max_file_size_mb} MB)."
            ),
        )
    if num_pages > policy.max_pages_per_pdf:
        raise HTTPException(
            status_code=402,
            detail=(
                f"PDF page limit exceeded ({num_pages} pages generated; maximum allowed on "
                f"the {policy.name} plan is {policy.max_pages_per_pdf} pages). Please upgrade to Pro or Ultra."
            ),
        )

    safe_style = "IEEE" if style == "ieee" else "APA"
    default_sandbox_name = f"CITRA_ACL_Sandbox_{safe_style}_{len(bounded_items)}refs.pdf"
    custom_filename = _sanitize_sandbox_pdf_filename(custom_filename, default_sandbox_name)

    if download_only and not run_verification:
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": _rfc5987_pdf_content_disposition(custom_filename),
            },
        )

    # Atomically claim 1 monthly upload slot, persist PDF bytes, & launch full IntegrityPipeline
    essay = await asyncio.to_thread(
        _claim_monthly_upload_slot_and_create_essay,
        db,
        current_user,
        filename=custom_filename,
        num_pages=num_pages,
        structured_error=True,
        upload_content=pdf_bytes,
        upload_ext=".pdf",
    )

    persisted_path = _get_persisted_upload_path(essay.id, ext=".pdf")

    if _get_worker_mode() == "web_only":
        get_tracker().clear(essay.id)
        initial_status = "queued"
    else:
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
        initial_status = "processing"

    return {
        "essay_id": essay.id,
        "filename": essay.filename,
        "num_pages": num_pages,
        "in_text_count": len(in_text_markers),
        "references_count": len(ref_lines),
        "in_text_markers_preview": in_text_markers[:25],
        "references_preview": ref_lines[:25],
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        "status": initial_status,
    }


def _enforce_sandbox_verify_rate_limit(current_user: User) -> None:
    """Enforce sliding-window per-user rate limit on /sandbox/verify and /sandbox/generate-pdf."""
    max_reqs = max(1, int(SANDBOX_VERIFY_MAX_REQUESTS))
    window_s = max(1.0, float(SANDBOX_VERIFY_WINDOW_SECONDS))
    bucket_key = int(current_user.id or 0)
    now = time.monotonic()
    cutoff = now - window_s
    with _sandbox_verify_rate_lock:
        timestamps = [
            ts for ts in _sandbox_verify_rate_buckets.get(bucket_key, []) if ts > cutoff
        ]
        if len(timestamps) >= max_reqs:
            retry_after = max(1, int(math.ceil(window_s - (now - timestamps[0]))))
            _sandbox_verify_rate_buckets[bucket_key] = timestamps
            _sandbox_verify_rate_buckets.move_to_end(bucket_key)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Sandbox verification rate limit exceeded ({max_reqs} requests per "
                    f"{int(window_s)}s). Please wait before running another live check."
                ),
                headers={"Retry-After": str(retry_after)},
            )
        timestamps.append(now)
        _sandbox_verify_rate_buckets[bucket_key] = timestamps
        _sandbox_verify_rate_buckets.move_to_end(bucket_key)
        if len(_sandbox_verify_rate_buckets) > _SANDBOX_VERIFY_MAX_BUCKET_KEYS:
            expired_uids = [
                uid_k
                for uid_k, ts_list in _sandbox_verify_rate_buckets.items()
                if not ts_list or ts_list[-1] <= cutoff
            ]
            for uid_k in expired_uids:
                _sandbox_verify_rate_buckets.pop(uid_k, None)
            while len(_sandbox_verify_rate_buckets) > _SANDBOX_VERIFY_MAX_BUCKET_KEYS:
                _sandbox_verify_rate_buckets.popitem(last=False)


def _enforce_public_sandbox_rate_limit(
    request: Request,
    *,
    is_en: bool = True,
    consume: bool = True,
) -> None:
    """Enforce sliding-window per-IP rate limit (default 6 req / 60s) on /sandbox/public-verify."""
    from integrity_checker.api.routes.auth import _extract_client_ip

    max_reqs = max(1, int(PUBLIC_SANDBOX_MAX_REQUESTS))
    window_s = max(1.0, float(PUBLIC_SANDBOX_WINDOW_SECONDS))
    client_ip = _extract_client_ip(request)
    now = time.monotonic()
    cutoff = now - window_s

    with _public_sandbox_rate_lock:
        timestamps = [
            ts for ts in _public_sandbox_rate_buckets.get(client_ip, []) if ts > cutoff
        ]
        if len(timestamps) >= max_reqs:
            retry_after = max(1, int(math.ceil(window_s - (now - timestamps[0]))))
            _public_sandbox_rate_buckets[client_ip] = timestamps
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Guest preview allows up to {max_reqs} live checks per {int(window_s)} seconds. "
                    f"Please wait {retry_after}s or create a free account to check full manuscripts."
                    if is_en
                    else (
                        f"Bản dùng thử nhanh hỗ trợ tối đa {max_reqs} lượt kiểm tra mỗi {int(window_s)} giây. "
                        f"Vui lòng đợi {retry_after} giây hoặc tạo tài khoản miễn phí để kiểm tra toàn bộ bài viết."
                    )
                ),
                headers={"Retry-After": str(retry_after)},
            )
        if consume:
            timestamps.append(now)
            _public_sandbox_rate_buckets[client_ip] = timestamps
            if len(_public_sandbox_rate_buckets) > _PUBLIC_SANDBOX_MAX_BUCKET_KEYS:
                expired_ips = [
                    ip_key
                    for ip_key, ts_list in _public_sandbox_rate_buckets.items()
                    if not ts_list or ts_list[-1] <= cutoff
                ]
                for ip_key in expired_ips:
                    _public_sandbox_rate_buckets.pop(ip_key, None)
                while len(_public_sandbox_rate_buckets) > _PUBLIC_SANDBOX_MAX_BUCKET_KEYS:
                    oldest_ip = next(iter(_public_sandbox_rate_buckets))
                    _public_sandbox_rate_buckets.pop(oldest_ip, None)
        elif timestamps:
            _public_sandbox_rate_buckets[client_ip] = timestamps
        else:
            _public_sandbox_rate_buckets.pop(client_ip, None)


_SANDBOX_BARE_DOI_RE = re.compile(
    r"\b(10\.\d{4,9}/[^\s,;)\]>\"']+)",
    re.IGNORECASE,
)
_SANDBOX_SCHOLARLY_ID_RE = re.compile(
    r"(?:https?://\S+|www\.\S+|\b10\.\d{4,9}/\S+|\bdoi\s*:\s*\S+|"
    r"\barxiv\s*[:\s]*\d{4}\.\d{4,5}|\b(?:isbn|issn|rfc|tcvn|qcvn)\b|"
    r"\d+/\d{4}/(?:qh|nđ|tt|qđ|nq|ubtvqh)|"
    r"\b(?:luật|bộ\s+luật|nghị\s+định|thông\s+tư|hiến\s+pháp|quyết\s+định|nghị\s+quyết)\b)",
    re.IGNORECASE,
)
_SANDBOX_PLAUSIBLE_YEAR_RE = re.compile(
    r"\b(?:18|19|20)\d{2}[a-z]?\b|\(\s*n\.?\s*d\.?\s*\)",
    re.IGNORECASE,
)
_SANDBOX_VOWELS = frozenset(
    "aeiouyàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹ"
)
_SANDBOX_KEYBOARD_ROWS = ("qwerty", "asdfg", "zxcvb", "hjkl", "uiop", "qwert", "asdf", "zxcv")
_SANDBOX_L1_NON_ISSUE_STATUSES = frozenset({"matched", "not_applicable"})

_VN_AUTHORITY_EN_MAP = {
    "quốc hội": "National Assembly of Vietnam",
    "chính phủ": "Government of Vietnam",
    "ủy ban thường vụ quốc hội": "Standing Committee of the National Assembly of Vietnam",
    "thủ tướng chính phủ": "Prime Minister of Vietnam",
    "hệ thống pháp luật việt nam (vbqppl)": "Vietnamese National Legal Database (VBQPPL)",
    "văn bản quy phạm pháp luật việt nam": "Vietnamese Legal Normative System",
}


def _is_keyboard_mash_word(word: str) -> bool:
    """Return True if a token looks like random keyboard mash rather than a real word."""
    w = word.lower()
    if len(w) < 4:
        return False
    if any(seq in w for seq in _SANDBOX_KEYBOARD_ROWS):
        return True
    if re.search(r"(.)\1{3,}", w):
        return True
    if len(w) >= 6 and not word.isupper():
        vowel_cnt = sum(1 for ch in w if ch in _SANDBOX_VOWELS)
        if vowel_cnt <= 1 and (vowel_cnt / len(w)) < 0.17:
            return True
    return False


def _is_non_citation_gibberish(raw_text: str | None) -> bool:
    """Fast heuristic detecting obvious gibberish / non-citation input before hitting external APIs."""
    text = " ".join((raw_text or "").split()).strip()
    if not text:
        return True
    if _SANDBOX_SCHOLARLY_ID_RE.search(text):
        return False
    alpha_words = re.findall(r"[^\W\d_]{2,}", text, flags=re.UNICODE)
    has_year = bool(_SANDBOX_PLAUSIBLE_YEAR_RE.search(text))
    has_punct = bool(re.search(r"[,.;:()\[\]\"“”]", text))
    if len(alpha_words) < 3 and not has_year:
        return True
    if len(alpha_words) < 3 and not has_punct:
        return True
    if not has_year and not has_punct:
        mash_cnt = sum(1 for w in alpha_words if _is_keyboard_mash_word(w))
        if alpha_words and (mash_cnt / len(alpha_words)) >= 0.5:
            return True
    return False


def _translate_vn_authority_en(authority: str | None) -> str:
    raw = (authority or "").strip()
    if not raw:
        return "Vietnamese legislative/executive authority"
    return _VN_AUTHORITY_EN_MAP.get(raw.lower(), raw)


_SANDBOX_FIELD_LABELS_EN: dict[str, str] = {
    "title": "title",
    "authors": "authors",
    "author": "authors",
    "year": "publication year",
    "venue": "journal/publisher",
    "journal": "journal/publisher",
    "doi": "DOI",
    "url": "URL",
    "volume": "volume",
    "pages": "pages",
    "issue": "issue",
}

_SANDBOX_FIELD_LABELS_VI: dict[str, str] = {
    "title": "tiêu đề",
    "authors": "tác giả",
    "author": "tác giả",
    "year": "năm xuất bản",
    "venue": "tạp chí/nơi xuất bản",
    "journal": "tạp chí/nơi xuất bản",
    "doi": "mã DOI",
    "url": "đường dẫn URL",
    "volume": "tập",
    "pages": "số trang",
    "issue": "số báo",
}

_SANDBOX_SOURCE_NAMES_EN: dict[str, str] = {
    "crossref": "Crossref",
    "openalex": "OpenAlex",
    "datacite": "DataCite",
    "doaj": "DOAJ",
    "openaire_hal": "OpenAIRE / HAL",
    "ncbi_biorxiv": "PubMed / bioRxiv",
    "dblp": "DBLP",
    "arxiv": "arXiv",
    "openlibrary": "Open Library",
    "europepmc": "Europe PMC",
    "huggingface": "Hugging Face",
    "tech_standard": "Technical Standards Registry",
    "wikidata_opencitations": "OpenCitations / Wikidata",
    "local_db": "indexed academic library",
    "known_papers": "standard academic reference library",
    "serpapi": "Google Scholar",
    "vn_legal_registry": "Vietnamese National Legal Registry",
    "vn_legal": "Vietnamese National Legal Registry",
    "web_html_meta": "source web page",
    "wayback_html_meta": "Wayback Machine archive",
}

_SANDBOX_SOURCE_NAMES_VI: dict[str, str] = {
    "crossref": "Crossref",
    "openalex": "OpenAlex",
    "datacite": "DataCite",
    "doaj": "DOAJ",
    "openaire_hal": "OpenAIRE / HAL",
    "ncbi_biorxiv": "PubMed / bioRxiv",
    "dblp": "DBLP",
    "arxiv": "arXiv",
    "openlibrary": "Open Library",
    "europepmc": "Europe PMC",
    "huggingface": "Hugging Face",
    "tech_standard": "Danh mục tiêu chuẩn kỹ thuật",
    "wikidata_opencitations": "OpenCitations / Wikidata",
    "local_db": "thư viện học thuật tích hợp",
    "known_papers": "thư viện tài liệu học thuật tiêu chuẩn",
    "serpapi": "Google Scholar",
    "vn_legal_registry": "Cơ sở dữ liệu Văn bản Pháp luật Việt Nam",
    "vn_legal": "Cơ sở dữ liệu Văn bản Pháp luật Việt Nam",
    "web_html_meta": "trang web gốc",
    "wayback_html_meta": "bản lưu trữ Wayback Machine",
}

_SANDBOX_NEURAL_TAG_RE = re.compile(r"\s*\[Neural:[^\]]*\]", re.IGNORECASE)
_SANDBOX_PROVENANCE_TAG_RE = re.compile(r"\s*\[provenance penalty:[^\]]*\]", re.IGNORECASE)
_SANDBOX_ML_KV_RE = re.compile(
    r"\b(?:author_jaccard|fuzzy_title_sim|title_sim(?:_fuzzy|_semantic)?|semantic_sim|"
    r"author_sim|venue_sim|year_distance|evidence_sim|neural\s*score|"
    r"content\s+alignment\s+score)\s*[=<>!]+\s*[^,;.)\]]+",
    re.IGNORECASE,
)


def _strip_sandbox_ml_jargon(text: str) -> str:
    """Ensure no raw ML scores, formulas, or accusatory phrases survive in sandbox prose."""
    cleaned = _SANDBOX_NEURAL_TAG_RE.sub("", text or "")
    cleaned = _SANDBOX_PROVENANCE_TAG_RE.sub("", cleaned)
    cleaned = _SANDBOX_ML_KV_RE.sub("", cleaned)
    cleaned = re.sub(r",?\s*DOI\s+match\s*=\s*(?:True|False)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*\(?[\d.]+\s+in\s*\[\s*[\d.]+\s*,\s*[\d.]+\s*\)\)?", "", cleaned)
    cleaned = re.sub(
        r"Suspected\s+AI-hallucinated(?:\s+or\s+(?:fabricated|non-existent))?",
        "Source not found",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"nghi\s+vấn\s+(?:nguồn\s+)?(?:bịa\s+đặt|ngụy\s+tạo)", "chưa thể xác minh", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"bịa\s+đặt", "chưa khớp dữ liệu", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\(\s*[,;:\s]*\)", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def _format_sandbox_source_names(matched_source: Any, *, is_en: bool) -> str:
    """Build a friendly comma-separated list of matched library names (up to 3)."""
    name_map = _SANDBOX_SOURCE_NAMES_EN if is_en else _SANDBOX_SOURCE_NAMES_VI
    raw_names: list[str] = []
    if matched_source is not None:
        for s_name in getattr(matched_source, "sources_succeeded", None) or []:
            if s_name and s_name not in raw_names:
                raw_names.append(str(s_name))
        for cand in getattr(matched_source, "candidates", None) or []:
            if getattr(cand, "found", False):
                c_src = str(getattr(cand, "source_name", "") or "").strip()
                if c_src and c_src not in raw_names:
                    raw_names.append(c_src)
    friendly: list[str] = []
    for raw_n in raw_names:
        lbl = name_map.get(raw_n.lower(), raw_n)
        if lbl not in friendly:
            friendly.append(lbl)
    return ", ".join(friendly[:3])


def _extract_sandbox_best_candidate(matched_source: Any) -> Any:
    """Safely return the top matched SourceCandidate if available."""
    if matched_source is None:
        return None
    best_fn = getattr(matched_source, "best_candidate", None)
    if callable(best_fn):
        try:
            cand = best_fn()
            if cand is not None:
                return cand
        except Exception:
            pass
    for cand in getattr(matched_source, "candidates", None) or []:
        if getattr(cand, "found", False):
            return cand
    return None


def _infer_sandbox_label(
    explicit_label: str | None,
    rules_set: set[str],
    raw_reasoning: str,
    best_cand: Any,
) -> str:
    """Infer canonical verdict label when _localize_sandbox_verdict_reasoning is called without label."""
    if explicit_label:
        norm = str(explicit_label).strip().lower()
        if norm in ("verified", "metadata_error", "suspected_hallucination", "unresolved", "resource"):
            return norm
    raw_low = (raw_reasoning or "").lower()
    if any(r in rules_set for r in ("R-WEB-RESOURCE", "R-URL-RESOURCE", "R-NON-SCHOLARLY-RESOURCE", "R-WAYBACK-ARCHIVED")):
        return "resource"
    if any(r in rules_set for r in (
        "R-FABRICATED-DOI",
        "R-NONEXISTENT-DOI",
        "R-CHIMERIC-DOI-MISMATCH",
        "R-HALLUCINATED-SOURCE",
        "R-NO-SCHOLARLY-RECORD",
        "R-FAIL-ALL",
        "R-CONTENT-MISMATCH",
    )):
        return "suspected_hallucination"
    if any(r in rules_set for r in (
        "R-INCOMPLETE-METADATA",
        "R-YEAR-MISMATCH",
        "R-FUTURE-YEAR",
        "R-TITLE-MISMATCH",
        "R-VENUE-MISMATCH",
        "R-DOI-METADATA-MISMATCH",
        "R-DOI-TITLE-MISMATCH",
        "R-DOI-CONFLICT",
        "R-LOCAL_DB_METADATA_ERROR",
        "R-FAKE-AUTHOR",
    )):
        return "metadata_error"
    if any(r in rules_set for r in (
        "R-CONSENSUS-FULL",
        "R-CONSENSUS-PARTIAL",
        "R-SINGLE-SOURCE-VERIFIED",
        "R-DOI-TITLE-AUTHOR",
        "R-KNOWN-PAPER",
        "R-LOCAL_DB_VERIFIED",
        "R-LOCAL_DB_GOOD_MATCH",
        "R-BOOK-EDITION-VERIFIED",
        "R-VN-TEXTBOOK-VERIFIED",
        "R-VN-STANDARD-VERIFIED",
        "R-GITHUB-VERIFIED",
        "R-HF-VERIFIED",
        "R-PACKAGE-VERIFIED",
        "R-RFC-VERIFIED",
        "R-WIKIDATA-VERIFIED",
        "R-GLOBAL-DOI-RA-VERIFIED",
    )):
        return "verified"
    if "url/reference link" in raw_low or "web resource" in raw_low:
        return "resource"
    if "hallucinat" in raw_low or "fabricat" in raw_low or "non-existent" in raw_low:
        return "suspected_hallucination"
    if "metadata_error" in raw_low or "mismatch" in raw_low or "wrong year" in raw_low:
        return "metadata_error"
    if "abstain" in raw_low or "rate limit" in raw_low or "429" in raw_low or "grey-zone" in raw_low:
        return "unresolved"
    if best_cand is not None and ("verified" in raw_low or "matched" in raw_low):
        return "verified"
    return "unresolved"


def _localize_sandbox_verdict_reasoning(
    raw_reasoning: str,
    trig_rules: list[str],
    citation: Any,
    matched_source: Any,
    *,
    is_en: bool,
    label: str | None = None,
    mismatched_fields: list[str] | None = None,
    features: Any = None,
    url_status: str | None = None,
) -> tuple[str, str, str]:
    """Produce crisp, non-accusatory plain-language EN & VI explanations for EVERY sandbox verdict."""
    rules_set = set(trig_rules or [])
    raw_cit = str(getattr(citation, "raw_text", "") or "")
    raw_reasoning_str = str(raw_reasoning or "")
    raw_lower = raw_reasoning_str.lower()

    # 1. Invalid / Placeholder DOI (R-FABRICATED-DOI)
    if "R-FABRICATED-DOI" in rules_set:
        doi_str = str(getattr(citation, "doi", None) or "").strip()
        if not doi_str:
            doi_m = _SANDBOX_BARE_DOI_RE.search(raw_cit)
            if doi_m:
                doi_str = doi_m.group(1).rstrip(".,;)]>\"'")
        doi_display = doi_str or "unknown DOI"
        reason_en = (
            f"Invalid or placeholder DOI detected ({doi_display}): this DOI uses a reserved "
            "test prefix (such as 10.1234 or 10.9999) or an unregistered pattern that does not "
            "exist in Crossref, DataCite, or the global DOI registry. "
            "Please replace it with the official DOI of the original publication or review this reference."
        )
        reason_vi = (
            f"Mã DOI không hợp lệ hoặc thuộc dải thử nghiệm ({doi_display}): mã DOI này sử dụng "
            "tiền tố giả định (như 10.1234, 10.9999) và không tồn tại trên Crossref, DataCite hay "
            "hệ thống đăng ký DOI toàn cầu. "
            "Vui lòng thay thế bằng mã DOI chính thức của bài gốc hoặc kiểm tra lại trích dẫn này."
        )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    # 2. Vietnamese Legal Statute / Document (R-LEGAL-DOCUMENT / R-VN-LEGAL-*)
    is_vn_legal = "R-LEGAL-DOCUMENT" in rules_set or any(
        r.startswith("R-VN-LEGAL-") for r in rules_set
    )
    if is_vn_legal:
        if "R-FAKE-URL" in rules_set:
            reason_en = (
                "This legal citation contains an invalid or placeholder web link. "
                "Please replace it with the official source URL."
            )
            reason_vi = (
                "Trích dẫn văn bản quy phạm pháp luật Việt Nam chứa đường dẫn thuộc tên miền "
                f"không hợp lệ hoặc giả định: {raw_cit[:120]}"
            )
            return (reason_en if is_en else reason_vi), reason_en, reason_vi

        reason_vi = _strip_sandbox_ml_jargon(raw_reasoning_str)
        legal_cand = None
        if matched_source is not None:
            for cand in getattr(matched_source, "candidates", None) or []:
                if getattr(cand, "source_name", None) == "vn_legal_registry":
                    legal_cand = cand
                    break

        code_m = re.search(
            r"\b(\d{1,4}/\d{4}/(?:QH\d{1,2}|NĐ-CP|TT-[A-ZĐÀ-Ỹ]+|QĐ-[A-ZĐÀ-Ỹ]+|NQ-[A-ZĐÀ-Ỹ]+|UBTVQH\d{1,2}))\b",
            raw_reasoning_str + " " + raw_cit,
            re.IGNORECASE,
        )
        code_str = code_m.group(1) if code_m else None
        canon_name = getattr(legal_cand, "title", None) if legal_cand is not None else None
        canon_year = getattr(legal_cand, "year", None) if legal_cand is not None else None
        canon_auth = getattr(legal_cand, "venue", None) if legal_cand is not None else None

        if "R-VN-LEGAL-FABRICATED" in rules_set or "R-VN-LEGAL-MISMATCH" in rules_set:
            en_details: list[str] = []
            date_m = re.search(r"Ngày ban hành không tồn tại trong lịch \(([^)]+)\)", raw_reasoning_str)
            if date_m:
                en_details.append(f"invalid calendar promulgation date ({date_m.group(1)})")
            if "chỉ có 6 Bộ luật chính thức" in raw_reasoning_str:
                en_details.append(
                    "Vietnam only has 6 official Codes (Civil, Penal, Labor, Civil Procedure, Criminal Procedure, Maritime)"
                )
            if "vượt quá phạm vi đánh số thực tế của Quốc hội" in raw_reasoning_str:
                en_details.append(
                    f"National Assembly statute number ({code_str or 'cited code'}) exceeds official legislative numbering "
                    "and was not found in the National Legal Database"
                )
            if "vượt quá phạm vi đánh số thực tế của Chính phủ" in raw_reasoning_str:
                en_details.append(
                    f"Government Decree number ({code_str or 'cited code'}) exceeds official numbering "
                    "and was not found in the National Legal Database"
                )
            if "Mâu thuẫn năm ban hành trong số hiệu" in raw_reasoning_str:
                en_details.append(
                    "conflict between enactment year in the statute number and the stated promulgation date"
                )
            if "Sai cơ quan ban hành" in raw_reasoning_str:
                en_details.append("issuing authority does not match the statutory document class")
            if "Tên văn bản không khớp với số hiệu" in raw_reasoning_str:
                en_details.append(
                    f"statute title does not match official code {code_str or ''}".strip()
                )
            yr_hist_m = re.search(
                r"Năm ban hành \(([^)]+)\) không khớp với lịch sử lập pháp của ([^(]+?)\s*\(các năm hợp lệ:\s*([^)]+)\)",
                raw_reasoning_str,
            )
            if yr_hist_m:
                en_details.append(
                    f"cited enactment year ({yr_hist_m.group(1)}) does not match legislative history of "
                    f"{yr_hist_m.group(2).strip()} (valid years: {yr_hist_m.group(3)})"
                )
            code_err_m = re.search(
                r"Sai số hiệu văn bản:\s*([^\n]+?)\s+năm\s+(\d{4})\s+có số hiệu chuẩn là\s+([^\s(]+)\s*\(ghi nhận:\s*([^)]+)\)",
                raw_reasoning_str,
            )
            if code_err_m:
                en_details.append(
                    f"incorrect statutory code for {code_err_m.group(1).strip()} ({code_err_m.group(2)}): "
                    f"official code is {code_err_m.group(3)} (cited: {code_err_m.group(4)})"
                )

            if "R-VN-LEGAL-FABRICATED" in rules_set:
                if en_details:
                    reason_en = "Unverified Vietnamese legal document: " + "; ".join(en_details) + "."
                else:
                    reason_en = (
                        "Unverified Vietnamese legal document: the statute code, enactment date, "
                        "or issuing authority does not match the Vietnamese National Legal Database. "
                        "Please double-check against official gazette records."
                    )
            else:
                if en_details:
                    reason_en = (
                        "Vietnamese legal statute details mismatch: "
                        + "; ".join(en_details)
                        + "."
                    )
                else:
                    reason_en = (
                        "Vietnamese legal statute details mismatch: enactment year, "
                        "statutory code, or issuing authority differs from the official registry."
                    )
            return (reason_en if is_en else reason_vi), reason_en, reason_vi

        if "R-VN-LEGAL-VERIFIED" in rules_set:
            statute_name_m = re.search(
                r"(?:hợp lệ|Việt Nam):\s*([^(\u2014—]+)",
                raw_reasoning_str,
            )
            name_display = (
                statute_name_m.group(1).strip()
                if statute_name_m
                else (canon_name or raw_cit[:100])
            )
            yr_display = canon_year
            if not yr_display:
                yr_m = re.search(r"\((\d{4})", raw_reasoning_str)
                if yr_m:
                    yr_display = yr_m.group(1)
            auth_m = re.search(r"[Cc]ơ quan ban hành:\s*([^.)]+)", raw_reasoning_str)
            auth_display = _translate_vn_authority_en(
                auth_m.group(1).strip() if auth_m else canon_auth
            )
            if "R-VN-LEGAL-SUPERSEDED" in rules_set:
                sup_m = re.search(r"thay thế bởi\s+(.+?)\.?$", raw_reasoning_str)
                sup_by = sup_m.group(1).strip() if sup_m else "a newer statutory enactment"
                reason_en = (
                    f"Verified Vietnamese legal statute: {name_display}"
                    + (f" ({yr_display})" if yr_display else "")
                    + (f", code {code_str}" if code_str else "")
                    + f", issued by {auth_display}. "
                    f"Effectiveness notice: This statute is no longer in force and was superseded by {sup_by}."
                )
            else:
                reason_en = (
                    f"Verified valid Vietnamese legal statute: {name_display}"
                    + (f" ({yr_display})" if yr_display else "")
                    + (f" — Code: {code_str}" if code_str else "")
                    + f" — Issuing authority: {auth_display} (Currently in force)."
                )
            return (reason_en if is_en else reason_vi), reason_en, reason_vi

        if "luật so sánh" in raw_lower or "nước ngoài" in raw_lower:
            reason_en = (
                "Recognized foreign or comparative-law statutory citation "
                "(outside the Vietnamese National Legal Registry)."
            )
        else:
            reason_en = (
                "Recognized Vietnamese legal or administrative document"
                + (f" ({code_str})" if code_str else "")
                + ": valid numbering format, outside the core automated statute registry — "
                "manual effectiveness check recommended."
            )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    # 3. Special high-signal academic rules (Retracted, Incomplete, Fake URL)
    if "R-RETRACTED-PAPER" in rules_set:
        reason_en = (
            "This publication has been flagged as retracted in scholarly registries. "
            "Please check its current publication status before citing it."
        )
        reason_vi = (
            "Bài báo này có thông báo đã bị rút bài (retracted) trên hệ thống học thuật. "
            "Vui lòng kiểm tra tình trạng ấn phẩm trước khi trích dẫn."
        )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    if "R-INCOMPLETE-METADATA" in rules_set:
        reason_en = (
            "This reference is missing key bibliographic details (such as author, publication year, "
            "title, or publisher), so it cannot be fully verified automatically. "
            "Please add the missing details and re-check."
        )
        reason_vi = (
            "Trích dẫn này còn thiếu thông tin quan trọng (như tác giả, năm xuất bản, tiêu đề "
            "hoặc nơi xuất bản) nên chưa thể đối chiếu đầy đủ tự động. "
            "Vui lòng bổ sung thông tin còn thiếu rồi kiểm tra lại."
        )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    if "R-FAKE-URL" in rules_set:
        reason_en = (
            "The web link in this reference points to a placeholder or invalid domain. "
            "Please update it with the actual source URL."
        )
        reason_vi = (
            "Đường dẫn trong trích dẫn thuộc tên miền giả định hoặc không hợp lệ. "
            "Vui lòng cập nhật lại liên kết nguồn chính xác."
        )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    # 4. General plain-language bilingual explanations covering ALL 5 verdict labels
    best_cand = _extract_sandbox_best_candidate(matched_source)
    eff_label = _infer_sandbox_label(label, rules_set, raw_reasoning_str, best_cand)
    src_en = _format_sandbox_source_names(matched_source, is_en=True)
    src_vi = _format_sandbox_source_names(matched_source, is_en=False)
    cand_title = str(getattr(best_cand, "title", "") or "").strip() if best_cand is not None else ""
    cand_year = str(getattr(best_cand, "year", "") or "").strip() if best_cand is not None else ""
    cited_year = str(getattr(citation, "year", "") or "").strip()
    mm_raw = [str(m).strip().lower() for m in (mismatched_fields or []) if str(m).strip()]

    xl_title_det = bool(
        (isinstance(features, dict) and features.get("cross_lingual_title_detected"))
        or getattr(features, "cross_lingual_title_detected", False)
    )
    stance_val = str(
        (features.get("stance_label") or features.get("citation_stance") or "")
        if isinstance(features, dict)
        else (getattr(features, "stance_label", None) or getattr(features, "citation_stance", None) or "")
    ).lower()
    has_contradiction_note = stance_val == "contradiction_risk" or "may contradict" in raw_lower

    if eff_label == "verified":
        work_suffix = (
            f' ("{cand_title[:100]}", {cand_year})'
            if cand_title and cand_year
            else (f' ("{cand_title[:100]}")' if cand_title else "")
        )
        if src_en:
            reason_en = (
                f"Confirmed in {src_en}{work_suffix}. "
                "Author, title, and publication details align with the published record."
            )
            reason_vi = (
                f"Đã đối chiếu và xác minh khớp trên {src_vi}{work_suffix}. "
                "Thông tin tác giả, tiêu đề và năm xuất bản trùng khớp với bản gốc."
            )
        else:
            reason_en = (
                "Confirmed in indexed academic libraries. "
                "Citation details align with the published record."
            )
            reason_vi = (
                "Đã tìm thấy và xác minh tài liệu trên các thư viện học thuật. "
                "Thông tin trích dẫn khớp với bản gốc."
            )
        if xl_title_det:
            reason_en += " The Vietnamese title matches the original English publication."
            reason_vi += " Tiêu đề tiếng Việt khớp với ấn phẩm gốc tiếng Anh."
        if has_contradiction_note:
            reason_en += (
                " Note: the surrounding claim in your text may not closely match the source's abstract — "
                "consider double-checking the wording."
            )
            reason_vi += (
                " Lưu ý: nội dung diễn giải trong bài có thể chưa sát với tóm tắt của bài gốc — "
                "bạn nên kiểm tra lại câu trích dẫn."
            )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    if eff_label == "metadata_error":
        mm_en = [_SANDBOX_FIELD_LABELS_EN.get(f, f) for f in mm_raw]
        mm_vi = [_SANDBOX_FIELD_LABELS_VI.get(f, f) for f in mm_raw]
        year_detail_en = ""
        year_detail_vi = ""
        if "year" in mm_raw and cited_year and cand_year and cited_year != cand_year:
            year_detail_en = f" (cited {cited_year}, published record shows {cand_year})"
            year_detail_vi = f" (trong bài ghi {cited_year}, bản gốc là {cand_year})"
        if mm_en:
            fields_en = ", ".join(dict.fromkeys(mm_en))
            fields_vi = ", ".join(dict.fromkeys(mm_vi))
            src_clause_en = f" in {src_en}" if src_en else " in academic libraries"
            src_clause_vi = f" trên {src_vi}" if src_vi else " trên thư viện học thuật"
            reason_en = (
                f"Source found{src_clause_en}, but some citation details differ ({fields_en}){year_detail_en}. "
                "Please review and update the mismatched information."
            )
            reason_vi = (
                f"Đã tìm thấy tài liệu gốc{src_clause_vi}, nhưng một số thông tin trích dẫn chưa khớp "
                f"({fields_vi}){year_detail_vi}. Vui lòng đối chiếu và chỉnh sửa lại."
            )
        else:
            reason_en = (
                "Source was found in academic libraries, but one or more citation details "
                "(author, publication year, title, or DOI) differ from the official record. "
                "Please review and update this reference."
            )
            reason_vi = (
                "Đã tìm thấy tài liệu trên thư viện học thuật, nhưng một số thông tin "
                "(tác giả, năm xuất bản, tiêu đề hoặc mã DOI) có sai lệch so với bản gốc. "
                "Vui lòng kiểm tra và cập nhật lại."
            )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    if eff_label == "suspected_hallucination":
        if (
            "R-NONEXISTENT-DOI" in rules_set
            or "R-CHIMERIC-DOI-MISMATCH" in rules_set
            or ("doi" in raw_lower and "does not exist" in raw_lower)
        ):
            reason_en = (
                "The cited DOI could not be found or does not match the cited title and authors "
                "in global DOI registries. Please check the DOI and verify the original publication."
            )
            reason_vi = (
                "Mã DOI được trích dẫn không tồn tại hoặc không khớp với tiêu đề và tác giả "
                "trên hệ thống đăng ký DOI toàn cầu. Vui lòng kiểm tra lại mã DOI và tài liệu gốc."
            )
        elif "R-CONTENT-MISMATCH" in rules_set or "content not aligned" in raw_lower:
            reason_en = (
                "The title matches a real publication, but the cited claim does not appear to align "
                "with the source's topic or abstract. Please verify that this is the intended reference."
            )
            reason_vi = (
                "Tiêu đề khớp với một tài liệu có thật, nhưng nội dung diễn giải trong bài chưa khớp "
                "với chủ đề hoặc tóm tắt của bài gốc. Vui lòng kiểm tra lại xem đã dẫn đúng nguồn chưa."
            )
        else:
            reason_en = (
                "No matching publication was found across indexed academic libraries. "
                "This review flag does not prove a source is invalid — it may be a typo, "
                "a local print edition, or an unindexed work. Please check the original source."
            )
            reason_vi = (
                "Chưa tìm thấy tài liệu khớp trên các thư viện học thuật trực tuyến. "
                "Cảnh báo này chưa khẳng định nguồn không có thật — có thể do lỗi gõ tiêu đề, "
                "tài liệu in nội bộ hoặc chưa được số hóa. Vui lòng kiểm tra lại bản gốc."
            )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    if eff_label == "resource":
        eff_url_status = str(
            url_status or getattr(matched_source, "url_status", "") or ""
        ).strip().lower()
        if eff_url_status in ("alive", "restricted_alive"):
            reason_en = (
                "Recognized as a web page or institutional online resource (the link is reachable). "
                "Web sources are verified for accessibility rather than academic journal indexing."
            )
            reason_vi = (
                "Đây là nguồn trang web hoặc tài nguyên trực tuyến (liên kết đang hoạt động). "
                "Nguồn web được kiểm tra khả năng truy cập thay vì đối chiếu trên tạp chí học thuật."
            )
        elif eff_url_status in ("dead_archived", "archived_alive", "archived_only") or "R-WAYBACK-ARCHIVED" in rules_set:
            reason_en = (
                "The original web link is currently unavailable, but an archived copy was found "
                "on the Wayback Machine. Consider adding or reviewing the archived link."
            )
            reason_vi = (
                "Liên kết web gốc hiện không truy cập được, nhưng đã tìm thấy bản lưu trữ trên "
                "Wayback Machine. Bạn nên kiểm tra hoặc bổ sung liên kết lưu trữ."
            )
        elif eff_url_status in ("dead", "broken", "unreachable") or "R-DEAD-URL" in rules_set or "R-BROKEN-LINK" in rules_set:
            reason_en = (
                "Recognized as a web resource, but the link could not be reached. "
                "Please check whether the address has moved or contains a typo."
            )
            reason_vi = (
                "Đây là nguồn tài nguyên web nhưng liên kết hiện không truy cập được. "
                "Vui lòng kiểm tra xem địa chỉ đã thay đổi hoặc có lỗi gõ hay không."
            )
        else:
            reason_en = (
                "Recognized as a web link, report, or non-journal reference rather than a "
                "peer-reviewed academic article. Please verify the source directly."
            )
            reason_vi = (
                "Đây là liên kết web, báo cáo hoặc tài liệu tham khảo ngoài tạp chí học thuật. "
                "Vui lòng kiểm tra trực tiếp tại nguồn gốc."
            )
        return (reason_en if is_en else reason_vi), reason_en, reason_vi

    # Unresolved (rate-limiting, borderline match, or insufficient information)
    if (
        "R-RATE-LIMITED-ABSTAIN" in rules_set
        or "429" in raw_reasoning_str
        or "rate limit" in raw_lower
        or "timeout" in raw_lower
    ):
        reason_en = (
            "Some academic libraries were temporarily busy while checking this citation. "
            "Please try again shortly or verify the reference manually."
        )
        reason_vi = (
            "Một số thư viện học thuật đang tạm thời bận khi tra cứu trích dẫn này. "
            "Vui lòng thử lại sau ít phút hoặc kiểm tra thủ công."
        )
    elif (
        "R-ABSTENTION-BORDER" in rules_set
        or "R-WEAK-EVIDENCE" in rules_set
        or "grey-zone" in raw_lower
        or "abstain" in raw_lower
        or cand_title
    ):
        reason_en = (
            "Found a possibly related publication, but there is not enough matching detail "
            "to confirm it automatically. Please review the citation against the original source."
        )
        reason_vi = (
            "Tìm thấy một tài liệu có nét tương đồng nhưng chưa đủ thông tin khớp để tự động "
            "xác nhận. Vui lòng đối chiếu thủ công với bản gốc."
        )
    else:
        reason_en = (
            "Not enough matching data was found to verify this citation automatically. "
            "Please double-check the title, author names, and publication year against the original source."
        )
        reason_vi = (
            "Chưa đủ dữ liệu để xác minh tự động trích dẫn này. "
            "Vui lòng kiểm tra lại tiêu đề, tên tác giả và năm xuất bản theo bản gốc."
        )
    return (reason_en if is_en else reason_vi), reason_en, reason_vi


@router.post("/sandbox/verify")
async def verify_sandbox_citations_instant(
    payload: dict[str, Any],
    current_user: User = Depends(get_current_user),
    pipeline: IntegrityPipeline = Depends(get_pipeline),
) -> dict[str, Any]:
    """Instant 3-second live citation & Layer-1/Layer-2 verification without leaving UploadPage."""
    from integrity_checker.extraction.base import Document, Page
    from integrity_checker.models.citation import Citation, CitationStyle, CitationType

    _enforce_sandbox_verify_rate_limit(current_user)
    policy = get_user_plan_policy(current_user)
    allow_serpapi_flag = bool(policy.allow_serpapi_fallback)

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
                    "Cited in the essay text but missing from the reference list."
                    if is_en
                    else "Đã trích dẫn trong nội dung bài viết nhưng thiếu ở danh mục tài liệu tham khảo."
                )
            elif inc_in_refs and not cite_in_text:
                l1_status = "uncited_reference"
                l1_note = (
                    "Listed in the reference list but never cited in the essay text."
                    if is_en
                    else "Có trong danh mục tài liệu tham khảo nhưng chưa được trích dẫn trong nội dung bài viết."
                )
            elif override_yr and override_yr != str(it.get("year") or "").strip():
                l1_status = "in_text_mismatch"
                l1_note = (
                    f"Publication year differs between the in-text citation ({override_yr}) and the reference list ({it.get('year')})."
                    if is_en
                    else f"Năm xuất bản trong bài viết ({override_yr}) khác với danh mục tài liệu tham khảo ({it.get('year')})."
                )
            else:
                l1_status = "matched"
                l1_note = (
                    "In-text citation matches the reference list entry."
                    if is_en
                    else "Khớp đầy đủ giữa trích dẫn trong bài và danh mục tài liệu tham khảo."
                )

            url_val = str(it.get("url") or "").strip() or None
            num_idx_raw = it.get("numeric_index")
            num_idx_val = int(num_idx_raw) if isinstance(num_idx_raw, int) else None
            sub_idx_val = str(it.get("sub_index") or "").strip() or None
            comp_lbl_val = str(it.get("composite_label") or "").strip() or None
            cit = Citation(
                raw_text=ref_line,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE if style == "ieee" else CitationStyle.APA,
                authors=authors_raw,
                year=str(year_val) if year_val is not None else None,
                title=str(it.get("title") or "").strip() or None,
                venue=str(it.get("venue") or "").strip() or None,
                doi=doi_val,
                url=url_val,
                numeric_index=num_idx_val,
                sub_index=sub_idx_val,
                composite_label=comp_lbl_val,
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
        parsed_citations = await asyncio.to_thread(
            pipeline.ref_parser.parse_reference_section, fake_doc
        )
        if not parsed_citations:
            raw_non_empty = [
                ln.strip()
                for ln in raw_references_text.splitlines()
                if ln.strip() and not _GUEST_BIB_HEADER_RE.match(ln.strip())
            ]
            for line in raw_non_empty[:15]:
                doi_m = _SANDBOX_BARE_DOI_RE.search(line)
                extracted_doi = (
                    doi_m.group(1).rstrip(".,;)]>\"'") if doi_m else None
                )
                parsed_citations.append(
                    Citation(
                        raw_text=line,
                        citation_type=CitationType.REFERENCE_LIST,
                        style=CitationStyle.IEEE if style == "ieee" else CitationStyle.APA,
                        doi=extracted_doi,
                        page_num=1,
                        context=claim_context or None,
                        mapping_status="not_applicable",
                        mapping_confidence=0.0,
                    )
                )
        for c in parsed_citations:
            if not c.doi and c.raw_text:
                doi_m = _SANDBOX_BARE_DOI_RE.search(c.raw_text)
                if doi_m:
                    c.doi = doi_m.group(1).rstrip(".,;)]>\"'")
            c.mapping_status = "not_applicable"
            c.mapping_confidence = 0.0
            if claim_context:
                c.context = claim_context
            layer1_statuses.append(
                {
                    "status": "not_applicable",
                    "note": (
                        "Direct bibliography verification (in-text linking not applicable)."
                        if is_en
                        else "Kiểm tra trực tiếp danh mục tham khảo (không áp dụng đối chiếu trong bài)."
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
    include_remediation = not (policy.tier == "basic" and current_user.role == "user")
    return await _execute_instant_citations_verification(
        pipeline=pipeline,
        parsed_citations=parsed_citations,
        layer1_statuses=layer1_statuses,
        style=style,
        allow_serpapi_flag=allow_serpapi_flag,
        include_remediation=include_remediation,
        t0=t0,
        is_en=is_en,
        is_bibliography_only=bool(raw_references_text and not (isinstance(items, list) and items)),
    )


async def _execute_instant_citations_verification(
    *,
    pipeline: IntegrityPipeline,
    parsed_citations: list[Any],
    layer1_statuses: list[dict[str, Any]],
    style: str,
    allow_serpapi_flag: bool,
    include_remediation: bool,
    t0: float,
    is_en: bool = False,
    is_bibliography_only: bool = False,
) -> dict[str, Any]:
    """Shared concurrent verification & serialization engine for /sandbox/verify and /sandbox/public-verify."""
    from integrity_checker.export.bibliography_formatter import build_remediated_bibliography
    from integrity_checker.models.source import SourceResult

    sem = asyncio.Semaphore(8)
    gibberish_flags = [
        bool(is_bibliography_only and _is_non_citation_gibberish(getattr(c, "raw_text", "")))
        for c in parsed_citations
    ]

    async def _retrieve_one(c: Any, *, is_gibberish: bool = False):
        if is_gibberish:
            return SourceResult(
                citation_raw=c.raw_text,
                candidates=[],
                sources_queried=[],
                sources_succeeded=[],
                sources_failed={},
            )

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
            local_db_obj = getattr(orch, "_local_db", None) if orch is not None else None
            lookup_fn = getattr(orch, "_lookup_local_db", None) if orch is not None else None
            if local_db_obj is not None and callable(lookup_fn):
                def _lookup_local_sync() -> SourceResult | None:
                    local_hit = lookup_fn(c)
                    if isinstance(local_hit, SourceResult) and local_hit.candidates:
                        return local_hit
                    if c.title and hasattr(local_db_obj, "search_by_title"):
                        from integrity_checker.models.source import SourceCandidate
                        from integrity_checker.retrieval.utils import title_similarity

                        title_hits = local_db_obj.search_by_title(c.title, limit=3) or []
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
                    return None

                try:
                    hit_res = await asyncio.to_thread(_lookup_local_sync)
                    if hit_res is not None:
                        return hit_res
                except Exception:
                    pass
            try:
                retrieve_fn = pipeline.orchestrator.retrieve
                ret_params = inspect.signature(retrieve_fn).parameters
                accepts_serpapi = "allow_serpapi" in ret_params or any(
                    p.kind == inspect.Parameter.VAR_KEYWORD for p in ret_params.values()
                )
                ret_coro = (
                    retrieve_fn(c, allow_serpapi=allow_serpapi_flag)
                    if accepts_serpapi
                    else retrieve_fn(c)
                )
                return await asyncio.wait_for(ret_coro, timeout=25.0)
            except TimeoutError:
                u_st, u_code, u_arch, u_meta = None, None, None, None
                if getattr(c, "url", None) or (
                    c.raw_text and re.search(r"https?://", c.raw_text, re.IGNORECASE)
                ):
                    try:
                        u_st, u_code, u_arch, u_meta = await asyncio.wait_for(
                            pipeline.orchestrator._validate_citation_url_with_meta(c),
                            timeout=8.0,
                        )
                    except Exception:
                        pass
                return SourceResult(
                    citation_raw=c.raw_text,
                    candidates=[],
                    sources_queried=["local_db", "crossref", "openalex"],
                    sources_succeeded=[],
                    sources_failed={
                        "crossref": "No results for query",
                        "openalex": "No results for query",
                    },
                    url_status=u_st,
                    url_status_code=u_code,
                    archive_url=u_arch,
                    html_meta=u_meta,
                )

    source_results = await asyncio.gather(
        *(
            _retrieve_one(c, is_gibberish=is_gib)
            for c, is_gib in zip(parsed_citations, gibberish_flags, strict=False)
        )
    )

    verdict_items: list[dict[str, Any]] = []
    remediable_verdict_pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []

    for idx, (citation, source, is_gib) in enumerate(
        zip(parsed_citations, source_results, gibberish_flags, strict=False), start=1
    ):
        l1_info = (
            layer1_statuses[idx - 1]
            if idx - 1 < len(layer1_statuses)
            else {"status": "not_applicable" if is_bibliography_only else "matched", "note": ""}
        )
        if is_gib:
            gib_reason_en = (
                "Input does not appear to be a valid bibliographic citation "
                "(missing recognizable author, title, publication year, DOI, or URL). "
                "Please paste a complete reference such as: Author, A. (Year). Title. Journal/Venue."
            )
            gib_reason_vi = (
                "Văn bản nhập vào không giống một trích dẫn học thuật hợp lệ "
                "(thiếu tác giả, tiêu đề, năm xuất bản, mã DOI hoặc URL). "
                "Vui lòng dán trích dẫn đầy đủ theo mẫu: Tác giả (Năm). Tiêu đề. Tạp chí/NXB."
            )
            gib_dict: dict[str, Any] = {
                "index": idx,
                "citation_raw": citation.raw_text,
                "cited_title": citation.title,
                "cited_authors": citation.authors,
                "cited_year": citation.year,
                "cited_venue": citation.venue,
                "cited_doi": citation.doi,
                "cited_url": getattr(citation, "url", None),
                "numeric_index": getattr(citation, "numeric_index", None),
                "sub_index": getattr(citation, "sub_index", None),
                "composite_label": getattr(citation, "composite_label", None),
                "label": "unresolved",
                "confidence": 0.0,
                "mapping_status": "not_applicable",
                "mapping_note": (
                    "Direct bibliography verification — input is not a recognizable citation."
                    if is_en
                    else "Kiểm tra trực tiếp danh mục tham khảo — đầu vào không giống cấu trúc trích dẫn hợp lệ."
                ),
                "reasoning": gib_reason_en if is_en else gib_reason_vi,
                "reasoning_en": gib_reason_en,
                "reasoning_vi": gib_reason_vi,
                "triggered_rules": ["R-INCOMPLETE-METADATA"],
                "mismatched_fields": [],
                "url_status": None,
                "url_status_code": None,
                "archive_url": None,
                "is_retracted": False,
                "is_invalid_input": True,
                "html_meta": None,
                "features": {
                    "title_sim_fuzzy": 0.0,
                    "title_sim_semantic": 0.0,
                    "author_jaccard": 0.0,
                    "year_distance": 0,
                    "doi_exact_match": False,
                    "venue_sim": 0.0,
                    "cross_lingual_detected": False,
                    "bridged_concepts": [],
                    "cross_lingual_title_detected": False,
                    "cross_lingual_title_sim": 0.0,
                    "html_meta_title_sim": None,
                    "has_scholarly_candidate": False,
                },
                "matched_source": None,
                "matched_sources": [],
                "sources_succeeded": [],
                "used_local_db": False,
                "remediated_apa": None,
            }
            verdict_items.append(gib_dict)
            continue

        used_local = "local_db" in (source.sources_succeeded or [])
        verdict = await asyncio.to_thread(
            pipeline.checker.check,
            citation,
            source,
            citation_context=citation.context,
            api_exhausted=bool(getattr(source, "api_exhausted", False)),
            used_local_db=used_local,
        )
        best = source.best_candidate()
        vf = getattr(verdict, "features", None)

        from integrity_checker.pipeline.integrity_pipeline import (
            _MAX_SERIALIZED_MATCHED_SOURCES,
            _build_matched_fields,
            _clean_public_external_ids,
            _extract_agreed_sources,
            _extract_corroborating_records,
            _format_candidate_authors,
        )

        checked_at_iso = datetime.now(UTC).isoformat()
        pristine_by_source: dict[str, Any] = {}
        for p_cand in getattr(source, "_pristine_candidates", None) or []:
            if getattr(p_cand, "found", False):
                p_src = str(getattr(p_cand, "source_name", "") or "").strip()
                if p_src and p_src not in pristine_by_source:
                    pristine_by_source[p_src] = p_cand

        def _serialize_cand(
            cand: Any,
            override_source: str | None = None,
            checked_ts: str = checked_at_iso,
            cit_obj: Any = citation,
            verdict_mm: tuple[str, ...] = tuple(verdict.mismatched_fields or ()),
        ) -> dict[str, Any]:
            cand_authors = _format_candidate_authors(getattr(cand, "authors", None))
            c_doi = getattr(cand, "doi", None)
            c_title = getattr(cand, "title", None)
            c_year = str(getattr(cand, "year", "")) if getattr(cand, "year", None) else None
            c_venue = getattr(cand, "venue", None)
            m_fields = _build_matched_fields(
                c_doi,
                c_title,
                cand_authors,
                c_year,
                c_venue,
                citation=cit_obj,
                mismatched_fields=list(verdict_mm),
            )
            src_name = override_source or getattr(cand, "source_name", "unknown")
            return {
                "source": src_name,
                "source_name": src_name,
                "matched_fields": m_fields,
                "checked_at": checked_ts,
                "title": c_title,
                "authors": cand_authors,
                "year": c_year,
                "venue": c_venue,
                "doi": c_doi,
                "url": getattr(cand, "url", None),
                "abstract": getattr(cand, "abstract", None),
                "confidence": float(getattr(cand, "confidence", 0.0) or 0.0),
                "external_ids": _clean_public_external_ids(getattr(cand, "external_ids", None)),
            }

        ordered_found: list[Any] = []
        if best is not None:
            ordered_found.append(best)
        for cand_item in getattr(source, "candidates", None) or []:
            if getattr(cand_item, "found", False) and cand_item is not best:
                ordered_found.append(cand_item)

        matched_sources_list: list[dict[str, Any]] = []
        seen_sandbox_sources: set[str] = set()
        for c_item in ordered_found:
            if len(matched_sources_list) >= _MAX_SERIALIZED_MATCHED_SOURCES:
                break
            primary_entry = _serialize_cand(c_item)
            matched_sources_list.append(primary_entry)
            seen_sandbox_sources.add(str(primary_entry["source"]))

            for corr in _extract_corroborating_records(c_item):
                if len(matched_sources_list) >= _MAX_SERIALIZED_MATCHED_SOURCES:
                    break
                corr_src = str(corr.get("source_name") or corr.get("source") or "").strip()
                if not corr_src or corr_src in seen_sandbox_sources:
                    continue
                c_authors = _format_candidate_authors(corr.get("authors")) or list(
                    primary_entry["authors"]
                )
                c_title = corr.get("title") or primary_entry["title"]
                c_raw_year = corr.get("year")
                c_year = str(c_raw_year) if c_raw_year else primary_entry["year"]
                c_venue = (
                    corr.get("venue")
                    if corr.get("venue") is not None
                    else primary_entry["venue"]
                )
                c_doi = corr.get("doi") if corr.get("doi") is not None else primary_entry["doi"]
                c_url = corr.get("url") if corr.get("url") is not None else primary_entry["url"]
                c_conf_raw = corr.get(
                    "confidence", corr.get("similarity", primary_entry["confidence"])
                )
                matched_sources_list.append({
                    "source": corr_src,
                    "source_name": corr_src,
                    "matched_fields": _build_matched_fields(
                        c_doi,
                        c_title,
                        c_authors,
                        c_year,
                        c_venue,
                        citation=citation,
                        mismatched_fields=list(verdict.mismatched_fields or []),
                    ),
                    "checked_at": checked_at_iso,
                    "title": c_title,
                    "authors": c_authors,
                    "year": c_year,
                    "venue": c_venue,
                    "doi": c_doi,
                    "url": c_url,
                    "abstract": corr.get("abstract", primary_entry["abstract"]),
                    "confidence": float(c_conf_raw or 0.0),
                    "external_ids": _clean_public_external_ids(corr.get("external_ids")),
                })
                seen_sandbox_sources.add(corr_src)

            for agreed_src in _extract_agreed_sources(c_item):
                if len(matched_sources_list) >= _MAX_SERIALIZED_MATCHED_SOURCES:
                    break
                if not agreed_src or agreed_src in seen_sandbox_sources:
                    continue
                p_cand = pristine_by_source.get(agreed_src)
                if p_cand is not None:
                    matched_sources_list.append(_serialize_cand(p_cand, override_source=agreed_src))
                else:
                    synth = dict(primary_entry)
                    synth["source"] = agreed_src
                    synth["source_name"] = agreed_src
                    synth["authors"] = list(primary_entry["authors"])
                    synth["matched_fields"] = list(primary_entry["matched_fields"])
                    synth["external_ids"] = dict(primary_entry["external_ids"])
                    matched_sources_list.append(synth)
                seen_sandbox_sources.add(agreed_src)

        matched_src = matched_sources_list[0] if matched_sources_list else None

        feat_html_meta = getattr(vf, "html_meta", None) if vf is not None else None
        src_html_meta = getattr(source, "html_meta", None)
        html_meta_dict: dict[str, Any] | None = None
        if isinstance(feat_html_meta, dict):
            html_meta_dict = {
                "page_title": feat_html_meta.get("page_title"),
                "citation_title": feat_html_meta.get("citation_title"),
                "citation_authors": list(feat_html_meta.get("citation_authors") or []),
                "published_year": feat_html_meta.get("published_year"),
                "site_name": feat_html_meta.get("site_name"),
                "citation_doi": feat_html_meta.get("citation_doi"),
                "canonical_url": feat_html_meta.get("canonical_url"),
                "is_soft_404": bool(feat_html_meta.get("is_soft_404", False)),
            }
        elif feat_html_meta is not None:
            html_meta_dict = {
                "page_title": getattr(feat_html_meta, "page_title", None),
                "citation_title": getattr(feat_html_meta, "citation_title", None),
                "citation_authors": list(getattr(feat_html_meta, "citation_authors", None) or []),
                "published_year": getattr(feat_html_meta, "published_year", None),
                "site_name": getattr(feat_html_meta, "site_name", None),
                "citation_doi": getattr(feat_html_meta, "citation_doi", None),
                "canonical_url": getattr(feat_html_meta, "canonical_url", None),
                "is_soft_404": bool(getattr(feat_html_meta, "is_soft_404", False)),
            }
        elif src_html_meta is not None:
            html_meta_dict = {
                "page_title": getattr(src_html_meta, "page_title", None),
                "citation_title": getattr(src_html_meta, "citation_title", None),
                "citation_authors": list(getattr(src_html_meta, "citation_authors", None) or []),
                "published_year": getattr(src_html_meta, "published_year", None),
                "site_name": getattr(src_html_meta, "site_name", None),
                "citation_doi": getattr(src_html_meta, "citation_doi", None),
                "canonical_url": getattr(src_html_meta, "canonical_url", None),
                "is_soft_404": bool(getattr(src_html_meta, "is_soft_404", False)),
            }

        if (
            not matched_sources_list
            and html_meta_dict is not None
            and not bool(html_meta_dict.get("is_soft_404", False))
        ):
            has_web_meta = any(
                html_meta_dict.get(k)
                for k in (
                    "citation_title",
                    "page_title",
                    "citation_authors",
                    "published_year",
                    "site_name",
                    "citation_doi",
                )
            )
            if has_web_meta:
                url_stat = getattr(source, "url_status", None)
                arch_url = getattr(source, "archive_url", None)
                is_wayback_meta = url_stat in ("archived_alive", "archived_only") or bool(
                    arch_url and url_stat not in ("alive", "restricted_alive")
                )
                synth_name = (
                    "wayback_html_meta" if is_wayback_meta else "web_html_meta"
                )
                web_title = html_meta_dict.get("citation_title") or html_meta_dict.get("page_title")
                web_authors = list(html_meta_dict.get("citation_authors") or [])
                web_year = (
                    str(html_meta_dict["published_year"])
                    if html_meta_dict.get("published_year")
                    else None
                )
                web_venue = html_meta_dict.get("site_name")
                web_doi = html_meta_dict.get("citation_doi")
                web_url = html_meta_dict.get("canonical_url") or arch_url or getattr(citation, "url", None)
                web_m_fields = _build_matched_fields(
                    web_doi,
                    web_title,
                    web_authors,
                    web_year,
                    web_venue,
                    citation=citation,
                    mismatched_fields=list(verdict.mismatched_fields or []),
                )
                web_entry: dict[str, Any] = {
                    "source": synth_name,
                    "source_name": synth_name,
                    "matched_fields": web_m_fields,
                    "checked_at": datetime.now(UTC).isoformat(),
                    "title": web_title,
                    "authors": web_authors,
                    "year": web_year,
                    "venue": web_venue,
                    "doi": web_doi,
                    "url": web_url,
                    "abstract": None,
                    "confidence": round(float(verdict.confidence or 0.0), 3),
                    "external_ids": {},
                }
                matched_sources_list = [web_entry]
                if matched_src is None:
                    matched_src = web_entry

        trig_rules = list(verdict.triggered_rules or [])
        is_retracted_flag = bool(
            getattr(verdict, "is_retracted", False)
            or getattr(source, "is_retracted", False)
            or ("R-RETRACTED-PAPER" in trig_rules)
        )
        has_scholarly_cand = (
            bool(getattr(vf, "has_scholarly_candidate", bool(best is not None)))
            if vf is not None
            else bool(best is not None)
        )
        features_payload = {
            "title_sim_fuzzy": float(getattr(vf, "title_sim_fuzzy", 0.0) or 0.0) if vf is not None else 0.0,
            "title_sim_semantic": float(getattr(vf, "title_sim_semantic", 0.0) or 0.0) if vf is not None else 0.0,
            "author_jaccard": float(getattr(vf, "author_jaccard", 0.0) or 0.0) if vf is not None else 0.0,
            "year_distance": int(getattr(vf, "year_distance", 0) or 0) if vf is not None else 0,
            "doi_exact_match": bool(getattr(vf, "doi_exact_match", False)) if vf is not None else False,
            "venue_sim": float(getattr(vf, "venue_sim", 0.0) or 0.0) if vf is not None else 0.0,
            "cross_lingual_detected": bool(getattr(vf, "cross_lingual_detected", False)) if vf is not None else False,
            "bridged_concepts": list(getattr(vf, "bridged_concepts", None) or []) if vf is not None else [],
            "cross_lingual_title_detected": bool(getattr(vf, "cross_lingual_title_detected", False)) if vf is not None else False,
            "cross_lingual_title_sim": float(getattr(vf, "cross_lingual_title_sim", 0.0) or 0.0) if vf is not None else 0.0,
            "html_meta_title_sim": getattr(vf, "html_meta_title_sim", None) if vf is not None else None,
            "has_scholarly_candidate": has_scholarly_cand,
        }

        effective_verdict_source = getattr(verdict, "matched_source", None) or source
        verdict_label_str = (
            verdict.label.value if hasattr(verdict.label, "value") else str(verdict.label)
        )
        final_reasoning, reason_en, reason_vi = _localize_sandbox_verdict_reasoning(
            str(verdict.reasoning or ""),
            trig_rules,
            citation,
            effective_verdict_source,
            is_en=is_en,
            label=verdict_label_str,
            mismatched_fields=list(verdict.mismatched_fields or []),
            features=vf,
            url_status=getattr(source, "url_status", None),
        )

        v_dict: dict[str, Any] = {
            "index": idx,
            "citation_raw": citation.raw_text,
            "cited_title": citation.title,
            "cited_authors": citation.authors,
            "cited_year": citation.year,
            "cited_venue": citation.venue,
            "cited_doi": citation.doi,
            "cited_url": getattr(citation, "url", None),
            "numeric_index": getattr(citation, "numeric_index", None),
            "sub_index": getattr(citation, "sub_index", None),
            "composite_label": getattr(citation, "composite_label", None),
            "label": verdict_label_str,
            "confidence": round(float(verdict.confidence or 0.0), 3),
            "mapping_status": l1_info["status"],
            "mapping_note": l1_info["note"],
            "reasoning": final_reasoning,
            "triggered_rules": trig_rules,
            "mismatched_fields": list(verdict.mismatched_fields or []),
            "url_status": getattr(source, "url_status", None),
            "url_status_code": getattr(source, "url_status_code", None),
            "archive_url": getattr(source, "archive_url", None),
            "is_retracted": is_retracted_flag,
            "html_meta": html_meta_dict,
            "features": features_payload,
            "matched_source": matched_src,
            "matched_sources": matched_sources_list,
            "sources_succeeded": list(source.sources_succeeded or []),
            "used_local_db": used_local,
        }
        if reason_en is not None:
            v_dict["reasoning_en"] = reason_en
        if reason_vi is not None:
            v_dict["reasoning_vi"] = reason_vi
        verdict_items.append(v_dict)
        remediable_verdict_pairs.append((v_dict, v_dict))

    remediation: dict[str, Any] | None = None
    remediated_apa: str | None = None
    if include_remediation and remediable_verdict_pairs:
        remediation_res = await asyncio.to_thread(
            build_remediated_bibliography,
            essay_id=0,
            verdicts=[raw_v for _, raw_v in remediable_verdict_pairs],
            style=style,
        )
        remediation = remediation_res
        rem_entries = remediation_res.get("entries") or []
        for (v_item, _), r_entry in zip(remediable_verdict_pairs, rem_entries, strict=False):
            if not r_entry.get("is_hallucination"):
                v_item["remediated_apa"] = r_entry.get("apa") or r_entry.get("remediated_text")
            else:
                v_item["remediated_apa"] = None
        non_halluc_apas = [
            str(r_entry.get("apa") or r_entry.get("remediated_text") or "").strip()
            for r_entry in rem_entries
            if not r_entry.get("is_hallucination")
            and str(r_entry.get("apa") or r_entry.get("remediated_text") or "").strip()
        ]
        remediated_apa = "\n\n".join(non_halluc_apas) if non_halluc_apas else None
    elapsed = round(time.monotonic() - t0, 2)

    verified_cnt = sum(1 for v in verdict_items if v["label"] == "verified")
    meta_err_cnt = sum(1 for v in verdict_items if v["label"] == "metadata_error")
    incomplete_meta_cnt = sum(
        1
        for v in verdict_items
        if "R-INCOMPLETE-METADATA" in (v.get("triggered_rules") or [])
    )
    halluc_cnt = sum(1 for v in verdict_items if v["label"] == "suspected_hallucination")
    resource_cnt = sum(1 for v in verdict_items if v["label"] == "resource")
    unresolved_cnt = sum(1 for v in verdict_items if v["label"] == "unresolved")
    l1_issue_cnt = sum(
        1
        for v in verdict_items
        if v["mapping_status"] not in _SANDBOX_L1_NON_ISSUE_STATUSES
    )

    return {
        "elapsed_seconds": elapsed,
        "total": len(verdict_items),
        "summary": {
            "total": len(verdict_items),
            "verified": verified_cnt,
            "metadata_error": meta_err_cnt,
            "incomplete_metadata": incomplete_meta_cnt,
            "suspected_hallucination": halluc_cnt,
            "resource": resource_cnt,
            "unresolved": unresolved_cnt,
            "layer1_linking_issues": l1_issue_cnt,
        },
        "results": verdict_items,
        "remediation": remediation,
        "remediated_apa": remediated_apa,
    }


_GUEST_BIB_HEADER_RE = re.compile(
    r"^(?:references?|reference\s+list|bibliography|works?\s+cited|tài\s+liệu\s+tham\s+khảo)\s*:?$",
    re.IGNORECASE,
)
_GUEST_NUMBERED_MARKER_RE = re.compile(
    r"(?:\[\s*\d+[a-z]?\s*\]|(?:^|\s)\d{1,2}[\.\)]\s+[A-ZÀ-ÝĂÂĐÊÔƠƯh])"
)
_GUEST_PAREN_YEAR_OR_ND_RE = re.compile(
    r"\(\s*(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*[^)]*)?\s*\)|\(\s*n\.?\s*d\.?\s*\)",
    re.IGNORECASE,
)
_GUEST_LEADING_PAREN_YEAR_OR_ND_RE = re.compile(
    r"^\(\s*(?:(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*[^)]*)?|n\.?\s*d\.?)\s*\)",
    re.IGNORECASE,
)
_GUEST_STANDALONE_URL_DOI_LINE_RE = re.compile(
    r"^(?:https?://|www\.|doi\s*:\s*|10\.\d{4,9}/)\S+$",
    re.IGNORECASE,
)
_GUEST_HAS_URL_OR_DOI_RE = re.compile(
    r"(?:https?://\S+|www\.\S+|\bdoi\s*:\s*\S+|\b10\.\d{4,9}/\S+)",
    re.IGNORECASE,
)
_GUEST_COMPLETE_SINGLE_LINE_CITATION_RE = re.compile(
    r"\(\s*(?:(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*[^)]*)?|n\.?\s*d\.?)\s*\)\.\s+\S.{10,}\.\s+\S.{3,}",
    re.IGNORECASE,
)


def _estimate_guest_reference_boundaries(raw_lines: list[str]) -> int:
    """Count distinct bibliography entry boundaries without wrapped-PDF false positives."""
    non_empty_lines = [ln for ln in raw_lines if ln]
    if not non_empty_lines:
        return 0

    clean_body = "\n".join(non_empty_lines)
    body_with_blanks = "\n".join(raw_lines).strip()

    # 1. Blank-line-separated paragraphs
    paragraphs = [
        blk.strip()
        for blk in re.split(r"\n\s*\n+", body_with_blanks)
        if len(blk.strip()) > 12
    ]

    # 2. Numbered entry markers — both line-start and inline (avoiding DOI decimals like 10.1093)
    numbered_markers = len(_GUEST_NUMBERED_MARKER_RE.findall(clean_body))

    # 3. Parenthetical APA/Harvard year or (n.d.) markers
    paren_year_markers = len(_GUEST_PAREN_YEAR_OR_ND_RE.findall(clean_body))

    # 4. Standalone URL/DOI lines + preceding non-URL bibliography entries
    url_and_entry_count = 0
    open_entry_needs_url = False
    open_entry_complete = False
    for ln in non_empty_lines:
        is_standalone_url = bool(_GUEST_STANDALONE_URL_DOI_LINE_RE.match(ln))
        line_has_url = bool(_GUEST_HAS_URL_OR_DOI_RE.search(ln))
        is_complete_single_line = bool(_GUEST_COMPLETE_SINGLE_LINE_CITATION_RE.search(ln))
        line_starts_entry = bool(
            _GUEST_PAREN_YEAR_OR_ND_RE.search(ln)
            or _GUEST_NUMBERED_MARKER_RE.match(ln)
            or re.search(r"\b(?:18|19|20)\d{2}[a-z]?\s*[;:.]", ln)
        )
        if is_standalone_url:
            if open_entry_needs_url and not open_entry_complete:
                open_entry_needs_url = False
                open_entry_complete = True
            else:
                url_and_entry_count += 1
                open_entry_needs_url = False
                open_entry_complete = True
        elif line_starts_entry:
            if (
                url_and_entry_count == 1
                and not open_entry_complete
                and _GUEST_LEADING_PAREN_YEAR_OR_ND_RE.match(ln)
            ):
                open_entry_needs_url = not line_has_url and not is_complete_single_line
                open_entry_complete = line_has_url or is_complete_single_line
            else:
                url_and_entry_count += 1
                open_entry_needs_url = not line_has_url and not is_complete_single_line
                open_entry_complete = line_has_url or is_complete_single_line
        elif line_has_url:
            if open_entry_needs_url and not open_entry_complete:
                open_entry_needs_url = False
                open_entry_complete = True
            else:
                url_and_entry_count += 1
                open_entry_needs_url = False
                open_entry_complete = True
        else:
            if url_and_entry_count == 0 or open_entry_complete:
                url_and_entry_count += 1
                open_entry_needs_url = True
                open_entry_complete = False

    return max(1, len(paragraphs), numbered_markers, paren_year_markers, url_and_entry_count)


@router.post("/sandbox/public-verify")
async def verify_public_guest_citations(
    request: Request,
    payload: dict[str, Any],
    pipeline: IntegrityPipeline = Depends(get_pipeline),
) -> dict[str, Any]:
    """Public IP-rate-limited instant guest citation checker (max 3 references / 1,500 chars, zero SerpAPI)."""
    from integrity_checker.extraction.base import Document, Page
    from integrity_checker.models.citation import Citation, CitationStyle, CitationType

    t0 = time.monotonic()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON request payload.")

    lang_code = str(payload.get("lang") or "vi").strip().lower()
    is_en = lang_code.startswith("en")
    style = str(payload.get("style") or "apa").strip().lower()
    if style not in {"apa", "ieee"}:
        style = "apa"

    # Short-circuit already-throttled client IPs before running any checks
    _enforce_public_sandbox_rate_limit(request, is_en=is_en, consume=False)

    raw_references_text = str(payload.get("references_text") or "").strip()
    if not raw_references_text:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please paste 1 to 3 references to verify."
                if is_en
                else "Vui lòng dán từ 1 đến 3 trích dẫn để kiểm tra."
            ),
        )

    if len(raw_references_text) > PUBLIC_SANDBOX_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Instant guest check supports up to {PUBLIC_SANDBOX_MAX_CHARS:,} characters "
                f"(up to {PUBLIC_SANDBOX_MAX_REFERENCES} references). Create a free account to upload "
                "your full PDF or Word manuscript."
                if is_en
                else (
                    f"Bản kiểm tra nhanh hỗ trợ tối đa 1.500 ký tự "
                    f"(tối đa {PUBLIC_SANDBOX_MAX_REFERENCES} trích dẫn). Vui lòng tạo tài khoản miễn phí "
                    "để tải lên toàn bộ file PDF hoặc Word."
                )
            ),
        )

    raw_lines = [ln.strip() for ln in raw_references_text.splitlines()]
    if raw_lines and _GUEST_BIB_HEADER_RE.match(raw_lines[0]):
        raw_lines = raw_lines[1:]
    clean_body = "\n".join(raw_lines).strip()
    if not clean_body:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please paste at least 1 reference entry to verify."
                if is_en
                else "Vui lòng dán ít nhất 1 mục tài liệu tham khảo để kiểm tra."
            ),
        )

    # Consume 1 IP rate-limit token immediately after cheap empty & >1,500-char pre-checks,
    # BEFORE regex-intensive reference section parsing to prevent unauthenticated CPU abuse.
    _enforce_public_sandbox_rate_limit(request, is_en=is_en, consume=True)

    # Collapse a wrapped Author line + leading "(n.d.)" / "(Year)" line before _split_entries
    # so ReferenceListParser keeps a single 4-line wrapped (n.d.) reference intact.
    normalized_lines: list[str] = []
    for ln in raw_lines:
        if (
            normalized_lines
            and normalized_lines[-1]
            and ln
            and _GUEST_LEADING_PAREN_YEAR_OR_ND_RE.match(ln)
            and not _GUEST_PAREN_YEAR_OR_ND_RE.search(normalized_lines[-1])
            and not _GUEST_HAS_URL_OR_DOI_RE.search(normalized_lines[-1])
        ):
            normalized_lines[-1] = f"{normalized_lines[-1]} {ln}"
        else:
            normalized_lines.append(ln)
    normalized_body = "\n".join(normalized_lines).strip()

    fake_doc = Document(
        file_path="public_guest_sandbox.pdf",
        num_pages=1,
        pages=[
            Page(
                page_num=1,
                text=f"References\n{normalized_body}\n",
                has_text_layer=True,
            )
        ],
        parser_used="sandbox",
    )
    def _parse_guest_refs_sync() -> tuple[list[str], list[Citation]]:
        splits = pipeline.ref_parser._split_entries(f"References\n{normalized_body}\n")
        parsed = pipeline.ref_parser.parse_reference_section(fake_doc)
        return splits, parsed

    split_entries, parsed_citations = await asyncio.to_thread(_parse_guest_refs_sync)

    boundary_estimate = _estimate_guest_reference_boundaries(raw_lines)
    estimated_reference_count = max(
        boundary_estimate,
        len(split_entries),
        len(parsed_citations),
    )

    if estimated_reference_count > PUBLIC_SANDBOX_MAX_REFERENCES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Instant guest check supports up to {PUBLIC_SANDBOX_MAX_REFERENCES} references at a time. "
                "Create a free account to upload and verify your full PDF, Word, or BibTeX manuscript."
                if is_en
                else (
                    f"Bản kiểm tra nhanh hỗ trợ tối đa {PUBLIC_SANDBOX_MAX_REFERENCES} trích dẫn mỗi lượt. "
                    "Hãy tạo tài khoản miễn phí để tải lên và kiểm tra toàn bộ file PDF, Word hoặc BibTeX của bạn."
                )
            ),
        )

    if not parsed_citations:
        candidate_entries = [e.strip() for e in split_entries if len(e.strip()) >= 8]
        if not candidate_entries:
            joined_single = " ".join(ln for ln in normalized_lines if ln).strip()
            candidate_entries = [joined_single] if len(joined_single) >= 8 else []
        if not candidate_entries:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Please enter a complete citation (author, year, and title) to verify."
                    if is_en
                    else "Vui lòng nhập đầy đủ thông tin trích dẫn (tác giả, năm và tiêu đề) để kiểm tra."
                ),
            )
        for entry_text in candidate_entries[:PUBLIC_SANDBOX_MAX_REFERENCES]:
            doi_m = _SANDBOX_BARE_DOI_RE.search(entry_text)
            extracted_doi = doi_m.group(1).rstrip(".,;)]>\"'") if doi_m else None
            parsed_citations.append(
                Citation(
                    raw_text=entry_text,
                    citation_type=CitationType.REFERENCE_LIST,
                    style=CitationStyle.IEEE if style == "ieee" else CitationStyle.APA,
                    doi=extracted_doi,
                    page_num=1,
                    mapping_status="not_applicable",
                    mapping_confidence=0.0,
                )
            )

    parsed_citations = parsed_citations[:PUBLIC_SANDBOX_MAX_REFERENCES]
    for c in parsed_citations:
        if not c.doi and c.raw_text:
            doi_m = _SANDBOX_BARE_DOI_RE.search(c.raw_text)
            if doi_m:
                c.doi = doi_m.group(1).rstrip(".,;)]>\"'")
        c.mapping_status = "not_applicable"
        c.mapping_confidence = 0.0
    layer1_statuses = [
        {
            "status": "not_applicable",
            "note": (
                "Direct bibliography verification (in-text linking not applicable)."
                if is_en
                else "Kiểm tra trực tiếp danh mục tham khảo (không áp dụng đối chiếu trong bài)."
            ),
        }
        for _ in parsed_citations
    ]

    return await _execute_instant_citations_verification(
        pipeline=pipeline,
        parsed_citations=parsed_citations,
        layer1_statuses=layer1_statuses,
        style=style,
        allow_serpapi_flag=False,
        include_remediation=True,
        t0=t0,
        is_en=is_en,
        is_bibliography_only=True,
    )

