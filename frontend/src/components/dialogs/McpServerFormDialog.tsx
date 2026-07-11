import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { McpServerConfig, McpServerInput } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: McpServerConfig | null;
  onSubmit: (input: McpServerInput) => Promise<boolean>;
}

const isEditing = (v: McpServerConfig | null | undefined): v is McpServerConfig =>
  !!v && typeof v.id === "string";

export function McpServerFormDialog({ open, onOpenChange, editing, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [authHeader, setAuthHeader] = useState("X-API-Key");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
      if (isEditing(editing)) {
        setName(editing.name);
        setEndpoint(editing.endpoint);
        setAuthHeader(editing.auth_header || "X-API-Key");
        setApiKey("");
      } else {
        setName("");
        setEndpoint("");
        setAuthHeader("X-API-Key");
        setApiKey("");
      }
    }
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Name is required.");
    if (!endpoint.trim()) return setError("Endpoint URL is required.");
    try {
      const u = new URL(endpoint);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      return setError("Endpoint must be a valid http(s) URL.");
    }
    if (!isEditing(editing) && !apiKey.trim()) {
      return setError("API key is required.");
    }

    setBusy(true);
    const payload: McpServerInput = {
      name: name.trim(),
      endpoint: endpoint.trim(),
      auth_header: authHeader.trim() || "X-API-Key",
    };
    if (apiKey.trim()) payload.api_key = apiKey.trim();
    const ok = await onSubmit(payload);
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  const editMode = isEditing(editing);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editMode ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            Point at any remote MCP server that speaks Streamable HTTP. The API key is sent
            in the header shown below (default <code className="rounded bg-muted px-1 py-0.5 text-[11px]">X-API-Key</code>).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ServiceNow (Prod)"
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="mcp-endpoint">Endpoint URL</Label>
            <Input
              id="mcp-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://…/api/mcpservers/<name>/mcp"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr,2fr]">
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-auth-header">Auth header</Label>
              <Input
                id="mcp-auth-header"
                value={authHeader}
                onChange={(e) => setAuthHeader(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-api-key">
                API key {editMode && <span className="normal-case text-muted-foreground/70">(leave blank to keep existing)</span>}
              </Label>
              <Input
                id="mcp-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editMode ? "•••••" : "paste the key"}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11.5px] text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Credentials are stored in plaintext in <code className="rounded bg-black/10 px-1 dark:bg-white/10">backend/connections.json</code>.
              Do not commit that file. Rotate keys regularly.
            </span>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter className="pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editMode ? "Save changes" : "Add server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
