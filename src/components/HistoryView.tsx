import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, onHistoryChanged } from "../lib/tauri";
import { useFailed } from "../hooks/useQueue";
import { useToast } from "./Toast";
import type { HistoryItem, ItemStatus } from "../types";

const BADGE: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  duplicate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  skipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  unsupported: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  failed: "bg-immich-100 text-immich-700 dark:bg-immich-900/40 dark:text-immich-300",
};

const FILTERS = ["all", "success", "duplicate", "skipped", "unsupported", "failed"] as const;

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function HistoryView() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  // Failed queue items are retryable; index by id so failed history rows can
  // surface a Retry button (history and queue share the same item id).
  const failed = useFailed();
  const retryable = new Set(failed.map((f) => f.id));

  const retryAll = async () => {
    await api.retryFailed().catch(() => {});
    toast.info(`Retrying ${failed.length} failed item${failed.length === 1 ? "" : "s"}`);
  };

  const retryOne = async (id: string) => {
    await api.retryItem(id).catch(() => {});
    toast.info("Retrying upload");
  };

  const refresh = useCallback(() => {
    api
      .getHistory(500, filter === "all" ? undefined : filter)
      .then(setItems)
      .catch(() => {});
  }, [filter]);

  useEffect(() => {
    refresh();
    const un = onHistoryChanged(refresh);
    return () => {
      un.then((fn) => fn());
    };
  }, [refresh]);

  const clear = async () => {
    try {
      const n = await api.clearHistory();
      toast.info(`Cleared ${n} history ${n === 1 ? "entry" : "entries"}`);
      setConfirmClear(false);
    } catch (e) {
      toast.error(`Couldn't clear history: ${e}`);
    }
  };

  const q = search.trim().toLowerCase();
  const shown = q
    ? items.filter((h) => h.filename.toLowerCase().includes(q))
    : items;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}
          className="rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === "all" ? "All statuses" : f[0].toUpperCase() + f.slice(1)}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search filename…"
          className="flex-1 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
        {failed.length > 0 && (
          <button
            onClick={retryAll}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            <RotateCcw size={15} /> Retry all ({failed.length})
          </button>
        )}
        {confirmClear ? (
          <span className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setConfirmClear(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={clear}
              className="rounded-lg bg-immich-600 px-3 py-1.5 font-medium text-white hover:bg-immich-700"
            >
              Clear all
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            disabled={items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Trash2 size={15} /> Clear
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          {items.length === 0 ? "No uploads yet." : "No entries match your filter."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {shown.map((h) => (
                <tr key={h.id} className="bg-white dark:bg-slate-900">
                  <td className="max-w-xs px-3 py-2">
                    <div className="truncate" title={h.filename}>
                      {h.filename}
                    </div>
                    {h.reason && (
                      <div
                        className="truncate text-[11px] text-slate-400"
                        title={h.reason}
                      >
                        {h.reason}
                      </div>
                    )}
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
                  <td className="px-3 py-2 text-right">
                    {retryable.has(h.id) && (
                      <button
                        onClick={() => retryOne(h.id)}
                        title="Retry this upload"
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <RotateCcw size={13} /> Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
