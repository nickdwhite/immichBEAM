import { LogViewer } from "./LogViewer";

export function Diagnostics() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Live application log. For per-file detail (hashing, duplicate checks,
        uploads), enable <strong>Verbose debug logging</strong> in the Sync tab.
      </p>
      <LogViewer />
    </div>
  );
}
