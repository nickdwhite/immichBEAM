import { useState } from "react";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { Loader2, Save, Trash2 } from "lucide-react";
import { api } from "../lib/tauri";
import { useToast } from "./Toast";
import type { ConfigDto, ConflictPolicy } from "../types";

export function SyncSettings({
  config,
  onSaved,
}: {
  config: ConfigDto;
  onSaved: () => void;
}) {
  const [concurrency, setConcurrency] = useState(config.concurrency);
  const [bandwidth, setBandwidth] = useState(config.bandwidth_limit_kbps);
  const [autostart, setAutostart] = useState(config.autostart);
  const [debug, setDebug] = useState(config.debug_logging);
  const [notifications, setNotifications] = useState(config.notifications_enabled);
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>(config.conflict_policy);
  const [logRetention, setLogRetention] = useState(config.log_retention_days);
  const [purging, setPurging] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const save = async () => {
    setSaving(true);
    try {
      // Apply OS autostart registration via the plugin.
      try {
        if (autostart) await enable();
        else await disable();
      } catch {
        /* autostart may be unavailable in dev; ignore */
      }
      await api.saveConfig({
        ...config,
        concurrency,
        bandwidth_limit_kbps: bandwidth,
        autostart,
        debug_logging: debug,
        notifications_enabled: notifications,
        conflict_policy: conflictPolicy,
        log_retention_days: logRetention,
      });
      onSaved();
      toast.success("Sync settings saved");
    } catch (e) {
      toast.error(`Couldn't save settings: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Performance
        </h3>
        <label className="flex items-center justify-between text-sm font-medium" title="How many files to upload at once — higher values use more bandwidth and CPU">
          Upload concurrency
          <span className="font-mono text-brand-600">{concurrency}</span>
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={concurrency}
          onChange={(e) => setConcurrency(Number(e.target.value))}
          className="mt-2 w-full accent-brand-600"
        />
        <p className="text-xs text-slate-400">
          Number of files uploaded simultaneously.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" title="Cap upload speed to avoid saturating your network — 0 means no limit">
          Bandwidth limit (KB/s)
        </label>
        <input
          type="number"
          min={0}
          value={bandwidth}
          onChange={(e) => setBandwidth(Math.max(0, Number(e.target.value)))}
          className="w-40 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
        <p className="mt-1 text-xs text-slate-400">0 = unlimited.</p>
      </div>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Behavior
        </h3>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm" title="Start Immich Beam when you log in to your computer">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
              className="rounded border-slate-300 text-brand-600"
            />
            Launch automatically on login
          </label>

          <label className="flex items-center gap-2 text-sm" title="Show a system notification when uploads fail or complete">
            <input
              type="checkbox"
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
              className="rounded border-slate-300 text-brand-600"
            />
            Desktop notifications
          </label>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Conflict Resolution
        </h3>
        <label className="mb-1 block text-sm font-medium" title="What happens when a file you already uploaded changes on disk">
          When a synced file changes
        </label>
        <select
          value={conflictPolicy}
          onChange={(e) => setConflictPolicy(e.target.value as ConflictPolicy)}
          className="rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="reupload">Re-upload the new version</option>
          <option value="skip">Skip (keep the original)</option>
        </select>
        <p className="mt-1 text-xs text-slate-400">
          Applies when a file you&apos;ve already uploaded is modified on disk.
        </p>
      </div>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Diagnostics
        </h3>
        <label className="flex items-center gap-2 text-sm" title="Enable per-file logging of hashes, duplicate checks, and upload steps">
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => setDebug(e.target.checked)}
            className="rounded border-slate-300 text-brand-600"
          />
          Verbose debug logging
        </label>
        <p className="mt-1 text-xs text-slate-400">
          Logs each file's hash, duplicate-check, and upload step. Useful when
          diagnosing sync problems; save to apply.
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium" title="Automatically delete rotated log files older than this many days — 0 keeps logs forever">
            Log retention (days)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              value={logRetention}
              onChange={(e) => setLogRetention(Math.max(0, Number(e.target.value)))}
              className="w-24 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              onClick={async () => {
                setPurging(true);
                try {
                  const r = await api.purgeOldLogs(logRetention);
                  if (r.deleted === 0) {
                    toast.success("No old log files to remove");
                  } else {
                    const mb = (r.freed_bytes / 1_048_576).toFixed(1);
                    toast.success(`Purged ${r.deleted} log file${r.deleted === 1 ? "" : "s"} (${mb} MB freed)`);
                  }
                } catch (e) {
                  toast.error(`Purge failed: ${e}`);
                } finally {
                  setPurging(false);
                }
              }}
              disabled={purging || logRetention === 0}
              title="Delete rotated log files older than the retention period"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {purging ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Purge now
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            0 = keep forever. Only rotated files are purged; the active log is never deleted.
          </p>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Save settings
      </button>
      </div>
    </div>
  );
}
