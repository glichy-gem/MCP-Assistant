"""Shared helpers for talking to the ServiceNow MCP server.

This uses a small, transparent Streamable-HTTP JSON-RPC client (httpx) rather than
the MCP SDK's transport. The Logic Apps server also advertises the legacy HTTP+SSE
transport, but that path requires VNet integration on the Logic App; the plain
Streamable-HTTP request/response path needs no such thing and is what we use here.

The other scripts import `connect()` (an async context manager yielding a session
with `.list_tools()` / `.call_tool()`) plus the parsing/discovery helpers below.
"""

from __future__ import annotations

import json
import os
import re
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv


def load_config():
    """Return (endpoint, headers) from environment / .env, or exit with guidance."""
    load_dotenv()
    endpoint = os.environ.get("MCP_ENDPOINT")
    key = os.environ.get("MCP_API_KEY")
    header = os.environ.get("MCP_AUTH_HEADER", "X-API-Key")

    missing = [name for name, value in (("MCP_ENDPOINT", endpoint), ("MCP_API_KEY", key)) if not value]
    if missing:
        raise SystemExit(
            "Missing required setting(s): "
            + ", ".join(missing)
            + ".\nCopy .env.example to .env and fill in the endpoint and API key."
        )
    return endpoint, {header: key}


# --- lightweight MCP types (mimic the shape the scripts expect) -------------

class Tool:
    def __init__(self, data):
        self.name = data.get("name")
        self.description = data.get("description")
        self.inputSchema = data.get("inputSchema") or {}


class ToolsResult:
    def __init__(self, tools):
        self.tools = tools


class _Block:
    def __init__(self, text=None):
        self.text = text


class CallToolResult:
    def __init__(self, content, structured_content, is_error):
        self.content = content
        self.structuredContent = structured_content
        self.isError = is_error


def _messages_from_response(resp):
    """Yield JSON-RPC messages from a response (handles JSON or text/event-stream)."""
    ctype = resp.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        for chunk in resp.text.split("\n\n"):
            data = "\n".join(
                line[len("data:"):].lstrip()
                for line in chunk.splitlines()
                if line.startswith("data:")
            )
            if not data:
                continue
            try:
                yield json.loads(data)
            except ValueError:
                continue
    else:
        try:
            body = resp.json()
        except ValueError:
            return
        if isinstance(body, list):
            yield from body
        elif isinstance(body, dict):
            yield body


def _pick_message(resp, want_id):
    """Return the JSON-RPC message matching want_id, else the first with result/error."""
    fallback = None
    for msg in _messages_from_response(resp):
        if not isinstance(msg, dict):
            continue
        if msg.get("id") == want_id:
            return msg
        if fallback is None and ("result" in msg or "error" in msg):
            fallback = msg
    return fallback


class StreamableHTTPSession:
    """Minimal MCP client: initialize, list tools, call tools over Streamable HTTP."""

    def __init__(self, client: httpx.AsyncClient, url: str):
        self._client = client
        self._url = url
        self._session_id = None
        self._protocol_version = "2025-06-18"
        self._counter = 0

    def _next_id(self):
        self._counter += 1
        return self._counter

    def _headers(self):
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
            headers["MCP-Protocol-Version"] = self._protocol_version
        return headers

    async def _post(self, payload):
        resp = await self._client.post(self._url, json=payload, headers=self._headers())
        session_id = resp.headers.get("mcp-session-id")
        if session_id:
            self._session_id = session_id
        if resp.status_code >= 400:
            message = resp.text
            for msg in _messages_from_response(resp):
                if isinstance(msg, dict) and msg.get("error"):
                    message = msg["error"].get("message", message)
                    break
            raise RuntimeError(f"HTTP {resp.status_code} from server: {message}")
        return resp

    async def _request(self, method, params=None):
        request_id = self._next_id()
        payload = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            payload["params"] = params
        resp = await self._post(payload)
        msg = _pick_message(resp, request_id) or {}
        if msg.get("error"):
            raise RuntimeError(f"{method} error: {msg['error']}")
        return msg.get("result") or {}

    async def _notify(self, method, params=None):
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        try:
            await self._post(payload)
        except Exception:  # noqa: BLE001 - notifications are best-effort
            pass

    async def initialize(self):
        result = await self._request(
            "initialize",
            {
                "protocolVersion": self._protocol_version,
                "capabilities": {},
                "clientInfo": {"name": "servicenow-mcp-tester", "version": "0.1.0"},
            },
        )
        if result.get("protocolVersion"):
            self._protocol_version = result["protocolVersion"]
        await self._notify("notifications/initialized")
        return result

    async def list_tools(self):
        result = await self._request("tools/list")
        return ToolsResult([Tool(t) for t in result.get("tools", [])])

    async def call_tool(self, name, arguments=None):
        result = await self._request("tools/call", {"name": name, "arguments": arguments or {}})
        blocks = [
            _Block(text=block.get("text"))
            for block in result.get("content", [])
            if isinstance(block, dict)
        ]
        return CallToolResult(blocks, result.get("structuredContent"), bool(result.get("isError")))


