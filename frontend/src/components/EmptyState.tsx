import { MessageSquare } from "lucide-react";

interface Props {
  onPick: (text: string) => void;
}

const SUGGESTIONS = [
  "List the 5 most recent incidents",
  "Create an incident: printer offline on 3rd floor, urgency medium",
  "Search the knowledge base for VPN",
];

export function EmptyState({ onPick }: Props) {
  return (
    <div className="m-auto flex max-w-lg flex-col items-center gap-6 py-10 text-center animate-fade-up">
      <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand to-primary text-white shadow-md">
        <MessageSquare className="size-7" />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          How can I help with your MCP tools?
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          I can call any tool from your enabled MCP servers (see the MCP page).
          Try one of the prompts below, or ask your own.
        </p>
      </div>
      <div className="grid w-full gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border bg-card px-4 py-2.5 text-left text-sm text-card-foreground transition hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
