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
