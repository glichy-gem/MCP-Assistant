import type { ChatEvent } from "@/types";

interface OutgoingMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Post a chat turn and yield parsed SSE events from the backend one by one.
 * The backend emits `data: <json>\n\n` frames — we split on the blank line
 * and JSON-parse each `data:` payload.
 */
export async function* streamChat(
  messages: OutgoingMessage[],
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const resp = await fetch("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Chat request failed: HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        try {
          yield JSON.parse(payload) as ChatEvent;
        } catch {
          // ignore malformed frame; keep reading
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
