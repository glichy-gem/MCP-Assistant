"""RBAC tool catalog + per-user tool grants (PostgreSQL).

- The `tools` catalog is kept fresh from live MCP discovery via sync_tools().
- Access is authoritative in `user_tools`; `role_defaults` seeds new users.
- allowed_tool_map(user) is the object threaded into the tool-filter choke
  points in agent.py (chat) and app.py (/api/tools, probe):
      None                                  -> all tools (super_admin)
      {server_id: {tool_name, ...}, ...}    -> only these tools per server
"""

from __future__ import annotations

from typing import Any

import db


def sync_tools(server_id: str, server_name: str, tools: list[dict]) -> None:
    """Upsert discovered tools for a server; mark vanished ones unavailable.

    `tools` items: {"tool_name": str, "qualified_name": str, "description": str}.
    """
    seen = [t["tool_name"] for t in tools]
    with db.connection() as conn:
        with conn.cursor() as cur:
            for t in tools:
                cur.execute(
                    """
                    INSERT INTO tools (server_id, server_name, tool_name, qualified_name,
                                       description, is_available, last_seen)
                    VALUES (%s, %s, %s, %s, %s, true, now())
                    ON CONFLICT (server_id, tool_name) DO UPDATE
                        SET server_name    = EXCLUDED.server_name,
                            qualified_name = EXCLUDED.qualified_name,
                            description    = EXCLUDED.description,
                            is_available   = true,
                            last_seen      = now()
                    """,
                    (server_id, server_name, t["tool_name"], t["qualified_name"],
                     t.get("description") or ""),
                )
            # Anything for this server not seen this pass is no longer available.
            cur.execute(
                "UPDATE tools SET is_available = false "
                "WHERE server_id = %s AND NOT (tool_name = ANY(%s))",
                (server_id, seen),
            )


def list_catalog(only_available: bool = True) -> list[dict]:
    where = "WHERE is_available" if only_available else ""
    rows = db.fetch_all(
        f"""
        SELECT id, server_id, server_name, tool_name, qualified_name,
               description, is_available
        FROM tools {where}
        ORDER BY server_name, tool_name
        """
    )
    return rows


def get_user_tool_ids(user_id: str) -> list[int]:
    rows = db.fetch_all(
        "SELECT tool_id FROM user_tools WHERE user_id = %s ORDER BY tool_id",
        (user_id,),
    )
    return [r["tool_id"] for r in rows]


def set_user_tools(user_id: str, tool_ids: list[int], granted_by: str | None = None) -> list[int]:
    """Replace a user's tool grants with exactly `tool_ids`."""
    ids = [int(i) for i in tool_ids]
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_tools WHERE user_id = %s", (user_id,))
            for tid in ids:
                cur.execute(
                    """
                    INSERT INTO user_tools (user_id, tool_id, granted_by)
                    VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
                    """,
                    (user_id, tid, granted_by),
                )
    return get_user_tool_ids(user_id)


def get_role_defaults(role: str) -> list[int]:
    rows = db.fetch_all(
        "SELECT tool_id FROM role_defaults WHERE role = %s ORDER BY tool_id",
        (role,),
    )
    return [r["tool_id"] for r in rows]


def set_role_defaults(role: str, tool_ids: list[int]) -> list[int]:
    ids = [int(i) for i in tool_ids]
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM role_defaults WHERE role = %s", (role,))
            for tid in ids:
                cur.execute(
                    "INSERT INTO role_defaults (role, tool_id) VALUES (%s, %s) "
                    "ON CONFLICT DO NOTHING",
                    (role, tid),
                )
    return get_role_defaults(role)


def allowed_tool_map(user: dict) -> dict[str, set[str]] | None:
    """None => all tools (super_admin). Else {server_id: {tool_name, ...}}."""
    if user.get("role") == "super_admin":
        return None
    rows = db.fetch_all(
        """
        SELECT t.server_id AS server_id, t.tool_name AS tool_name
        FROM user_tools ut JOIN tools t ON t.id = ut.tool_id
        WHERE ut.user_id = %s
        """,
        (user["id"],),
    )
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(r["server_id"], set()).add(r["tool_name"])
    return out
