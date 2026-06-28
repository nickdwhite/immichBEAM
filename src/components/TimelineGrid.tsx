import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Images, Loader2, Video } from "lucide-react";
import { useBrowse, type BrowseFilter } from "../hooks/useBrowse";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import type { BrowseAsset } from "../types";

const FILTERS: { id: BrowseFilter; label: string; Icon: typeof Images }[] = [
  { id: "all", label: "All", Icon: Images },
  { id: "IMAGE", label: "Photos", Icon: ImageIcon },
  { id: "VIDEO", label: "Videos", Icon: Video },
];

export function TimelineGrid() {
  const [filter, setFilter] = useState<BrowseFilter>("all");
  const [active, setActive] = useState<BrowseAsset | null>(null);
  const { items, loading, error, hasMore, loadMore } = useBrowse(filter);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {FILTERS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === id
                ? "bg-brand-600 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {items.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          No photos found.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {items.map((a) => (
            <PhotoTile key={a.id} asset={a} onClick={() => setActive(a)} />
          ))}
        </div>
      )}

      <div ref={sentinel} className="h-1" />
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-brand-500" size={20} />
        </div>
      )}

      {active && <PhotoLightbox asset={active} onClose={() => setActive(null)} />}
    </div>
  );
}
