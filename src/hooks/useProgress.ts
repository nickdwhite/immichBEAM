import { useEffect, useRef, useState } from "react";
import { onProgress, onProgressDone } from "../lib/tauri";

export interface ItemProgress {
  path: string;
  phase: "hashing" | "uploading";
  sent: number;
  total: number;
  pct: number;
}

/** Map of queue-item id → live upload progress, from progress events. */
export function useProgress(): Record<string, ItemProgress> {
  const [progress, setProgress] = useState<Record<string, ItemProgress>>({});
  const doneIds = useRef(new Set<string>());

  useEffect(() => {
    let mounted = true;
    const unProgress = onProgress((p) => {
      if (mounted && !doneIds.current.has(p.id))
        setProgress((prev) => ({
          ...prev,
          [p.id]: {
            path: p.path,
            phase: p.phase,
            sent: p.sent,
            total: p.total,
            pct: p.pct,
          },
        }));
    });
    const unDone = onProgressDone((id) => {
      if (mounted) {
        doneIds.current.add(id);
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setTimeout(() => doneIds.current.delete(id), 5000);
      }
    });
    return () => {
      mounted = false;
      unProgress.then((fn) => fn());
      unDone.then((fn) => fn());
    };
  }, []);

  return progress;
}
