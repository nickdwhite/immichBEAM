import { useState } from "react";
import { Images, LayoutGrid, Map as MapIcon, MapPin, Users } from "lucide-react";
import { isServerConfigured } from "../lib/config";
import { TimelineGrid } from "./TimelineGrid";
import { AlbumList } from "./AlbumList";
import { AlbumView } from "./AlbumView";
import { PeopleView } from "./PeopleView";
import { PlacesView } from "./PlacesView";
import { MapView } from "./MapView";
import { AssetResults } from "./AssetResults";
import type { Album, ConfigDto, MetadataSearch, Person } from "../types";

type Mode = "timeline" | "albums" | "people" | "places" | "map";

const MODES: { id: Mode; label: string; Icon: typeof Images }[] = [
  { id: "timeline", label: "Timeline", Icon: Images },
  { id: "albums", label: "Albums", Icon: LayoutGrid },
  { id: "people", label: "People", Icon: Users },
  { id: "places", label: "Places", Icon: MapPin },
  { id: "map", label: "Map", Icon: MapIcon },
];

const chip = (active: boolean): string =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "bg-brand-600 text-white"
      : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

interface ResultsView {
  title: string;
  search: MetadataSearch;
}

export function PhotoBrowser({ config }: { config: ConfigDto }) {
  const [mode, setMode] = useState<Mode>("timeline");
  const [openedAlbum, setOpenedAlbum] = useState<Album | null>(null);
  const [results, setResults] = useState<ResultsView | null>(null);

  if (!isServerConfigured(config)) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
        <Images className="mx-auto mb-2 text-slate-400" size={28} />
        <p className="text-sm font-medium">Connect to your server first</p>
        <p className="mt-1 text-xs text-slate-400">
          Add your Immich server in Server Settings to browse your library.
        </p>
      </div>
    );
  }

  const showToggle = !openedAlbum && !results;

  const openPerson = (p: Person) =>
    setResults({
      title: p.name || "Unnamed",
      search: { page: 1, size: 60, personIds: [p.id] },
    });
  const openPlace = (city: string) =>
    setResults({ title: city, search: { page: 1, size: 60, city } });
  const handlePersonClick = (personId: string, name: string) =>
    setResults({
      title: name,
      search: { page: 1, size: 60, personIds: [personId] },
    });

  return (
    <div className="space-y-3">
      {showToggle && (
        <div className="flex flex-wrap gap-1.5">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={chip(mode === id)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}

      {results ? (
        <AssetResults
          title={results.title}
          search={results.search}
          serverUrl={config.server_url}
          onBack={() => setResults(null)}
          onPersonClick={handlePersonClick}
        />
      ) : openedAlbum ? (
        <AlbumView
          album={openedAlbum}
          serverUrl={config.server_url}
          onBack={() => setOpenedAlbum(null)}
          onPersonClick={handlePersonClick}
        />
      ) : mode === "timeline" ? (
        <TimelineGrid
          serverUrl={config.server_url}
          onPersonClick={handlePersonClick}
        />
      ) : mode === "albums" ? (
        <AlbumList onOpen={setOpenedAlbum} />
      ) : mode === "people" ? (
        <PeopleView onOpen={openPerson} />
      ) : mode === "places" ? (
        <PlacesView onOpen={openPlace} />
      ) : (
        <MapView
          serverUrl={config.server_url}
          onPersonClick={handlePersonClick}
        />
      )}
    </div>
  );
}
