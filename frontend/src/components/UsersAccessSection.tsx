import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Sliders,
  Trash2,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserFormDialog } from "@/components/dialogs/UserFormDialog";
import { useUsers } from "@/hooks/useUsers";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CatalogTool, RoleDefaults, User, UserRole } from "@/types";

type View =
  | { kind: "list" }
  | { kind: "assign"; user: User }
  | { kind: "defaults" };

const ROLE_LABEL: Record<UserRole, string> = {
  user: "User",
  admin: "Admin",
  super_admin: "Super admin",
};

/** Group a flat tool catalog by server for display. */
function byServer(tools: CatalogTool[]) {
  const map = new Map<string, CatalogTool[]>();
  for (const t of tools) {
    const arr = map.get(t.server_name) ?? [];
    arr.push(t);
    map.set(t.server_name, arr);
  }
  return [...map.entries()];
}

export function UsersAccessSection({ currentUserId }: { currentUserId: string }) {
  const { users, loading, error, refresh, add, patch, remove } = useUsers(true);
  const [view, setView] = useState<View>({ kind: "list" });
  const [catalog, setCatalog] = useState<CatalogTool[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const { tools } = await api.admin.tools();
      setCatalog(tools);
      setCatalogError(null);
    } catch (e) {
      setCatalogError((e as Error).message);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // Fetch the tool catalog once (it also refreshes it from live MCP discovery).
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  if (view.kind === "assign") {
    return (
      <ToolAssignment
        user={view.user}
        catalog={catalog}
        catalogError={catalogError}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  if (view.kind === "defaults") {
    return (
      <RoleDefaultsEditor
        catalog={catalog}
        catalogError={catalogError}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  // ----- list view -----
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          Create accounts, set roles, and assign which tools each user can call.
        </p>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView({ kind: "defaults" })}
            title="Per-role default tools"
          >
            <Sliders className="size-3.5" />
            Role defaults
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add user
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="max-h-[52vh] overflow-y-auto rounded-lg border scrollbar-thin">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-4 text-[12.5px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading users…
          </div>
        )}
        {!loading &&
          users.map((u) => {
            const isSelf = u.id === currentUserId;
            const canDelete = !u.is_seed && !isSelf;
            return (
              <div
                key={u.id}
                className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold uppercase text-muted-foreground">
                  {(u.display_name || u.username).slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{u.display_name || u.username}</span>
                    {u.is_seed && <Badge variant="secondary">seed</Badge>}
                    {isSelf && <Badge variant="secondary">you</Badge>}
                  </div>
                  <div className="truncate text-[11.5px] text-muted-foreground">@{u.username}</div>
                </div>
                <Badge variant={u.role === "user" ? "secondary" : "ok"} className="gap-1">
                  {u.role === "user" ? (
                    <UserIcon className="size-3" />
                  ) : (
                    <ShieldCheck className="size-3" />
                  )}
                  {ROLE_LABEL[u.role]}
                </Badge>
                <div className="flex items-center gap-0.5">
                  {u.role !== "super_admin" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Assign tools"
                      onClick={() => setView({ kind: "assign", user: u })}
                    >
                      <Wrench className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit"
                    onClick={() => {
                      setEditing(u);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={canDelete ? "Delete" : "Cannot delete this account"}
                    disabled={!canDelete}
                    onClick={() => {
                      if (confirm(`Remove user "${u.username}"?`)) void remove(u.id);
                    }}
                  >
                    <Trash2 className={cn("size-4", canDelete && "text-destructive")} />
                  </Button>
                </div>
              </div>
            );
          })}
      </div>

      {u_note(catalog, catalogLoading)}

      <UserFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={async (payload) => {
          const ok = editing ? await patch(editing.id, payload) : await add(payload);
          if (ok) await refresh();
          return ok;
        }}
      />
    </div>
  );
}

function u_note(catalog: CatalogTool[] | null, loading: boolean) {
  if (loading) return null;
  if (catalog && catalog.length === 0)
    return (
      <p className="text-[11.5px] text-amber-600 dark:text-amber-400">
        No tools discovered yet. Open the MCP page and probe a server, then reopen this panel to
        assign tools.
      </p>
    );
  return (
    <p className="text-[11.5px] text-muted-foreground">
      Super admins always have access to every tool, so they have no per-user assignment.
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Tool assignment for a single user                                   */
/* ------------------------------------------------------------------ */

function ToolAssignment({
  user,
  catalog,
  catalogError,
  onBack,
}: {
  user: User;
  catalog: CatalogTool[] | null;
  catalogError: string | null;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { tool_ids } = await api.users.getTools(user.id);
        if (!cancelled) setSelected(new Set(tool_ids));
      } catch (e) {
        if (!cancelled) {
          setSelected(new Set());
          toast.error("Couldn't load current grants", { description: (e as Error).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const groups = useMemo(() => byServer(catalog ?? []), [catalog]);
  const ready = selected !== null && catalog !== null;

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.users.setTools(user.id, [...selected]);
      toast.success(`Tools updated for ${user.display_name || user.username}`);
      onBack();
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" /> Back to users
      </button>
      <div className="text-sm">
        Tools for <span className="font-semibold">{user.display_name || user.username}</span>{" "}
        <Badge variant="secondary">{ROLE_LABEL[user.role]}</Badge>
      </div>

      {catalogError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Couldn't load the tool catalog: {catalogError}
        </div>
      ) : !ready ? (
        <div className="flex items-center gap-2 px-1 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : groups.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">No tools discovered yet.</p>
      ) : (
        <div className="max-h-[46vh] overflow-y-auto rounded-lg border p-2 scrollbar-thin">
          {groups.map(([server, tools]) => (
            <div key={server} className="mb-2 last:mb-0">
              <div className="px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {server}
              </div>
              {tools.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={selected!.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] font-medium">{t.tool_name}</span>
                    {t.description && (
                      <span className="line-clamp-1 text-[11px] text-muted-foreground">
                        {t.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-muted-foreground">
          {ready ? `${selected!.size} selected` : ""}
        </span>
        <Button size="sm" onClick={save} disabled={!ready || saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save assignments
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-role default tool template                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_ROLES: UserRole[] = ["user", "admin"];

function RoleDefaultsEditor({
  catalog,
  catalogError,
  onBack,
}: {
  catalog: CatalogTool[] | null;
  catalogError: string | null;
  onBack: () => void;
}) {
  const [defaults, setDefaults] = useState<RoleDefaults | null>(null);
  const [role, setRole] = useState<UserRole>("user");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await api.admin.roleDefaults.get();
        if (!cancelled) setDefaults(d);
      } catch (e) {
        if (!cancelled) toast.error("Couldn't load role defaults", { description: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => byServer(catalog ?? []), [catalog]);
  const selected = new Set(defaults?.[role] ?? []);
  const ready = defaults !== null && catalog !== null;

  const toggle = (id: number) => {
    setDefaults((prev) => {
      if (!prev) return prev;
      const cur = new Set(prev[role] ?? []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      return { ...prev, [role]: [...cur] };
    });
  };

  const save = async () => {
    if (!defaults) return;
    setSaving(true);
    try {
      await api.admin.roleDefaults.set(role, defaults[role] ?? []);
      toast.success(`Defaults saved for ${ROLE_LABEL[role]}`);
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" /> Back to users
      </button>
      <p className="text-[12.5px] text-muted-foreground">
        Tools pre-assigned to new accounts of each role. Changing these does not affect existing
        users.
      </p>

      <div className="flex gap-1.5">
        {DEFAULT_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition",
              role === r ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent",
            )}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>

      {catalogError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Couldn't load the tool catalog: {catalogError}
        </div>
      ) : !ready ? (
        <div className="flex items-center gap-2 px-1 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : groups.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">No tools discovered yet.</p>
      ) : (
        <div className="max-h-[42vh] overflow-y-auto rounded-lg border p-2 scrollbar-thin">
          {groups.map(([server, tools]) => (
            <div key={server} className="mb-2 last:mb-0">
              <div className="px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {server}
              </div>
              {tools.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <span className="font-mono text-[12px]">{t.tool_name}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-muted-foreground">
          {ready ? `${selected.size} selected for ${ROLE_LABEL[role]}` : ""}
        </span>
        <Button size="sm" onClick={save} disabled={!ready || saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save defaults
        </Button>
      </div>
    </div>
  );
}
