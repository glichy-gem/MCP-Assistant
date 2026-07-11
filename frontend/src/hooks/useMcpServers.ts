import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type {
  McpProbeResult,
  McpServerConfig,
  McpServerInput,
} from "@/types";

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { servers } = await api.mcp.list();
      setServers(servers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (payload: McpServerInput) => {
      try {
        await api.mcp.add(payload);
        toast.success("MCP server added");
        await refresh();
        return true;
      } catch (e) {
        toast.error("Add failed", { description: (e as Error).message });
        return false;
      }
    },
    [refresh],
  );

  const patch = useCallback(
    async (id: string, payload: McpServerInput) => {
      try {
        await api.mcp.patch(id, payload);
        toast.success("MCP server updated");
        await refresh();
        return true;
      } catch (e) {
        toast.error("Update failed", { description: (e as Error).message });
        return false;
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.mcp.remove(id);
        toast.success("MCP server removed");
        await refresh();
        return true;
      } catch (e) {
        toast.error("Remove failed", { description: (e as Error).message });
        return false;
      }
    },
    [refresh],
  );

  const probe = useCallback(
    async (id: string, opts?: { silent?: boolean }): Promise<McpProbeResult> => {
      const silent = opts?.silent ?? false;
      try {
        const res = await api.mcp.probe(id);
        if (!silent) {
          if (res.ok) {
            toast.success("Connected", { description: `${res.tools.length} tools discovered` });
          } else {
            toast.error("Probe failed", { description: res.error || "unknown error" });
          }
        }
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!silent) toast.error("Probe failed", { description: msg });
        return { ok: false, tools: [], error: msg };
      }
    },
    [],
  );

  return { servers, loading, error, refresh, add, patch, remove, probe };
}
