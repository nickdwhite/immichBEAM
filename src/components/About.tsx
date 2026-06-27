import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { UpdateChecker } from "./UpdateChecker";
import { Logo } from "./Logo";
import { IN_APP_UPDATES_ENABLED } from "../lib/release";

export function About() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Logo size={44} className="rounded-xl" />
        <div>
          <h2 className="text-base font-semibold">Immich Beam</h2>
          <p className="text-sm text-slate-500">
            Desktop sync client for Immich{version && ` · v${version}`}
          </p>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
        {IN_APP_UPDATES_ENABLED ? (
          <UpdateChecker />
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Updates</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Manual downloads only in the current private-repo release setup.
            </p>
            <p className="text-xs text-slate-400">
              GitHub Actions can still build draft releases for macOS, Windows,
              and Linux. Install new versions from the release assets until a
              public or authenticated update feed is configured.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-6 dark:border-slate-800">
        <button
          onClick={() => openUrl("https://immich.app").catch(() => {})}
          className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline"
        >
          About Immich <ExternalLink size={13} />
        </button>
        <br />
        <button
          onClick={() =>
            openUrl("https://immich.app/docs/features/supported-formats").catch(
              () => {},
            )
          }
          className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:underline"
        >
          Supported file formats <ExternalLink size={13} />
        </button>
      </div>
    </div>
  );
}
