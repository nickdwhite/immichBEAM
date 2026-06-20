import { Lock, ShieldAlert } from "lucide-react";

/** Shows whether the configured server URL is encrypted (HTTPS) or not. */
export function SecurityBadge({ url }: { url: string }) {
  if (!url) return null;
  const isHttps = url.trim().toLowerCase().startsWith("https://");
  return isHttps ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      <Lock size={12} /> Secure (HTTPS)
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <ShieldAlert size={12} /> Insecure (HTTP)
    </span>
  );
}
