import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../lib/tauri";
import { personUrl } from "../lib/assetUrl";
import { FilterBar, type TypeFilter } from "./FilterBar";
import { SmartResults } from "./SmartResults";
import type { Person } from "../types";

export function PeopleView({
  onOpen,
  serverUrl,
  onPersonClick,
}: {
  onOpen: (person: Person) => void;
  serverUrl: string;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [smartMode, setSmartMode] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    let cancelled = false;
    api
      .browsePeople()
      .then((p) => { if (!cancelled) setPeople(p); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => (p.name ?? "").toLowerCase().includes(q));
  }, [people, query]);

  if (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </p>
    );
  }
  if (!people) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-brand-500" size={20} />
      </div>
    );
  }
  if (people.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400 dark:border-slate-700">
        No recognized people. Run face detection in Immich to populate this.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by name…"
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
          No people match your search.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpen(p)}
              title={p.name || "Unnamed"}
              className="flex flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <img
                src={personUrl(p.id)}
                alt={p.name ?? ""}
                loading="lazy"
                className="h-16 w-16 rounded-full bg-slate-200 object-cover dark:bg-slate-700"
              />
              <span className="max-w-full truncate text-xs text-slate-600 dark:text-slate-300">
                {p.name || "Unnamed"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
