import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { ExternalLink, Loader2, Usb, X } from "lucide-react";
import { api } from "./lib/tauri";
import { Sidebar, type Tab } from "./components/Sidebar";
import { ActivityBar } from "./components/ActivityBar";
import { Overview } from "./components/Overview";
import { PhotoBrowser } from "./components/PhotoBrowser";
import { ServerSettings } from "./components/ServerSettings";
import { FolderSettings } from "./components/FolderSettings";
import { SyncSettings } from "./components/SyncSettings";
import { QueueView } from "./components/QueueView";
import { HistoryView } from "./components/HistoryView";
import { FreeUpSpace } from "./components/FreeUpSpace";
import { Diagnostics } from "./components/Diagnostics";
import { About } from "./components/About";
import { ThemeToggle } from "./components/ThemeToggle";
import { useConfig } from "./hooks/useConfig";
import { useStatus } from "./hooks/useStatus";

const TITLES: Record<Tab, string> = {
  browse: "Browse",
  overview: "Overview",
  queue: "Upload Queue",
  history: "History",
  cleanup: "Free Up Space",
  server: "Server Settings",
  folders: "Watched Folders",
  sync: "Sync Settings",
  diagnostics: "Diagnostics",
  about: "About",
};

function App() {
  const { config, loading, reload } = useConfig();
  const status = useStatus();
  const [tab, setTab] = useState<Tab>("overview");
  const [dragOver, setDragOver] = useState(false);
  const [removable, setRemovable] = useState<{
    volume_name: string;
    dcim_path: string;
  } | null>(null);

  useEffect(() => {
    const unlisten = listen<{ volume_name: string; dcim_path: string }>(
      "sync://removable-detected",
      (event) => setRemovable(event.payload),
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const addRemovable = useCallback(async () => {
    if (!removable) return;
    try {
      await api.addFolder(removable.dcim_path);
      reload();
      setTab("folders");
    } catch {
      // ignored
    }
    setRemovable(null);
  }, [removable, reload]);

  const handleDrop = useCallback(
    async (paths: string[]) => {
      for (const p of paths) {
        try {
          await api.addFolder(p);
        } catch {
          // non-directory drops are silently ignored
        }
      }
      reload();
      setTab("folders");
    },
    [reload],
  );

  useEffect(() => {
    const webview = getCurrentWebview();
    const unlisten = webview.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragOver(true);
      } else if (event.payload.type === "drop") {
        setDragOver(false);
        handleDrop(event.payload.paths);
      } else {
        setDragOver(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleDrop]);

  const openWeb = useMemo(
    () => () => {
      if (config?.server_url) openUrl(config.server_url).catch(() => {});
    },
    [config?.server_url],
  );

  if (loading || !config) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 size={18} className="animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="relative flex h-full">
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-brand-600/20 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-brand-500 bg-white/90 px-8 py-6 text-center shadow-lg dark:bg-slate-900/90">
            <p className="text-lg font-semibold text-brand-700 dark:text-brand-300">
              Drop folder to add
            </p>
            <p className="mt-1 text-sm text-slate-500">
              It will be added to your watched folders
            </p>
          </div>
        </div>
      )}
      <Sidebar tab={tab} onChange={setTab} status={status} />

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h1 className="text-lg font-semibold">{TITLES[tab]}</h1>
          <div className="flex items-center gap-4">
            {config.server_url && (
              <button
                onClick={openWeb}
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline"
              >
                Open Web UI <ExternalLink size={14} />
              </button>
            )}
            <ThemeToggle />
          </div>
        </header>

        <ActivityBar status={status} />

        {removable && (
          <div className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-6 py-2.5 dark:border-blue-900 dark:bg-blue-900/20">
            <Usb size={18} className="shrink-0 text-blue-600" />
            <p className="flex-1 text-sm text-blue-800 dark:text-blue-200">
              <strong>{removable.volume_name}</strong> has a DCIM folder — sync
              photos from this device?
            </p>
            <button
              onClick={addRemovable}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Add folder
            </button>
            <button
              onClick={() => setRemovable(null)}
              className="text-blue-400 hover:text-blue-600"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <section className="flex-1 overflow-auto p-6">
          {tab === "browse" && <PhotoBrowser config={config} />}
          {tab === "overview" && (
            <Overview config={config} status={status} onNavigate={setTab} onSaved={reload} />
          )}
          {tab === "queue" && <QueueView status={status} />}
          {tab === "history" && <HistoryView serverUrl={config.server_url} />}
          {tab === "cleanup" && <FreeUpSpace />}
          {tab === "server" && <ServerSettings config={config} onSaved={reload} />}
          {tab === "folders" && <FolderSettings config={config} onSaved={reload} />}
          {tab === "sync" && <SyncSettings config={config} onSaved={reload} />}
          {tab === "diagnostics" && <Diagnostics />}
          {tab === "about" && <About />}
        </section>
      </main>
    </div>
  );
}

export default App;
