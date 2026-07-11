"""FastAPI backend for the ServiceNow MCP chat app.

Every /api/* route except /api/auth/* requires a signed-in session.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent          # Foundary/backend/
ROOT = HERE.parent                              # Foundary/
MCP_DIR = ROOT / "mcp"
FRONTEND_DIR = ROOT / "frontend"
BUILD_DIR = FRONTEND_DIR / "dist"

# Load env files for AZURE_OPENAI_ENDPOINT / ADMIN_PASSWORD / etc.
load_dotenv(MCP_DIR / ".env")
load_dotenv(HERE / ".env", override=True)

sys.path.insert(0, str(MCP_DIR))
from mcp_client import connect  # noqa: E402

import agent  # noqa: E402
import auth  # noqa: E402
import config  # noqa: E402
import oidc  # noqa: E402
import rbac  # noqa: E402
import users as users_store  # noqa: E402

from fastapi import Depends, FastAPI, HTTPException, Request, Response  # noqa: E402
from fastapi.responses import (  # noqa: E402
    FileResponse,
    HTMLResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles  # noqa: E402
from starlette.middleware.sessions import SessionMiddleware  # noqa: E402
from urllib.parse import quote  # noqa: E402

app = FastAPI(title="ServiceNow MCP Chat")

# Short-lived signed cookie that holds the OAuth transaction (state/nonce/PKCE)
# between the redirect to Google and the callback. Separate from the app session.
app.add_middleware(
    SessionMiddleware,
    secret_key=auth.signing_secret(),
    session_cookie="snmcp_oauth",
    same_site="lax",
    https_only=False,  # dev; behind HTTPS set to True
    max_age=600,
)

# Trigger the first-run migrations on import (may exit if seed cannot be created).
config.load()
users_store.load()

if BUILD_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(BUILD_DIR / "assets")),
        name="assets",
    )

_NO_BUILD_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Frontend not built</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:64px auto;padding:0 24px;color:#213}
code{background:#eef2f4;padding:2px 6px;border-radius:4px}
h1{margin-bottom:8px}</style></head><body>
<h1>Frontend not built yet</h1>
<p>Run <code>cd frontend && npm install && npm run build</code> and reload.</p>
</body></html>
"""


@app.get("/")
async def index():
    """Always serves the SPA shell (built index.html). Auth is enforced by the API,
    not by hiding the shell — the app itself renders the login page when unauth."""
    index_html = BUILD_DIR / "index.html"
    if index_html.exists():
        return FileResponse(str(index_html))
    return HTMLResponse(_NO_BUILD_HTML, status_code=503)


# ---------- Auth ----------

