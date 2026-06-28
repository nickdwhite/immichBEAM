import { useEffect, useState } from "react";
import { Images, Loader2 } from "lucide-react";
import { api } from "../lib/tauri";
import type { Album } from "../types";

export function AlbumList({ onOpen }: { onOpen: (album: Album) => void }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.getAlbums();
        if (!cancelled) setAlbums(list);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-brand-500" size={20} />
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </p>
    );
  }
  if (albums.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
        No albums on this server.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {albums.map((a) => (
        <button
          key={a.id}
          onClick={() => onOpen(a)}
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <span className="inline-flex shrink-0 rounded-lg bg-brand-100 p-2 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Images size={20} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {a.album_name}
            </span>
            <span className="text-xs text-slate-400">
              {a.asset_count} item{a.asset_count === 1 ? "" : "s"}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
