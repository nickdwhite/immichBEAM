import { useCallback, useRef, useState } from "react";
import type { BrowseAsset, BrowsePage } from "../types";

export const PAGE_SIZE = 60;

export function usePaginated(fetchPage: (page: number) => Promise<BrowsePage>) {
  const [items, setItems] = useState<BrowseAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);
  const genRef = useRef(0);

  const loadFirst = useCallback(async () => {
    const gen = ++genRef.current;
    pageRef.current = 1;
    setHasMore(true);
    setError(null);
    setLoading(true);
    loadingRef.current = true;
    try {
      const result = await fetchPage(1);
      if (gen !== genRef.current) return;
      setItems(result.items);
      setHasMore(result.items.length >= PAGE_SIZE && result.nextPage !== null);
      pageRef.current = 2;
    } catch (e) {
      if (gen !== genRef.current) return;
      setError(String(e));
      setItems([]);
      setHasMore(false);
    } finally {
      if (gen === genRef.current) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    const gen = genRef.current;
    const page = pageRef.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const result = await fetchPage(page);
      if (gen !== genRef.current) return;
      setItems((prev) => [...prev, ...result.items]);
      if (result.items.length < PAGE_SIZE || result.nextPage === null) {
        setHasMore(false);
      } else {
        pageRef.current = page + 1;
      }
    } catch (e) {
      if (gen !== genRef.current) return;
      setError(String(e));
      setHasMore(false);
    } finally {
      if (gen === genRef.current) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  }, [fetchPage, hasMore]);

  const clear = useCallback(() => {
    ++genRef.current;
    setItems([]);
    setHasMore(false);
    setLoading(false);
    setError(null);
  }, []);

  return { items, loading, error, hasMore, loadMore, loadFirst, clear };
}
