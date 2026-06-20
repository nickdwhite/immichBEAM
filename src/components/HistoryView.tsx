import clsx from "clsx";
import { useHistory } from "../hooks/useHistory";
import type { ItemStatus } from "../types";

const BADGE: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  duplicate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  skipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  unsupported: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-immich-100 text-immich-700 dark:bg-immich-900/40 dark:text-immich-300",
};

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function HistoryView() {
  const items = useHistory();

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
        No uploads yet.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
          <tr>
            <th className="px-3 py-2 font-medium">File</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((h) => (
            <tr key={h.id} className="bg-white dark:bg-slate-900">
              <td className="max-w-xs truncate px-3 py-2" title={h.filename}>
                {h.filename}
              </td>
              <td className="px-3 py-2">
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    BADGE[h.status as ItemStatus] ?? BADGE.duplicate,
                  )}
                >
                  {h.status}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-slate-400">{fmt(h.uploaded_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
