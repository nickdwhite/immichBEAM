import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Image as ImageIcon,
  Images,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Video,
  X,
} from "lucide-react";
import {
  DEFAULT_FILTERS,
  useBrowse,
  type BrowseFilters,
  type BrowseMode,
} from "../hooks/useBrowse";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import type { BrowseAsset } from "../types";

type TypeFilter = BrowseFilters["type"];

const TYPE_CHIPS: { id: TypeFilter; label: string; Icon: typeof Images }[] = [
  { id: "all", label: "All", Icon: Images },
  { id: "IMAGE", label: "Photos", Icon: ImageIcon },
  { id: "VIDEO", label: "Videos", Icon: Video },
];

const toggleChip = (active: boolean): string =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "bg-brand-600 text-white"
      : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

export function TimelineGrid({ serverUrl }: { serverUrl: string }) {
  const [filters, setFilters] = useState<BrowseFilters>(DEFAULT_FILTERS);
  const [mode, setMode] = useState<BrowseMode>("metadata");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [active, setActive] = useState<BrowseAsset | null>(null);
  const { items, loading, error, hasMore, loadMore } = useBrowse(filters, mode);
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

  const set = <K extends keyof BrowseFilters>(
    key: K,
    value: BrowseFilters[K],
  ) => setFilters((f) => ({ ...f, [key]: value }));

  const smartActive = mode === "smart";
  const hasDate = Boolean(filters.takenAfter || filters.takenBefore);

  return (
    <div className="space-y-3">
      {/* Search bar + smart/metadata toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            size={15}
          />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder={
              smartActive
                ? "Smart search — describe what's in the photo…"
                : "Search by filename or description…"
            }
            className="w-full rounded-lg border-slate-300 py-1.5 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <button
          onClick={() => setMode(smartActive ? "metadata" : "smart")}
          aria-pressed={smartActive}
          title={
            smartActive
              ? "Switch to metadata search"
              : "Switch to smart (semantic/CLIP) search — needs machine-learning on the server"
          }
          className={toggleChip(smartActive)}
        >
          <Sparkles size={14} /> Smart
        </button>
      </div>

      {/* Type + quick filters (metadata mode only — smart search takes a query alone) */}
      {!smartActive && (
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_CHIPS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => set("type", id)}
              aria-pressed={filters.type === id}
              className={toggleChip(filters.type === id)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <button
            onClick={() => set("isFavorite", !filters.isFavorite)}
            aria-pressed={filters.isFavorite}
            className={toggleChip(filters.isFavorite)}
          >
            <Star size={14} /> Favorites
          </button>
          <button
            onClick={() => set("isArchived", !filters.isArchived)}
            aria-pressed={filters.isArchived}
            className={toggleChip(filters.isArchived)}
          >
            <Archive size={14} /> Archive
          </button>
          <button
            onClick={() => set("isNotInAlbum", !filters.isNotInAlbum)}
            aria-pressed={filters.isNotInAlbum}
            className={toggleChip(filters.isNotInAlbum)}
          >
            <Images size={14} /> Not in album
          </button>
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            aria-pressed={showAdvanced}
            className={toggleChip(showAdvanced)}
          >
            <SlidersHorizontal size={14} /> Dates
          </button>
        </div>
      )}

      {/* Collapsible date range */}
      {!smartActive && showAdvanced && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500">Taken after</span>
            <input
              type="date"
              value={filters.takenAfter}
              onChange={(e) => set("takenAfter", e.target.value)}
              className="rounded-md border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500">Taken before</span>
            <input
              type="date"
              value={filters.takenBefore}
              onChange={(e) => set("takenBefore", e.target.value)}
              className="rounded-md border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          {hasDate && (
            <button
              onClick={() => {
                set("takenAfter", "");
                set("takenBefore", "");
              }}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              <X size={12} /> Clear dates
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {items.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          {smartActive && !filters.query.trim()
            ? "Enter a search to find photos semantically."
            : "No photos match."}
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
        />
      )}
    </div>
  );
}
