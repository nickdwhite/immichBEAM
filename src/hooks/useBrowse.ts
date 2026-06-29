import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/tauri";
import type { BrowseAsset, BrowsePage } from "../types";

const PAGE_SIZE = 60;

export interface BrowseFilters {
  query: string;
  type: "all" | "IMAGE" | "VIDEO";
  isFavorite: boolean;
  isArchived: boolean;
  isNotInAlbum: boolean;
  takenAfter: string; // YYYY-MM-DD or ""
  takenBefore: string; // YYYY-MM-DD or ""
  tagId: string; // "" = no tag filter
}

export const DEFAULT_FILTERS: BrowseFilters = {
  query: "",
  type: "all",
  isFavorite: false,
  isArchived: false,
  isNotInAlbum: false,
  takenAfter: "",
  takenBefore: "",
  tagId: "",
};

export type BrowseMode = "metadata" | "smart";

export function useBrowse(filters: BrowseFilters, mode: BrowseMode) {
  const [items, setItems] = useState<BrowseAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (page: number): Promise<BrowsePage> => {
      if (mode === "smart") {
        // Smart search requires a non-empty query — short-circuit before the API
        // call. This also covers loadMore firing while the query is being cleared
        // (the first-page guard in the effect alone isn't enough).
        const q = filters.query.trim();
        if (!q) return { items: [], nextPage: null };
        return api.browseSmart(q, page, PAGE_SIZE);
      }
      const q = filters.query.trim() || undefined;
      return api.browseSearch({
        page,
        size: PAGE_SIZE,
        // Send both: current Immich filters filename via originalFileName; older
        // servers used the legacy `query` field for filename matching.
        query: q,
        originalFileName: q,
        type: filters.type === "all" ? undefined : filters.type,
        isFavorite: filters.isFavorite || undefined,
        isArchived: filters.isArchived || undefined,
        isNotInAlbum: filters.isNotInAlbum || undefined,
        takenAfter: filters.takenAfter || undefined,
        takenBefore: filters.takenBefore || undefined,
        tagIds: filters.tagId ? [filters.tagId] : undefined,
      });
    },
    [filters, mode],
  );

  // (Re)load from page 1 when the filters or mode change. Debounced so typing
  // into the search box doesn't fire a request per keystroke; a filter/mode
  // change cancels any in-flight delayed request via `cancelled`.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      setError(null);
      pageRef.current = 1;
      setHasMore(true);
      // Smart search needs a query — clear the grid until there is one.
      if (mode === "smart" && !filters.query.trim()) {
        setItems([]);
        setHasMore(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      loadingRef.current = true;
      (async () => {
        try {
          const result = await fetchPage(1);
          if (cancelled) return;
          setItems(result.items);
          setHasMore(
            result.items.length >= PAGE_SIZE && result.nextPage !== null,
          );
          pageRef.current = 2;
        } catch (e) {
          if (!cancelled) {
            setError(String(e));
            setItems([]);
            setHasMore(false);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
            loadingRef.current = false;
          }
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fetchPage, filters, mode]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    const page = pageRef.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const result = await fetchPage(page);
      setItems((prev) => [...prev, ...result.items]);
      if (result.items.length < PAGE_SIZE || result.nextPage === null) {
        setHasMore(false);
      } else {
        pageRef.current = page + 1;
      }
    } catch (e) {
      setError(String(e));
      setHasMore(false);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [fetchPage, hasMore]);

  return { items, loading, error, hasMore, loadMore };
}