@app.post("/api/auth/login")
async def api_login(req: Request, response: Response):
    body = await req.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = users_store.verify_credentials(username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    auth.set_session_cookie(response, user["id"])
    return {"user": user}


@app.post("/api/auth/register")
async def api_register(req: Request, response: Response):
    """Public self-service signup. Always creates a role='user' local account and
    logs the caller in immediately. Never trusts a client-supplied role."""
    body = await req.json()
    username = (body.get("username") or "").strip()
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        # role is hard-coded to 'user'; the client cannot escalate.
        user = users_store.add_user(
            {"username": username, "email": email, "password": password, "role": "user"}
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    auth.set_session_cookie(response, user["id"])
    return {"user": user}


@app.post("/api/auth/logout")
async def api_logout(response: Response):
    auth.clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/auth/whoami")
async def api_whoami(user=Depends(auth.require_session)):
    return {"user": user}


@app.get("/api/auth/providers")
async def api_auth_providers():
    """Which sign-in methods the login page should offer (public)."""
    return {"local": True, "google": oidc.google_enabled()}


# ---------- Google OIDC single sign-on ----------

def _google_error_redirect(message: str) -> RedirectResponse:
    return RedirectResponse(url=f"/?auth_error={quote(message)}", status_code=302)


@app.get("/api/auth/google/login")
async def api_google_login(request: Request, mode: str = "signin"):
    if not oidc.google_enabled():
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    mode = "signup" if mode == "signup" else "signin"
    request.session["google_mode"] = mode
    # `prompt=select_account` forces Google's account chooser even when a Google
    # session already exists, so signup never silently reuses whoever is already
    # signed into the browser. Plain sign-in skips this and reuses the session.
    extra = {"prompt": "select_account"} if mode == "signup" else {}
    return await oidc.get_oauth().google.authorize_redirect(request, oidc.redirect_uri(), **extra)


@app.get("/api/auth/google/callback")
async def api_google_callback(request: Request):
    if not oidc.google_enabled():
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    mode = request.session.pop("google_mode", "signin")
    try:
        token = await oidc.get_oauth().google.authorize_access_token(request)
    except Exception:  # noqa: BLE001 - bad state, denied consent, expired code, etc.
        return _google_error_redirect("Google sign-in failed or was cancelled.")

    claims = token.get("userinfo") or {}
    sub = claims.get("sub")
    email = claims.get("email")
    name = claims.get("name") or claims.get("preferred_username")
    if not sub:
        return _google_error_redirect("Google did not return a user identity.")

    # Only sign-up may create a new account; sign-in requires an existing one.
    try:
        user = users_store.upsert_google_user(sub, email, name, allow_create=(mode == "signup"))
    except PermissionError as e:
        return _google_error_redirect(str(e))
    except Exception:  # noqa: BLE001
        return _google_error_redirect("Could not provision your account.")

    if user is None:
        return _google_error_redirect('No account yet — use "Sign up with Google" to create one.')

    resp = RedirectResponse(url=oidc.post_login_redirect(), status_code=302)
    auth.set_session_cookie(resp, user["id"])
    return resp


# ---------- Users CRUD + tool assignment (super_admin only) ----------

@app.get("/api/users")
async def api_list_users(_admin=Depends(auth.require_super_admin)):
    return {"users": users_store.list_users(redacted=True)}


@app.post("/api/users")
async def api_add_user(req: Request, _admin=Depends(auth.require_super_admin)):
    body = await req.json()
    try:
        entry = users_store.add_user(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return entry


@app.patch("/api/users/{user_id}")
async def api_patch_user(user_id: str, req: Request, admin=Depends(auth.require_super_admin)):
    body = await req.json()
    try:
        entry = users_store.patch_user(user_id, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return entry


@app.delete("/api/users/{user_id}")
async def api_delete_user(user_id: str, admin=Depends(auth.require_super_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=409, detail="You cannot delete your own account while signed in.")
    try:
        users_store.delete_user(user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found")
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True}


@app.get("/api/users/{user_id}/tools")
async def api_get_user_tools(user_id: str, _admin=Depends(auth.require_super_admin)):
    if users_store.get_user_full(user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {"tool_ids": rbac.get_user_tool_ids(user_id)}


@app.put("/api/users/{user_id}/tools")
async def api_set_user_tools(user_id: str, req: Request, admin=Depends(auth.require_super_admin)):
    if users_store.get_user_full(user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    body = await req.json()
    tool_ids = body.get("tool_ids") or []
    ids = rbac.set_user_tools(user_id, tool_ids, granted_by=admin["id"])
    return {"tool_ids": ids}


# ---------- Tool catalog + role defaults (super_admin only) ----------

async def _discover_and_sync_all() -> None:
    """Probe every enabled MCP server to refresh the tool catalog."""
    servers = [
        s for s in config.mcp_servers(redacted=False)
        if s.get("enabled", True)
    ]
    for srv in servers:
        # allowed=None discovers every tool; sync happens inside the helper.
        await _list_tools_for_server(srv, None)


@app.get("/api/admin/tools")
async def api_admin_tools(_admin=Depends(auth.require_super_admin)):
    await _discover_and_sync_all()
    return {"tools": rbac.list_catalog(only_available=True)}


@app.post("/api/admin/tools/sync")
async def api_admin_tools_sync(_admin=Depends(auth.require_super_admin)):
    await _discover_and_sync_all()
    return {"tools": rbac.list_catalog(only_available=True)}


@app.get("/api/admin/role-defaults")
async def api_get_role_defaults(_admin=Depends(auth.require_super_admin)):
    return {role: rbac.get_role_defaults(role) for role in users_store.VALID_ROLES}


@app.put("/api/admin/role-defaults")
async def api_set_role_defaults(req: Request, _admin=Depends(auth.require_super_admin)):
    body = await req.json()
    role = (body.get("role") or "").strip()
    if role not in users_store.VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    ids = rbac.set_role_defaults(role, body.get("tool_ids") or [])
    return {"role": role, "tool_ids": ids}


# ---------- Chat + status (all require a session) ----------

async def _list_tools_for_server(srv, allowed) -> dict:
    """List a server's tools, refresh the RBAC catalog, and filter to `allowed`.

    `allowed` is None (all tools) or a dict {server_id: {tool_name, ...}}.
    """
    try:
        async with connect(srv["endpoint"], {srv["auth_header"]: srv["api_key"]}) as session:
            tools = (await session.list_tools()).tools
        # Keep the RBAC catalog fresh from live discovery (best-effort).
        try:
            slug = agent._sanitize_slug(srv["name"])
            rbac.sync_tools(
                srv["id"],
                srv["name"],
                [
                    {
                        "tool_name": t.name,
                        "qualified_name": agent._openai_tool_name(slug, t.name),
                        "description": (t.description or "").strip(),
                    }
                    for t in tools
                ],
            )
        except Exception:  # noqa: BLE001
            pass
        allow_names = None if allowed is None else allowed.get(srv["id"], set())
        items = [
            {"name": t.name, "description": (t.description or "").strip()}
            for t in tools
            if allow_names is None or t.name in allow_names
        ]
        return {"id": srv["id"], "name": srv["name"], "tools": items, "status": "connected"}
    except Exception as exc:  # noqa: BLE001
        return {
            "id": srv["id"],
            "name": srv["name"],
            "tools": [],
            "status": f"error: {exc}",
        }


@app.get("/api/tools")
async def api_tools(user=Depends(auth.require_session)):
    allowed = rbac.allowed_tool_map(user)
    servers_full = config.mcp_servers(redacted=False)
    servers_out = []
    total = 0
    for srv in servers_full:
        if not srv.get("enabled", True):
            servers_out.append({"id": srv["id"], "name": srv["name"], "tools": [], "status": "disabled"})
            continue
        info = await _list_tools_for_server(srv, allowed)
        servers_out.append(info)
        total += len(info["tools"])
    return {"servers": servers_out, "count": total}


@app.get("/api/health")
async def api_health(user=Depends(auth.require_session)):
    allowed = rbac.allowed_tool_map(user)
    servers_full = config.mcp_servers(redacted=False)
    servers_status = []
    total_tools = 0
    for srv in servers_full:
        if not srv.get("enabled", True):
            servers_status.append(
                {"id": srv["id"], "name": srv["name"], "status": "disabled", "tools": 0}
            )
            continue
        info = await _list_tools_for_server(srv, allowed)
        servers_status.append(
            {
                "id": srv["id"],
                "name": srv["name"],
                "status": info["status"],
                "tools": len(info["tools"]),
            }
        )
        total_tools += len(info["tools"])
    return {
        "mcp_servers": servers_status,
        "total_tools": total_tools,
        "openai_configured": bool(os.environ.get("AZURE_OPENAI_ENDPOINT")),
        "deployment": agent.AOAI_DEPLOYMENT,
        "openai_auth": agent.openai_auth_mode(),
        "openai_connection": agent.openai_auth_source(),
    }


@app.post("/api/chat")
async def api_chat(req: Request, user=Depends(auth.require_session)):
    body = await req.json()
    messages = body.get("messages", [])
    allowed = rbac.allowed_tool_map(user)

    async def gen():
        try:
            async for event in agent.run_turn(messages, allowed):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------- MCP server CRUD (read = any session; write = admin+) ----------

@app.get("/api/mcp/servers")
async def api_list_mcp_servers(_user=Depends(auth.require_session)):
    return {"servers": config.mcp_servers(redacted=True)}


@app.post("/api/mcp/servers")
async def api_add_mcp_server(req: Request, _admin=Depends(auth.require_admin)):
    body = await req.json()
    try:
        entry = config.add_mcp_server(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return entry


@app.patch("/api/mcp/servers/{id_}")
async def api_patch_mcp_server(id_: str, req: Request, _admin=Depends(auth.require_admin)):
    body = await req.json()
    try:
        entry = config.patch_mcp_server(id_, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return entry


@app.delete("/api/mcp/servers/{id_}")
async def api_delete_mcp_server(id_: str, _admin=Depends(auth.require_admin)):
    try:
        config.delete_mcp_server(id_)
    except KeyError:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return {"ok": True}


@app.post("/api/mcp/servers/{id_}/probe")
async def api_probe_mcp_server(id_: str, user=Depends(auth.require_session)):
    srv = config.mcp_server_by_id(id_)
    if not srv:
        raise HTTPException(status_code=404, detail="MCP server not found")
    allowed = rbac.allowed_tool_map(user)
    info = await _list_tools_for_server(srv, allowed)
    if info["status"] == "connected":
        return {"ok": True, "tools": info["tools"]}
    return {"ok": False, "error": info["status"].removeprefix("error: "), "tools": []}


# ---------- App settings (active cloud) ----------

def _settings_payload(user: dict) -> dict:
    role = user.get("role", "user")
    provider = config.get_llm_provider()
    return {
        "role": role,
        "can_manage_users": role == "super_admin",
        "can_manage_config": role in ("admin", "super_admin"),
        "llm": {
            "provider": provider,
            "providers": list(config.LLM_PROVIDERS),
            "groq_available": bool(agent.GROQ_API_KEY),
            "configured": agent.provider_configured(),
            "deployment": agent.active_model(),
            "auth": agent.openai_auth_mode(),
            "source": agent.openai_auth_source(),
        },
    }


@app.get("/api/settings")
async def api_get_settings(user=Depends(auth.require_session)):
    return _settings_payload(user)


@app.put("/api/settings/provider")
async def api_set_provider(req: Request, user=Depends(auth.require_admin)):
    body = await req.json()
    try:
        config.set_llm_provider((body.get("provider") or "").strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _settings_payload(user)


@app.get("/api/settings/models")
async def api_list_models(_user=Depends(auth.require_session)):
    """Models available for the active LLM provider (for the model picker)."""
    models = await asyncio.to_thread(agent.list_models)
    selected = agent.active_model()
    # Ensure the active model is always selectable, even if discovery is empty.
    if selected and selected not in models:
        models = [selected, *models]
    return {"deployments": models, "selected": selected}


@app.put("/api/settings/model")
async def api_set_model(req: Request, user=Depends(auth.require_admin)):
    body = await req.json()
    name = (body.get("deployment") or "").strip()
    provider = config.get_llm_provider()
    try:
        if provider == "groq":
            config.set_groq_model(name)
        else:
            config.set_selected_deployment(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _settings_payload(user)


# --- Root-level static assets (favicon, logo files copied from frontend/public) ---
# Registered LAST so /api/* and /assets/* always take precedence. Only serves
# a whitelist of image extensions from BUILD_DIR to avoid accidental exposure.

_PUBLIC_EXTS = {".svg", ".png", ".ico", ".jpg", ".jpeg", ".webp", ".gif"}


@app.get("/{filename:path}")
async def serve_public(filename: str):
    if not filename or filename.startswith("api/") or filename.startswith("assets/"):
        raise HTTPException(status_code=404)
    # Reject anything that would escape BUILD_DIR.
    if ".." in filename.split("/") or filename.startswith("/"):
        raise HTTPException(status_code=404)
    lower = filename.lower()
    if not any(lower.endswith(ext) for ext in _PUBLIC_EXTS):
        raise HTTPException(status_code=404)
    target = (BUILD_DIR / filename).resolve()
    try:
        target.relative_to(BUILD_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404)
    if not target.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(target))
