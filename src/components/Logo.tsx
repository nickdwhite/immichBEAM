/**
 * The immich-beam brand mark — a blue UFO beaming the Immich logo, tilted 60°
 * (`public/logo.png`). Used in the sidebar, About screen, and as the favicon.
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
