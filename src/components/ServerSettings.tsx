import { useEffect, useState } from "react";
import { CheckCircle2, CloudOff, Loader2, Plug, Save, ShieldCheck } from "lucide-react";
import { api } from "../lib/tauri";
import { SecurityBadge } from "./SecurityBadge";
import { useToast } from "./Toast";
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
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const toast = useToast();

  const loadFingerprint = () =>
    api.getCertFingerprint().then(setFingerprint).catch(() => setFingerprint(null));

  // Show live connection status (incl. server version) when configured. Uses
  // the cached client, so it doesn't prompt for the keychain.
  useEffect(() => {
    if (config.has_api_key && config.server_url) {
      api.getConnectionInfo().then(setConn).catch(() => setConn(null));
      loadFingerprint();
    } else {
      setConn(null);
      setFingerprint(null);
    }
  }, [config.has_api_key, config.server_url]);

  const forgetPin = async () => {
    try {
      await api.forgetCertPin();
      await loadFingerprint();
      toast.info("Forgot pinned certificate — it will be re-trusted on the next connection");
    } catch (e) {
      toast.error(`Couldn't forget certificate: ${e}`);
    }
  };

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
      toast.success("Server settings saved");
    } catch (e) {
      toast.error(`Couldn't save server settings: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      {conn && (conn.authenticated || conn.reachable) && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
            conn.authenticated
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
          }`}
        >
          {conn.authenticated ? (
            <CheckCircle2 size={18} className="shrink-0" />
          ) : (
            <CloudOff size={18} className="shrink-0" />
          )}
          <span className="flex-1">
            {conn.authenticated ? "Connected" : "Reachable, not authenticated"}
            {conn.version && ` · Immich v${conn.version}`}
            {conn.user_email && ` · ${conn.user_email}`}
          </span>
          <SecurityBadge url={config.server_url} />
        </div>
      )}

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

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowInsecure}
            onChange={(e) => setAllowInsecure(e.target.checked)}
            className="rounded border-slate-300 text-brand-600"
          />
          Trust a self-signed certificate (pin it on first connection)
        </label>
        <p className="ml-6 text-xs text-slate-400">
          The server's certificate is captured and pinned the first time it
          connects; afterwards only that exact certificate is accepted, so a
          swapped certificate is rejected.
        </p>
        {allowInsecure && (
          <div className="ml-6 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/50">
            {fingerprint ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck size={14} /> Certificate pinned
                </div>
                <code className="block break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  SHA-256 {fingerprint}
                </code>
                <button
                  onClick={forgetPin}
                  className="rounded-md border border-slate-300 px-2 py-1 font-medium hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800"
                >
                  Forget &amp; re-trust
                </button>
              </div>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">
                No certificate pinned yet — it will be captured on the next
                successful HTTPS connection.
              </span>
            )}
          </div>
        )}
      </div>

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
