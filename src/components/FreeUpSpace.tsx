import { useCallback, useEffect, useState } from "react";
import { HardDriveDownload, Loader2, Search, Trash2 } from "lucide-react";
import { api, onFreeableChanged } from "../lib/tauri";
import { fmtBytes } from "../lib/format";
import type { FreeableScan } from "../types";

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

const EMPTY: FreeableScan = {
  running: false,
  done: false,
  scanned: 0,
  total: 0,
  items: [],
};

export function FreeUpSpace() {
  const [days, setDays] = useState(30);
  const [scan, setScan] = useState<FreeableScan>(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeing, setFreeing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await api.getFreeableState();
    setScan(s);
    // Default-select everything each time a completed result arrives.
    if (s.done && !s.running) {
      setSelected((prev) =>
        prev.size === 0 ? new Set(s.items.map((i) => i.path)) : prev,
      );
    }
  }, []);

  // Restore state on mount + follow backend scan events (survives tab switches).
  useEffect(() => {
    refresh();
    const un = onFreeableChanged(refresh);
    return () => {
      un.then((fn) => fn());
    };
  }, [refresh]);

  const startScan = async () => {
    setDoneMsg(null);
    setConfirming(false);
    setSelected(new Set());
    await api.startFreeableScan(days);
    refresh();
  };

  const selectedBytes = scan.items
    .filter((i) => selected.has(i.path))
    .reduce((sum, i) => sum + i.size, 0);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const free = async () => {
    setFreeing(true);
    try {
      const paths = scan.items.filter((i) => selected.has(i.path)).map((i) => i.path);
      const result = await api.freeSpace(paths);
      setDoneMsg(
        `Moved ${result.freed_count} file${result.freed_count === 1 ? "" : "s"} to Trash, freeing ${fmtBytes(result.freed_bytes)}.` +
          (result.errors.length ? ` ${result.errors.length} failed.` : ""),
      );
      const freed = new Set(paths);
      setScan((s) => ({ ...s, items: s.items.filter((i) => !freed.has(i.path)) }));
      setSelected(new Set());
      setConfirming(false);
    } finally {
      setFreeing(false);
    }
  };

  const items = scan.items;

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-slate-500">
        Finds photos and videos in your watched folders older than the threshold
        <em> and</em> confirmed safely backed up on your Immich server, then moves
        them to the Trash. Verified by checksum; anything in the server's trash is
        skipped. The scan runs in the background — you can leave this tab.
      </p>

      <div className="flex items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Older than (days)</span>
          <input
            type="number"
            min={0}
            value={days}
            onChange={(e) => setDays(Math.max(0, Number(e.target.value)))}
            disabled={scan.running}
            className="w-32 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
        <button
          onClick={startScan}
          disabled={scan.running || freeing}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {scan.running ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}
          {scan.running ? "Scanning…" : "Scan"}
        </button>
      </div>

      {scan.running && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
          Scanning… examined {scan.scanned.toLocaleString()}
          {scan.total > 0 && ` / ${scan.total.toLocaleString()}`} candidate files.
        </div>
      )}

      {doneMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
          {doneMsg}
        </div>
      )}

      {scan.done && !scan.running && items.length === 0 && !doneMsg && (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-slate-700">
          Nothing to free — no synced files older than {days} days were found.
        </p>
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
            <span>
              {selected.size} of {items.length} selected ·{" "}
              <strong>{fmtBytes(selectedBytes)}</strong> reclaimable
            </span>
            <button
              onClick={() =>
                setSelected(
                  selected.size === items.length
                    ? new Set()
                    : new Set(items.map((i) => i.path)),
                )
              }
              className="text-brand-600 hover:underline"
            >
              {selected.size === items.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          <ul className="max-h-80 divide-y divide-slate-200 overflow-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {items.map((i) => (
              <li
                key={i.path}
                className="flex items-center gap-3 bg-white px-3 py-2 text-sm dark:bg-slate-900"
              >
                <input
                  type="checkbox"
                  checked={selected.has(i.path)}
                  onChange={() => toggle(i.path)}
                  className="shrink-0 rounded border-slate-300 text-brand-600"
                />
                <span className="min-w-0 flex-1 truncate" title={i.path}>
                  {basename(i.path)}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {fmtBytes(i.size)}
                </span>
              </li>
            ))}
          </ul>

          {confirming ? (
            <div className="flex items-center gap-3 rounded-lg border border-immich-200 bg-immich-50 p-3 dark:border-immich-900 dark:bg-immich-900/30">
              <HardDriveDownload size={18} className="shrink-0 text-immich-600" />
              <span className="flex-1 text-sm text-immich-800 dark:text-immich-200">
                Move {selected.size} file{selected.size === 1 ? "" : "s"} (
                {fmtBytes(selectedBytes)}) to the Trash? They stay recoverable from
                your system Trash.
              </span>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={free}
                disabled={freeing}
                className="inline-flex items-center gap-2 rounded-lg bg-immich-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-immich-700 disabled:opacity-50"
              >
                {freeing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Confirm
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-immich-600 px-4 py-2 text-sm font-medium text-white hover:bg-immich-700 disabled:opacity-50"
            >
              <Trash2 size={16} /> Move {selected.size} to Trash
            </button>
          )}
        </>
      )}
    </div>
  );
}
