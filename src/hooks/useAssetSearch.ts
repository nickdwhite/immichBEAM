import { useCallback, useEffect } from "react";
import { api } from "../lib/tauri";
import { PAGE_SIZE, usePaginated } from "./usePaginated";
import type { MetadataSearch } from "../types";

export function useAssetSearch(search: MetadataSearch) {
  const fetchPage = useCallback(
    async (page: number) => api.browseSearch({ ...search, page, size: PAGE_SIZE }),
    [search],
  );

  const { items, loading, error, hasMore, loadMore, loadFirst } =
    usePaginated(fetchPage);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  return { items, loading, error, hasMore, loadMore };
}
