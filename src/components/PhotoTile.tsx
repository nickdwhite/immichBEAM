import { useState } from "react";
import { FileImage, FileVideo, Film } from "lucide-react";
import { assetUrl, originalUrl } from "../lib/assetUrl";
import type { BrowseAsset } from "../types";

export function PhotoTile({
  asset,
  onClick,
}: {
  asset: BrowseAsset;
  onClick: () => void;
}) {
  const isVideo = asset.type === "VIDEO";
  // SVG: Immich may not rasterize a thumbnail, so load the original — the
  // browser renders the vector natively (safe: <img> won't execute SVG scripts).
  const isSvg = asset.originalMimeType === "image/svg+xml";
  const [failed, setFailed] = useState(false);
  const ext =
    asset.originalFileName?.split(".").pop()?.toUpperCase() ??
    (isVideo ? "VIDEO" : "IMG");

  return (
    <button
      onClick={onClick}
      title={asset.originalFileName ?? asset.id}
      className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800"
    >
      {failed ? (
        <div className="flex flex-col items-center gap-1 text-slate-400">
          {isVideo ? <FileVideo size={20} /> : <FileImage size={20} />}
          <span className="text-[10px] font-medium">{ext}</span>
        </div>
      ) : (
        <img
          src={isSvg ? originalUrl(asset.id) : assetUrl(asset.id, "thumbnail")}
          alt={asset.originalFileName ?? ""}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      )}
      {isVideo && !failed && (
        <span className="absolute right-1 top-1 inline-flex rounded bg-black/60 p-0.5 text-white">
          <Film size={12} />
        </span>
      )}
      {isVideo && !failed && asset.duration && (
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
          {asset.duration}
        </span>
      )}
    </button>
  );
}
