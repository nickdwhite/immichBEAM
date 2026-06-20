import { useEffect, useState } from "react";
import { onProgress, onProgressDone } from "../lib/tauri";

export interface ItemProgress {
  path: string;
  sent: number;
  total: number;
  pct: number;
}

/** Map of queue-item id → live upload progress, from progress events. */
export function useProgress(): Record<string, ItemProgress> {
  const [progress, setProgress] = useState<Record<string, ItemProgress>>({});

  useEffect(() => {
    let mounted = true;
    const unProgress = onProgress((p) => {
      if (mounted)
        setProgress((prev) => ({
          ...prev,
          [p.id]: { path: p.path, sent: p.sent, total: p.total, pct: p.pct },
        }));
    });
    const unDone = onProgressDone((id) => {
      if (mounted)
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
    });
    return () => {
      mounted = false;
      unProgress.then((fn) => fn());
      unDone.then((fn) => fn());
    };
  }, []);

  return progress;
}
