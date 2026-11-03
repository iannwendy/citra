"""FastAPI dependency injection - Extended with auth."""

from __future__ import annotations

import threading
from collections.abc import Generator
from datetime import UTC, datetime

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from integrity_checker.config import get_settings
from integrity_checker.db.models import User
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

_pipeline_lock = threading.Lock()
_pipeline_singleton: IntegrityPipeline | None = None


def get_db() -> Generator[Session, None, None]:
    """Yield DB session, close sau khi xong."""
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def get_repository(session: Session = Depends(get_db)) -> Repository:
    if not isinstance(session, Session):
        session = get_session()
    return Repository(session)


def get_pipeline() -> IntegrityPipeline:
    """Singleton pipeline (lazy, thread-safe)."""
    global _pipeline_singleton
    if _pipeline_singleton is None:
        with _pipeline_lock:
            if _pipeline_singleton is None:
                _pipeline_singleton = IntegrityPipeline()
    return _pipeline_singleton


def reset_pipeline() -> None:
    """Reset cached pipeline singleton (for tests)."""
    global _pipeline_singleton
    with _pipeline_lock:
        _pipeline_singleton = None


def get_token_from_header(authorization: str) -> str:
    """Extract Bearer token from authorization header."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return authorization[7:].strip()


def get_current_user(
    authorization: str | None = Header(None, description="Bearer token"),
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> User:
    """Authenticate via JWT Bearer token or X-API-Key (`citra_live_...`) and return current user."""
    repo = Repository(db)

    raw_api_key = x_api_key.strip() if isinstance(x_api_key, str) else ""
    raw_auth = authorization.strip() if isinstance(authorization, str) else ""
    if not raw_api_key and raw_auth.startswith("Bearer citra_live_"):
        raw_api_key = raw_auth[7:].strip()

    if raw_api_key:
        api_key_row = repo.get_active_api_key_by_raw(raw_api_key)
        if not api_key_row:
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")
        user = db.get(User, api_key_row.user_id)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account is deactivated")
        now_utc = datetime.now(UTC)
        prev_used = api_key_row.last_used_at
        if prev_used is not None and prev_used.tzinfo is None:
            prev_used = prev_used.replace(tzinfo=UTC)
        if prev_used is None or (now_utc - prev_used).total_seconds() >= 60.0:
            api_key_row.last_used_at = now_utc
            db.commit()
        return user

    if not raw_auth:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = get_token_from_header(raw_auth)
    settings = get_settings()

    try:
        payload = jwt.decode(token, settings.auth.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_id = int(user_id)  # Convert back from string
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token payload") from exc

    # Verify session exists and is not expired
    session_record = repo.get_session_by_token(token)
    if not session_record:
        raise HTTPException(status_code=401, detail="Session not found")

    # Compare datetimes - handle naive vs aware
    now = datetime.now(UTC)
    expires_at = session_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    if expires_at < now:
        repo.delete_session(token)
        raise HTTPException(status_code=401, detail="Token expired")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        repo.delete_session(token)
        db.commit()
        raise HTTPException(status_code=403, detail="Account is deactivated")

    return user


def get_current_user_optional(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> User | None:
    """Return current user or None if not authenticated."""
    raw_auth = authorization.strip() if isinstance(authorization, str) else ""
    raw_key = x_api_key.strip() if isinstance(x_api_key, str) else ""
    if not raw_auth and not raw_key:
        return None

    try:
        return get_current_user(authorization, db, x_api_key=x_api_key)
    except HTTPException:
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Raise 403 if user is not admin."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_teacher(user: User = Depends(get_current_user)) -> User:
    """Raise 403 if user is not teacher or admin.

    Both teacher and admin can hit /api/teacher/* endpoints — admin acts
    as a global teacher with no class ownership restrictions.
    """
    if user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=403, detail="Teacher access required")
    return user
