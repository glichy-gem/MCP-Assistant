"""LLM tool-calling loop across every enabled MCP server.

`run_turn()` opens one MCP session per enabled server, merges their tools into
a single OpenAI function list (with server-name prefixes to avoid collisions),
runs the OpenAI streaming completion, and routes each tool call back to the
originating server's session.
"""

from __future__ import annotations

import json
import os
import re
import sys
from contextlib import AsyncExitStack
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import httpx

# Reuse the MCP client from the sibling `mcp/` folder.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "mcp"))
from mcp_client import connect, result_text  # noqa: E402

import config  # noqa: E402
import rbac  # noqa: E402

from openai import AsyncOpenAI  # noqa: E402

# --- Groq (OpenAI-compatible, fast free tier) ---
GROQ_API_KEY = os.environ.get("GROQ_API_KEY") or None
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Model families that are NOT chat/completion models — hidden from the picker.
_NON_CHAT = ("embedding", "whisper", "tts", "dall-e", "dalle", "sora", "moderation")
# Groq exposes audio (whisper/tts/orpheus) and safety (prompt-guard/safeguard)
# models alongside chat models; hide those from the picker.
_GROQ_NON_CHAT = ("whisper", "tts", "orpheus", "guard")

MAX_TOOL_ROUNDS = 8
_INVALID_NAME_CHAR = re.compile(r"[^a-zA-Z0-9_-]")
_BR_TAG = re.compile(r"<br\s*/?>", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]+>")


def _clean_tool_html(text: str) -> str:
    """Convert <br> tags to newlines and strip remaining HTML from tool results.

    ServiceNow often returns HTML markup in text fields even when the field is
    labeled 'HTML stripped'. Cleaning here keeps the LLM context and the UI
    preview readable without requiring a full HTML parser.
    """
    text = _BR_TAG.sub("\n", text)
    text = _HTML_TAG.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def enabled_tools():
    raw = (os.environ.get("ENABLED_TOOLS") or "").strip()
    if not raw:
        return None
    return {name.strip() for name in raw.split(",") if name.strip()}


def provider_configured() -> bool:
    """Whether Groq is configured."""
    return bool(GROQ_API_KEY)


def active_groq_model() -> str:
    """The Groq model to use — the user's pick, else the .env default."""
    return config.get_groq_model() or GROQ_MODEL


def active_model() -> str:
    """The model id to send in the chat completion."""
    return active_groq_model()


def list_models() -> list[str]:
    """List selectable models for Groq (for the model picker)."""
    return list_groq_models()


def list_groq_models() -> list[str]:
    """List chat-capable model ids on Groq (audio/safety models hidden).

    [] if not configured or on error.
    """
    if not GROQ_API_KEY:
        return []
    try:
        resp = httpx.get(
            f"{GROQ_BASE_URL}/models",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            timeout=20,
        )
        resp.raise_for_status()
        ids = [
            mid
            for m in resp.json().get("data", [])
            if (mid := m.get("id")) and not any(x in mid.lower() for x in _GROQ_NON_CHAT)
        ]
        return sorted(ids)
    except Exception:
        return []


def build_client() -> AsyncOpenAI:
    """Build the OpenAI-compatible client for Groq."""
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set (see backend/.env).")
    return AsyncOpenAI(base_url=GROQ_BASE_URL, api_key=GROQ_API_KEY)


