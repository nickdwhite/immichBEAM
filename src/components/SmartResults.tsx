import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../lib/tauri";
import { PAGE_SIZE, usePaginated } from "../hooks/usePaginated";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import { VirtualGrid } from "./VirtualGrid";
import type { TypeFilter } from "./FilterBar";
import type { BrowseAsset } from "../types";

export function SmartResults({
  query,
  serverUrl,
  typeFilter,
  onPersonClick,
}: {
  query: string;
  serverUrl: string;
  typeFilter?: TypeFilter;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const fetchPage = useCallback(
    async (page: number) => {
      const q = query.trim();
      if (!q) return { items: [], nextPage: null };
      return api.browseSmart({
        page,
        size: PAGE_SIZE,
        query: q,
        type: typeFilter === "all" ? undefined : typeFilter,
      });
    },
    [query, typeFilter],
  );

  const { items, loading, error, hasMore, loadMore, loadFirst, clear } =
    usePaginated(fetchPage);
  const sentinel = useInfiniteScroll(loadMore, hasMore);
  const [active, setActive] = useState<BrowseAsset | null>(null);

  useEffect(() => {
    if (query.trim()) {
      const t = setTimeout(() => loadFirst(), 250);
      return () => clearTimeout(t);
    }
    clear();
  }, [query, loadFirst, clear]);

  if (!query.trim()) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
        Enter a search to find photos semantically.
      </p>
    );
  }

  return (
    <>
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
        <VirtualGrid
          items={items}
          getKey={(a) => a.id}
          renderItem={(a) => (
            <PhotoTile asset={a} onClick={() => setActive(a)} />
          )}
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
    </>
  );
}
