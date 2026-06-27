import {
  CheckCircle2,
  Copy,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { api } from "../lib/tauri";
import { useStats } from "../hooks/useStats";
import { StatusIndicator } from "./StatusIndicator";
import { SecurityBadge } from "./SecurityBadge";
import { Onboarding } from "./Onboarding";
import type { Tab } from "./Sidebar";
import type { ConfigDto, SyncStatus } from "../types";

function StatCard({
  label,
  value,
  Icon,
  color,
}: {
  label: string;
  value: number;
  Icon: typeof CheckCircle2;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className={`mb-2 inline-flex rounded-lg p-2 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function Overview({
  config,
  status,
  onNavigate,
  onSaved,
}: {
  config: ConfigDto;
  status: SyncStatus;
  onNavigate: (t: Tab) => void;
  onSaved: () => void;
}) {
  const stats = useStats();
  const paused = status.state === "paused";

  return (
    <div className="space-y-6">
      <Onboarding config={config} onNavigate={onNavigate} onSaved={onSaved} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-1">
          <StatusIndicator state={status.state} size={22} />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <SecurityBadge url={config.server_url} />
            <span>· last upload {timeAgo(stats.last_uploaded_at)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => (paused ? api.resume() : api.pause())}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => api.rescan()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <RefreshCw size={16} /> Rescan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Uploaded"
          value={stats.success}
          Icon={CheckCircle2}
          color="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
        />
        <StatCard
          label="Duplicates"
          value={stats.duplicate}
          Icon={Copy}
          color="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        />
        <StatCard
          label="In queue"
          value={status.pending}
          Icon={ListChecks}
          color="bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          Icon={XCircle}
          color="bg-immich-100 text-immich-600 dark:bg-immich-900/40 dark:text-immich-300"
        />
      </div>

      <p className="text-xs text-slate-400">
        {stats.total} total items processed · {config.folders.length} folder
        {config.folders.length === 1 ? "" : "s"} watched ·{" "}
        {status.uploaded_session} uploaded this session
      </p>
    </div>
  );
}
