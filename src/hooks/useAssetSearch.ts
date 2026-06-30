import { useCallback, useEffect } from "react";
import { api } from "../lib/tauri";
import { PAGE_SIZE, usePaginated } from "./usePaginated";
import type { MetadataSearch } from "../types";

export function useAssetSearch(search: MetadataSearch, smartMode = false) {
  const fetchPage = useCallback(
    async (page: number) => {
      const req = { ...search, page, size: PAGE_SIZE };
      if (smartMode) {
        if (!req.query?.trim()) return { items: [], nextPage: null };
        return api.browseSmart(req);
      }
      return api.browseSearch(req);
    },
    [search, smartMode],
  );

  const { items, loading, error, hasMore, loadMore, loadFirst } =
    usePaginated(fetchPage);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  return { items, loading, error, hasMore, loadMore };
}
