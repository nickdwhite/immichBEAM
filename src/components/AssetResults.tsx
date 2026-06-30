import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAssetSearch } from "../hooks/useAssetSearch";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { FilterBar, type TypeFilter } from "./FilterBar";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import { VirtualGrid } from "./VirtualGrid";
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
  const [query, setQuery] = useState("");
  const [smartMode, setSmartMode] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const mergedSearch = useMemo(() => {
    const q = query.trim() || undefined;
    return {
      ...search,
      query: q,
      originalFileName: smartMode ? undefined : q,
      type: typeFilter === "all" ? undefined : typeFilter,
    };
  }, [search, query, smartMode, typeFilter]);

  const { items, loading, error, hasMore, loadMore } = useAssetSearch(
    mergedSearch,
    smartMode,
  );
  const [active, setActive] = useState<BrowseAsset | null>(null);
  const sentinel = useInfiniteScroll(loadMore, hasMore);

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

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by filename…"
        smartPlaceholder="Smart search — describe what's in the photo…"
        smartMode={smartMode}
        onSmartModeChange={setSmartMode}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
      />

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {items.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          {smartMode && !query.trim()
            ? "Enter a search to find photos semantically."
            : "No photos found."}
        </p>
      ) : (
        <VirtualGrid
          items={items}
          getKey={(a) => a.id}
          renderItem={(a) => <PhotoTile asset={a} onClick={() => setActive(a)} />}
        />
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
