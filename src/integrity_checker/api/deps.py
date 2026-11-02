"""FastAPI dependency injection - Extended with auth."""

from __future__ import annotations

import threading
from collections.abc import Generator
from datetime import UTC, datetime, timezone

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
    authorization: str = Header(..., description="Bearer token"),
    db: Session = Depends(get_db),
) -> User:
    """Decode JWT token and return current user."""
    token = get_token_from_header(authorization)
    settings = get_settings()

    try:
        payload = jwt.decode(token, settings.auth.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    try:
        user_id = int(user_id)  # Convert back from string
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Verify session exists and is not expired
    repo = Repository(db)
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
) -> User | None:
    """Return current user or None if not authenticated."""
    if not authorization:
        return None

    try:
        return get_current_user(authorization, db)
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
