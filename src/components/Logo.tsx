/**
 * The immich-beam brand mark — the blue cloud + photo-swirl + sync-arrows logo
 * on a transparent background (`public/logo.png`). One clean mark used
 * everywhere in the UI (sidebar, About, buttons, favicon); it reads on both
 * light and dark backgrounds since the cloud body is opaque.
 */
export function Logo({
  size = 32,
  className = "",
  title = "immich-beam",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      draggable={false}
    />
  );
}
