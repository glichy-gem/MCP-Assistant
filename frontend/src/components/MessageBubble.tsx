import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, Copy, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToolCallCard } from "@/components/ToolCallCard";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

interface Props {
  message: ChatMessage;
  isStreaming: boolean;
  isLast: boolean;
}

export function MessageBubble({ message, isStreaming, isLast }: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  const showTyping =
    !isUser && isStreaming && isLast && message.content.length === 0;

  return (
    <div
      className={cn(
        "group flex w-full gap-3 animate-fade-up",
        isUser && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-gradient-to-br from-brand to-primary text-white",
        )}
        aria-hidden
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          isUser ? "items-end" : "items-start",
          "max-w-[85%] sm:max-w-[75%]",
        )}
      >
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            {message.toolCalls.map((c) => (
              <ToolCallCard key={c.id} call={c} />
            ))}
          </div>
        )}

        {(message.content.length > 0 || showTyping) && (
          <div
            className={cn(
              "relative rounded-2xl px-4 py-2.5 shadow-sm animate-fade-up",
              isUser
                ? "bg-primary text-primary-foreground rounded-tr-md"
                : "bg-card text-card-foreground border rounded-tl-md",
            )}
          >
            {showTyping ? (
              <span className="flex gap-1 py-1 text-muted-foreground" aria-label="assistant typing">
                <span className="size-1.5 animate-blink rounded-full bg-current" />
                <span className="size-1.5 animate-blink rounded-full bg-current [animation-delay:150ms]" />
                <span className="size-1.5 animate-blink rounded-full bg-current [animation-delay:300ms]" />
              </span>
            ) : isUser ? (
              <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed">
                {message.content}
              </div>
            ) : (
              <>
                <div className="prose-chat">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: (props) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" />
                      ),
                      // Wrap tables in a scrollable div so the table itself keeps
                      // normal display:table layout (correct column distribution)
                      // while still allowing horizontal scroll for wide tables.
                      table: ({ children, ...props }) => (
                        <div className="table-wrapper">
                          <table {...props}>{children}</table>
                        </div>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
                <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1.5 px-1.5 text-[11px] text-muted-foreground"
                    onClick={copy}
                    aria-label="Copy message"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
