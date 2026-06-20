import { useEffect, useState } from "react";
import { api, onFreeableChanged } from "../lib/tauri";

/** True while a free-up-space scan is running (for cross-tab indicators). */
export function useFreeableRunning(): boolean {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      api
        .getFreeableState()
        .then((s) => mounted && setRunning(s.running))
        .catch(() => {});
    refresh();
    const un = onFreeableChanged(refresh);
    return () => {
      mounted = false;
      un.then((fn) => fn());
    };
  }, []);

  return running;
}
