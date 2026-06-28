import { useEffect, useState, type ReactNode } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  MapPin,
  X,
} from "lucide-react";
import { assetUrl, videoUrl } from "../lib/assetUrl";
import { api } from "../lib/tauri";
import { fmtBytes } from "../lib/format";
import { useToast } from "./Toast";
import type { AssetDetail, BrowseAsset } from "../types";

function fmtDate(s?: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="truncate text-slate-200" title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}

export function PhotoLightbox({
  asset,
  serverUrl,
  onClose,
}: {
  asset: BrowseAsset;
  serverUrl: string;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [localPath, setLocalPath] = useState<string | null>(null);
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
    exif?.resolutionX != null && exif?.resolutionY != null
      ? `${exif.resolutionX} × ${exif.resolutionY}`
      : null;
  const serverPhotoUrl = serverUrl ? `${serverUrl}/photos/${asset.id}` : null;

  return (
    // Contained in the right-hand column (sidebar stays visible), not the whole window.
    <div
      className="fixed inset-y-0 right-0 left-56 z-50 flex flex-col bg-black/95"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-3 p-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate text-sm">
          {asset.originalFileName ?? asset.id}
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={download}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
            >
              <ExternalLink size={15} /> Server
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center rounded-lg bg-white/10 p-1.5 hover:bg-white/20"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className="flex flex-1 items-center justify-center p-4"
        onClick={onClose}
      >
        {isVideo ? (
          <video
            src={videoUrl(asset.id)}
            controls
            autoPlay
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
        className="border-t border-white/10 bg-black/80 p-3 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 md:grid-cols-4">
          <Field label="Type">{asset.type}</Field>
          {exif?.fileSizeBytes != null && (
            <Field label="Size">{fmtBytes(exif.fileSizeBytes)}</Field>
          )}
          {dims && <Field label="Dimensions">{dims}</Field>}
          {(fmtDate(exif?.dateTimeOriginal) ?? fmtDate(asset.fileCreatedAt)) && (
            <Field label="Taken">
              {fmtDate(exif?.dateTimeOriginal) ?? fmtDate(asset.fileCreatedAt)}
            </Field>
          )}
          {fmtDate(detail?.updatedAt) && (
            <Field label="Uploaded">{fmtDate(detail?.updatedAt)}</Field>
          )}
          {asset.originalMimeType && (
            <Field label="MIME">{asset.originalMimeType}</Field>
          )}
          {camera && <Field label="Camera">{camera}</Field>}
          {exif?.lensModel && <Field label="Lens">{exif.lensModel}</Field>}
          {settings && <Field label="Settings">{settings}</Field>}
          {(place || coords) && (
            <Field label="Location">
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} /> {place || coords}
              </span>
            </Field>
          )}
        </dl>
        {localPath && (
          <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2 text-slate-400">
            <FolderOpen size={13} className="shrink-0" />
            <span className="truncate" title={localPath}>
              {localPath}
            </span>
            <button
              onClick={() => revealItemInDir(localPath).catch(() => {})}
              className="shrink-0 text-brand-400 hover:underline"
            >
              Reveal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
