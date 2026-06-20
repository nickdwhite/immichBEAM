import { useState } from "react";
import { Loader2, Plug, Save } from "lucide-react";
import { api } from "../lib/tauri";
import { SecurityBadge } from "./SecurityBadge";
import type { ConfigDto, ConnectionInfo } from "../types";

export function ServerSettings({
  config,
  onSaved,
}: {
  config: ConfigDto;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(config.server_url);
  const [apiKey, setApiKey] = useState("");
  const [allowInsecure, setAllowInsecure] = useState(config.allow_insecure);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ConnectionInfo | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const info = await api.testConnection(url, apiKey || null, allowInsecure);
      setResult(info);
    } catch (e) {
      setResult({
        reachable: false,
        authenticated: false,
        version: null,
        user_email: null,
        insecure: url.startsWith("http://"),
        message: String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveServer(url, apiKey || null, allowInsecure);
      setApiKey("");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium">Server URL</label>
          <SecurityBadge url={url} />
        </div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.2.119:2283"
          className="w-full rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            config.has_api_key ? "•••••••• (stored in keychain)" : "Paste API key"
          }
          className="w-full rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
        <p className="mt-1 text-xs text-slate-400">
          Stored securely in your OS keychain — never written to disk in plain text.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowInsecure}
          onChange={(e) => setAllowInsecure(e.target.checked)}
          className="rounded border-slate-300 text-brand-600"
        />
        Trust self-signed certificate (accept invalid TLS)
      </label>

      <div className="flex gap-3">
        <button
          onClick={test}
          disabled={testing || !url}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {testing ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
          Test Connection
        </button>
        <button
          onClick={save}
          disabled={saving || !url}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save
        </button>
      </div>

      {result && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            result.authenticated
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
              : "border-immich-200 bg-immich-50 text-immich-800 dark:border-immich-900 dark:bg-immich-900/30 dark:text-immich-200"
          }`}
        >
          <p className="font-medium">{result.message}</p>
          <p className="mt-1 text-xs opacity-80">
            {result.version && `Immich v${result.version}`}
            {result.user_email && ` · ${result.user_email}`}
          </p>
        </div>
      )}
    </div>
  );
}
