import { MessageSquare, Server } from "lucide-react";
import { SnLogo } from "@/components/SnLogo";
import { UserMenu } from "@/components/UserMenu";
import { cn } from "@/lib/utils";
import type { PageId } from "@/App";
import type { User } from "@/types";

interface Props {
  activePage: PageId;
  onSelectPage: (page: PageId) => void;
  user: User;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

const nav: Array<{ id: PageId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "mcp", label: "MCP", icon: Server },
];

export function Sidebar({ activePage, onSelectPage, user, onOpenSettings, onSignOut }: Props) {

  return (
    <aside className="hidden h-full w-[240px] shrink-0 flex-col bg-gradient-to-b from-[hsl(195,30%,10%)] to-[hsl(200,35%,6%)] text-white/90 lg:flex">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-4">
        <SnLogo className="size-10 rounded-xl shadow-md" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-white">
            ServiceNow MCP
          </div>
          <div className="text-[11.5px] text-white/60">Assistant</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 px-3 py-2">
        {nav.map(({ id, label, icon: Icon }) => {
          const active = activePage === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectPage(id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                active
                  ? "bg-white/[0.09] text-white shadow-inner"
                  : "text-white/70 hover:bg-white/[0.05] hover:text-white",
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  active ? "text-brand" : "text-white/60",
                )}
              />
              <span className="font-medium">{label}</span>
              {active && (
                <span className="ml-auto size-1.5 rounded-full bg-brand shadow-[0_0_0_4px_hsl(var(--brand)/0.15)]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom user block */}
      <div className="mt-auto border-t border-white/10 p-2">
        <UserMenu user={user} onOpenSettings={onOpenSettings} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
