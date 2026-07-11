import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { ChatPane } from "@/components/ChatPane";
import { SettingsModal } from "@/components/SettingsModal";
import { McpServersPage } from "@/pages/McpServersPage";
import { LoginPage } from "@/pages/LoginPage";
import type { ComposerHandle } from "@/components/Composer";
import { useChat } from "@/hooks/useChat";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
import type { User } from "@/types";

export type PageId = "chat" | "mcp";

export default function App() {
  const { user, status, login, register, logout } = useAuth();
  const { effective } = useTheme();

  if (status === "unknown") {
    return (
      <div className="grid h-full w-full place-items-center bg-background">
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (status === "anonymous" || !user) {
    return (
      <>
        <LoginPage onLogin={login} onRegister={register} />
        <Toaster position="top-right" richColors theme={effective} closeButton />
      </>
    );
  }

  return <AppShell user={user} onSignOut={logout} theme={effective} />;
}

function AppShell({
  user,
  onSignOut,
  theme,
}: {
  user: User;
  onSignOut: () => Promise<void>;
  theme: "light" | "dark";
}) {
  const composerRef = useRef<ComposerHandle>(null);
  const { messages, isStreaming, send, stop, clear } = useChat();
  const { settings, setProvider, setModel } = useSettings();
  const [activePage, setActivePage] = useState<PageId>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Cmd/Ctrl+K = clear chat (only in Chat + not in an input field).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        if (activePage === "chat") clear();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clear, activePage]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full w-full overflow-hidden">
        <Sidebar
          activePage={activePage}
          onSelectPage={setActivePage}
          user={user}
          onOpenSettings={() => setSettingsOpen(true)}
          onSignOut={onSignOut}
        />

        {activePage === "chat" && (
          <ChatPane
            messages={messages}
            isStreaming={isStreaming}
            onSend={send}
            onStop={stop}
            onClear={clear}
            composerRef={composerRef}
          />
        )}
        {activePage === "mcp" && (
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <McpServersPage canManage={settings?.can_manage_config ?? false} />
          </main>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        user={user}
        onSetProvider={setProvider}
        onSetModel={setModel}
      />
      <Toaster position="top-right" richColors theme={theme} closeButton />
    </TooltipProvider>
  );
}
