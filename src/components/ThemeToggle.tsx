import { Monitor, Moon, Sun } from "lucide-react";
import clsx from "clsx";
import { useTheme, type Theme } from "../lib/theme";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-label={`${label} theme`}
          aria-pressed={theme === value}
          title={`${label} theme`}
          className={clsx(
            "rounded-md p-1.5 transition-colors",
            theme === value
              ? "bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200"
              : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200",
          )}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
