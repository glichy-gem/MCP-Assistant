# MCP Assistant

A chat assistant that connects to any MCP (Model Context Protocol) server and lets you query and manage ServiceNow records through a conversational UI backed by an LLM.

```
MCP-Assistant/
├── mcp/        # MCP client (Python). Reads endpoint + API key from mcp/.env.
├── backend/    # FastAPI app: LLM tool-loop + SSE + user/RBAC store (Postgres).
└── frontend/   # React 18 + TypeScript + Vite + Tailwind + shadcn/ui.
```

## Features

- **Chat** — streamed conversation. The LLM calls tools from every enabled MCP server automatically.
- **MCP** — register / edit / delete MCP servers; cards probe the server and list tools inline.
- **Users** *(admin-only)* — manage local accounts with role-based access control (RBAC).
- **LLM** — powered by [Groq](https://console.groq.com) (free tier, OpenAI-compatible API).
- **Auth** — local username/password + Google OIDC (optional). Self-service signup supported.

## Prerequisites

- Python 3.10+
- Node 20+ / npm 10+
- A Postgres database (e.g. [Neon](https://neon.tech) free tier)
- A free [Groq](https://console.groq.com) API key
- An MCP server endpoint + API key

## Setup

### 1. Backend

```bash
pip install -r backend/requirements.txt
pip install -r mcp/requirements.txt
```

Copy and fill in the config files:

```bash
cp backend/.env.example backend/.env   # fill Postgres, Groq key, Google OIDC
cp mcp/.env.example mcp/.env           # fill MCP_ENDPOINT + MCP_API_KEY
```

### 2. Frontend

```bash
cd frontend && npm install
```

## Running

### Development (hot reload — two terminals)

```bash
uvicorn app:app --app-dir backend --port 8000 --reload   # terminal 1
cd frontend && npm run dev                                # terminal 2
```

Open <http://localhost:5173>.

### Single-URL / production mode

```bash
cd frontend && npm run build && cd ..
uvicorn app:app --app-dir backend --port 8000
```

Open <http://localhost:8000>.

## Configuration

All config lives in environment variables — see `backend/.env.example` for the full reference:

| Section | Key variables |
|---|---|
| Postgres | `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` |
| Google OIDC | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Seed admin | `ADMIN_USER`, `ADMIN_PASSWORD` |

On first startup the backend creates the Postgres schema and seeds one `super_admin` from `ADMIN_USER`/`ADMIN_PASSWORD`. MCP servers are managed through the UI (stored in `backend/connections.json`, git-ignored).

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, react-markdown |
| Backend | Python 3.11, FastAPI, uvicorn, psycopg v3, psycopg_pool |
| Database | PostgreSQL (Neon serverless or any Postgres) |
| LLM | Groq (OpenAI-compatible, free tier) |
| Auth | bcrypt + itsdangerous signed cookies, Google OIDC via Authlib |
| Protocol | MCP Streamable-HTTP JSON-RPC over httpx |
