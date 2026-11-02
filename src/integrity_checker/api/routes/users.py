"""User management routes (admin + self-service).

Admin endpoints under ``/api/users`` (CRUD for all users) require admin role.
Self-service endpoints under ``/api/users/me`` allow any authenticated user
to view/update their own profile, upload avatar, change password.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, EmailStr, Field

from integrity_checker.api.deps import get_current_user, get_db, require_admin
from integrity_checker.api.routes.auth import (
    _create_token,
    _dispatch_email_task,
    _ensure_utc,
    _hash_password,
    _is_reserved_username,
    _is_valid_username_format,
    _verify_password,
)
from integrity_checker.api.services.avatar_service import get_avatar_service
from integrity_checker.api.services.email_service import get_email_service
from integrity_checker.billing.plans import PLAN_TIERS, get_user_subscription_summary
from integrity_checker.config import get_settings, is_test_runtime
from integrity_checker.db.models import VALID_USER_ROLES, User
from integrity_checker.db.repository import Repository

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------- Schemas ----------


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=128)
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=120)
    role: str = "user"
    is_active: bool = True
    institution: str | None = Field(default=None, max_length=255)
    can_override_verdicts: bool | None = None
    plan_tier: str | None = None


class UserUpdate(BaseModel):
    """Admin full-update — all fields optional except what's being changed."""

    username: str | None = Field(default=None, min_length=3, max_length=50)
    password: str | None = Field(default=None, min_length=6, max_length=128)
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=120)
    role: str | None = None
    is_active: bool | None = None
    institution: str | None = Field(default=None, max_length=255)
    can_override_verdicts: bool | None = None
    plan_tier: str | None = None


class UserSelfUpdate(BaseModel):
    """Self-service profile update — allows one-time username setup for Google accounts."""

    username: str | None = Field(default=None, min_length=3, max_length=50)
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=120)
    complete_onboarding: bool | None = None


class PasswordChange(BaseModel):
    current_password: str | None = None
    new_password: str = Field(min_length=6, max_length=128)


class PasswordSetupEmailRequest(BaseModel):
    lang: str = "vi"


class PasswordChangeResponse(BaseModel):
    message: str
    token: str | None = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: str | None
    full_name: str | None
    role: str
    is_active: bool
    email_verified: bool = True
    auth_provider: str = "local"
    google_linked: bool = False
    has_password: bool = True
    can_set_username: bool = False
    needs_onboarding: bool = False
    avatar_url: str | None
    last_login_at: str | None
    created_at: str | None
    institution: str | None = None
    can_override_verdicts: bool = False
    plan_tier: str = "basic"
    billing_cycle: str | None = None
    subscription_status: str = "active"
    cancel_at_period_end: bool = False
    current_period_end: str | None = None
    quota: dict | None = None


class MessageResponse(BaseModel):
    message: str


# ---------- Helpers ----------


def _to_response(user: User) -> UserResponse:
    sub = get_user_subscription_summary(user)
    provider = getattr(user, "auth_provider", None) or "local"
    google_linked = bool(getattr(user, "google_id", None)) or ("google" in provider)
    username_customized = bool(getattr(user, "username_customized", True))
    has_password = "local" in provider
    can_set_username = google_linked and not username_customized
    needs_onboarding = (provider == "google") and not username_customized
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=bool(user.is_active),
        email_verified=bool(getattr(user, "email_verified", True)),
        auth_provider=provider,
        google_linked=google_linked,
        has_password=has_password,
        can_set_username=can_set_username,
        needs_onboarding=needs_onboarding,
        avatar_url=user.avatar_path,
        last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
        created_at=user.created_at.isoformat() if user.created_at else None,
        institution=user.institution,
        can_override_verdicts=bool(user.can_override_verdicts),
        plan_tier=sub["plan_tier"],
        billing_cycle=sub["billing_cycle"],
        subscription_status=sub["subscription_status"],
        cancel_at_period_end=sub["cancel_at_period_end"],
        current_period_end=sub["current_period_end"],
        quota=sub["quota"],
    )


# ---------- Admin endpoints (existing, extended) ----------


