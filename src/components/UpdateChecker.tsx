import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/tauri";
import type { UpdateInfo } from "../types";

export function UpdateChecker() {
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const check = async () => {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.checkForUpdate());
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await api.installUpdate(); // app restarts on success
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Updates</h3>
          <p className="text-xs text-slate-400">
            Current version {version || "…"}
          </p>
        </div>
        <button
          onClick={check}
          disabled={checking || installing}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {checking ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          Check for updates
        </button>
      </div>

      {result && !result.available && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          You're on the latest version.
        </p>
      )}

      {result?.available && (
        <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-900 dark:bg-brand-900/30">
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand-800 dark:text-brand-200">
              Version {result.version} is available
            </p>
            {result.notes && (
              <p className="mt-0.5 line-clamp-3 text-xs text-brand-700/80 dark:text-brand-300/80">
                {result.notes}
              </p>
            )}
          </div>
          <button
            onClick={install}
            disabled={installing}
            className="ml-3 inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {installing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            {installing ? "Installing…" : "Download & install"}
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-immich-600" title={error}>
          Update check failed: {error}
        </p>
      )}
    </div>
  );
}
