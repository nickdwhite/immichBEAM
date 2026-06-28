// Types mirroring the Rust backend's serialized structs.

export interface WatchedFolder {
  path: string;
  enabled: boolean;
  album_id: string | null;
  recursive: boolean;
}

export type ConflictPolicy = "reupload" | "skip";

export type AuthMethodConfig = "api_key" | "password";

export type AlbumMode = "off" | "device" | "folder";

export interface ServerFeatures {
  oauth: boolean;
  password_login: boolean;
}

export interface AppConfig {
  server_url: string;
  allow_insecure: boolean;
  folders: WatchedFolder[];
  include_extensions: string[];
  concurrency: number;
  bandwidth_limit_kbps: number;
  autostart: boolean;
  device_id: string;
  paused: boolean;
  debug_logging: boolean;
  notifications_enabled: boolean;
  conflict_policy: ConflictPolicy;
  auth_method: AuthMethodConfig;
  album_mode: AlbumMode;
  device_album_id: string | null;
  log_retention_days: number;
}

export interface ConfigDto extends AppConfig {
  has_api_key: boolean;
}

export interface ConnectionInfo {
  reachable: boolean;
  authenticated: boolean;
  version: string | null;
  user_email: string | null;
  is_admin: boolean;
  insecure: boolean;
  message: string;
}

export type SyncState = "idle" | "syncing" | "paused" | "error" | "offline";

export type IconKey =
  | "disconnected"
  | "insecure"
  | "secure"
  | "syncing"
  | "paused";

export interface SyncStatus {
  state: SyncState;
  icon: IconKey;
  secure: boolean;
  pending: number;
  active: number;
  uploaded_session: number;
  failed_session: number;
  message: string;
}

export type ItemStatus =
  | "pending"
  | "active"
  | "success"
  | "duplicate"
  | "skipped"
  | "unsupported"
  | "failed";

export interface QueueItem {
  id: string;
  path: string;
  priority: number;
  status: ItemStatus;
  retries: number;
  error: string | null;
  size: number;
}

export interface HistoryItem {
  id: string;
  filename: string;
  asset_id: string | null;
  status: ItemStatus;
  uploaded_at: number;
  reason: string | null;
}

export interface Album {
  id: string;
  album_name: string;
  asset_count: number;
}

export interface HistoryStats {
  total: number;
  success: number;
  duplicate: number;
  skipped: number;
  failed: number;
  last_uploaded_at: number | null;
}

export interface ProgressPayload {
  id: string;
  path: string;
  phase: "hashing" | "uploading";
  sent: number;
  total: number;
  pct: number;
}

export interface FreeableItem {
  path: string;
  size: number;
  mtime: number;
  asset_id: string | null;
}

export interface FreeResult {
  freed_count: number;
  freed_bytes: number;
  errors: string[];
}

export interface FreeableScan {
  running: boolean;
  done: boolean;
  scanned: number;
  total: number;
  items: FreeableItem[];
}

export interface RepairReport {
  requeued_active: number;
  removed_missing: number;
  resized: number;
}

export interface ReorganizeResult {
  added: number;
  errors: string[];
}

export interface FolderInspect {
  file_count: number;
  total_bytes: number;
}

export interface PurgeResult {
  deleted: number;
  freed_bytes: number;
}

export interface UpdateInfo {
  available: boolean;
  version: string | null;
  current_version: string | null;
  notes: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  pct: number;
}
