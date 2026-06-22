import { useCallback, useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, RefreshCw } from "lucide-react";
import { api } from "../lib/tauri";

export function LogViewer() {
  const [log, setLog] = useState("");
  const [auto, setAuto] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);

  const refresh = useCallback(async () => {
    try {
      const text = await api.readLog(500);
      setLog(text);
    } catch (e) {
      setLog(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!auto) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh, auto]);

  // Keep the view pinned to the newest lines.
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [log]);

  // WKWebView doesn't repaint off-screen content in a tall scroll container when
  // the theme class flips on <html>. Force a repaint of the <pre> on theme
  // changes, preserving scroll position.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const el = preRef.current;
      if (!el) return;
      const top = el.scrollTop;
      el.style.display = "none";
      void el.offsetHeight; // force reflow
      el.style.display = "";
      el.scrollTop = top;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const openFolder = async () => {
    try {
      const path = await api.getLogPath();
      await revealItemInDir(path);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Log</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="rounded border-slate-300 text-brand-600"
            />
            Auto-refresh
          </label>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            onClick={openFolder}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <FolderOpen size={13} /> Open folder
          </button>
        </div>
      </div>
      <pre
        ref={preRef}
        className="h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
      >
        {log || "No log output yet."}
      </pre>
    </div>
  );
}
