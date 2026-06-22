import { Loader2 } from "lucide-react";
import { fmtBytes } from "../lib/format";
import { useProgress } from "../hooks/useProgress";
import type { SyncStatus } from "../types";

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Always-visible strip (sits under the header) showing live upload activity.
 * Renders only while syncing or when an upload is in flight.
 */
export function ActivityBar({ status }: { status: SyncStatus }) {
  const progress = useProgress();
  const active = Object.values(progress);
  const syncing = status.state === "syncing";

  if (!syncing && active.length === 0) return null;

  // Surface the largest in-flight file as the headline.
  const current = active.slice().sort((a, b) => b.total - a.total)[0];
  const others = active.length - 1;

  return (
    <div className="border-b border-slate-200 bg-brand-50/60 px-6 py-2 dark:border-slate-800 dark:bg-brand-900/20">
      <div className="flex items-center gap-3">
        <Loader2 size={15} className="shrink-0 animate-spin text-brand-600" />
        <span className="min-w-0 flex-1 truncate text-sm">
          {current ? (
            <>
              <span className="font-medium">
                {current.phase === "hashing" ? "Hashing" : "Uploading"}
              </span>{" "}
              <span title={current.path}>{basename(current.path)}</span>
              <span className="text-slate-500">
                {" "}
                — {current.pct}%
                {current.phase === "uploading" &&
                  ` · ${fmtBytes(current.sent)}/${fmtBytes(current.total)}`}
                {others > 0 && ` (+${others} more)`}
              </span>
            </>
          ) : (
            <span className="font-medium">Syncing…</span>
          )}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {status.pending} queued · {status.uploaded_session} done
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900/40">
        {current ? (
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${current.pct}%` }}
          />
        ) : (
          // Indeterminate sweep while small files flash through.
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-400" />
        )}
      </div>
    </div>
  );
}
