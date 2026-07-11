import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ComposerHandle {
  focus: () => void;
  setValue: (v: string) => void;
}

interface Props {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { isStreaming, onSend, onStop },
  ref,
) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
      setValue: (v: string) => {
        setValue(v);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      },
    }),
    [],
  );

  // Auto-resize the textarea to fit content up to a cap.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setValue("");
  }, [isStreaming, onSend, value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Global "/" keybind to focus the input (unless already typing somewhere).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      textareaRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm",
        "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15",
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder="Message the assistant…  (Enter to send, Shift+Enter for newline)"
        className="flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground scrollbar-thin"
        style={{ maxHeight: 200 }}
      />
      {isStreaming ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onStop}
          aria-label="Stop generating"
          title="Stop generating"
          className="rounded-full text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
        >
          <Square className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={!value.trim()}
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      )}
    </form>
  );
});
