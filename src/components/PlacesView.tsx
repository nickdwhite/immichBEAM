import { useEffect, useMemo, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { api } from "../lib/tauri";
import { assetUrl } from "../lib/assetUrl";
import { FilterBar, type TypeFilter } from "./FilterBar";
import { SmartResults } from "./SmartResults";
import type { AssetDetail } from "../types";

export function PlacesView({
  onOpen,
  serverUrl,
  onPersonClick,
}: {
  onOpen: (city: string) => void;
  serverUrl: string;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const [places, setPlaces] = useState<AssetDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [smartMode, setSmartMode] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    let cancelled = false;
    api
      .browseCities()
      .then((c) => { if (!cancelled) setPlaces(c); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const withCity = useMemo(
    () => (places ?? []).filter((a) => a.exifInfo?.city),
    [places],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return withCity;
    return withCity.filter((a) =>
      (a.exifInfo?.city ?? "").toLowerCase().includes(q),
    );
  }, [withCity, query]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </p>
    );
  }
  if (!places) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-brand-500" size={20} />
      </div>
    );
  }
  if (withCity.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
        No places. Assets need GPS data + reverse geocoding in Immich.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by city…"
        smartPlaceholder="Smart search — describe what's in the photo…"
        smartMode={smartMode}
        onSmartModeChange={setSmartMode}
        typeFilter={smartMode ? typeFilter : undefined}
        onTypeChange={smartMode ? setTypeFilter : undefined}
      />
      {smartMode ? (
        <SmartResults query={query} serverUrl={serverUrl} typeFilter={typeFilter} onPersonClick={onPersonClick} />
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
          No places match your search.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((a) => {
            const city = a.exifInfo?.city ?? "Unknown";
            return (
              <button
                key={a.id}
                onClick={() => onOpen(city)}
                title={city}
                className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <img
                  src={assetUrl(a.id, "thumbnail")}
                  alt={city}
                  loading="lazy"
                  className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
                />
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs font-medium text-white">
                  <MapPin size={11} /> <span className="truncate">{city}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