@asynccontextmanager
async def connect(endpoint: str | None = None, headers: dict | None = None):
    """Open an initialized MCP session.

    If endpoint/headers are omitted, they're loaded from the environment
    (mcp/.env). Pass them explicitly to talk to a specific MCP server —
    that's what the backend uses to iterate over its registered servers.
    """
    if endpoint is None or headers is None:
        endpoint, headers = load_config()
    async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(60.0)) as client:
        session = StreamableHTTPSession(client, endpoint)
        await session.initialize()
        yield session


# --- result parsing ---------------------------------------------------------

def error_hint(exc) -> str:
    """Return an actionable hint string for a connection/call failure."""
    text = str(exc)
    if "500" in text or "InternalServerError" in text:
        return (
            "This is a SERVER-SIDE 500 from the MCP server. The protocol handshake\n"
            "(initialize/ping) works and the API key is fine, but every tools/* operation faults\n"
            "on the server. Likely causes:\n"
            "  - The ServiceNow API connection is unauthorized/expired -> re-authorize it.\n"
            "  - A tool registration/schema problem on the server.\n"
            "  - A server runtime/backing-storage problem.\n"
            "First step: check the server logs to see the real exception."
        )
    if "401" in text or "403" in text:
        return "A 401/403 means MCP_API_KEY or MCP_AUTH_HEADER is wrong; also double-check MCP_ENDPOINT."
    return "Check MCP_ENDPOINT / MCP_API_KEY in .env and that the endpoint is reachable."


def result_text(result) -> str:
    """Concatenate the text blocks from a CallToolResult."""
    parts = []
    for block in result.content:
        text = getattr(block, "text", None)
        if text is not None:
            parts.append(text)
    return "\n".join(parts)


def result_json(result):
    """Best-effort structured view of a CallToolResult (structuredContent or parsed text)."""
    structured = getattr(result, "structuredContent", None)
    if structured:
        return structured
    text = result_text(result)
    if not text:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def deep_find(obj, target_key):
    """Recursively find the first scalar value stored under `target_key` (case-insensitive)."""
    target = target_key.lower()
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and k.lower() == target and not isinstance(v, (dict, list)):
                return v
        for v in obj.values():
            found = deep_find(v, target_key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = deep_find(item, target_key)
            if found is not None:
                return found
    return None


# --- tool / schema discovery helpers ----------------------------------------

def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def find_tool(tools, *names):
    """Find a tool by exact name, then by prefix (handles a trailing _1 suffix)."""
    for wanted in names:
        w = wanted.lower()
        for tool in tools:
            if tool.name.lower() == w:
                return tool
    for wanted in names:
        w = wanted.lower()
        for tool in tools:
            if tool.name.lower().startswith(w):
                return tool
    return None


def schema_props(tool):
    return (tool.inputSchema or {}).get("properties") or {}


def pick_param(tool, *candidates):
    """Return the actual schema property name matching one of the candidate names."""
    props = schema_props(tool)
    norm_map = {_norm(name): name for name in props}
    for cand in candidates:  # exact (normalized) match first
        key = _norm(cand)
        if key in norm_map:
            return norm_map[key]
    for cand in candidates:  # loose 'contains' fallback
        key = _norm(cand)
        if not key:
            continue
        for nk, orig in norm_map.items():
            if key in nk:
                return orig
    return None
