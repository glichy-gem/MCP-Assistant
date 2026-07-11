# ServiceNow MCP — client library

Python client for the **ServiceNow MCP server**. The backend (`../backend`) imports 
`mcp_client` to call tools; a small `list_tools.py` script is kept so you can smoke-test 
the MCP server directly when the chat app misbehaves.

- **Endpoint:** Configure `MCP_ENDPOINT` in `.env` (e.g., a Logic App URL or custom server)
- **Transport:** **Streamable HTTP.** The MCP client uses the Streamable-HTTP 
  request/response path for compatibility.
- **Auth:** Key-based. The key is sent in the **`X-API-Key`** HTTP header (or override 
  via `MCP_AUTH_HEADER`). Confirmed working: `initialize` and `ping` return 200.

## Files

| File | What it does |
|---|---|
| `mcp_client.py` | Shared connection + parsing helpers. Imported by `backend/agent.py`. |
| `list_tools.py` | Connects, lists every exposed tool + its input schema, writes `tools_schema.json`. Use for smoke-testing MCP connectivity. |
| `.env.example` | Template for your endpoint + key. Copy to `.env`. |

## Setup

1. **Install Python 3.10+**, then install dependencies:
   ```powershell
   pip install -r requirements.txt
   ```

2. **Get your MCP server endpoint and API key.**
   - If using a Logic App: in the Azure portal, go to Logic App → MCP servers → 
     Authentication → Method = Key-based → copy the endpoint and key.
   - If using a different MCP server: get the endpoint and API key from your server admin.

3. **Create your `.env`:**
   ```powershell
   Copy-Item .env.example .env
   ```
   Open `.env` and fill in `MCP_ENDPOINT` and `MCP_API_KEY`.
   `.env` is git-ignored — the key never lands in source control or this repo's history.

## Smoke test

```powershell
# Prove connectivity + auth, and see every tool's exact parameter names.
python list_tools.py
```
This should print 17 tools and write `tools_schema.json`. If it fails, fix the MCP
server before starting the chat app.

## Verify in ServiceNow

1. Log into the instance **`dev424497`** (`https://dev424497.service-now.com`).
2. Open the **Incidents** list to see records created through the chat app.

## Root cause of the earlier 500 — and the fix that was applied (RESOLVED)

For the record: `tools/list` and every `tools/call` used to return a server-side
`500 InternalServerError` (even for a made-up tool name), while `initialize`/`ping`
worked. Diagnosis via the Logic App's Functions host log (`FlowMcpDefinitionEngine`
stack trace) showed the real exception:

```
Newtonsoft.Json.Schema.JSchemaReaderException: Invalid JSON schema type: file.
    Path 'properties.attachment_content.type'.
```

**Cause:** the `Upload_a_multipart_file_attachment` tool declared its `attachment_content`
parameter as `"type": "file"`, which is not a valid JSON Schema type. The Logic Apps MCP
engine parses *all* tool schemas to build the manifest, so this one bad schema aborted the
entire manifest → 500 for every tool operation. (This is a preview bug in the connector /
MCP definition engine.)

**Fix applied:** in `wwwroot/Upload_a_multipart_file_attachment/workflow.json` the trigger
schema was changed from `"type": "file"` to `"type": "string", "format": "binary"` (matching
the working `Upload_a_binary_file_as_an_attachment` tool). After that, `tools/list` returns
all 17 tools and calls succeed. If the server is re-registered/overwrites that workflow and the
500 returns, re-apply the same one-field change (or just remove the multipart-attachment tool).

## How the tools are actually registered (important)

Verified against the live schemas:

- Parameters use ServiceNow names: **`tableType`** (e.g. `"incident"`) and **`sysid`** —
  not `sys_id`. `Get_Record`/`Delete_Record` take `tableType`+`sysid`; `List_Records` takes
  `tableType`; `Get_Knowledge_Articles` takes `query` (required), `fields`, `limit`.
- **`Create_Record` and `Update_Record` now accept field parameters** (added by editing their
  workflow definitions in `wwwroot`; they were originally registered with none). Create accepts
  `short_description` (required), `description`, `category`, `urgency`, `impact`, `comments`;
  Update accepts `sysid` (required) plus `short_description`, `description`, `work_notes`,
  `comments`, `state`. The action body forwards them to ServiceNow (`@triggerBody()` for create,
  `@removeProperty(triggerBody(),'sysid')` for update). **Caveat:** this is a direct edit to the
  deployed workflow — the registration UI won't reflect it and re-registering from the
  portal could overwrite it (re-apply the edit if the fields disappear).
  Verified working: `INC0010001` was created and updated with field values through the MCP server.
- A stray **duplicate MCP server** (`MCPServer`, tools suffixed `_1`) previously existed on
  the same Logic App (from the "two creation paths" gotcha). It has since been **deleted**;
  only `ServiceNowMCPserver` remains, and deleting the duplicate did not affect it.

## Notes / gotchas

- **PDI hibernation:** the dev instance `dev424497` sleeps after ~10 days idle. If
  `list_tools.py` works but a tool *call* fails, log into the instance to wake it, then retry.
- **`List_Records` / `Get_Knowledge_Articles`** do exact-match filtering, **not**
  relevance-ranked full-text search. KB article bodies come back as **HTML** in the `text` field.
- **Every registered tool is callable** by anyone with the key, including `Delete_Record`.
  Keep the key secret and consider trimming the tool list / moving to OAuth for anything
  beyond testing.
- If the header name ever differs from `X-API-Key`, override it via `MCP_AUTH_HEADER` in `.env`.