def system_prompt() -> str:
    return (
        "You are a helpful ServiceNow assistant. You manage ServiceNow records (incidents, "
        "knowledge articles, catalog items) by calling the available tools.\n\n"
        "Guidelines:\n"
        '- The default table (tableType) is "incident" unless the user clearly means another table.\n'
        "- Create_Record requires at least short_description. Fill urgency/impact/category when the "
        "user implies them (urgency & impact: 1=High, 2=Medium, 3=Low).\n"
        "- Tools that act on an existing record need its sysid (sys_id). If the user refers to an "
        "incident by number (e.g. INC0010001), FIRST call List_Records with:\n"
        '    tableType="incident", sysparm_query="number=INC0010001", sysparm_fields="number,short_description,state,sys_id"\n'
        "  Take the sys_id from that single result, then call the target tool with sysid=<that value>.\n"
        "- For \"most recent\" incidents, use sysparm_query=\"ORDERBYDESCsys_created_on\" and set sysparm_limit "
        "(e.g. '5' or '10'). Without sysparm_query the connector returns the OLDEST records — always sort or filter.\n"
        "- ServiceNow query syntax: combine clauses with ^ (e.g. \"active=true^ORDERBYDESCsys_created_on\"). "
        "Operators include =, !=, LIKE, STARTSWITH, IN, ISEMPTY.\n"
        "- Incident state codes: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed, 8=Canceled. "
        'To "resolve" set state=6; to "close" set state=7.\n'
        "- RESOLVING or CLOSING (state 6 or 7) REQUIRES both close_code (Resolution code) and "
        "close_notes on Update_Record — set them in the SAME call as the state change, using the "
        "dedicated close_code/close_notes fields (NOT comments or work_notes), or ServiceNow rejects "
        "it with a Data Policy Exception.\n"
        "- close_code must be a value this instance actually defines. Do NOT assume legacy codes like "
        "'Solved (Permanently)'. If unsure of the valid codes, look them up first with List_Records: "
        'tableType="sys_choice", sysparm_query="element=close_code^name=incident^inactive=false", '
        'sysparm_fields="label,value". Then pick the closest match to the user\'s intent (e.g. a '
        "permanent fix → 'Solution provided'; a workaround → 'Workaround provided').\n"
        "- Get_Knowledge_Articles needs a query string.\n"
        "- After creating or updating a record, tell the user the incident number and sys_id.\n"
        "- Deleting is permanent; briefly confirm what you deleted afterwards.\n"
        "- Be concise. Confirm what you did and show key fields. Use markdown tables for lists.\n"
        "\n"
        "STRICT ANTI-HALLUCINATION RULES:\n"
        "- NEVER invent a field value the tool response doesn't contain. If a field is empty, missing, "
        "or looks like a raw sys_id, say so explicitly (e.g. 'Assignment group: (empty)' or 'Caller "
        "sys_id: abc123 - display name not returned'). Do NOT guess a person's name or a group name.\n"
        "- List_Records / Get_Record default to sysparm_display_value='true', so reference fields "
        "like caller_id/assignment_group/assigned_to come back as human-readable names. If you see "
        "an opaque sys_id instead, the field is either empty or display resolution failed - do NOT invent a name.\n"
        "\n"
        "COUNTING RULES:\n"
        "- Never report a total based on a page of results. If asked 'how many...', call List_Records "
        "with sysparm_limit='10000' and sysparm_fields='sys_id' (tiny payload) and count the returned "
        "rows. If the returned count equals your sysparm_limit, the true total may be higher - say so.\n"
        "\n"
        "MULTI-SERVER NOTES:\n"
        "- Tool names shown to you are prefixed with the MCP server slug (e.g. `servicenow_azure__List_Records`). "
        "Use the exact prefixed name in your function call; the app strips the prefix before routing.\n"
        f"- Today's date is {date.today().isoformat()}."
    )


def _sanitize_slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s or "srv"


def _openai_tool_name(slug: str, tool_name: str) -> str:
    """OpenAI function names must match ^[a-zA-Z0-9_-]{1,64}$."""
    combined = f"{slug}__{tool_name}"
    combined = _INVALID_NAME_CHAR.sub("_", combined)
    return combined[:64]


def mcp_tools_to_openai(tools_by_server):
    """
    tools_by_server: list of (server_id, slug, server_name, [mcp Tool])
    Returns (openai_tool_list, name_map)
      name_map: openai_name -> (server_id, real_tool_name, input_schema)
    """
    specs = []
    name_map: dict[str, tuple[str, str, dict]] = {}
    for server_id, slug, server_name, tools in tools_by_server:
        for t in tools:
            oname = _openai_tool_name(slug, t.name)
            i = 1
            while oname in name_map:
                oname = _openai_tool_name(slug, f"{t.name}_{i}")[:64]
                i += 1
            desc = (t.description or t.name).strip()
            desc = f"[{server_name}] {desc}"
            schema = t.inputSchema or {"type": "object", "properties": {}}
            specs.append(
                {
                    "type": "function",
                    "function": {
                        "name": oname,
                        "description": desc[:1024],
                        "parameters": schema,
                    },
                }
            )
            name_map[oname] = (server_id, t.name, schema)
    return specs, name_map


def _coerce_args(args, schema):
    """Coerce string argument values to the types the tool's JSON schema declares.

    Some models (notably smaller open models via Groq) emit numbers/booleans as
    strings in tool-call arguments (e.g. limit="10"). ServiceNow's connector
    validates types strictly, so a string where an integer is expected fails.
    Coerce per the tool's inputSchema so tool calls work across all models.
    """
    if not isinstance(args, dict) or not isinstance(schema, dict):
        return args
    props = schema.get("properties")
    if not isinstance(props, dict):
        return args
    out = dict(args)
    for key, val in list(out.items()):
        if not isinstance(val, str):
            continue
        spec = props.get(key)
        if not isinstance(spec, dict):
            continue
        typ = spec.get("type")
        if isinstance(typ, list):  # e.g. ["integer", "null"]
            typ = next((t for t in typ if t != "null"), None)
        s = val.strip()
        try:
            if typ == "integer":
                out[key] = int(s)
            elif typ == "number":
                out[key] = float(s)
            elif typ == "boolean":
                low = s.lower()
                if low in ("true", "1", "yes"):
                    out[key] = True
                elif low in ("false", "0", "no"):
                    out[key] = False
        except (ValueError, TypeError):
            pass  # leave as-is; let the server surface a clear error
    return out


def _clean_history(history):
    clean = []
    for m in history or []:
        role = m.get("role")
        content = m.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            clean.append({"role": role, "content": content})
    return clean


