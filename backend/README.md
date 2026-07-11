# ServiceNow MCP Assistant (chat app)

A small web app where you chat in plain English and an LLM calls the **ServiceNow MCP server**
tools for you (create/get/update/list/delete incidents, search KB, browse catalog).

```
Browser (frontend/ served)  ──►  FastAPI backend  ──►  Groq LLM (tool-calling)
                                       │  imports ../mcp/mcp_client.py    │ picks tool + args
                                       └────── MCP client ──(tools/call)──► MCP server ──► ServiceNow
```

Folder layout:

- **`backend/`** — this app (FastAPI + LLM tool-loop). `.env` holds `GROQ_API_KEY`.
- **`frontend/`** — React 18 + TypeScript + Vite + Tailwind + shadcn/ui. `npm run build` emits
  `frontend/dist/`, which this backend serves at `/` and `/assets/*`.
- **`mcp/`** — MCP client library + smoke-test scripts. `.env` holds `MCP_ENDPOINT` / `MCP_API_KEY`.

- **Brain:** Groq LLM (free API key from https://console.groq.com, configured in `backend/.env` —
  `GROQ_API_KEY` / `GROQ_MODEL`). OpenAI-compatible API.
- **Hands:** one or more MCP servers registered on the **MCP** page. Each turn opens a session
  per enabled server, merges their tools into a single function list (names prefixed by
  server slug, e.g. `servicenow__List_Records`), and routes each tool call back
  to the originating server. Tool cards show which server answered.
- **UI (React + shadcn/ui):** left-nav with **Chat**, **MCP**, and **Users** pages, plus a
  bottom-left user block → **Settings**. Streaming replies, inline
  tool-call cards, dark/light theme, keyboard shortcuts.

## Persistence: `backend/connections.json`

Holds `{ app_settings, mcp_servers }` (git-ignored). On first startup the MCP server is migrated
from `mcp/.env`; the JSON is the source of truth thereafter. Add/edit/delete MCP servers via the
**MCP** page. The LLM's Groq API key lives in `backend/.env`.

**Redaction:** MCP `api_key` is masked as `•••••<last4>` on GET. On PATCH, a blank secret means
"keep existing".

## Provenance

The agent tags every `tool_call`/`tool_result` SSE event with the `server` name.
The UI shows it on each tool card (`via <MCP server>`), so you can see which server answered.

Settings endpoints (session-gated):
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings` | `{role, llm:{configured,model}}` |

## Authentication

Local username/password auth. Users live in `backend/users.json` (git-ignored). Passwords are
stored as **bcrypt** hashes. Sessions use an **`itsdangerous`-signed HttpOnly cookie**
(`snmcp_session`, TTL 12h). All `/api/*` routes except `/api/auth/*` require a valid session.

**First-run seed** — reads `ADMIN_USER` (default `admin`) and `ADMIN_PASSWORD` from
`backend/.env`. If `ADMIN_PASSWORD` is missing on a fresh install, the backend **refuses to
start** so the app can't come up unauthenticated. Change the password from the Users page
after the first login and then rotate `ADMIN_PASSWORD` out of `.env`.

**Session secret** — from `SESSION_SECRET` env var if set; otherwise auto-generated on first
run and persisted to `backend/.session_secret` (also git-ignored).

**Reset a forgotten admin** — stop the backend, delete `backend/users.json` and
`backend/.session_secret`, set `ADMIN_PASSWORD` in `.env`, and restart. A fresh seeded admin
is created.

Auth endpoints (public):
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → sets cookie, returns `{user}` |
| POST | `/api/auth/logout` | Clears cookie |
| GET | `/api/auth/whoami` | Returns `{user}` or 401 |

Users endpoints (admin-only):
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users` | List (redacted; hashes never leave the backend) |
| POST | `/api/users` | Add. Body: `{username, password, role?, display_name?, email?}` |
| PATCH | `/api/users/{id}` | Update. Blank password = keep existing |
| DELETE | `/api/users/{id}` | Remove (409 for the seed admin or your own account) |

## Setup

From the project root:

```powershell
pip install -r backend/requirements.txt
pip install -r mcp/requirements.txt
Copy-Item backend\.env.example backend\.env   # then fill in GROQ_API_KEY
```

- MCP credentials are read from **`../mcp/.env`** — nothing to repeat here.
- Groq API key is configured in `backend/.env`: `GROQ_API_KEY` from https://console.groq.com.
  The LLM model defaults to `llama-3.3-70b-versatile` but can be overridden with `GROQ_MODEL`.

## Run

**Dev (hot reload):** two processes.
```powershell
uvicorn app:app --app-dir backend --port 8000 --reload   # terminal 1
cd frontend && npm run dev                                # terminal 2 (proxies /api → :8000)
```
Open <http://localhost:5173>.

**Single-URL demo:** build once, then start the backend only.
```powershell
cd frontend && npm run build && cd ..
uvicorn app:app --app-dir backend --port 8000
```
Open <http://localhost:8000>. If `frontend/dist/` doesn't exist, `/` returns a 503 with the
build instructions embedded. `/api/*` still works.

## What to try

- *"List the 5 most recent incidents"* → calls `List_Records`.
- *"Create an incident: VPN is down for finance, urgency high"* → `Create_Record` → returns the INC number.
- *"Mark INC0010001 as resolved"* → `List_Records`/`Get_Record` to find the sys_id, then `Update_Record` (state=6).
- *"Search the knowledge base for password reset"* → `Get_Knowledge_Articles`.

Each tool call appears as a card in the chat so you can see exactly what was invoked. Verify results
in ServiceNow `dev424497`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Chat UI (built React bundle from `frontend/dist/`; 503 with hint if not built) |
| GET | `/assets/*` | Vite-emitted JS/CSS from `frontend/dist/assets/` |
| GET | `/api/tools` | Per-server tool listing: `{servers:[{id,name,tools,status}], count}` |
| GET | `/api/health` | Per-MCP-server status + LLM info |
| GET | `/api/mcp/servers` | List (redacted) MCP servers |
| POST | `/api/mcp/servers` | Add MCP server. Body: `{name, endpoint, auth_header?, api_key, enabled?}` |
| PATCH | `/api/mcp/servers/{id}` | Update. Empty `api_key` = keep existing |
| DELETE | `/api/mcp/servers/{id}` | Remove |
| POST | `/api/mcp/servers/{id}/probe` | Open a transient session and return its tool list |
| POST | `/api/chat` | SSE stream of the assistant turn |

## RBAC — next phase (hooks are ready)

- `ENABLED_TOOLS` in `.env` (comma-separated tool names) already filters which tools reach the LLM.
  Leave empty = all. This becomes the per-user / per-role allowlist.
- Add auth (login → user/role) as middleware in `app.py`, then compute `ENABLED_TOOLS` per request
  from the caller's role, and map the signed-in user to a ServiceNow `caller_id` on create.

## Notes

- Chat history is persisted per browser tab in `sessionStorage` (no DB).
- The assistant can call **every** registered tool, including `Delete_Record`. Every call is shown
  in the UI, but there's no hard confirmation gate yet (that comes with RBAC).
