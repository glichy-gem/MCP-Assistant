"""User store backed by PostgreSQL (RBAC).

Public surface is unchanged from the previous JSON implementation so auth.py and
app.py keep working: load(), list_users(), get_user(), get_user_full(),
find_by_username(), verify_credentials(), add_user(), patch_user(), delete_user().

Passwords are bcrypt hashes (auth.py). The store is seeded on first run with a
single super_admin from ADMIN_USER / ADMIN_PASSWORD; if the users table is empty
and no seed password is set, the app refuses to start (so it can never come up
open). Google users will have a null password_hash and auth_provider='google'.
"""

from __future__ import annotations

import os
import secrets as _secrets
import sys
from datetime import datetime
from typing import Any

import psycopg

import auth as _auth
import db

VALID_ROLES = ("user", "admin", "super_admin")
SECRET_FIELDS = ("password_hash",)

# Columns exposed through the API (never password_hash).
_PUBLIC_COLS = (
    "id, username, email, display_name, role, is_active, is_seed, created_at"
)


def _mkid() -> str:
    return f"usr_{_secrets.token_hex(4)}"


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _redact(row: dict | None) -> dict | None:
    if row is None:
        return None
    out = {k: _iso(v) for k, v in row.items() if k not in SECRET_FIELDS}
    return out


def _seed_admin_or_fail() -> None:
    """Insert the initial super_admin from ADMIN_USER/ADMIN_PASSWORD, or exit."""
    admin_name = (os.environ.get("ADMIN_USER") or "admin").strip() or "admin"
    admin_pw = (os.environ.get("ADMIN_PASSWORD") or "").strip()
    if not admin_pw:
        sys.stderr.write(
            "\n[users] The Postgres users table is empty and ADMIN_PASSWORD is not set.\n"
            "        The app refuses to start without a seeded super_admin so it can never\n"
            "        come up open. Set ADMIN_PASSWORD in backend/.env (and optionally\n"
            "        ADMIN_USER, default 'admin'), then start again. After the first run\n"
            "        these env vars are ignored.\n\n"
        )
        raise SystemExit(1)
    db.execute(
        f"""
        INSERT INTO users (id, username, display_name, email, role,
                           password_hash, is_seed, auth_provider)
        VALUES (%s, %s, %s, %s, 'super_admin', %s, true, 'local')
        """,
        (_mkid(), admin_name, "Admin", None, _auth.hash_password(admin_pw)),
    )
    sys.stderr.write(
        f"\n[users] Seeded super_admin '{admin_name}'. Log in with the password from\n"
        f"        ADMIN_PASSWORD, then rotate it out of .env.\n\n"
    )


def load() -> dict:
    """Ensure the schema exists and a super_admin is seeded. Idempotent."""
    db.init_schema()
    count = db.fetch_one("SELECT count(*) AS n FROM users")["n"]
    if count == 0:
        _seed_admin_or_fail()
    return {"ready": True}


# --- accessors -----------------------------------------------------------

def list_users(redacted: bool = True) -> list[dict]:
    cols = _PUBLIC_COLS if redacted else _PUBLIC_COLS + ", password_hash"
    rows = db.fetch_all(f"SELECT {cols} FROM users ORDER BY created_at, username")
    if redacted:
        return [_redact(r) for r in rows]
    return [{k: _iso(v) for k, v in r.items()} for r in rows]


def get_user(user_id: str) -> dict | None:
    """Redacted current user; only active accounts resolve (deactivated => None)."""
    row = db.fetch_one(
        f"SELECT {_PUBLIC_COLS} FROM users WHERE id = %s AND is_active",
        (user_id,),
    )
    return _redact(row)


def get_user_full(user_id: str) -> dict | None:
    """Non-redacted, for internal use only."""
    row = db.fetch_one(
        f"SELECT {_PUBLIC_COLS}, password_hash FROM users WHERE id = %s",
        (user_id,),
    )
    if row is None:
        return None
    return {k: _iso(v) for k, v in row.items()}


def find_by_username(username: str) -> dict | None:
    """Return the FULL user record (with hash) — internal use only."""
    if not username:
        return None
    row = db.fetch_one(
        f"SELECT {_PUBLIC_COLS}, password_hash FROM users WHERE lower(username) = lower(%s)",
        (username.strip(),),
    )
    if row is None:
        return None
    return {k: _iso(v) for k, v in row.items()}


def verify_credentials(username: str, password: str) -> dict | None:
    """Return the redacted user on success, else None. Rejects inactive accounts."""
    u = find_by_username(username)
    if not u or not u.get("is_active", True):
        return None
    if not _auth.verify_password(password, u.get("password_hash") or ""):
        return None
    return _redact(u)


def find_by_external_id(external_id: str) -> dict | None:
    """Look up a user by their Google subject (sub) claim. Redacted."""
    if not external_id:
        return None
    row = db.fetch_one(
        f"SELECT {_PUBLIC_COLS} FROM users WHERE external_id = %s", (external_id,)
    )
    return _redact(row)


def find_by_email(email: str) -> dict | None:
    """Look up a user by email (case-insensitive). Redacted."""
    if not email:
        return None
    row = db.fetch_one(
        f"SELECT {_PUBLIC_COLS} FROM users WHERE lower(email) = lower(%s)",
        (email.strip(),),
    )
    return _redact(row)


