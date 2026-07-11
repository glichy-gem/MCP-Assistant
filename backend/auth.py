"""Local authentication: bcrypt password hashing + signed session cookies.

Session tokens are `itsdangerous.URLSafeTimedSerializer` blobs holding the user id.
The cookie is HttpOnly + SameSite=Lax. TTL is 12h.
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Optional

import bcrypt
from fastapi import Cookie, Depends, HTTPException, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

HERE = Path(__file__).resolve().parent
SESSION_SECRET_FILE = HERE / ".session_secret"
SESSION_COOKIE = "snmcp_session"
SESSION_TTL_SECONDS = 12 * 60 * 60  # 12 hours


def _pw_bytes(plain: str) -> bytes:
    # bcrypt has a hard 72-byte cap on the input; truncate deterministically.
    return plain.encode("utf-8")[:72]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_pw_bytes(plain), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, password_hash: str) -> bool:
    if not plain or not password_hash:
        return False
    try:
        return bcrypt.checkpw(_pw_bytes(plain), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _load_or_create_secret() -> str:
    env_secret = (os.environ.get("SESSION_SECRET") or "").strip()
    if env_secret:
        return env_secret
    if SESSION_SECRET_FILE.exists():
        return SESSION_SECRET_FILE.read_text(encoding="utf-8").strip()
    # First run without an explicit secret: mint one and persist it.
    fresh = secrets.token_urlsafe(48)
    SESSION_SECRET_FILE.write_text(fresh, encoding="utf-8")
    try:
        SESSION_SECRET_FILE.chmod(0o600)  # tighten on POSIX; noop on Windows
    except Exception:
        pass
    return fresh


_SECRET = _load_or_create_secret()
_serializer = URLSafeTimedSerializer(_SECRET, salt="snmcp-session-v1")


def signing_secret() -> str:
    """The shared secret used for signing cookies (session + OAuth transaction)."""
    return _SECRET


def make_session_token(user_id: str) -> str:
    return _serializer.dumps({"uid": user_id})


def parse_session_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        data = _serializer.loads(token, max_age=SESSION_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict):
        return None
    uid = data.get("uid")
    return uid if isinstance(uid, str) else None


def set_session_cookie(response: Response, user_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        make_session_token(user_id),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,  # local dev on 127.0.0.1; flip to True behind HTTPS
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


# --- FastAPI dependencies ------------------------------------------------

def require_session(snmcp_session: Optional[str] = Cookie(default=None)):
    """Return the authenticated user dict, else 401."""
    import users  # local import to avoid a startup cycle

    user_id = parse_session_token(snmcp_session)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not signed in")
    user = users.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


def require_admin(user=Depends(require_session)):
    """Admin-or-above: manage MCP servers and cloud/model settings."""
    if user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def require_super_admin(user=Depends(require_session)):
    """Super-admin only: manage users, tool assignments, and role defaults."""
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super-admin role required")
    return user
