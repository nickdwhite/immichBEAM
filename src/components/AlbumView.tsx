import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Image as ImageIcon,
  Images,
  Loader2,
  Search,
  Video,
} from "lucide-react";
import { api } from "../lib/tauri";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import type { Album, BrowseAsset } from "../types";

type TypeFilter = "all" | "IMAGE" | "VIDEO";

const TYPE_CHIPS: { id: TypeFilter; label: string; Icon: typeof Images }[] = [
  { id: "all", label: "All", Icon: Images },
  { id: "IMAGE", label: "Photos", Icon: ImageIcon },
  { id: "VIDEO", label: "Videos", Icon: Video },
];

function extOf(a: BrowseAsset): string {
  const fromName = a.originalFileName?.split(".").pop();
  if (fromName) return fromName.toLowerCase();
  return a.originalMimeType ? (a.originalMimeType.split("/").pop() ?? "") : "";
}

const chip = (active: boolean): string =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "bg-brand-600 text-white"
      : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

export function AlbumView({
  album,
  serverUrl,
  onBack,
}: {
  album: Album;
  serverUrl: string;
  onBack: () => void;
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

      {/* Client-side filters (the album endpoint returns the full set) */}
      {!loading && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              size={15}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by filename…"
              className="w-full rounded-lg border-slate-300 py-1.5 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          {TYPE_CHIPS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setType(id)}
              aria-pressed={type === id}
              className={chip(type === id)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
          <select
            value={ext}
            onChange={(e) => setExt(e.target.value)}
            title="File type"
            className="rounded-lg border-slate-300 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {extensions.map((e) => (
              <option key={e} value={e}>
                {e === "all" ? "All file types" : e}
              </option>
            ))}
          </select>
        </div>
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
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {filtered.map((a) => (
            <PhotoTile key={a.id} asset={a} onClick={() => setActive(a)} />
          ))}
        </div>
      )}

      {active && (
        <PhotoLightbox
          asset={active}
          serverUrl={serverUrl}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
