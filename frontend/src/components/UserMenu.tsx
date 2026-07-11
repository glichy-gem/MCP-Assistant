import { ChevronsUpDown, LogOut, Settings as SettingsIcon, ShieldCheck, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { User } from "@/types";

interface Props {
  user: User;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Bottom-of-sidebar user block: avatar + name + email, opens a popup menu. */
export function UserMenu({ user, onOpenSettings, onSignOut }: Props) {
  const label = user.display_name || user.username;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition",
            "hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-primary text-[11px] font-bold text-[hsl(150,60%,10%)]">
            {initials(label)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">{label}</span>
            <span className="block truncate text-[11px] text-white/50">{user.email || user.username}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-white/50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[220px]">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="grid size-9 place-items-center rounded-full bg-primary/15 text-[12px] font-semibold uppercase text-primary">
            {initials(label)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{label}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              {user.email || user.username}
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 px-2 py-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {user.role === "admin" ? (
            <ShieldCheck className="size-3.5 text-primary" />
          ) : (
            <UserIcon className="size-3.5" />
          )}
          Role: {user.role}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <SettingsIcon className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
