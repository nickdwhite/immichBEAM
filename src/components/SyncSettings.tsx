import { useState } from "react";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { Loader2, Save, Trash2 } from "lucide-react";
import { api } from "../lib/tauri";
import { useToast } from "./Toast";
import type { ConfigDto, ConflictPolicy } from "../types";

const BW_STOPS = [0, 256, 512, 1024, 2048, 5120, 10240, 51200, 102400];

function fmtBw(kbps: number): string {
  if (kbps === 0) return "Unlimited";
  if (kbps >= 1024) {
    const mb = kbps / 1024;
    return `${mb % 1 === 0 ? mb.toFixed(0) : mb.toFixed(1)} MB/s`;
  }
  return `${kbps} KB/s`;
}

function closestStopIndex(kbps: number): number {
  if (kbps === 0) return 0;
  let best = 0;
  let bestDist = Math.abs(BW_STOPS[0] - kbps);
  for (let i = 1; i < BW_STOPS.length; i++) {
    const dist = Math.abs(BW_STOPS[i] - kbps);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

function BandwidthPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [unit, setUnit] = useState<"kbps" | "mbps">("mbps");

  const sliderIndex = closestStopIndex(value);

  const startEdit = () => {
    if (value === 0) {
      setDraft("");
      setUnit("mbps");
    } else if (value >= 1024) {
      setDraft(String(value / 1024));
      setUnit("mbps");
    } else {
      setDraft(String(value));
      setUnit("kbps");
    }
    setEditing(true);
  };

  const commitEdit = () => {
    const num = Number(draft);
    if (draft === "" || Number.isNaN(num) || num <= 0) {
      onChange(0);
    } else {
      onChange(Math.round(unit === "mbps" ? num * 1024 : num));
    }
    setEditing(false);
  };

  return (
    <div>
      <label className="flex items-center justify-between text-sm font-medium" title="Cap upload speed to avoid saturating your network — 0 means no limit">
        Bandwidth limit
        {editing ? (
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              autoFocus
              value={draft}
              placeholder="0"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-20 rounded-md border-slate-300 px-2 py-0.5 text-right text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <select
              value={unit}
              onChange={(e) => {
                const next = e.target.value as "kbps" | "mbps";
                const num = Number(draft);
                if (!Number.isNaN(num) && num > 0) {
                  if (unit === "kbps" && next === "mbps") setDraft(String(num / 1024));
                  if (unit === "mbps" && next === "kbps") setDraft(String(num * 1024));
                }
                setUnit(next);
              }}
              className="rounded-md border-slate-300 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="kbps">KB/s</option>
              <option value="mbps">MB/s</option>
            </select>
            <button
              type="button"
              onClick={commitEdit}
              className="rounded-md bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              Set
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="font-mono text-brand-600 underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {fmtBw(value)}
          </button>
        )}
      </label>
      <input
        type="range"
        min={0}
        max={BW_STOPS.length - 1}
        value={sliderIndex}
        onChange={(e) => {
          onChange(BW_STOPS[Number(e.target.value)]);
          setEditing(false);
        }}
        className="mt-2 w-full accent-brand-600"
      />
      <p className="text-xs text-slate-400">
        Drag the slider or click the value to set a custom limit.
      </p>
    </div>
  );
}

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
  const [pollInterval, setPollInterval] = useState(config.poll_interval_secs);
  const [healthProbe, setHealthProbe] = useState(config.health_probe_secs);
  const [followSymlinks, setFollowSymlinks] = useState(config.follow_symlinks);
  const [debounceSecs, setDebounceSecs] = useState(config.debounce_secs);
  const [maxRetries, setMaxRetries] = useState(config.max_retries);
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
        poll_interval_secs: pollInterval,
        health_probe_secs: healthProbe,
        follow_symlinks: followSymlinks,
        debounce_secs: debounceSecs,
        max_retries: maxRetries,
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

      <BandwidthPicker value={bandwidth} onChange={setBandwidth} />

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
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Advanced
        </h3>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" title="How long to wait after a file change before processing it — prevents duplicate events from rapid saves">
              Debounce window (seconds)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={debounceSecs}
              onChange={(e) => setDebounceSecs(Math.max(1, Number(e.target.value)))}
              className="w-24 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <p className="mt-1 text-xs text-slate-400">
              Delay after detecting a file change before queuing it for upload.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" title="How often to check for changes on network-mounted folders (NFS, SMB) where native file events aren't available">
              Poll interval (seconds)
            </label>
            <input
              type="number"
              min={5}
              max={300}
              value={pollInterval}
              onChange={(e) => setPollInterval(Math.max(5, Number(e.target.value)))}
              className="w-24 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <p className="mt-1 text-xs text-slate-400">
              Used for NFS/SMB mounts where native file-system events are unavailable.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" title="How often to verify that watched folders are still reachable — catches unmounted drives and dropped network shares">
              Health probe interval (seconds)
            </label>
            <input
              type="number"
              min={10}
              max={600}
              value={healthProbe}
              onChange={(e) => setHealthProbe(Math.max(10, Number(e.target.value)))}
              className="w-24 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <p className="mt-1 text-xs text-slate-400">
              Checks whether watched folders are still accessible (mount still alive, etc.).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" title="Maximum number of times a failed upload is retried before it is permanently marked as failed">
              Max upload retries
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Math.max(1, Number(e.target.value)))}
              className="w-24 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <p className="mt-1 text-xs text-slate-400">
              How many times a failed upload is retried before giving up.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm" title="Traverse symbolic links when scanning folders — enable if your media is organized with symlinks">
            <input
              type="checkbox"
              checked={followSymlinks}
              onChange={(e) => setFollowSymlinks(e.target.checked)}
              className="rounded border-slate-300 text-brand-600"
            />
            Follow symbolic links
          </label>
          <p className="text-xs text-slate-400">
            When enabled, symlinked files and directories are included in folder scans.
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
