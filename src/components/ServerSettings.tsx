import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CloudOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Plug,
  Save,
  ScanSearch,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "../lib/tauri";
import { isServerConfigured } from "../lib/config";
import { SecurityBadge } from "./SecurityBadge";
import { useToast } from "./Toast";
import type { ConfigDto, ConnectionInfo, ServerFeatures } from "../types";

type AuthTab = "api_key" | "password";

export function ServerSettings({
  config,
  onSaved,
}: {
  config: ConfigDto;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(config.server_url);
  const [apiKey, setApiKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [allowInsecure, setAllowInsecure] = useState(config.allow_insecure);
  const [authTab, setAuthTab] = useState<AuthTab>(config.auth_method);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [result, setResult] = useState<ConnectionInfo | null>(null);
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [features, setFeatures] = useState<ServerFeatures | null>(null);
  const [detecting, setDetecting] = useState(false);
  const toast = useToast();

  const isConfigured = isServerConfigured(config);

  useEffect(() => {
    setAuthTab(config.auth_method);
  }, [config.auth_method]);

  const loadFingerprint = () =>
    api.getCertFingerprint().then(setFingerprint).catch(() => setFingerprint(null));

  useEffect(() => {
    if (isConfigured) {
      api.getConnectionInfo().then(setConn).catch(() => setConn(null));
      loadFingerprint();
    } else {
      setConn(null);
      setFingerprint(null);
    }
  }, [isConfigured, config.server_url]);

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
        is_admin: false,
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

  /// Probe the server's unauthenticated /api/server/features to see whether it
  /// advertises OAuth/SSO. Doesn't persist anything; decides whether offering
  /// the full OAuth login flow is worthwhile for this server.
  const detectSso = async () => {
    setDetecting(true);
    setFeatures(null);
    try {
      const f = await api.checkServerFeatures(url, allowInsecure);
      setFeatures(f);
      if (f.oauth) {
        toast.success("This server advertises SSO (OAuth)");
      } else {
        toast.info("This server uses API key / password only (no SSO)");
      }
    } catch (e) {
      toast.error(`Couldn't reach server: ${e}`);
    } finally {
      setDetecting(false);
    }
  };

  const login = async () => {
    setLoggingIn(true);
    setResult(null);
    try {
      const info = await api.loginWithPassword(url, email, password, allowInsecure);
      setResult(info);
      setPassword("");
      onSaved();
      toast.success(info.is_admin ? "Logged in as admin" : "Logged in successfully");
    } catch (e) {
      setResult({
        reachable: false,
        authenticated: false,
        version: null,
        user_email: null,
        is_admin: false,
        insecure: url.startsWith("http://"),
        message: String(e),
      });
      toast.error(`Login failed: ${e}`);
    } finally {
      setLoggingIn(false);
    }
  };

  /// Validate the active password session (bearer token) against the server.
  const testSession = async () => {
    setTesting(true);
    setResult(null);
    try {
      const info = await api.getConnectionInfo();
      setConn(info);
      setResult(info);
      if (info.authenticated) {
        toast.success("Session is valid");
      } else {
        toast.error(info.message || "Session is not valid");
      }
    } catch (e) {
      toast.error(`Couldn't validate session: ${e}`);
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.clearCredentials();
      setEmail("");
      setPassword("");
      setResult(null);
      onSaved();
      toast.info("Disconnected — all credentials cleared");
    } catch (e) {
      toast.error(`Couldn't clear credentials: ${e}`);
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
            {conn.authenticated && conn.is_admin && (
              <span className="ml-1.5 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                admin
              </span>
            )}
          </span>
          <SecurityBadge url={config.server_url} />
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium" title="The base URL of your Immich server, including port">Server URL</label>
          <SecurityBadge url={url} />
        </div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://your-server:2283"
          className="w-full rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <div>
        <button
          onClick={detectSso}
          disabled={detecting || !url}
          title="Probe the server to check if it supports SSO/OAuth login"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {detecting ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
          Detect SSO / server capabilities
        </button>
        {features && (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {features.oauth ? (
              <>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  SSO (OAuth) is available
                </span>{" "}
                on this server — full OAuth login support is coming soon.
              </>
            ) : (
              <>
                <span className="font-medium">No SSO</span> — this server uses API
                key / password authentication
                {features.password_login ? "" : " (password login disabled)"}.
              </>
            )}
          </p>
        )}
      </div>

      <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Authentication
        </h3>
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => { setAuthTab("api_key"); setResult(null); }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${
              authTab === "api_key"
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <KeyRound size={15} />
            API Key
          </button>
          <button
            onClick={() => { setAuthTab("password"); setResult(null); }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors ${
              authTab === "password"
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <UserRound size={15} />
            Email &amp; Password
          </button>
        </div>
      </div>

      {authTab === "api_key" ? (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                config.has_api_key && config.auth_method === "api_key"
                  ? "•••••••• (stored in keychain)"
                  : "Paste API key"
              }
              className="w-full rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <p className="mt-1 text-xs text-slate-400">
              Stored securely in your OS keychain — never written to disk in plain text.
            </p>
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
        </>
      ) : (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                config.auth_method === "password"
                  ? "•••••••• (stored in keychain)"
                  : "Enter password"
              }
              autoComplete="current-password"
              className="w-full rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <p className="mt-1 text-xs text-slate-400">
              Credentials are stored in your OS keychain and used to obtain a session token.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={login}
              disabled={loggingIn || !url || !email || !password}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loggingIn ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <LogIn size={16} />
              )}
              Log In
            </button>
            {config.auth_method === "password" && (
              <button
                onClick={testSession}
                disabled={testing}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {testing ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                Test Session
              </button>
            )}
            {config.auth_method === "password" && (
              <button
                onClick={disconnect}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <LogOut size={16} />
                Disconnect
              </button>
            )}
          </div>
        </>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Security
        </h3>
        <label className="flex items-center gap-2 text-sm" title="Enable trust-on-first-use certificate pinning for self-signed servers">
          <input
            type="checkbox"
            checked={allowInsecure}
            onChange={(e) => setAllowInsecure(e.target.checked)}
            className="rounded border-slate-300 text-brand-600"
          />
          Trust a self-signed certificate (pin on first connection)
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

      {result && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            result.authenticated
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/30 dark:text-red-200"
          }`}
        >
          <p className="font-medium">
            {result.message}
            {result.authenticated && result.is_admin && (
              <span className="ml-1.5 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                admin
              </span>
            )}
          </p>
          <p className="mt-1 text-xs opacity-80">
            {result.version && `Immich v${result.version}`}
            {result.user_email && ` · ${result.user_email}`}
          </p>
        </div>
      )}
    </div>
  );
}
