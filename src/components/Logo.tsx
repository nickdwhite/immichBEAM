import { useId } from "react";

/**
 * The canonical Immich SyncDesk brand mark — a vector copy of the app icon
 * (`src-tauri/icons/logo-source.png`): an orange→deep-red squircle with a white
 * upload cloud and a blue up-arrow. Use this everywhere the logo appears in the
 * UI so the in-app brand matches the dock / installer icon.
 *
 * Coordinates are the icon generator's 1024px layout divided by 10.24 onto a
 * 0–100 viewBox, so the proportions stay identical to the rendered app icon.
 */
export function Logo({
  size = 32,
  className,
  title = "Immich SyncDesk",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const gid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f06e46" />
          <stop offset="1" stopColor="#ce2f15" />
        </linearGradient>
      </defs>
      {/* Background squircle */}
      <rect x="4" y="4" width="92" height="92" rx="22" fill={`url(#${gid})`} />
      {/* Upload cloud */}
      <g fill="#ffffff">
        <circle cx="35.4" cy="54.7" r="12.7" />
        <circle cx="64.6" cy="54.7" r="14.6" />
        <circle cx="47.1" cy="45.9" r="17.1" />
        <circle cx="60.7" cy="48.8" r="12.7" />
        <rect x="25.6" y="52.7" width="49.8" height="11.8" rx="5.9" />
      </g>
      {/* Blue up-arrow rising out of the cloud */}
      <path
        d="M40.7 44.4 L50 35.2 L59.3 44.4 M50 35.2 L50 58.6"
        fill="none"
        stroke="#2563eb"
        strokeWidth="6.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
