import { useState } from "react";
import { Loader2, Pause, Play, RefreshCw, Trash2, Wrench } from "lucide-react";
import { api } from "../lib/tauri";
import { fmtBytes } from "../lib/format";
import { useQueue } from "../hooks/useQueue";
import { useProgress } from "../hooks/useProgress";
import { useToast } from "./Toast";
import type { SyncStatus } from "../types";

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function QueueView({ status }: { status: SyncStatus }) {
  const items = useQueue();
  const progress = useProgress();
  const paused = status.state === "paused";
  const totalBytes = items.reduce((sum, i) => sum + (i.size || 0), 0);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  const repair = async () => {
    setBusy(true);
    try {
      const r = await api.repairQueue();
      toast.success(
        `Repair done: ${r.requeued_active} unstuck, ${r.removed_missing} missing removed, ${r.resized} sizes filled in`,
      );
    } catch (e) {
      toast.error(`Repair failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const n = await api.clearQueue();
      toast.info(`Cleared ${n} item${n === 1 ? "" : "s"} from the queue`);
      setConfirmClear(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (paused ? api.resume() : api.pause())}
          title={paused ? "Resume processing the upload queue" : "Pause all uploads"}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => api.rescan()}
          disabled={busy}
          title="Re-scan all watched folders for new or changed files"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <RefreshCw size={16} /> Rescan
        </button>
        <button
          onClick={repair}
          disabled={busy}
          title="Unstick active items, remove missing files, and fill in sizes"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
          Repair
        </button>
        <button
          onClick={() => setConfirmClear(true)}
          disabled={busy || items.length === 0}
          title="Remove all pending items from the queue — files on disk are untouched"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-immich-600 hover:bg-immich-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-immich-900/30"
        >
          <Trash2 size={16} /> Clear
        </button>
        <span className="ml-auto text-sm text-slate-500">
          {status.pending} pending
          {totalBytes > 0 && ` · ${fmtBytes(totalBytes)} queued`} ·{" "}
          {status.uploaded_session} uploaded this session
        </span>
      </div>

      {confirmClear && (
        <div className="flex items-center gap-3 rounded-lg border border-immich-200 bg-immich-50 p-3 dark:border-immich-900 dark:bg-immich-900/30">
          <span className="flex-1 text-sm text-immich-800 dark:text-immich-200">
            Remove all {items.length} pending item{items.length === 1 ? "" : "s"} from
            the queue? Files on disk are untouched; they'll be re-detected on the next
            scan.
          </span>
          <button
            onClick={() => setConfirmClear(false)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={clear}
            disabled={busy}
            className="rounded-lg bg-immich-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-immich-700 disabled:opacity-50"
          >
            Clear queue
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          Nothing in the queue — you’re all caught up.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {items.map((item) => {
            const prog = progress[item.id];
            const active = item.status === "active";
            return (
              <li
                key={item.id}
                className="bg-white px-3 py-2.5 dark:bg-slate-900"
              >
                <div className="flex items-center gap-3">
                  {active ? (
                    <Loader2 size={16} className="animate-spin text-brand-500" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                  )}
                  <span className="flex-1 truncate text-sm" title={item.path}>
                    {basename(item.path)}
                  </span>
                  {active && prog ? (
                    <span className="text-xs tabular-nums text-slate-500">
                      {prog.phase === "hashing"
                        ? `Hashing ${prog.pct}%`
                        : `${fmtBytes(prog.sent)} / ${fmtBytes(prog.total)} · ${prog.pct}%`}
                    </span>
                  ) : (
                    <span className="text-xs tabular-nums text-slate-400">
                      {item.size > 0 ? fmtBytes(item.size) : item.status}
                    </span>
                  )}
                </div>
                {active && prog && (
                  <div className="mt-1.5 ml-7 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${prog.pct}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {status.pending > items.length && (
        <p className="text-center text-xs text-slate-400">
          + {(status.pending - items.length).toLocaleString()} more queued (showing
          the first {items.length.toLocaleString()})
        </p>
      )}
    </div>
  );
}
