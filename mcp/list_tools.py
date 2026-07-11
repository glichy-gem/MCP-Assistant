"""Connect to the ServiceNow MCP server and list every exposed tool + schema.

Run this FIRST. A clean listing proves the endpoint and X-API-Key auth work, and
reveals the exact parameter names for each tool (also written to tools_schema.json).

    python list_tools.py
"""

import asyncio
import json
import textwrap

from mcp_client import connect, error_hint


async def main():
    async with connect() as session:
        response = await session.list_tools()
        tools = response.tools
        print(f"Connected OK. Server exposes {len(tools)} tool(s):\n")

        dump = []
        for tool in tools:
            print("=" * 72)
            print(f"TOOL: {tool.name}")
            if tool.description:
                print(textwrap.indent(tool.description.strip(), "  "))
            print("  inputSchema:")
            print(textwrap.indent(json.dumps(tool.inputSchema, indent=2), "    "))
            print()
            dump.append(
                {
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": tool.inputSchema,
                }
            )

        with open("tools_schema.json", "w", encoding="utf-8") as f:
            json.dump(dump, f, indent=2)
        print("=" * 72)
        print("Wrote full schema to tools_schema.json")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"\nFailed to connect / list tools: {type(exc).__name__}: {exc}")
        print(error_hint(exc))
        raise SystemExit(1)
