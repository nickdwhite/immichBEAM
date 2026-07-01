import { useEffect, useState } from "react";
import { api } from "../lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Github } from "lucide-react";
import { UpdateChecker } from "./UpdateChecker";
import { Logo } from "./Logo";

export function About() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    api.getVersionDisplay().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-4">
        <Logo size={64} />
        <div>
          <h2 className="text-lg font-semibold">immichBEAM</h2>
          <p className="text-sm text-slate-500">
            {version && `${version} · `}Desktop sync client for Immich
          </p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        immichBEAM keeps your photos and videos backed up to your self-hosted{" "}
        <button
          onClick={() => openUrl("https://immich.app").catch(() => {})}
          className="text-brand-600 hover:underline dark:text-brand-400"
        >
          Immich
        </button>{" "}
        server. It watches folders on your computer for new media, hashes files
        to avoid duplicates, and uploads them in the background with streaming
        progress, bandwidth limits, and automatic retries. Supports API key and
        email/password authentication, per-folder and automatic album
        organization, Live Photo pairing, XMP sidecars, and trust-on-first-use
        certificate pinning. Available for macOS, Windows, and Linux.
      </p>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Updates
        </h3>
        <UpdateChecker />
      </div>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Links
        </h3>
        <div className="flex flex-col gap-2">
          <button
            onClick={() =>
              openUrl("https://github.com/nickdwhite/immichBEAM").catch(
                () => {},
              )
            }
            className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline dark:text-brand-400"
          >
            <Github size={14} />
            immichBEAM on GitHub
          </button>
          <button
            onClick={() => openUrl("https://immich.app").catch(() => {})}
            className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline dark:text-brand-400"
          >
            <ExternalLink size={13} />
            About Immich
          </button>
          <button
            onClick={() =>
              openUrl(
                "https://immich.app/docs/features/supported-formats",
              ).catch(() => {})
            }
            className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline dark:text-brand-400"
          >
            <ExternalLink size={13} />
            Supported file formats
          </button>
        </div>
      </div>
    </div>
  );
}
