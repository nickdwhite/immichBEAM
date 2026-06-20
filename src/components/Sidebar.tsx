import {
  FolderSync,
  HardDrive,
  History,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Server,
  Settings,
  AlertOctagon,
} from "lucide-react";
import clsx from "clsx";
import { StatusIndicator } from "./StatusIndicator";
import { useFreeableRunning } from "../hooks/useFreeable";
import type { SyncStatus } from "../types";

export type Tab =
  | "overview"
  | "queue"
  | "history"
  | "errors"
  | "cleanup"
  | "server"
  | "folders"
  | "sync";

const NAV: { id: Tab; label: string; Icon: typeof Server }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "queue", label: "Queue", Icon: ListChecks },
  { id: "history", label: "History", Icon: History },
  { id: "errors", label: "Errors", Icon: AlertOctagon },
  { id: "cleanup", label: "Free Up Space", Icon: HardDrive },
  { id: "server", label: "Server", Icon: Server },
  { id: "folders", label: "Folders", Icon: FolderSync },
  { id: "sync", label: "Sync", Icon: Settings },
];

export function Sidebar({
  tab,
  onChange,
  status,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  status: SyncStatus;
}) {
  const scanning = useFreeableRunning();
  return (
    <aside className="flex w-56 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-immich-500 text-white">
          <FolderSync size={18} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Immich</div>
          <div className="text-xs text-slate-500">SyncDesk</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {NAV.map(({ id, label, Icon }) => {
          const badge =
            id === "queue" && status.pending > 0
              ? status.pending
              : id === "errors" && status.failed_session > 0
                ? status.failed_session
                : null;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                tab === id
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              <span className="flex items-center gap-2">
                <Icon size={16} />
                {label}
              </span>
              {id === "cleanup" && scanning ? (
                <Loader2 size={14} className="animate-spin text-brand-500" />
              ) : (
                badge !== null && (
                  <span className="rounded-full bg-immich-500 px-1.5 text-xs text-white">
                    {badge}
                  </span>
                )
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <StatusIndicator state={status.state} />
        {status.message && (
          <p className="mt-1 truncate text-xs text-slate-400" title={status.message}>
            {status.message}
          </p>
        )}
      </div>
    </aside>
  );
}
