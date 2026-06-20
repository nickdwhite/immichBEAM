import { useEffect, useState } from "react";
import { api, onHistoryChanged } from "../lib/tauri";
import type { HistoryItem } from "../types";

/** Completed-upload history, refreshed on the history-updated event. */
export function useHistory(limit = 200) {
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      api.getHistory(limit).then((h) => mounted && setItems(h)).catch(() => {});
    refresh();
    const unlisten = onHistoryChanged(refresh);
    return () => {
      mounted = false;
      unlisten.then((fn) => fn());
    };
  }, [limit]);

  return items;
}
