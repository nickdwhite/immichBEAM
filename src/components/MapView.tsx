import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { api } from "../lib/tauri";
import { assetUrl } from "../lib/assetUrl";
import { PhotoLightbox } from "./PhotoLightbox";
import type { BrowseAsset, MapMarker } from "../types";

// Clean CartoDB basemaps (free, with attribution). Voyager for light, Dark
// Matter for dark — much sleeker than raw OSM tiles.
const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTR = "© OpenStreetMap, © CARTO";

const isDark = () => document.documentElement.classList.contains("dark");
const tileLayerForTheme = (): L.TileLayer =>
  L.tileLayer(isDark() ? TILES.dark : TILES.light, { maxZoom: 19, attribution: ATTR });

// A small brand-blue dot (white-ringed) on a 24x24 transparent hit area, so the
// hover/click target is comfortable. divIcon so it can be clustered.
const dotIcon = L.divIcon({
  className: "immich-map-marker",
  html: '<span class="immich-map-marker-dot"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Defense-in-depth for tooltip HTML interpolation — Immich asset ids are UUIDs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function MapView({
  serverUrl,
  onPersonClick,
}: {
  serverUrl: string;
  onPersonClick?: (personId: string, name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const [markers, setMarkers] = useState<MapMarker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<BrowseAsset | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .browseMap()
      .then((m) => { if (!cancelled) setMarkers(m); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  // Initialize the map once. No Leaflet prefix in the attribution (the required
  // OSM/CARTO credit still shows); swap basemaps when the app theme changes.
  useEffect(() => {
    if (!containerRef.current || mapRef.current || error) return;
    const map = L.map(containerRef.current, {
      worldCopyJump: true,
      attributionControl: false,
      scrollWheelZoom: true,
    }).setView([20, 0], 2);
    L.control.attribution({ prefix: false }).addTo(map);
    tileRef.current = tileLayerForTheme().addTo(map);
    mapRef.current = map;

    const obs = new MutationObserver(() => {
      if (!mapRef.current) return;
      tileRef.current?.remove();
      tileRef.current = tileLayerForTheme().addTo(mapRef.current);
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      obs.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
    };
  }, [error]);

  // Render clustered markers with hover-thumbnail tooltips; auto-fit on load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !markers || markers.length === 0) return;
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      iconCreateFunction: (c) =>
        L.divIcon({
          className: "immich-map-cluster",
          html: `<span>${c.getChildCount()}</span>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
    });
    for (const m of markers) {
      const marker = L.marker([m.lat, m.lon], { icon: dotIcon })
        .addTo(cluster)
        .on("click", () => void openAsset(m.id));
      // Only build the tooltip HTML if the id is a valid UUID. assetUrl()
      // already encodeURIComponent's the id, but this prevents XSS if that
      // encoding is ever dropped or a non-UUID id slips through.
      if (UUID_RE.test(m.id)) {
        marker.bindTooltip(
          `<img src="${assetUrl(m.id, "thumbnail")}" class="immich-map-preview-img" ` +
            `width="160" height="160" alt="" />`,
          { direction: "top", opacity: 1, offset: [0, -8] },
        );
      }
    }
    cluster.addTo(map);
    clusterRef.current = cluster;
    map.fitBounds(cluster.getBounds().pad(0.15), { maxZoom: 15 });
    return () => {
      cluster.remove();
      clusterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  const fitAll = () => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (map && cluster && cluster.getLayers().length) {
      map.fitBounds(cluster.getBounds().pad(0.15), { maxZoom: 15 });
    }
  };

  const openAsset = async (id: string) => {
    try {
      const d = await api.getAssetDetail(id);
      setActive({
        id: d.id,
        type: d.type,
        originalFileName: d.originalFileName ?? null,
        originalMimeType: d.originalMimeType ?? null,
        fileCreatedAt: d.fileCreatedAt ?? d.localDateTime ?? null,
        duration: d.duration ?? null,
        isFavorite: d.isFavorite ?? false,
        livePhotoVideoId: d.livePhotoVideoId ?? null,
      });
    } catch {
      // ignored — click just does nothing on failure
    }
  };

  if (error) {
    const unavailable = /404/i.test(error);
    return (
      <div
        className={`rounded-lg border p-8 text-center text-sm ${
          unavailable
            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
            : "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        }`}
      >
        {unavailable
          ? "Map view isn't available on this Immich version — the server didn't expose a map-markers endpoint."
          : error}
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          {markers
            ? `${markers.length} geo-tagged location${markers.length === 1 ? "" : "s"}`
            : "Loading map…"}
        </span>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline">Hover to preview · click to open</span>
          <button
            onClick={fitAll}
            disabled={!markers || markers.length === 0}
            className="rounded-md border border-slate-300 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Fit all
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="h-[68vh] w-full overflow-hidden rounded-xl border border-slate-200 shadow-sm dark:border-slate-800"
      />
      {active && (
        <PhotoLightbox
          asset={active}
          serverUrl={serverUrl}
          onClose={() => setActive(null)}
          onPersonClick={onPersonClick}
        />
      )}
    </>
  );
}
