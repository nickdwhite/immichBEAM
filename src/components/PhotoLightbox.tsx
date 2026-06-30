import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Archive,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  MapPin,
  Play,
  Star,
  Tag,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { assetUrl, personUrl, videoUrl } from "../lib/assetUrl";
import { api } from "../lib/tauri";
import { fmtBytes } from "../lib/format";
import { useToast } from "./Toast";
import type { AssetDetail, BrowseAsset } from "../types";

function fmtDate(s?: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

function fmtDuration(s?: string | null): string | null {
  if (!s) return null;
  // Older Immich: "H:MM:SS.ffffff" (or "MM:SS.ffffff"). Newer: ms as a number
  // string. Handle both.
  if (s.includes(":")) {
    const parts = s.split(".")[0].split(":").map(Number);
    if (parts.some(Number.isNaN)) return null;
    const [h, m, sec] = parts.length === 3 ? parts : [0, ...parts];
    if (h === 0 && m === 0 && sec === 0) return null; // images / no duration
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  const ms = Number(s);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd
        className="truncate text-slate-800 dark:text-slate-200"
        title={typeof children === "string" ? children : undefined}
      >
        {children}
      </dd>
    </div>
  );
}

// Shared theme-aware styles for the overlay's buttons + chips.
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium " +
  "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-white/10 dark:text-white dark:hover:bg-white/20";
const closeCls =
  "inline-flex items-center rounded-lg p-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 " +
  "dark:bg-white/10 dark:text-white dark:hover:bg-white/20";
const chipCls =
  "inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] " +
  "font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200";

export function PhotoLightbox({
  asset,
  serverUrl,
  onClose,
  onPersonClick,
}: {
  asset: BrowseAsset;
  serverUrl: string;
  onClose: () => void;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState<boolean>(() => {
    try {
      return localStorage.getItem("immich-beam:autoplay-video") !== "off";
    } catch {
      return true;
    }
  });
  const toggleAutoplay = () =>
    setAutoplay((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("immich-beam:autoplay-video", next ? "on" : "off");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  const toast = useToast();
  const isVideo = asset.type === "VIDEO";
  const exif = detail?.exifInfo ?? null;

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLocalPath(null);
    (async () => {
      const [d, lp] = await Promise.allSettled([
        api.getAssetDetail(asset.id),
        api.getLocalPath(asset.id),
      ]);
      if (cancelled) return;
      if (d.status === "fulfilled") setDetail(d.value);
      if (lp.status === "fulfilled") setLocalPath(lp.value);
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  // Close on Escape key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = async () => {
    setDownloading(true);
    try {
      const fallbackExt = isVideo ? "mp4" : "jpg";
      const ext =
        asset.originalFileName?.split(".").pop()?.toLowerCase() ?? fallbackExt;
      const defaultName = asset.originalFileName ?? `${asset.id}.${ext}`;
      const dest = await save({ defaultPath: defaultName });
      if (!dest) return;
      await api.downloadAsset(asset.id, dest);
      toast.success(`Saved to ${dest}`);
    } catch (e) {
      toast.error(`Download failed: ${e}`);
    } finally {
      setDownloading(false);
    }
  };

  const camera = [exif?.make, exif?.model].filter(Boolean).join(" ");
  const settings = [
    exif?.fNumber != null && `ƒ/${exif.fNumber}`,
    exif?.iso != null && `ISO ${exif.iso}`,
    exif?.focalLength != null && `${exif.focalLength}mm`,
    exif?.exposureTime,
  ]
    .filter(Boolean)
    .join(" · ");
  const place = [exif?.city, exif?.state, exif?.country].filter(Boolean).join(", ");
  const coords =
    exif?.latitude != null && exif?.longitude != null
      ? `${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`
      : null;
  const dims =
    detail?.width != null && detail?.height != null
      ? `${detail.width} × ${detail.height}`
      : exif?.exifImageWidth != null && exif?.exifImageHeight != null
        ? `${exif.exifImageWidth} × ${exif.exifImageHeight}`
        : null;
  const duration = fmtDuration(detail?.duration);
  const taken = fmtDate(
    detail?.localDateTime ?? exif?.dateTimeOriginal ?? asset.fileCreatedAt,
  );
  const uploaded = fmtDate(detail?.createdAt ?? detail?.updatedAt);
  const rating = exif?.rating ?? null;
  const people = detail?.people ?? [];
  const tags = detail?.tags ?? [];
  const badges = [
    detail?.isFavorite && { label: "Favorite", Icon: Star },
    detail?.isArchived && { label: "Archived", Icon: Archive },
    detail?.isTrashed && { label: "Trashed", Icon: Trash2 },
    detail?.isOffline && { label: "Offline", Icon: WifiOff },
  ].filter(Boolean) as { label: string; Icon: typeof Star }[];
  const serverPhotoUrl = serverUrl ? `${serverUrl}/photos/${asset.id}` : null;

  const portalRoot =
    typeof document !== "undefined"
      ? document.getElementById("lightbox-root")
      : null;
  if (!portalRoot) return null;

  return createPortal(
    // Rendered into #lightbox-root (positioned below the header via the DOM
    // hierarchy in App.tsx). No measurement needed — the container's layout
    // defines the position. pointer-events-auto re-enables interaction.
    <div
      className="pointer-events-auto absolute inset-0 z-[1100] flex flex-col bg-slate-100 dark:bg-slate-950"
      role="dialog"
      aria-modal="true"
      aria-label={asset.originalFileName ?? "Photo viewer"}
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-3 p-3 text-slate-900 dark:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 truncate text-sm">
          {asset.originalFileName ?? asset.id}
        </span>
        <div className="flex shrink-0 gap-2">
          {isVideo && (
            <button
              onClick={toggleAutoplay}
              aria-pressed={autoplay}
              title={
                autoplay
                  ? "Autoplay is on — click to turn off"
                  : "Autoplay is off — click to turn on"
              }
              className={
                autoplay
                  ? "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
                  : btnCls
              }
            >
              <Play size={15} /> Autoplay
            </button>
          )}
          <button
            onClick={download}
            disabled={downloading}
            className={`${btnCls} disabled:opacity-50`}
          >
            {downloading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            Download
          </button>
          {serverPhotoUrl && (
            <button
              onClick={() => openUrl(serverPhotoUrl).catch(() => {})}
              title="Open on Immich server"
              className={btnCls}
            >
              <ExternalLink size={15} /> Server
            </button>
          )}
          <button autoFocus onClick={onClose} aria-label="Close" className={closeCls}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
        onClick={onClose}
      >
        {isVideo ? (
          <video
            src={videoUrl(asset.id)}
            controls
            autoPlay={autoplay}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full"
          />
        ) : (
          <img
            src={assetUrl(asset.id, "preview")}
            alt={asset.originalFileName ?? ""}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      {/* Info panel */}
      <div
        className="border-t border-slate-200 bg-white p-3 text-xs dark:border-white/10 dark:bg-black/30"
        onClick={(e) => e.stopPropagation()}
      >
        {badges.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {badges.map(({ label, Icon }) => (
              <span key={label} className={chipCls}>
                <Icon size={10} /> {label}
              </span>
            ))}
          </div>
        )}
        {exif?.description && (
          <p className="mb-2 text-slate-600 dark:text-slate-300">
            {exif.description}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 md:grid-cols-4">
          <Field label="Type">{asset.type}</Field>
          {exif?.fileSizeInByte != null && (
            <Field label="Size">{fmtBytes(exif.fileSizeInByte)}</Field>
          )}
          {dims && <Field label="Dimensions">{dims}</Field>}
          {duration && <Field label="Duration">{duration}</Field>}
          {taken && <Field label="Taken">{taken}</Field>}
          {uploaded && <Field label="Uploaded">{uploaded}</Field>}
          {asset.originalMimeType && (
            <Field label="MIME">{asset.originalMimeType}</Field>
          )}
          {camera && <Field label="Camera">{camera}</Field>}
          {exif?.lensModel && <Field label="Lens">{exif.lensModel}</Field>}
          {settings && <Field label="Settings">{settings}</Field>}
          {rating != null && (
            <Field label="Rating">
              <span className="inline-flex items-center gap-0.5 text-amber-500 dark:text-amber-400">
                <Star size={11} className="fill-amber-500 dark:fill-amber-400" />{" "}
                {rating}
              </span>
            </Field>
          )}
          {place && (
            <Field label="Location">
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} /> {place}
              </span>
            </Field>
          )}
          {coords && <Field label="GPS">{coords}</Field>}
          {exif?.timeZone && <Field label="Time zone">{exif.timeZone}</Field>}
        </dl>
        {(people.length > 0 || tags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-white/10 dark:text-slate-400">
            {people.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users size={12} />
                {people.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onPersonClick?.(p.id, p.name || "Unnamed");
                      onClose();
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-200 py-0.5 pl-0.5 pr-2 text-[10px] text-slate-700 transition-colors hover:bg-brand-100 hover:text-brand-700 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-brand-900/40 dark:hover:text-brand-300"
                  >
                    <img
                      src={personUrl(p.id)}
                      alt=""
                      className="h-4 w-4 rounded-full object-cover"
                    />
                    {p.name || "Unnamed"}
                  </button>
                ))}
              </span>
            )}
            {tags.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Tag size={12} />
                {tags.map((t) => (
                  <span key={t.id} className={chipCls}>
                    {t.value ?? t.name ?? t.id}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
        {localPath && (
          <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2 text-slate-500 dark:border-white/10 dark:text-slate-400">
            <FolderOpen size={13} className="shrink-0" />
            <span className="truncate" title={localPath}>
              {localPath}
            </span>
            <button
              onClick={() => revealItemInDir(localPath).catch(() => {})}
              className="shrink-0 text-brand-600 hover:underline dark:text-brand-400"
            >
              Reveal
            </button>
          </div>
        )}
      </div>
    </div>,
    portalRoot,
  );
}
