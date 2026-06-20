import { useEffect, useState } from "react";
import { api, onHistoryChanged } from "../lib/tauri";
import type { HistoryStats } from "../types";

const INITIAL: HistoryStats = {
  total: 0,
  success: 0,
  duplicate: 0,
  skipped: 0,
  failed: 0,
  last_uploaded_at: null,
};

/** Aggregate upload stats, refreshed when history changes. */
export function useStats(): HistoryStats {
  const [stats, setStats] = useState<HistoryStats>(INITIAL);

  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      api.getStats().then((s) => mounted && setStats(s)).catch(() => {});
    refresh();
    const unlisten = onHistoryChanged(refresh);
    return () => {
      mounted = false;
      unlisten.then((fn) => fn());
    };
  }, []);

  return stats;
}
