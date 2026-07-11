import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "snmcp.theme";

function resolveEffective(t: Theme): "light" | "dark" {
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return t;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored ?? "system";
  });

  useEffect(() => {
    const effective = resolveEffective(theme);
    document.documentElement.classList.toggle("dark", effective === "dark");
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      document.documentElement.classList.toggle("dark", media.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolveEffective(theme) === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return { theme, effective: resolveEffective(theme), setTheme, toggle };
}
