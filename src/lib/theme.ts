import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "theme";

export function getStoredTheme(): Theme {
  const t = localStorage.getItem(KEY);
  return t === "light" || t === "dark" || t === "system" ? t : "system";
}

/** Apply the effective light/dark choice to the <html> element. */
export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  // Keep native controls (scrollbars, inputs) in step with the chosen theme.
  root.style.colorScheme = dark ? "dark" : "light";
}

/** Theme state persisted to localStorage; follows the OS when set to system. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(KEY, t);
    setThemeState(t);
  };

  return [theme, setTheme];
}
