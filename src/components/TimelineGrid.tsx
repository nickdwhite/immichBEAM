import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Calendar,
  Image as ImageIcon,
  Images,
  Loader2,
  Search,
  Sparkles,
  Star,
  Video,
} from "lucide-react";
import { DEFAULT_FILTERS, useBrowse, type BrowseFilters, type BrowseMode } from "../hooks/useBrowse";
import { api } from "../lib/tauri";
import { PhotoTile } from "./PhotoTile";
import { PhotoLightbox } from "./PhotoLightbox";
import { RangeCalendar } from "./RangeCalendar";
import type { BrowseAsset, Tag } from "../types";

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
  const sentinel = useRef<HTMLDivElement>(null);

  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    api.browseTags().then(setTags).catch(() => {});
  }, []);

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
                : "Search by filename (e.g. logo, .png)…"
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
          {tags.length > 0 && (
            <select
              value={filters.tagId}
              onChange={(e) => set("tagId", e.target.value)}
              title="Filter by tag"
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.value ?? t.name ?? t.id}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            aria-pressed={showAdvanced}
            aria-expanded={showAdvanced}
            title="Filter by date taken"
            className={toggleChip(showAdvanced || hasDate)}
          >
            <Calendar size={14} /> Dates
          </button>
        </div>
      )}

      {/* Date filter — quick ranges + custom range */}
      {!smartActive && showAdvanced && (
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
          onPersonClick={onPersonClick}
        />
      )}
    </div>
  );
}
