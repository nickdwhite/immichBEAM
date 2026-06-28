import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/tauri";
import type { BrowseAsset } from "../types";

const PAGE_SIZE = 60;

export type BrowseFilter = "all" | "IMAGE" | "VIDEO";

export function useBrowse(filter: BrowseFilter) {
  const [items, setItems] = useState<BrowseAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(async (page: number, f: BrowseFilter) => {
    loadingRef.current = true;
    setLoading(true);
    try {
      return await api.browseAssets(page, PAGE_SIZE, f === "all" ? undefined : f);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // (Re)load from page 1 whenever the filter changes.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    pageRef.current = 1;
    (async () => {
      try {
        const result = await fetchPage(1, filter);
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, fetchPage]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    const page = pageRef.current;
    try {
      const result = await fetchPage(page, filter);
      setItems((prev) => [...prev, ...result.items]);
      if (result.items.length < PAGE_SIZE || result.nextPage === null) {
        setHasMore(false);
      } else {
        pageRef.current = page + 1;
      }
    } catch (e) {
      setError(String(e));
      setHasMore(false);
    }
  }, [filter, hasMore, fetchPage]);

  return { items, loading, error, hasMore, loadMore };
}
