import { Check, ChevronRight, Circle } from "lucide-react";
import type { ConfigDto } from "../types";
import type { Tab } from "./Sidebar";

/** First-run checklist; hides itself once setup is complete. */
export function Onboarding({
  config,
  onNavigate,
}: {
  config: ConfigDto;
  onNavigate: (t: Tab) => void;
}) {
  const serverDone = config.has_api_key && !!config.server_url;
  const folderDone = config.folders.length > 0;
  if (serverDone && folderDone) return null;

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
        A couple of steps and SyncDesk will start backing up your photos.
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
    </div>
  );
}
