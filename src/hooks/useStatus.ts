import { useEffect, useState } from "react";
import { api, onStatus } from "../lib/tauri";
import type { SyncStatus } from "../types";

const INITIAL: SyncStatus = {
  state: "idle",
  icon: "disconnected",
  secure: false,
  pending: 0,
  active: 0,
  uploaded_session: 0,
  failed_session: 0,
  message: "",
};

/** Live sync status, seeded by a fetch and kept fresh via the status event. */
export function useStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(INITIAL);

  useEffect(() => {
    let mounted = true;
    api.getStatus().then((s) => mounted && setStatus(s)).catch(() => {});
    const unlisten = onStatus((s) => mounted && setStatus(s));
    return () => {
      mounted = false;
      unlisten.then((fn) => fn());
    };
  }, []);

  return status;
}