@router.get("", response_model=list[UserResponse])
def list_users(
    admin: User = Depends(require_admin),
    db=Depends(get_db),
):
    """List all users (admin only)."""
    repo = Repository(db)
    users = repo.get_all_users()
    return [_to_response(u) for u in users]


@router.post("", response_model=UserResponse)
def create_user(
    request: UserCreate,
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    admin: User = Depends(require_admin),
    db=Depends(get_db),
):
    """Create new user (admin only)."""
    repo = Repository(db)

    if repo.get_user_by_username(request.username):
        raise HTTPException(status_code=400, detail="Username already exists")

    if request.email and repo.get_user_by_email(request.email):
        raise HTTPException(status_code=400, detail="Email already exists")

    if request.role not in VALID_USER_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Role must be one of {list(VALID_USER_ROLES)}",
        )
    if request.plan_tier is not None and request.plan_tier not in PLAN_TIERS:
        raise HTTPException(
            status_code=400,
            detail=f"plan_tier must be one of {list(PLAN_TIERS)}",
        )

    password_hash = _hash_password(request.password)
    user = repo.create_user(
        username=request.username,
        password_hash=password_hash,
        role=request.role,
        email=request.email,
        full_name=request.full_name,
        is_active=request.is_active,
        institution=request.institution,
        can_override_verdicts=request.can_override_verdicts,
        plan_tier=request.plan_tier,
    )
    raw_activation_token: str | None = None
    if request.email and not request.is_active:
        settings = get_settings()
        expires_at = datetime.now(UTC) + timedelta(
            hours=settings.auth.activation_expire_hours
        )
        raw_activation_token, _ = repo.create_auth_token(
            user.id, "activation", expires_at
        )
    repo.commit()
    if request.email and raw_activation_token is not None:
        _dispatch_email_task(
            background_tasks,
            get_email_service().send_activation_email,
            to_email=str(request.email),
            username=user.username,
            full_name=user.full_name,
            raw_token=raw_activation_token,
            institution=user.institution,
            lang="vi",
        )
    return _to_response(user)


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    request: UserUpdate,
    admin: User = Depends(require_admin),
    db=Depends(get_db),
):
    """Update user (admin only)."""
    repo = Repository(db)

    existing = repo.get_user_by_id(user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")

    update_data: dict = {}

    if request.username is not None and request.username != existing.username:
        dup = repo.get_user_by_username(request.username)
        if dup and dup.id != user_id:
            raise HTTPException(status_code=400, detail="Username already exists")
        update_data["username"] = request.username

    if request.email is not None and request.email != existing.email:
        dup = repo.get_user_by_email(request.email)
        if dup and dup.id != user_id:
            raise HTTPException(status_code=400, detail="Email already exists")
        update_data["email"] = request.email

    if request.full_name is not None:
        update_data["full_name"] = request.full_name

    if request.role is not None:
        if request.role not in VALID_USER_ROLES:
            raise HTTPException(
                status_code=400,
                detail=f"Role must be one of {list(VALID_USER_ROLES)}",
            )
        # Prevent admin from demoting themselves or another admin away from
        # the only admin account — would lock them out of the system.
        if existing.role == "admin" and request.role != "admin":
            if existing.id == admin.id:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot demote yourself from admin",
                )
            # Count remaining active admins; if this would be the last one, refuse.
            active_admins = [
                u for u in repo.get_all_users() if u.role == "admin" and u.is_active
            ]
            if len(active_admins) <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot demote the last active admin",
                )
        update_data["role"] = request.role

    if request.is_active is not None:
        if not request.is_active and existing.id == admin.id:
            raise HTTPException(
                status_code=400,
                detail="Cannot deactivate your own account",
            )
        update_data["is_active"] = request.is_active

    if request.institution is not None:
        update_data["institution"] = request.institution

    if request.can_override_verdicts is not None:
        update_data["can_override_verdicts"] = request.can_override_verdicts

    if request.plan_tier is not None:
        if request.plan_tier not in PLAN_TIERS:
            raise HTTPException(
                status_code=400,
                detail=f"plan_tier must be one of {list(PLAN_TIERS)}",
            )
        update_data["plan_tier"] = request.plan_tier

    if request.password is not None:
        update_data["password_hash"] = _hash_password(request.password)

    user = repo.update_user(user_id, **update_data)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if (
        request.is_active is False
        or request.password is not None
        or request.role is not None
    ):
        repo.delete_user_sessions(user_id)
    repo.commit()
    return _to_response(user)


