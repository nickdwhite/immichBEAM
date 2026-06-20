import { useState } from "react";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { Loader2, Save } from "lucide-react";
import { api } from "../lib/tauri";
import { LogViewer } from "./LogViewer";
import type { ConfigDto } from "../types";

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
  const [saving, setSaving] = useState(false);

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
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <label className="flex items-center justify-between text-sm font-medium">
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
        <label className="mb-1 block text-sm font-medium">
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autostart}
          onChange={(e) => setAutostart(e.target.checked)}
          className="rounded border-slate-300 text-brand-600"
        />
        Launch Immich SyncDesk automatically on login
      </label>

      <div>
        <label className="flex items-center gap-2 text-sm">
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
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Save settings
      </button>

      <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
        <LogViewer />
      </div>
    </div>
  );
}
