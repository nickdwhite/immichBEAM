import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2, X } from "lucide-react";
import { assetUrl } from "../lib/assetUrl";
import { api } from "../lib/tauri";
import { useToast } from "./Toast";
import type { BrowseAsset } from "../types";

export function PhotoLightbox({
  asset,
  onClose,
}: {
  asset: BrowseAsset;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
  const isVideo = asset.type === "VIDEO";

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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
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
          <p className="text-sm text-slate-300">
            Video preview isn't supported yet — use Download.
          </p>
        ) : (
          <img
            src={assetUrl(asset.id, "preview")}
            alt={asset.originalFileName ?? ""}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </div>
  );
}
