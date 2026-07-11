import { useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Server, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolCallRecord } from "@/types";

interface Props {
  call: ToolCallRecord;
}

export function ToolCallCard({ call }: Props) {
  const [open, setOpen] = useState(call.status === "running");
  const statusBadge = (() => {
    if (call.status === "running")
      return (
        <Badge variant="warn" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          running
        </Badge>
      );
    if (call.status === "error")
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="size-3" />
          error
        </Badge>
      );
    return (
      <Badge variant="ok" className="gap-1">
        <CheckCircle2 className="size-3" />
        done
      </Badge>
    );
  })();

  const argsJson = JSON.stringify(call.args, null, 2);

  return (
    <div className="animate-fade-up rounded-xl border bg-card text-card-foreground shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]"
      >
        <Wrench className="size-3.5 text-primary" />
        <span className="font-mono font-semibold">{call.name}</span>
        <div className="ml-auto flex items-center gap-2">
          {statusBadge}
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>
      {open && (
        <div className="border-t px-3 pb-3 pt-2 text-xs">
          <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Arguments
          </div>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11.5px] leading-snug scrollbar-thin">
            {argsJson}
          </pre>
          {call.preview !== undefined && (
            <>
              <div className="mb-1 mt-2.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Result
              </div>
              <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-[11.5px] leading-snug scrollbar-thin">
                {call.preview || "(empty)"}
              </pre>
            </>
          )}
        </div>
      )}
      {call.server && (
        <div className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <Server className="size-3 shrink-0" />
          <span className="truncate">via {call.server}</span>
        </div>
      )}
    </div>
  );
}
