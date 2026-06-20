import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { Sidebar, type Tab } from "./components/Sidebar";
import { ActivityBar } from "./components/ActivityBar";
import { Overview } from "./components/Overview";
import { ServerSettings } from "./components/ServerSettings";
import { FolderSettings } from "./components/FolderSettings";
import { SyncSettings } from "./components/SyncSettings";
import { QueueView } from "./components/QueueView";
import { HistoryView } from "./components/HistoryView";
import { ErrorLog } from "./components/ErrorLog";
import { FreeUpSpace } from "./components/FreeUpSpace";
import { useConfig } from "./hooks/useConfig";
import { useStatus } from "./hooks/useStatus";

const TITLES: Record<Tab, string> = {
  overview: "Overview",
  queue: "Upload Queue",
  history: "History",
  errors: "Error Log",
  cleanup: "Free Up Space",
  server: "Server Settings",
  folders: "Watched Folders",
  sync: "Sync Settings",
};

function App() {
  const { config, loading, reload } = useConfig();
  const status = useStatus();
  const [tab, setTab] = useState<Tab>("overview");

  // On first load, land on Server settings until a key is configured.
  const needsSetup = !!config && (!config.has_api_key || !config.server_url);
  useEffect(() => {
    if (needsSetup) setTab("server");
  }, [needsSetup]);

  const openWeb = useMemo(
    () => () => {
      if (config?.server_url) openUrl(config.server_url).catch(() => {});
    },
    [config?.server_url],
  );

  if (loading || !config) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar tab={tab} onChange={setTab} status={status} />

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h1 className="text-lg font-semibold">{TITLES[tab]}</h1>
          {config.server_url && (
            <button
              onClick={openWeb}
              className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline"
            >
              Open Web UI <ExternalLink size={14} />
            </button>
          )}
        </header>

        <ActivityBar status={status} />

        <section className="flex-1 overflow-auto p-6">
          {tab === "overview" && <Overview config={config} status={status} />}
          {tab === "queue" && <QueueView status={status} />}
          {tab === "history" && <HistoryView />}
          {tab === "errors" && <ErrorLog />}
          {tab === "cleanup" && <FreeUpSpace />}
          {tab === "server" && <ServerSettings config={config} onSaved={reload} />}
          {tab === "folders" && <FolderSettings config={config} onSaved={reload} />}
          {tab === "sync" && <SyncSettings config={config} onSaved={reload} />}
        </section>
      </main>
    </div>
  );
}

export default App;
