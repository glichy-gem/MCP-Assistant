import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Pencil,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { McpServerFormDialog } from "@/components/dialogs/McpServerFormDialog";
import { useMcpServers } from "@/hooks/useMcpServers";
import type { McpProbeResult, McpServerConfig, ToolDescriptor } from "@/types";
import { cn } from "@/lib/utils";

type ProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; tools: ToolDescriptor[] }
  | { status: "error"; error: string };

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function McpServersPage({
  canManage,
}: {
  canManage: boolean;
}) {
  const { servers, loading, error, refresh, add, patch, remove, probe } = useMcpServers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (srv: McpServerConfig) => {
    setEditing(srv);
    setDialogOpen(true);
  };

  const doProbe = useCallback(
    async (id: string, silent = false) => {
      setProbes((p) => ({ ...p, [id]: { status: "loading" } }));
      const res: McpProbeResult = await probe(id, { silent });
      setProbes((p) => ({
        ...p,
        [id]: res.ok
          ? { status: "ok", tools: res.tools }
          : { status: "error", error: res.error || "unknown error" },
      }));
      // Note: probing only populates status/tool-count. The Tools list stays
      // collapsed until the user clicks the "Tools" row.
    },
    [probe],
  );

  // Probe all enabled servers on first load (silently) so the status + tool
  // count populate without firing a global toast on whatever page you're on.
  useEffect(() => {
    for (const s of servers) {
      if (s.enabled && !probes[s.id]) {
        void doProbe(s.id, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length]);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto p-6 sm:p-8 scrollbar-thin">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">MCP servers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Register the MCP servers this assistant can call. Tools from every enabled server are
            merged and exposed to the LLM.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          {canManage && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="size-4" />
              Add MCP server
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && servers.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Server className="mx-auto size-8 text-muted-foreground" />
          <div className="mt-3 text-sm font-medium">No MCP servers yet</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {canManage
              ? "Add one to start calling tools from the chat."
              : "No servers are configured, or none of your assigned tools are available."}
          </div>
          {canManage && (
            <Button size="sm" onClick={openAdd} className="mt-4">
              <Plus className="size-4" />
              Add MCP server
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4">
        {servers.map((srv) => {
          const p = probes[srv.id] ?? { status: "idle" };
          const isExpanded = expanded[srv.id] ?? false;
          return (
            <div key={srv.id} className="rounded-2xl border bg-card shadow-sm">
              <div className="flex flex-wrap items-start gap-3 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-primary text-white shadow-sm">
                  <Server className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-semibold">{srv.name}</div>
                    <StatusBadge state={p} enabled={srv.enabled} />
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
                    {hostOf(srv.endpoint)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>
                      Auth: <code className="rounded bg-muted px-1">{srv.auth_header}</code>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {canManage && (
                    <div className="mr-1 flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Enabled</span>
                      <Switch
                        checked={srv.enabled}
                        onCheckedChange={(v) => patch(srv.id, { enabled: v })}
                      />
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => doProbe(srv.id)}
                    title="Probe now"
                  >
                    <RefreshCw
                      className={cn("size-4", p.status === "loading" && "animate-spin")}
                    />
                  </Button>
                  {canManage && (
                    <>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(srv)} title="Edit">
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Remove MCP server "${srv.name}"?`)) void remove(srv.id);
                        }}
                        title="Delete"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [srv.id]: !isExpanded }))}
                className="flex w-full items-center gap-2 border-t px-4 py-2 text-left text-[12px] text-muted-foreground hover:bg-muted/40"
              >
                <Wrench className="size-3.5" />
                Tools
                {p.status === "ok" && (
                  <Badge variant="secondary" className="ml-1">
                    {p.tools.length}
                  </Badge>
                )}
                <ChevronDown
                  className={cn(
                    "ml-auto size-3.5 transition-transform",
                    isExpanded && "rotate-180",
                  )}
                />
              </button>

              {isExpanded && (
                <div className="border-t px-4 py-3">
                  {p.status === "loading" && (
                    <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Probing…
                    </div>
                  )}
                  {p.status === "error" && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {p.error}
                    </div>
                  )}
                  {p.status === "idle" && (
                    <div className="text-[12px] text-muted-foreground">
                      Click <RefreshCw className="mx-0.5 inline size-3" /> to fetch the tool list.
                    </div>
                  )}
                  {p.status === "ok" && p.tools.length === 0 && (
                    <div className="text-[12px] text-muted-foreground">
                      Server returned no tools.
                    </div>
                  )}
                  {p.status === "ok" && p.tools.length > 0 && (
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {p.tools.map((t) => (
                        <div
                          key={t.name}
                          className="rounded-md border bg-background/40 px-2.5 py-1.5"
                          title={t.description}
                        >
                          <div className="truncate font-mono text-[12px] font-semibold">
                            {t.name}
                          </div>
                          {t.description && (
                            <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                              {t.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <McpServerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={async (payload) => {
          if (editing) return patch(editing.id, payload);
          return add(payload);
        }}
      />
    </div>
  );
}

function StatusBadge({ state, enabled }: { state: ProbeState; enabled: boolean }) {
  if (!enabled)
    return (
      <Badge variant="secondary" className="gap-1">
        disabled
      </Badge>
    );
  if (state.status === "loading")
    return (
      <Badge variant="warn" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        probing
      </Badge>
    );
  if (state.status === "ok")
    return (
      <Badge variant="ok" className="gap-1">
        <CheckCircle2 className="size-3" />
        connected · {state.tools.length}
      </Badge>
    );
  if (state.status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="size-3" />
        error
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      unknown
    </Badge>
  );
}
