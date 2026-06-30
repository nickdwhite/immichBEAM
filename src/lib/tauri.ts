// Typed wrappers around Tauri IPC commands and events.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Album,
  AppConfig,
  AssetDetail,
  BrowseAsset,
  BrowsePage,
  ConfigDto,
  MetadataSearch,
  MapMarker,
  Person,
  Tag,
  ConnectionInfo,
  FolderInspect,
  OverviewCounts,
  FreeableScan,
  FreeResult,
  HistoryItem,
  HistoryStats,
  ProgressPayload,
  PurgeResult,
  QueueItem,
  ReorganizeResult,
  RepairReport,
  ServerFeatures,
  SyncStatus,
  UpdateInfo,
  UpdateProgress,
} from "../types";

// ---- commands -----------------------------------------------------------

export const api = {
  getConfig: () => invoke<ConfigDto>("get_config"),

  getVersionDisplay: () => invoke<string>("get_version_display"),

  testConnection: (url: string, apiKey: string | null, allowInsecure: boolean) =>
    invoke<ConnectionInfo>("test_connection", {
      url,
      apiKey,
      allowInsecure,
    }),

  checkServerFeatures: (url: string, allowInsecure: boolean) =>
    invoke<ServerFeatures>("check_server_features", { url, allowInsecure }),

  saveServer: (url: string, apiKey: string | null, allowInsecure: boolean) =>
    invoke<void>("save_server", { url, apiKey, allowInsecure }),

  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),

  addFolder: (path: string, albumId: string | null = null) =>
    invoke<AppConfig>("add_folder", { path, albumId }),

  removeFolder: (path: string) => invoke<AppConfig>("remove_folder", { path }),

  clearApiKey: () => invoke<void>("clear_api_key"),

  loginWithPassword: (
    url: string,
    email: string,
    password: string,
    allowInsecure: boolean,
  ) =>
    invoke<ConnectionInfo>("login_with_password", {
      url,
      email,
      password,
      allowInsecure,
    }),

  clearCredentials: () => invoke<void>("clear_credentials"),

  getStatus: () => invoke<SyncStatus>("get_status"),
  getConnectionInfo: () => invoke<ConnectionInfo>("get_connection_info"),
  getCertFingerprint: () => invoke<string | null>("get_cert_fingerprint"),
  forgetCertPin: () => invoke<void>("forget_cert_pin"),
  defaultExtensions: () => invoke<string[]>("default_extensions"),
  getQueue: (limit = 500) => invoke<QueueItem[]>("get_queue", { limit }),
  getFailed: () => invoke<QueueItem[]>("get_failed"),
  getHistory: (limit = 500, status?: string) =>
    invoke<HistoryItem[]>("get_history", { limit, status: status ?? null }),
  clearHistory: () => invoke<number>("clear_history"),

  getStats: () => invoke<HistoryStats>("get_stats"),
  getOverviewCounts: () => invoke<OverviewCounts>("get_overview_counts"),

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
  reorganizeAlbums: () => invoke<ReorganizeResult>("reorganize_albums"),
  suggestFolders: () => invoke<string[]>("suggest_folders"),

  startFreeableScan: (days: number) =>
    invoke<void>("start_freeable_scan", { days }),
  getFreeableState: () => invoke<FreeableScan>("get_freeable_state"),
  freeSpace: (paths: string[]) => invoke<FreeResult>("free_space", { paths }),

  getLogPath: () => invoke<string>("get_log_path"),
  readLog: (lines = 500) => invoke<string>("read_log", { lines }),
  exportLog: (destination: string, content: string) =>
    invoke<void>("export_log", { destination, content }),
  purgeOldLogs: (maxAgeDays: number) =>
    invoke<PurgeResult>("purge_old_logs", { maxAgeDays }),

  checkForUpdate: () => invoke<UpdateInfo>("check_for_update"),
  installUpdate: () => invoke<void>("install_update"),

  browseAssets: (page: number, size: number, assetType?: string) =>
    invoke<BrowsePage>("browse_assets", {
      page,
      size,
      assetType: assetType ?? null,
    }),
  browseSearch: (search: MetadataSearch) =>
    invoke<BrowsePage>("browse_search", { search }),
  browseSmart: (search: MetadataSearch) =>
    invoke<BrowsePage>("browse_smart", { search }),
  getAssetDetail: (assetId: string) =>
    invoke<AssetDetail>("get_asset_detail", { assetId }),
  browseTags: () => invoke<Tag[]>("browse_tags"),
  browsePeople: () => invoke<Person[]>("browse_people"),
  browseCities: () => invoke<AssetDetail[]>("browse_cities"),
  browseMap: () => invoke<MapMarker[]>("browse_map"),
  getLocalPath: (assetId: string) =>
    invoke<string | null>("get_local_path", { assetId }),
  browseAlbumAssets: (albumId: string) =>
    invoke<BrowseAsset[]>("browse_album_assets", { albumId }),
  downloadAsset: (assetId: string, destination: string) =>
    invoke<void>("download_asset", { assetId, destination }),
};

// ---- events -------------------------------------------------------------

export const events = {
  STATUS: "sync://status",
  QUEUE: "sync://queue-updated",
  HISTORY: "sync://history-updated",
  PROGRESS: "sync://progress",
  PROGRESS_DONE: "sync://progress-done",
  FREEABLE: "freeable://updated",
  UPDATE_PROGRESS: "update://progress",
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

export function onUpdateProgress(cb: (p: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>(events.UPDATE_PROGRESS, (e) => cb(e.payload));
}