@router.delete("/{user_id}", response_model=MessageResponse)
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db=Depends(get_db),
):
    """Delete user (admin only). Cannot delete yourself."""
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    repo = Repository(db)
    user = repo.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Best-effort: clean up avatar file
    if user.avatar_path:
        get_avatar_service().delete(user.avatar_path)

    success = repo.delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    repo.commit()
    return MessageResponse(message=f"User {user_id} deleted")


# ---------- Self-service endpoints ----------


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get current user full profile."""
    return _to_response(current_user)


@router.patch("/me", response_model=UserResponse)
def update_me(
    request: UserSelfUpdate,
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    """Update own profile (and allow one-time username customization for Google accounts)."""
    repo = Repository(db)

    update_data: dict = {}
    provider = getattr(current_user, "auth_provider", None) or "local"
    google_linked = bool(getattr(current_user, "google_id", None)) or ("google" in provider)
    can_set_username = google_linked and not bool(getattr(current_user, "username_customized", True))

    if request.username is not None:
        new_username = request.username.strip()
        if not _is_valid_username_format(new_username):
            raise HTTPException(
                status_code=400,
                detail="Username must be 3-50 characters, start and end with a letter or number, and contain only letters, numbers, dots, underscores, or hyphens.",
            )
        if new_username != current_user.username:
            if not can_set_username:
                raise HTTPException(
                    status_code=400,
                    detail="Username cannot be changed after initial setup.",
                )
            dup_user = repo.get_user_by_username(new_username)
            if (dup_user and dup_user.id != current_user.id) or _is_reserved_username(new_username):
                raise HTTPException(status_code=400, detail="Username already exists")
            update_data["username"] = new_username
            update_data["username_customized"] = True
            update_data["google_onboarded"] = True
        elif can_set_username:
            update_data["username_customized"] = True
            update_data["google_onboarded"] = True

    if request.complete_onboarding:
        update_data["username_customized"] = True
        update_data["google_onboarded"] = True

    email_changed_to: str | None = None
    if request.email is not None:
        normalized_email = str(request.email).strip().lower()
        current_email = (current_user.email or "").strip().lower()
        if normalized_email != current_email:
            if google_linked and current_email:
                raise HTTPException(
                    status_code=400,
                    detail="Email address is linked to Google Sign-In and cannot be changed.",
                )
            dup = repo.get_user_by_email(normalized_email)
            if dup and dup.id != current_user.id:
                raise HTTPException(status_code=400, detail="Email already exists")
            update_data["email"] = normalized_email
            update_data["email_verified"] = False
            email_changed_to = normalized_email

    if request.full_name is not None:
        update_data["full_name"] = request.full_name.strip()

    if update_data:
        user = repo.update_user(current_user.id, **update_data)
        raw_activation_token: str | None = None
        if email_changed_to is not None:
            settings = get_settings()
            expires_at = datetime.now(UTC) + timedelta(
                hours=settings.auth.activation_expire_hours
            )
            raw_activation_token, _ = repo.create_auth_token(
                current_user.id, "activation", expires_at
            )
        repo.commit()
        if email_changed_to is not None and raw_activation_token is not None:
            target_user = user or current_user
            _dispatch_email_task(
                background_tasks,
                get_email_service().send_activation_email,
                to_email=email_changed_to,
                username=target_user.username,
                full_name=target_user.full_name,
                raw_token=raw_activation_token,
                institution=target_user.institution,
                lang="vi",
            )
        if user:
            return _to_response(user)

    return _to_response(current_user)


@router.post("/me/avatar", response_model=UserResponse)
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    """Upload avatar for the current user. Max 2MB, JPG/PNG/WEBP only."""
    from integrity_checker.api.services.avatar_service import MAX_BYTES

    avatar_svc = get_avatar_service()
    mime = file.content_type or ""

    # Read in bounded chunks up to MAX_BYTES + 1 to prevent memory exhaustion
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Avatar file too large. Max size is {MAX_BYTES} bytes (2MB)",
            )
        chunks.append(chunk)
    content = b"".join(chunks)

    try:
        avatar_svc.validate(mime, len(content), content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    avatar_url = avatar_svc.save(current_user.id, content, mime)

    repo = Repository(db)
    user = repo.update_user(current_user.id, avatar_path=avatar_url)
    repo.commit()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _to_response(user)


@router.delete("/me/avatar", response_model=UserResponse)
def delete_my_avatar(
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    """Remove current user's avatar."""
    if current_user.avatar_path:
        get_avatar_service().delete(current_user.avatar_path)

    repo = Repository(db)
    user = repo.update_user(current_user.id, avatar_path=None)
    repo.commit()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _to_response(user)


