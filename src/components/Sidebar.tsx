import {
  FolderSync,
  HardDrive,
  History,
  Images,
  Info,
  LayoutDashboard,
  ListChecks,
  Loader2,
  ScrollText,
  Server,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/tauri";
import clsx from "clsx";
import { StatusIndicator } from "./StatusIndicator";
import { Logo } from "./Logo";
import { useFreeableRunning } from "../hooks/useFreeable";
import type { SyncStatus } from "../types";

export type Tab =
  | "browse"
  | "overview"
  | "queue"
  | "history"
  | "cleanup"
  | "server"
  | "folders"
  | "sync"
  | "diagnostics"
  | "about";

interface NavItem {
  id: Tab;
  label: string;
  Icon: typeof Server;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Library",
    items: [{ id: "browse", label: "Browse", Icon: Images }],
  },
  {
    title: "Activity",
    items: [
      { id: "overview", label: "Overview", Icon: LayoutDashboard },
      { id: "queue", label: "Queue", Icon: ListChecks },
      { id: "history", label: "History", Icon: History },
    ],
  },
  {
    title: "Settings",
    items: [
      { id: "server", label: "Server", Icon: Server },
      { id: "folders", label: "Folders", Icon: FolderSync },
      { id: "sync", label: "Sync", Icon: Settings },
    ],
  },
  {
    title: "Tools",
    items: [
      { id: "cleanup", label: "Free Up Space", Icon: HardDrive },
      { id: "diagnostics", label: "Diagnostics", Icon: ScrollText },
      { id: "about", label: "About", Icon: Info },
    ],
  },
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
  const [version, setVersion] = useState("");
  useEffect(() => {
    api.getVersionDisplay().then(setVersion).catch(() => {});
  }, []);

  return (
    <aside className="flex w-56 flex-col border-r border-slate-200 bg-white dark:border-navy-800 dark:bg-navy-900">
      <div className="flex items-center gap-2 px-4 py-4">
        <Logo size={32} className="rounded-lg" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Immich</div>
          <div className="text-xs text-slate-500">Beam</div>
        </div>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-1">
        {SECTIONS.map((section) => (
          <div key={section.title} className="space-y-0.5">
            <div className="flex items-center gap-2 px-3 pb-1">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </p>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
            {section.items.map(({ id, label, Icon }) => {
              const badge =
                id === "queue" && status.pending > 0
                  ? status.pending
                  : id === "history" && status.failed_session > 0
                    ? status.failed_session
                    : null;
              return (
                <button
                  key={id}
                  onClick={() => onChange(id)}
                  aria-current={tab === id ? "page" : undefined}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
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
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <StatusIndicator state={status.state} />
        {status.message && (
          <p className="mt-1 truncate text-xs text-slate-400" title={status.message}>
            {status.message}
          </p>
        )}
        {version && (
          <p className="mt-2 break-all text-[11px] text-slate-400">{version}</p>
        )}
      </div>
    </aside>
  );
}
