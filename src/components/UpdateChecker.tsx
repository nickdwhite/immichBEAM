import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { api, onUpdateProgress } from "../lib/tauri";
import type { UpdateInfo, UpdateProgress } from "../types";

export function UpdateChecker() {
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [result, setResult] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!installing) return;
    const unlisten = onUpdateProgress(setProgress);
    return () => { unlisten.then((f) => f()); };
  }, [installing]);

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
    setProgress(null);
    setError(null);
    try {
      await api.installUpdate(); // app restarts on success
    } catch (e) {
      setError(String(e));
      setInstalling(false);
      setProgress(null);
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
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-900 dark:bg-brand-900/30">
          <div className="flex items-center justify-between">
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
              {installing ? "Downloading…" : "Download & install"}
            </button>
          </div>
          {installing && progress && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-brand-200 dark:bg-brand-800">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all duration-150"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-brand-700/70 dark:text-brand-300/70">
                {progress.pct}% downloaded
              </p>
            </div>
          )}
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
