import { useCallback, useEffect } from "react";
import { api } from "../lib/tauri";
import { PAGE_SIZE, usePaginated } from "./usePaginated";
import type { BrowsePage } from "../types";

export interface BrowseFilters {
  query: string;
  type: "all" | "IMAGE" | "VIDEO";
  isFavorite: boolean;
  isArchived: boolean;
  isNotInAlbum: boolean;
  takenAfter: string;
  takenBefore: string;
  tagIds: string[];
}

export const DEFAULT_FILTERS: BrowseFilters = {
  query: "",
  type: "all",
  isFavorite: false,
  isArchived: false,
  isNotInAlbum: false,
  takenAfter: "",
  takenBefore: "",
  tagIds: [],
};

export type BrowseMode = "metadata" | "smart";

export function useBrowse(filters: BrowseFilters, mode: BrowseMode) {
  const fetchPage = useCallback(
    async (page: number): Promise<BrowsePage> => {
      const q = filters.query.trim() || undefined;
      if (mode === "smart" && !q) return { items: [], nextPage: null };
      const search = {
        page,
        size: PAGE_SIZE,
        query: q,
        originalFileName: mode === "metadata" ? q : undefined,
        type: filters.type === "all" ? undefined : filters.type,
        isFavorite: filters.isFavorite || undefined,
        isArchived: filters.isArchived || undefined,
        visibility: filters.isArchived ? "archive" : undefined,
        isNotInAlbum: filters.isNotInAlbum || undefined,
        takenAfter: filters.takenAfter || undefined,
        takenBefore: filters.takenBefore || undefined,
        tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
      };
      return mode === "smart"
        ? api.browseSmart(search)
        : api.browseSearch(search);
    },
    [filters, mode],
  );

  const { items, loading, error, hasMore, loadMore, loadFirst, clear } =
    usePaginated(fetchPage);

  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === "smart" && !filters.query.trim()) {
        clear();
        return;
      }
      loadFirst();
    }, 250);
    return () => clearTimeout(t);
  }, [fetchPage, filters, mode, loadFirst, clear]);

  return { items, loading, error, hasMore, loadMore };
}
