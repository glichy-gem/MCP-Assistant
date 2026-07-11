import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { streamChat } from "@/lib/streamChat";
import { nanoId } from "@/lib/utils";
import type { ChatMessage, ToolCallRecord } from "@/types";

const STORAGE_KEY = "snmcp.chat.v1";

function loadPersisted(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadPersisted);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* quota errors are non-fatal */
    }
  }, [messages]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: ChatMessage = {
        id: nanoId("u"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      const assistantId = nanoId("a");
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
        createdAt: Date.now(),
      };

      // Snapshot the wire history BEFORE the placeholder is added,
      // otherwise we'd send an empty assistant turn to the model.
      const wireHistory = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // Queue of pending tool_call events (indexed by name order); a tool_result
      // event finalizes the earliest matching one.
      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? fn(m) : m)),
        );

      try {
        for await (const evt of streamChat(wireHistory, controller.signal)) {
          if (evt.type === "token") {
            patch((m) => ({ ...m, content: m.content + evt.text }));
          } else if (evt.type === "tool_call") {
            patch((m) => {
              const record: ToolCallRecord = {
                id: nanoId("t"),
                name: evt.name,
                args: evt.args,
                status: "running",
                server: evt.server ?? null,
              };
              return { ...m, toolCalls: [...(m.toolCalls ?? []), record] };
            });
          } else if (evt.type === "tool_result") {
            patch((m) => {
              const calls = (m.toolCalls ?? []).slice();
              // finalize the first still-running call matching this name
              const idx = calls.findIndex(
                (c) => c.status === "running" && c.name === evt.name,
              );
              if (idx >= 0) {
                calls[idx] = {
                  ...calls[idx],
                  status: evt.ok ? "done" : "error",
                  preview: evt.preview,
                };
              }
              return { ...m, toolCalls: calls };
            });
          } else if (evt.type === "error") {
            toast.error("Assistant error", { description: evt.message });
            patch((m) => ({
              ...m,
              content:
                m.content || `⚠ ${evt.message}`,
            }));
          } else if (evt.type === "done") {
            // fall through - loop will exit when reader signals done
          }
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          patch((m) => ({
            ...m,
            content: m.content || "_(stopped)_",
          }));
        } else {
          const message = err instanceof Error ? err.message : String(err);
          toast.error("Connection error", { description: message });
          patch((m) => ({ ...m, content: m.content || `⚠ ${message}` }));
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [isStreaming, messages],
  );

  return { messages, isStreaming, send, stop, clear };
}