async def run_turn(history, allowed=None):
    """Drive one assistant turn across every enabled MCP server."""
    try:
        client = build_client()
    except Exception as exc:  # noqa: BLE001
        yield {"type": "error", "message": f"LLM not configured: {exc}"}
        return

    # Read from the config store — full (unredacted) copies of enabled servers.
    servers = [
        s
        for s in config.mcp_servers(redacted=False)
        if s.get("enabled", True)
    ]
    if not servers:
        yield {
            "type": "error",
            "message": (
                "No enabled MCP servers. Open the MCP page to add one or enable an existing server."
            ),
        }
        return

    # server_id -> {server} for provenance on tool events (which MCP server answered).
    meta_by_server: dict[str, dict] = {s["id"]: {"server": s["name"]} for s in servers}

    async with AsyncExitStack() as stack:
        tools_by_server: list[tuple[str, str, str, list]] = []
        session_by_server: dict[str, object] = {}

        for srv in servers:
            try:
                sess = await stack.enter_async_context(
                    connect(srv["endpoint"], {srv["auth_header"]: srv["api_key"]})
                )
                tools_resp = await sess.list_tools()
                slug = _sanitize_slug(srv["name"])
                # Keep the RBAC tool catalog fresh from live discovery (best-effort).
                try:
                    rbac.sync_tools(
                        srv["id"],
                        srv["name"],
                        [
                            {
                                "tool_name": t.name,
                                "qualified_name": _openai_tool_name(slug, t.name),
                                "description": (t.description or "").strip(),
                            }
                            for t in tools_resp.tools
                        ],
                    )
                except Exception:  # noqa: BLE001 - catalog sync must never break chat
                    pass
                # allowed: None => all tools (super_admin); else per-server name set.
                allow_names = None if allowed is None else allowed.get(srv["id"], set())
                filtered = [
                    t for t in tools_resp.tools
                    if allow_names is None or t.name in allow_names
                ]
                tools_by_server.append((srv["id"], slug, srv["name"], filtered))
                session_by_server[srv["id"]] = sess
            except Exception as exc:  # noqa: BLE001 - keep other servers alive
                yield {
                    "type": "error",
                    "message": f"MCP server '{srv['name']}' unreachable: {exc}",
                }

        if not session_by_server:
            return

        openai_tools, name_map = mcp_tools_to_openai(tools_by_server)
        messages = [{"role": "system", "content": system_prompt()}] + _clean_history(history)
        deployment = active_model()

        for _ in range(MAX_TOOL_ROUNDS):
            try:
                stream = await client.chat.completions.create(
                    model=deployment,
                    messages=messages,
                    tools=openai_tools,
                    tool_choice="auto",
                    temperature=0.2,
                    stream=True,
                )
            except Exception as exc:  # noqa: BLE001
                yield {"type": "error", "message": f"LLM call failed: {exc}"}
                return

            content_parts: list[str] = []
            calls: dict[int, dict] = {}
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                if delta.content:
                    content_parts.append(delta.content)
                    yield {"type": "token", "text": delta.content}
                for tc in delta.tool_calls or []:
                    slot = calls.setdefault(tc.index, {"id": None, "name": "", "args": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            slot["name"] += tc.function.name
                        if tc.function.arguments:
                            slot["args"] += tc.function.arguments

            if not calls:
                yield {"type": "done"}
                return

            messages.append(
                {
                    "role": "assistant",
                    "content": "".join(content_parts) or None,
                    "tool_calls": [
                        {
                            "id": s["id"],
                            "type": "function",
                            "function": {"name": s["name"], "arguments": s["args"] or "{}"},
                        }
                        for s in calls.values()
                    ],
                }
            )

            for s in calls.values():
                oname = s["name"]
                call_id = s["id"]
                try:
                    args = json.loads(s["args"] or "{}")
                except json.JSONDecodeError:
                    args = {}

                mapped = name_map.get(oname)
                if mapped:
                    # Coerce arg types to the tool schema (models may emit
                    # numbers/booleans as strings), so calls work across models.
                    args = _coerce_args(args, mapped[2])
                meta = meta_by_server.get(mapped[0]) if mapped else None
                prov = {"server": meta["server"] if meta else None}

                yield {"type": "tool_call", "name": oname, "args": args, **prov}

                if mapped:
                    server_id, real_name, _schema = mapped
                    sess = session_by_server.get(server_id)
                    if sess is None:
                        text = f"Error: MCP server for {oname} disconnected mid-turn."
                        ok = False
                    else:
                        try:
                            res = await sess.call_tool(real_name, args)
                            text = _clean_tool_html(result_text(res) or "(no content)")
                            ok = not getattr(res, "isError", False)
                        except Exception as exc:  # noqa: BLE001
                            text = f"Tool call failed: {exc}"
                            ok = False
                else:
                    text = f"Error: unknown tool '{oname}'."
                    ok = False

                yield {"type": "tool_result", "name": oname, "ok": ok, "preview": text[:1500], **prov}
                messages.append(
                    {"role": "tool", "tool_call_id": call_id, "content": text[:8000]}
                )

        yield {"type": "done"}
