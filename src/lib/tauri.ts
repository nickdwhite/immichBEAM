// Typed wrappers around Tauri IPC commands and events.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Album,
  AppConfig,
  ConfigDto,
  ConnectionInfo,
  FolderInspect,
  FreeableScan,
  FreeResult,
  HistoryItem,
  HistoryStats,
  ProgressPayload,
  QueueItem,
  RepairReport,
  SyncStatus,
} from "../types";

// ---- commands -----------------------------------------------------------

export const api = {
  getConfig: () => invoke<ConfigDto>("get_config"),

  testConnection: (url: string, apiKey: string | null, allowInsecure: boolean) =>
    invoke<ConnectionInfo>("test_connection", {
      url,
      apiKey,
      allowInsecure,
    }),

  saveServer: (url: string, apiKey: string | null, allowInsecure: boolean) =>
    invoke<void>("save_server", { url, apiKey, allowInsecure }),

  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),

  addFolder: (path: string, albumId: string | null = null) =>
    invoke<AppConfig>("add_folder", { path, albumId }),

  removeFolder: (path: string) => invoke<AppConfig>("remove_folder", { path }),

  clearApiKey: () => invoke<void>("clear_api_key"),

  getStatus: () => invoke<SyncStatus>("get_status"),
  defaultExtensions: () => invoke<string[]>("default_extensions"),
  getQueue: () => invoke<QueueItem[]>("get_queue"),
  getFailed: () => invoke<QueueItem[]>("get_failed"),
  getHistory: (limit = 200) => invoke<HistoryItem[]>("get_history", { limit }),

  getStats: () => invoke<HistoryStats>("get_stats"),

  pause: () => invoke<void>("pause_sync"),
  resume: () => invoke<void>("resume_sync"),
  retryFailed: () => invoke<void>("retry_failed"),
  retryItem: (id: string) => invoke<void>("retry_item", { id }),
  rescan: () => invoke<void>("rescan"),
  repairQueue: () => invoke<RepairReport>("repair_queue"),
  clearQueue: () => invoke<number>("clear_queue"),
  inspectFolder: (path: string) =>
    invoke<FolderInspect>("inspect_folder", { path }),
  getAlbums: () => invoke<Album[]>("get_albums"),
  createAlbum: (name: string) => invoke<Album>("create_album", { name }),

  startFreeableScan: (days: number) =>
    invoke<void>("start_freeable_scan", { days }),
  getFreeableState: () => invoke<FreeableScan>("get_freeable_state"),
  freeSpace: (paths: string[]) => invoke<FreeResult>("free_space", { paths }),

  getLogPath: () => invoke<string>("get_log_path"),
  readLog: (lines = 500) => invoke<string>("read_log", { lines }),
};

// ---- events -------------------------------------------------------------

export const events = {
  STATUS: "sync://status",
  QUEUE: "sync://queue-updated",
  HISTORY: "sync://history-updated",
  PROGRESS: "sync://progress",
  PROGRESS_DONE: "sync://progress-done",
  FREEABLE: "freeable://updated",
} as const;

export function onStatus(cb: (s: SyncStatus) => void): Promise<UnlistenFn> {
  return listen<SyncStatus>(events.STATUS, (e) => cb(e.payload));
}

export function onQueueChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(events.QUEUE, () => cb());
}

export function onHistoryChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(events.HISTORY, () => cb());
}

export function onProgress(cb: (p: ProgressPayload) => void): Promise<UnlistenFn> {
  return listen<ProgressPayload>(events.PROGRESS, (e) => cb(e.payload));
}

export function onProgressDone(cb: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>(events.PROGRESS_DONE, (e) => cb(e.payload));
}

export function onFreeableChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(events.FREEABLE, () => cb());
}
