import { LogViewer } from "./LogViewer";

export function Diagnostics() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Application Log
        </h3>
        <p className="text-xs text-slate-500">
          Live log stream. Enable <strong>Verbose debug logging</strong> in
          Sync settings for per-file detail.
        </p>
      </div>
      <LogViewer />
    </div>
  );
}
