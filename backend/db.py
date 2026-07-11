"""PostgreSQL access layer for the RBAC store.

A small, sync wrapper around a psycopg (v3) connection pool. The rest of the
backend (users.py, rbac.py) calls the helpers here; queries are single-row and
fast, so calling them synchronously from async routes matches how the previous
JSON stores already behaved.

Connection details come from the environment:
    POSTGRES_HOST / PORT / USER / PASSWORD / DB / SSLMODE
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def _conninfo() -> str:
    host = os.environ.get("POSTGRES_HOST")
    if not host:
        raise RuntimeError(
            "POSTGRES_HOST is not set - the RBAC store needs a Postgres connection. "
            "Fill the POSTGRES_* values in backend/.env."
        )
    return make_conninfo(
        host=host,
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        user=os.environ.get("POSTGRES_USER"),
        password=os.environ.get("POSTGRES_PASSWORD"),
        dbname=os.environ.get("POSTGRES_DB"),
        sslmode=os.environ.get("POSTGRES_SSLMODE", "require"),
    )


def get_pool() -> ConnectionPool:
    """Lazily create and open the shared connection pool."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ConnectionPool(
                    _conninfo(),
                    min_size=1,
                    max_size=5,
                    kwargs={"row_factory": dict_row},
                    # Serverless Postgres (e.g. Neon) suspends when idle and drops
                    # open connections. check_connection validates each connection
                    # on checkout (reconnecting dead ones), and max_idle recycles
                    # idle connections before the server times them out.
                    check=ConnectionPool.check_connection,
                    max_idle=120.0,
                    open=False,
                )
                _pool.open()
    return _pool


def close_pool() -> None:
    """Close the pool cleanly (used on shutdown / in scripts)."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


@contextmanager
def connection():
    """Yield a pooled connection (auto-commit on clean exit, rollback on error)."""
    with get_pool().connection() as conn:
        yield conn


def fetch_all(sql: str, params: tuple | list | dict | None = None) -> list[dict]:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def fetch_one(sql: str, params: tuple | list | dict | None = None) -> dict | None:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def execute(sql: str, params: tuple | list | dict | None = None) -> int:
    """Run a statement; return affected row count."""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount


# --------------------------------------------------------------------------- #
# Schema bootstrap
# --------------------------------------------------------------------------- #

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  username      text NOT NULL,
  email         text,
  display_name  text NOT NULL,
  password_hash text,
  role          text NOT NULL DEFAULT 'user'
                CHECK (role IN ('user','admin','super_admin')),
  is_active     boolean NOT NULL DEFAULT true,
  is_seed       boolean NOT NULL DEFAULT false,
  auth_provider text NOT NULL DEFAULT 'local',
  external_id   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower
  ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS tools (
  id             bigserial PRIMARY KEY,
  server_id      text NOT NULL,
  server_name    text NOT NULL,
  tool_name      text NOT NULL,
  qualified_name text NOT NULL,
  description    text,
  is_available   boolean NOT NULL DEFAULT true,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, tool_name)
);

CREATE TABLE IF NOT EXISTS user_tools (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id    bigint NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  granted_by text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tool_id)
);

CREATE TABLE IF NOT EXISTS role_defaults (
  role    text NOT NULL CHECK (role IN ('user','admin','super_admin')),
  tool_id bigint NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  PRIMARY KEY (role, tool_id)
);
"""


def init_schema() -> None:
    """Create the RBAC tables if they don't exist. Idempotent; safe every boot."""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA_SQL)
