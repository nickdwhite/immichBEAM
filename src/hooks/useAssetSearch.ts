import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/tauri";
import type { BrowseAsset, MetadataSearch } from "../types";

const PAGE_SIZE = 60;

/// Paginated asset search for a fixed `MetadataSearch` (used by the People and
/// Places browsers to show a person's / place's photos). Unlike `useBrowse`, the
/// filter is fixed (no live editing), so there's no debounce.
export function useAssetSearch(search: MetadataSearch) {
  const [items, setItems] = useState<BrowseAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (page: number) => api.browseSearch({ ...search, page, size: PAGE_SIZE }),
    [search],
  );

  useEffect(() => {
    let cancelled = false;
    setError(null);
    pageRef.current = 1;
    setHasMore(true);
    setLoading(true);
    loadingRef.current = true;
    (async () => {
      try {
        const result = await fetchPage(1);
        if (cancelled) return;
        setItems(result.items);
        setHasMore(result.items.length >= PAGE_SIZE && result.nextPage !== null);
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
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

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
