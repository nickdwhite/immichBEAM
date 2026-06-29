import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import type { BrowseAsset, MetadataSearch } from "../types";

export function AssetResults({
  title,
  search,
  serverUrl,
  onBack,
  onPersonClick,
}: {
  title: string;
  search: MetadataSearch;
  serverUrl: string;
  onBack: () => void;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const { items, loading, error, hasMore, loadMore } = useAssetSearch(search);
  const [active, setActive] = useState<BrowseAsset | null>(null);
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
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        <span className="shrink-0 text-xs text-slate-400">
          {loading ? "" : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
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
