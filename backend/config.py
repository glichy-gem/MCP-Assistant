"""Persistent config store: app settings + MCP servers.

Backed by backend/connections.json (git-ignored). First run migrates the MCP
server from mcp/.env. The LLM's Groq API key lives in backend/.env.

Model:
  app_settings: { groq_model? }   # optional Groq model override
  mcp_servers:  each reached via endpoint + api_key.

Secret handling:
  - Full secrets live in the file and in-memory.
  - `redacted=True` (default) masks secret fields as `•••••<last4>`.
  - PATCH treats a blank secret value as "keep existing".
"""

from __future__ import annotations

import json
import os
import re
import secrets as _secrets
import tempfile
import threading
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
CONFIG_FILE = BACKEND_DIR / "connections.json"

MCP_SECRETS = ("api_key",)

_lock = threading.Lock()
_state: dict[str, Any] = {
    "app_settings": {},
    "mcp_servers": [],
}
_loaded = False


# --- utilities ------------------------------------------------------------

def _mkid(prefix: str) -> str:
    return f"{prefix}_{_secrets.token_hex(4)}"


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s or "srv"


def _redact_value(v: str) -> str:
    if not v:
        return ""
    last = v[-4:] if len(v) > 4 else v
    return f"•••••{last}"


def _redact_entry(entry: dict, secret_keys) -> dict:
    out = {**entry}
    for k in secret_keys:
        if k in out and out[k]:
            out[k] = _redact_value(str(out[k]))
    return out


# --- migration + load/save -----------------------------------------------

def _migrate_from_env() -> dict:
    """Build an initial state from mcp/.env (LLM creds stay in backend/.env)."""
    from dotenv import dotenv_values

    mcp_env = dotenv_values(ROOT_DIR / "mcp" / ".env")

    servers: list[dict] = []
    if mcp_env.get("MCP_ENDPOINT") and mcp_env.get("MCP_API_KEY"):
        servers.append(
            {
                "id": _mkid("srv"),
                "name": "ServiceNow MCP",
                "endpoint": mcp_env["MCP_ENDPOINT"],
                "auth_header": mcp_env.get("MCP_AUTH_HEADER", "X-API-Key"),
                "api_key": mcp_env["MCP_API_KEY"],
                "enabled": True,
            }
        )

    return {"app_settings": {}, "mcp_servers": servers}


def _normalize_state() -> None:
    """Ensure required keys/fields exist; drop retired keys (accounts, cloud, azure)."""
    _state.setdefault("app_settings", {})
    # Retire the cloud-provider concept (feature removed).
    _state["app_settings"].pop("selected_cloud", None)
    # Retire Azure LLM provider (Groq only).
    _state["app_settings"].pop("llm_provider", None)
    _state["app_settings"].pop("azure_deployment", None)

    # Retire the accounts store (feature removed).
    _state.pop("accounts", None)
    _state.pop("cloud_connections", None)

    _state.setdefault("mcp_servers", [])
    for s in _state["mcp_servers"]:
        s.pop("provider", None)     # cloud provider retired
        s.pop("account_id", None)   # link retired


def _save_locked() -> None:
    tmp = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", delete=False, dir=str(BACKEND_DIR), prefix=".connections.", suffix=".tmp"
    )
    try:
        json.dump(_state, tmp, indent=2)
        tmp.flush()
        tmp.close()
        os.replace(tmp.name, CONFIG_FILE)
    except Exception:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass
        raise


def load() -> dict:
    """Read the config from disk (or migrate + create it on first run)."""
    global _state, _loaded
    with _lock:
        if CONFIG_FILE.exists():
            try:
                _state = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
                _normalize_state()
                _save_locked()  # persist any migrations
            except Exception:
                CONFIG_FILE.rename(CONFIG_FILE.with_suffix(".bad"))
                _state = _migrate_from_env()
                _save_locked()
        else:
            _state = _migrate_from_env()
            _save_locked()
        _loaded = True
    return _state


def save() -> None:
    with _lock:
        _save_locked()


def state() -> dict:
    if not _loaded:
        load()
    return _state


# --- App settings --------------------------------------------------------

def get_groq_model() -> str | None:
    """The user-selected Groq model (None = use the .env default)."""
    return state()["app_settings"].get("groq_model") or None


def set_groq_model(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError("model name is required")
    with _lock:
        _state["app_settings"]["groq_model"] = name
        _save_locked()
    return name


# --- MCP servers ---------------------------------------------------------

def mcp_servers(redacted: bool = True) -> list[dict]:
    rows = state()["mcp_servers"]
    if redacted:
        return [_redact_entry(s, MCP_SECRETS) for s in rows]
    return [dict(s) for s in rows]


def mcp_server_by_id(id_: str) -> dict | None:
    for s in state()["mcp_servers"]:
        if s["id"] == id_:
            return s
    return None


def server_slug(server: dict) -> str:
    return _slugify(server.get("name", ""))


def add_mcp_server(payload: dict) -> dict:
    name = (payload.get("name") or "").strip()
    endpoint = (payload.get("endpoint") or "").strip()
    api_key = (payload.get("api_key") or "").strip()
    auth_header = (payload.get("auth_header") or "X-API-Key").strip() or "X-API-Key"
    if not name or not endpoint or not api_key:
        raise ValueError("name, endpoint, and api_key are required")
    with _lock:
        entry = {
            "id": _mkid("srv"),
            "name": name,
            "endpoint": endpoint,
            "auth_header": auth_header,
            "api_key": api_key,
            "enabled": bool(payload.get("enabled", True)),
        }
        _state["mcp_servers"].append(entry)
        _save_locked()
    return _redact_entry(entry, MCP_SECRETS)


def patch_mcp_server(id_: str, payload: dict) -> dict:
    with _lock:
        entry = next((s for s in _state["mcp_servers"] if s["id"] == id_), None)
        if not entry:
            raise KeyError(id_)
        for k in ("name", "endpoint", "auth_header"):
            if k in payload and payload[k] is not None:
                val = str(payload[k]).strip()
                if val:
                    entry[k] = val
        if "api_key" in payload and payload["api_key"]:
            entry["api_key"] = str(payload["api_key"]).strip()
        if "enabled" in payload:
            entry["enabled"] = bool(payload["enabled"])
        _save_locked()
        return _redact_entry(entry, MCP_SECRETS)


def delete_mcp_server(id_: str) -> None:
    with _lock:
        before = len(_state["mcp_servers"])
        _state["mcp_servers"] = [s for s in _state["mcp_servers"] if s["id"] != id_]
        if len(_state["mcp_servers"]) == before:
            raise KeyError(id_)
        _save_locked()
