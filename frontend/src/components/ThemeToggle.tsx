import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { effective, toggle } = useTheme();
  const isDark = effective === "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? <Sun /> : <Moon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? "Light mode" : "Dark mode"}
      </TooltipContent>
    </Tooltip>
  );
}
