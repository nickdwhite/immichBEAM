import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/tauri";
import type { ConfigDto } from "../types";

/** Loads config once and exposes a reload function. */
export function useConfig() {
  const [config, setConfig] = useState<ConfigDto | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { config, loading, reload, setConfig };
}
