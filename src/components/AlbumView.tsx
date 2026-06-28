import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "../lib/tauri";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import type { Album, BrowseAsset } from "../types";

export function AlbumView({
  album,
  onBack,
}: {
  album: Album;
  onBack: () => void;
}) {
  const [items, setItems] = useState<BrowseAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<BrowseAsset | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const assets = await api.browseAlbumAssets(album.id);
        if (!cancelled) setItems(assets);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [album.id]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <ArrowLeft size={15} /> Albums
        </button>
        <h2 className="truncate text-sm font-semibold">{album.album_name}</h2>
        <span className="shrink-0 text-xs text-slate-400">
          {loading ? "" : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-brand-500" size={20} />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          This album is empty.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {items.map((a) => (
            <PhotoTile key={a.id} asset={a} onClick={() => setActive(a)} />
          ))}
        </div>
      )}

      {active && <PhotoLightbox asset={active} onClose={() => setActive(null)} />}
    </div>
  );
}
