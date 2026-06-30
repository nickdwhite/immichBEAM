import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "../lib/tauri";
import { FilterBar, type TypeFilter } from "./FilterBar";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import { VirtualGrid } from "./VirtualGrid";
import type { Album, BrowseAsset } from "../types";

function extOf(a: BrowseAsset): string {
  const fromName = a.originalFileName?.split(".").pop();
  if (fromName) return fromName.toLowerCase();
  return a.originalMimeType ? (a.originalMimeType.split("/").pop() ?? "") : "";
}

export function AlbumView({
  album,
  serverUrl,
  onBack,
  onPersonClick,
}: {
  album: Album;
  serverUrl: string;
  onBack: () => void;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const [items, setItems] = useState<BrowseAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<BrowseAsset | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [ext, setExt] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuery("");
    setType("all");
    setExt("all");
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

  const extensions = useMemo(() => {
    const set = new Set<string>();
    for (const a of items) {
      const e = extOf(a);
      if (e) set.add(e);
    }
    return ["all", ...[...set].sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((a) => {
      if (type !== "all" && a.type !== type) return false;
      if (ext !== "all" && extOf(a) !== ext) return false;
      if (q && !(a.originalFileName ?? a.id).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, type, ext]);

  const filtering = query !== "" || type !== "all" || ext !== "all";

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
          {loading
            ? ""
            : filtering
              ? `${filtered.length} of ${items.length}`
              : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {!loading && items.length > 0 && (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search by filename…"
          typeFilter={type}
          onTypeChange={setType}
        >
          <select
            value={ext}
            onChange={(e) => setExt(e.target.value)}
            title="File type"
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            {extensions.map((e) => (
              <option key={e} value={e}>
                {e === "all" ? "All file types" : e}
              </option>
            ))}
          </select>
        </FilterBar>
      )}

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-brand-500" size={20} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          {items.length === 0
            ? "This album is empty."
            : "No items match your filter."}
        </p>
      ) : (
        <VirtualGrid
          items={filtered}
          getKey={(a) => a.id}
          renderItem={(a) => <PhotoTile asset={a} onClick={() => setActive(a)} />}
        />
      )}

      {active && (
        <PhotoLightbox
          asset={active}
          serverUrl={serverUrl}
          onClose={() => setActive(null)}
          onPersonClick={onPersonClick}
        />
      )}
    </div>
  );
}
