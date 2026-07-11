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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { User, UserInput, UserRole } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: User | null;
  onSubmit: (input: UserInput) => Promise<boolean>;
}

const isEditing = (v: User | null | undefined): v is User =>
  !!v && typeof v.id === "string";

export function UserFormDialog({ open, onOpenChange, editing, onSubmit }: Props) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
      setPassword("");
      if (isEditing(editing)) {
        setUsername(editing.username);
        setDisplayName(editing.display_name || "");
        setEmail(editing.email || "");
        setRole(editing.role);
      } else {
        setUsername("");
        setDisplayName("");
        setEmail("");
        setRole("user");
      }
    }
  }, [open, editing]);

  const editMode = isEditing(editing);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return setError("Username is required.");
    if (!editMode && !password) return setError("Password is required.");

    setBusy(true);
    const payload: UserInput = {
      username: username.trim(),
      display_name: displayName.trim() || username.trim(),
      email: email.trim() || null,
      role,
    };
    if (password) payload.password = password;
    const ok = await onSubmit(payload);
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editMode ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {editMode
              ? "Update the account details. Leave password blank to keep the current one."
              : "Create a new account. The password is stored as a bcrypt hash and can be reset, not recovered."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="user-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="super_admin">Super admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="user-display">Display name</Label>
              <Input
                id="user-display"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alice"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alice@example.com"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="user-password">
              Password {editMode && <span className="normal-case text-muted-foreground/70">(leave blank to keep existing)</span>}
            </Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editMode ? "•••••" : "at least 8 characters"}
              autoComplete="new-password"
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11.5px] text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Passwords are stored as bcrypt hashes. Users can't retrieve their password —
              only reset it here.
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
              {busy ? "Saving…" : editMode ? "Save changes" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
