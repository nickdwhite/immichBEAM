import { useEffect, useState } from "react";
import {
  Archive,
  Calendar,
  Images,
  Loader2,
  Star,
} from "lucide-react";
import { DEFAULT_FILTERS, useBrowse, type BrowseFilters, type BrowseMode } from "../hooks/useBrowse";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { api } from "../lib/tauri";
import { FilterBar, toggleChip, type ChipDef } from "./FilterBar";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import { RangeCalendar } from "./RangeCalendar";
import { TagInput } from "./TagInput";
import { VirtualGrid } from "./VirtualGrid";
import type { BrowseAsset, Tag } from "../types";

/** Local YYYY-MM-DD for today shifted back by the given days/months/years. */
function shiftDate(days = 0, months = 0, years = 0): string {
  const d = new Date();
  if (days) d.setDate(d.getDate() - days);
  if (months) d.setMonth(d.getMonth() - months);
  if (years) d.setFullYear(d.getFullYear() - years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Compact filled pill for date presets (distinct from the bordered filter chips). */
const presetChip = (active: boolean): string =>
  `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? "bg-brand-600 text-white"
      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
  }`;

// Module-level cache — tags rarely change; fetched once per session.
let _tagsCache: Tag[] | null = null;

export function TimelineGrid({
  serverUrl,
  onPersonClick,
}: {
  serverUrl: string;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const [filters, setFilters] = useState<BrowseFilters>(DEFAULT_FILTERS);
  const [mode, setMode] = useState<BrowseMode>("metadata");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [active, setActive] = useState<BrowseAsset | null>(null);
  const { items, loading, error, hasMore, loadMore } = useBrowse(filters, mode);
  const sentinel = useInfiniteScroll(loadMore, hasMore);

  const [tags, setTags] = useState<Tag[]>(_tagsCache ?? []);
  useEffect(() => {
    if (_tagsCache) return;
    api.browseTags()
      .then((t) => {
        _tagsCache = t;
        setTags(t);
      })
      .catch(() => {});
  }, []);

  const set = <K extends keyof BrowseFilters>(
    key: K,
    value: BrowseFilters[K],
  ) => setFilters((f) => ({ ...f, [key]: value }));

  const smartActive = mode === "smart";

  const extraChips: ChipDef[] = [
    { key: "fav", label: "Favorites", icon: Star, active: filters.isFavorite, onToggle: () => set("isFavorite", !filters.isFavorite) },
    { key: "arch", label: "Archive", icon: Archive, active: filters.isArchived, onToggle: () => set("isArchived", !filters.isArchived) },
    { key: "noAlbum", label: "Not in album", icon: Images, active: filters.isNotInAlbum, onToggle: () => set("isNotInAlbum", !filters.isNotInAlbum) },
  ];
  const hasDate = Boolean(filters.takenAfter || filters.takenBefore);

  const presets = [
    { label: "30 days", after: shiftDate(30) },
    { label: "90 days", after: shiftDate(90) },
    { label: "6 months", after: shiftDate(0, 6) },
    { label: "1 year", after: shiftDate(0, 0, 1) },
  ];
  const applyPreset = (after: string) => {
    set("takenAfter", after);
    set("takenBefore", "");
  };
  const clearDates = () => {
    set("takenAfter", "");
    set("takenBefore", "");
  };

  return (
    <div className="space-y-3">
      <FilterBar
        query={filters.query}
        onQueryChange={(q) => set("query", q)}
        placeholder="Search by filename (e.g. logo, .png)…"
        smartPlaceholder="Smart search — describe what's in the photo…"
        smartMode={smartActive}
        onSmartModeChange={(s) => setMode(s ? "smart" : "metadata")}
        typeFilter={filters.type}
        onTypeChange={(t) => set("type", t)}
        chips={extraChips}
      >
        <button
          onClick={() => setShowAdvanced((s) => !s)}
          aria-pressed={showAdvanced}
          aria-expanded={showAdvanced}
          title="Filter by date taken"
          className={toggleChip(showAdvanced || hasDate)}
        >
          <Calendar size={14} /> Dates
        </button>
      </FilterBar>

      {tags.length > 0 && (
        <TagInput
          tags={tags}
          selectedIds={filters.tagIds}
          onChange={(ids) => set("tagIds", ids)}
        />
      )}

      {showAdvanced && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Quick ranges
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={clearDates}
                aria-pressed={!hasDate}
                className={presetChip(!hasDate)}
              >
                All time
              </button>
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.after)}
                  aria-pressed={
                    filters.takenAfter === p.after && !filters.takenBefore
                  }
                  className={presetChip(
                    filters.takenAfter === p.after && !filters.takenBefore,
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Custom range
            </span>
            <RangeCalendar
              from={filters.takenAfter}
              to={filters.takenBefore}
              onChange={(f, t) =>
                setFilters((prev) => ({ ...prev, takenAfter: f, takenBefore: t }))
              }
            />
          </div>
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
