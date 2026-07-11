import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/MessageBubble";
import { EmptyState } from "@/components/EmptyState";
import { Composer, type ComposerHandle } from "@/components/Composer";
import type { ChatMessage } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  composerRef: React.RefObject<ComposerHandle>;
}

export function ChatPane({
  messages,
  isStreaming,
  onSend,
  onStop,
  onClear,
  composerRef,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Auto-scroll only when the user is already near the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinned) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pinned]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setPinned(isNearBottom());
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b bg-card/60 px-5 py-3 backdrop-blur">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">
            ServiceNow Assistant
          </h1>
          <p className="text-[12px] text-muted-foreground">
            Ask in plain English. I'll pick the right tool from your MCP servers and run it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={messages.length === 0}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto scrollbar-thin"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6">
          {messages.length === 0 ? (
            <EmptyState onPick={(t) => composerRef.current?.setValue(t)} />
          ) : (
            messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                isStreaming={isStreaming}
                isLast={i === messages.length - 1}
              />
            ))
          )}
        </div>

        {/* Jump-to-bottom pill */}
        <div
          className={cn(
            "pointer-events-none sticky bottom-3 flex justify-center transition-opacity",
            pinned && "opacity-0",
          )}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={jumpToBottom}
            className="pointer-events-auto gap-1.5 shadow-md"
          >
            <ArrowDown className="size-3.5" />
            Jump to latest
          </Button>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t bg-card/50 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            ref={composerRef}
            isStreaming={isStreaming}
            onSend={onSend}
            onStop={onStop}
          />
          <div className="mt-1.5 px-2 text-[11px] text-muted-foreground">
            Press <kbd className="rounded border bg-muted px-1 py-px text-[10px]">Enter</kbd> to send,
            <kbd className="ml-1 rounded border bg-muted px-1 py-px text-[10px]">/</kbd> to focus,
            <kbd className="ml-1 rounded border bg-muted px-1 py-px text-[10px]">Shift+Enter</kbd> for a newline.
          </div>
        </div>
      </div>
    </main>
  );
}
