// Custom URI scheme registered in Rust (src-tauri/src/lib.rs) that proxies to
// the Immich server and injects auth, so <img> tags can load server thumbnails
// directly (webview-cached) with no frontend credentials.
//
// macOS/Linux: immichasset://localhost/...
// Windows:     http://immichasset.localhost/...
const isWindows =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
const ORIGIN = isWindows
  ? "http://immichasset.localhost"
  : "immichasset://localhost";

export function assetUrl(
  id: string,
  size: "thumbnail" | "preview" | "full" = "preview",
): string {
  return `${ORIGIN}/${encodeURIComponent(id)}?size=${size}`;
}

// Inline `<video>` source — routed to /api/assets/{id}/video/playback by the
// immichasset scheme handler (with Range passthrough for seeking).
export function videoUrl(id: string): string {
  return `${ORIGIN}/video/${encodeURIComponent(id)}`;
}

// Original bytes — routed to /api/assets/{id}/original. Used for SVG (and other
// formats Immich may not rasterize into a thumbnail), which the browser renders
// natively via <img>.
export function originalUrl(id: string): string {
  return `${ORIGIN}/original/${encodeURIComponent(id)}`;
}

// A person's face thumbnail — routed to /api/people/{id}/thumbnail.
export function personUrl(id: string): string {
  return `${ORIGIN}/person/${encodeURIComponent(id)}`;
}
