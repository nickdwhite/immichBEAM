import { useState } from "react";
import { Images, LayoutGrid } from "lucide-react";
import { isServerConfigured } from "../lib/config";
import { TimelineGrid } from "./TimelineGrid";
import { AlbumList } from "./AlbumList";
import { AlbumView } from "./AlbumView";
import type { Album, ConfigDto } from "../types";

type Mode = "timeline" | "albums";

export function PhotoBrowser({ config }: { config: ConfigDto }) {
  const [mode, setMode] = useState<Mode>("timeline");
  const [openedAlbum, setOpenedAlbum] = useState<Album | null>(null);

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

  return (
    <div className="space-y-3">
      {!openedAlbum && (
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          <button
            onClick={() => setMode("timeline")}
            aria-pressed={mode === "timeline"}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "timeline"
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Images size={14} /> Timeline
          </button>
          <button
            onClick={() => setMode("albums")}
            aria-pressed={mode === "albums"}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "albums"
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <LayoutGrid size={14} /> Albums
          </button>
        </div>
      )}

      {openedAlbum ? (
        <AlbumView album={openedAlbum} onBack={() => setOpenedAlbum(null)} />
      ) : mode === "timeline" ? (
        <TimelineGrid />
      ) : (
        <AlbumList onOpen={setOpenedAlbum} />
      )}
    </div>
  );
}
