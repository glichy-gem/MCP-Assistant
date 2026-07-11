import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  variant?: "mark" | "wordmark";
}

/**
 * Brand mark. If you drop an SVG or PNG at `frontend/public/logo.svg`
 * (or `frontend/public/logo.png`), it is served at `/logo.svg` and shown here.
 * Otherwise a text-based "servicenow" wordmark falls in as a placeholder.
 *
 * Priority:
 *   1. /logo.svg  (Vite serves anything in frontend/public/ at the root)
 *   2. /logo.png
 *   3. text fallback
 */
const CANDIDATES = ["/logo.svg", "/logo.png", "/image.svg", "/image.png"];

export function SnLogo({ className, variant = "mark" }: Props) {
  const [idx, setIdx] = useState(0);
  const failed = idx >= CANDIDATES.length;
  const src = failed ? null : CANDIDATES[idx];

  if (variant === "wordmark") {
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        <Mark
          src={src}
          failed={failed}
          onError={() => setIdx((i) => i + 1)}
          className="size-8"
        />
        {failed && (
          <span className="font-semibold tracking-tight text-emerald-400">
            servicenow
          </span>
        )}
      </span>
    );
  }
  return (
    <Mark
      src={src}
      failed={failed}
      onError={() => setIdx((i) => i + 1)}
      className={className}
    />
  );
}

function Mark({
  src,
  failed,
  onError,
  className,
}: {
  src: string | null;
  failed: boolean;
  onError: () => void;
  className?: string;
}) {
  if (failed || !src) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-md bg-emerald-500 text-[10px] font-extrabold tracking-tight text-emerald-950",
          className,
        )}
        aria-label="ServiceNow"
      >
        SN
      </div>
    );
  }
  return (
    <img
      src={src}
      onError={onError}
      alt="ServiceNow"
      loading="lazy"
      decoding="async"
      className={cn("object-contain", className)}
    />
  );
}
