import { useEffect, useState } from "react";
import { Check, ChevronRight, Circle, FolderPlus } from "lucide-react";
import { api } from "../lib/tauri";
import { isServerConfigured } from "../lib/config";
import type { ConfigDto } from "../types";
import type { Tab } from "./Sidebar";

/** First-run checklist; hides itself once setup is complete. */
export function Onboarding({
  config,
  onNavigate,
  onSaved,
}: {
  config: ConfigDto;
  onNavigate: (t: Tab) => void;
  onSaved: () => void;
}) {
  const serverDone = isServerConfigured(config);
  const folderDone = config.folders.length > 0;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (serverDone && !folderDone) {
      api.suggestFolders().then(setSuggestions).catch(() => {});
    }
  }, [serverDone, folderDone]);

  if (serverDone && folderDone) return null;

  const addSuggested = async (path: string) => {
    setAdding(path);
    try {
      await api.addFolder(path);
      setSuggestions((s) => s.filter((p) => p !== path));
      onSaved();
    } catch {
      // Folder tab will show the error
    } finally {
      setAdding(null);
    }
  };

  const steps: { done: boolean; label: string; tab: Tab; cta: string }[] = [
    {
      done: serverDone,
      label: "Connect your Immich server",
      tab: "server",
      cta: "Set up",
    },
    {
      done: folderDone,
      label: "Add a folder to back up",
      tab: "folders",
      cta: "Add folder",
    },
  ];

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-900/20">
      <h3 className="text-sm font-semibold text-brand-800 dark:text-brand-200">
        Get started
      </h3>
      <p className="text-xs text-brand-700/80 dark:text-brand-300/80">
        A couple of steps and immichBEAM will start backing up your photos.
      </p>
      <ul className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            {s.done ? (
              <Check size={16} className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={16} className="shrink-0 text-slate-300" />
            )}
            <span
              className={
                s.done
                  ? "text-slate-400 line-through"
                  : "text-slate-700 dark:text-slate-200"
              }
            >
              {s.label}
            </span>
            {!s.done && (
              <button
                onClick={() => onNavigate(s.tab)}
                className="ml-auto inline-flex items-center gap-0.5 rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700"
              >
                {s.cta} <ChevronRight size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {serverDone && !folderDone && suggestions.length > 0 && (
        <div className="mt-3 border-t border-brand-200 pt-3 dark:border-brand-800">
          <p className="mb-2 text-xs font-medium text-brand-700 dark:text-brand-300">
            Suggested folders on this computer:
          </p>
          <ul className="space-y-1">
            {suggestions.map((path) => (
              <li
                key={path}
                className="flex items-center gap-2 rounded-md bg-white/60 px-2 py-1.5 text-xs dark:bg-slate-800/60"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-slate-600 dark:text-slate-300">
                  {path}
                </span>
                <button
                  onClick={() => addSuggested(path)}
                  disabled={adding !== null}
                  className="inline-flex shrink-0 items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  <FolderPlus size={12} />
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