@router.post("/me/password", response_model=PasswordChangeResponse)
def change_my_password(
    request: PasswordChange,
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    """Change or set current user's password.

    - If the user already has a local password (`has_password=True`), `current_password` is required.
    - If the user signed in via Google only (`auth_provider=='google'`), `current_password` is not required
      for setting their initial password, and `auth_provider` is upgraded to `'local,google'`.
    """
    provider = getattr(current_user, "auth_provider", None) or "local"
    has_password = "local" in provider

    if has_password:
        if not request.current_password or not _verify_password(
            request.current_password, current_user.password_hash
        ):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        if request.new_password == request.current_password:
            raise HTTPException(
                status_code=400, detail="New password must be different from current"
            )

    repo = Repository(db)
    update_fields: dict = {"password_hash": _hash_password(request.new_password)}
    if not has_password:
        update_fields["auth_provider"] = (
            "local,google" if "google" in provider else "local"
        )
        update_fields["google_onboarded"] = True
    updated_user = repo.update_user(current_user.id, **update_fields) or current_user
    repo.delete_user_sessions(current_user.id)
    new_token, expires_at = _create_token(updated_user)
    repo.create_session(current_user.id, new_token, expires_at)
    repo.session.flush()
    repo.commit()
    return PasswordChangeResponse(
        message="Password changed successfully",
        token=new_token,
    )


@router.post("/me/password-setup-email", response_model=MessageResponse)
def send_my_password_setup_email(
    request: PasswordSetupEmailRequest | None = None,
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    current_user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    """Send a password setup / reset link to the current authenticated user's email address."""
    if not current_user.email:
        raise HTTPException(
            status_code=400,
            detail="Your account does not have an email address configured.",
        )

    lang = request.lang if request else "vi"
    repo = Repository(db)
    now = datetime.now(UTC)
    if not is_test_runtime():
        latest = repo.get_latest_auth_token_for_user(current_user.id, "password_reset")
        if latest and (now - _ensure_utc(latest.created_at)).total_seconds() < 30:
            raise HTTPException(
                status_code=429,
                detail="Please wait 30 seconds before requesting another password setup email.",
            )

    provider = getattr(current_user, "auth_provider", None) or "local"
    is_initial_google = "local" not in provider
    settings = get_settings()
    expires_at = (
        now + timedelta(hours=24)
        if is_initial_google
        else now + timedelta(minutes=settings.auth.reset_expire_minutes)
    )
    raw_token, _ = repo.create_auth_token(current_user.id, "password_reset", expires_at)
    repo.commit()

    email_svc = get_email_service()
    if is_initial_google:
        _dispatch_email_task(
            background_tasks,
            email_svc.send_google_welcome_email,
            to_email=current_user.email,
            username=current_user.username,
            full_name=current_user.full_name,
            raw_token=raw_token,
            lang=lang,
        )
    else:
        _dispatch_email_task(
            background_tasks,
            email_svc.send_password_reset_email,
            to_email=current_user.email,
            username=current_user.username,
            full_name=current_user.full_name,
            raw_token=raw_token,
            lang=lang,
        )

    return MessageResponse(
        message=f"A password setup link has been sent to {current_user.email}."
    )