def upsert_google_user(
    sub: str,
    email: str | None,
    display_name: str | None,
    allow_create: bool = True,
) -> dict | None:
    """Resolve (or optionally create) the local user for a Google login.

    Match order: existing Google link (external_id) -> existing account by email
    (link it to Google) -> otherwise, only if `allow_create` (sign-up), JIT-create
    as role 'user' with that role's default tools. Roles are app-owned: Google never
    changes an existing role. When there is no match and `allow_create` is False
    (a sign-in of someone who never signed up), returns **None** so the caller can
    reject. Raises PermissionError if the matched account is deactivated.
    """
    if not sub:
        raise ValueError("Google token is missing the 'sub' claim")

    existing = find_by_external_id(sub)
    if existing:
        if not existing.get("is_active", True):
            raise PermissionError("This account has been deactivated.")
        return existing

    # Link an already-provisioned local account (matched by email) to Google.
    if email:
        by_email = db.fetch_one(
            f"SELECT {_PUBLIC_COLS} FROM users WHERE lower(email) = lower(%s)",
            (email.strip(),),
        )
        if by_email:
            if not by_email.get("is_active", True):
                raise PermissionError("This account has been deactivated.")
            db.execute(
                "UPDATE users SET external_id = %s, auth_provider = 'google', updated_at = now() "
                "WHERE id = %s",
                (sub, by_email["id"]),
            )
            return get_user(by_email["id"])

    # No existing account. Only sign-up (allow_create) may provision one.
    if not allow_create:
        return None

    # JIT provision a brand-new user (sign-up).
    user_id = _mkid()
    uname = (email or f"google_{sub[:8]}").strip()
    dname = (display_name or email or uname).strip()
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (id, username, display_name, email, role,
                                   password_hash, is_seed, auth_provider, external_id)
                VALUES (%s, %s, %s, %s, 'user', NULL, false, 'google', %s)
                """,
                (user_id, uname, dname, email, sub),
            )
            cur.execute(
                """
                INSERT INTO user_tools (user_id, tool_id, granted_by)
                SELECT %s, tool_id, 'role_default' FROM role_defaults WHERE role = 'user'
                ON CONFLICT DO NOTHING
                """,
                (user_id,),
            )
    return get_user(user_id)


# --- mutators ------------------------------------------------------------

def add_user(payload: dict) -> dict:
    username = (payload.get("username") or "").strip()
    display_name = (payload.get("display_name") or username).strip()
    email = (payload.get("email") or "").strip() or None
    role = (payload.get("role") or "user").strip()
    password = payload.get("password") or ""
    if not username:
        raise ValueError("username is required")
    if not password:
        raise ValueError("password is required")
    if role not in VALID_ROLES:
        raise ValueError(f"role must be one of: {', '.join(VALID_ROLES)}")

    user_id = _mkid()
    try:
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (id, username, display_name, email, role,
                                       password_hash, is_seed, auth_provider)
                    VALUES (%s, %s, %s, %s, %s, %s, false, 'local')
                    """,
                    (user_id, username, display_name, email, role,
                     _auth.hash_password(password)),
                )
                # Pre-fill this user's tools from the role default template.
                cur.execute(
                    """
                    INSERT INTO user_tools (user_id, tool_id, granted_by)
                    SELECT %s, tool_id, 'role_default' FROM role_defaults WHERE role = %s
                    ON CONFLICT DO NOTHING
                    """,
                    (user_id, role),
                )
    except psycopg.errors.UniqueViolation:
        raise ValueError(f"username or email already exists")

    return get_user(user_id)


def patch_user(user_id: str, payload: dict) -> dict:
    row = db.fetch_one(
        f"SELECT {_PUBLIC_COLS} FROM users WHERE id = %s", (user_id,)
    )
    if row is None:
        raise KeyError(user_id)

    sets: list[str] = []
    params: list[Any] = []

    if payload.get("username"):
        sets.append("username = %s")
        params.append(str(payload["username"]).strip())
    if payload.get("display_name") is not None and "display_name" in payload:
        sets.append("display_name = %s")
        params.append(str(payload["display_name"]).strip())
    if "email" in payload:
        email = (str(payload["email"]).strip() or None) if payload["email"] else None
        sets.append("email = %s")
        params.append(email)
    if payload.get("role"):
        r = str(payload["role"]).strip()
        if r not in VALID_ROLES:
            raise ValueError(f"role must be one of: {', '.join(VALID_ROLES)}")
        # Prevent demoting the last remaining super_admin.
        if row["role"] == "super_admin" and r != "super_admin":
            others = db.fetch_one(
                "SELECT count(*) AS n FROM users WHERE id <> %s AND role = 'super_admin' AND is_active",
                (user_id,),
            )["n"]
            if others == 0:
                raise ValueError("Cannot demote the last super_admin. Promote another user first.")
        sets.append("role = %s")
        params.append(r)
    if payload.get("password"):
        sets.append("password_hash = %s")
        params.append(_auth.hash_password(str(payload["password"])))

    if sets:
        sets.append("updated_at = now()")
        params.append(user_id)
        try:
            db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = %s", tuple(params))
        except psycopg.errors.UniqueViolation:
            raise ValueError("username or email already exists")

    return get_user(user_id)


def delete_user(user_id: str) -> None:
    row = db.fetch_one(
        "SELECT id, role, is_seed FROM users WHERE id = %s", (user_id,)
    )
    if row is None:
        raise KeyError(user_id)
    if row["is_seed"]:
        raise PermissionError("The seeded super_admin account cannot be deleted.")
    if row["role"] == "super_admin":
        others = db.fetch_one(
            "SELECT count(*) AS n FROM users WHERE id <> %s AND role = 'super_admin' AND is_active",
            (user_id,),
        )["n"]
        if others == 0:
            raise PermissionError("Cannot delete the last super_admin. Promote another user first.")
    db.execute("DELETE FROM users WHERE id = %s", (user_id,))
