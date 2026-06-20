import { useEffect, useState } from "react";
import { api, onQueueChanged } from "../lib/tauri";
import type { QueueItem } from "../types";

/** Active + pending queue items, refreshed on the queue-updated event. */
export function useQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      api.getQueue().then((q) => mounted && setItems(q)).catch(() => {});
    refresh();
    const unlisten = onQueueChanged(refresh);
    const interval = setInterval(refresh, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
      unlisten.then((fn) => fn());
    };
  }, []);

  return items;
}

/** Failed (dead-letter) items. */
export function useFailed() {
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      api.getFailed().then((q) => mounted && setItems(q)).catch(() => {});
    refresh();
    const unlisten = onQueueChanged(refresh);
    return () => {
      mounted = false;
      unlisten.then((fn) => fn());
    };
  }, []);

  return items;
}
