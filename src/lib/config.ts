import type { ConfigDto } from "../types";

export function isServerConfigured(config: ConfigDto): boolean {
  return (
    !!config.server_url &&
    ((config.auth_method === "api_key" && config.has_api_key) ||
      config.auth_method === "password")
  );
}
