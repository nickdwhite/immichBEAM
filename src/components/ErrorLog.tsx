import { RotateCcw } from "lucide-react";
import { api } from "../lib/tauri";
import { useFailed } from "../hooks/useQueue";

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function ErrorLog() {
  const items = useFailed();

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
        No failed uploads. 🎉
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {items.length} item{items.length === 1 ? "" : "s"} failed after retries.
        </p>
        <button
          onClick={() => api.retryFailed()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <RotateCcw size={16} /> Retry all
        </button>
      </div>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {items.map((item) => (
          <li key={item.id} className="bg-white px-3 py-2.5 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.path}>
                {basename(item.path)}
              </span>
              <span className="shrink-0 text-xs text-slate-400">
                {item.retries} retries
              </span>
              <button
                onClick={() => api.retryItem(item.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                title="Retry this item"
              >
                <RotateCcw size={13} /> Retry
              </button>
            </div>
            {item.error && (
              <p className="mt-1 truncate text-xs text-immich-600" title={item.error}>
                {item.error}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
