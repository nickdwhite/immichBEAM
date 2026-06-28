import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, FolderTree, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { api } from "../lib/tauri";
import { fmtBytes } from "../lib/format";
import { isServerConfigured } from "../lib/config";
import { useToast } from "./Toast";
import type { Album, ConfigDto, FolderInspect } from "../types";

const BIG_FILES = 1000;
const BIG_BYTES = 5 * 1024 ** 3; // 5 GB

export function FolderSettings({
  config,
  onSaved,
}: {
  config: ConfigDto;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [extInput, setExtInput] = useState(config.include_extensions.join(", "));
  const [albums, setAlbums] = useState<Album[]>([]);
  const [newAlbum, setNewAlbum] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [pending, setPending] = useState<{ path: string; info: FolderInspect } | null>(
    null,
  );
  const [stats, setStats] = useState<Record<string, FolderInspect>>({});
  const [reorganizing, setReorganizing] = useState(false);
  const toast = useToast();

  const isConfigured = isServerConfigured(config);

  // Lazily compute per-folder media count + size in the background.
  useEffect(() => {
    let active = true;
    config.folders.forEach((f) => {
      api
        .inspectFolder(f.path)
        .then((info) => active && setStats((s) => ({ ...s, [f.path]: info })))
        .catch(() => {});
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.folders.map((f) => f.path).join("|")]);

  // Albums are only available once the server is configured (API key or a
  // logged-in password session).
  useEffect(() => {
    if (isConfigured) {
      api.getAlbums().then(setAlbums).catch(() => setAlbums([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured]);

  const doAdd = async (path: string) => {
    setBusy(true);
    try {
      await api.addFolder(path);
      onSaved();
      toast.success("Folder added — scanning for media");
    } catch (e) {
      toast.error(`Couldn't add folder: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    setInspecting(true);
    try {
      const info = await api.inspectFolder(selected);
      const large =
        info.file_count > BIG_FILES || info.total_bytes > BIG_BYTES;
      if (large) {
        setPending({ path: selected, info });
      } else {
        await doAdd(selected);
      }
    } finally {
      setInspecting(false);
    }
  };

  const confirmAdd = async () => {
    if (!pending) return;
    const path = pending.path;
    setPending(null);
    await doAdd(path);
  };

  const remove = async (path: string) => {
    setBusy(true);
    try {
      await api.removeFolder(path);
      onSaved();
      toast.info("Folder removed");
    } finally {
      setBusy(false);
    }
  };

  const toggleFolder = async (path: string, enabled: boolean) => {
    setBusy(true);
    try {
      await api.saveConfig({
        ...config,
        folders: config.folders.map((f) =>
          f.path === path ? { ...f, enabled } : f,
        ),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const toggleRecursive = async (path: string, recursive: boolean) => {
    setBusy(true);
    try {
      await api.saveConfig({
        ...config,
        folders: config.folders.map((f) =>
          f.path === path ? { ...f, recursive } : f,
        ),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const setAlbum = async (path: string, albumId: string) => {
    setBusy(true);
    try {
      await api.saveConfig({
        ...config,
        folders: config.folders.map((f) =>
          f.path === path ? { ...f, album_id: albumId || null } : f,
        ),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const createAlbum = async () => {
    const name = newAlbum.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await api.createAlbum(name);
      setAlbums((prev) => [...prev, created]);
      setNewAlbum("");
      toast.success(`Album “${name}” created`);
    } catch (e) {
      toast.error(`Couldn't create album: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const saveExtensions = async () => {
    const exts = extInput
      .split(/[\s,]+/)
      .map((e) => e.trim().replace(/^\./, "").toLowerCase())
      .filter(Boolean);
    setBusy(true);
    try {
      await api.saveConfig({ ...config, include_extensions: exts });
      onSaved();
      toast.success("File-type filter saved");
    } finally {
      setBusy(false);
    }
  };

  const resetExtensions = async () => {
    setBusy(true);
    try {
      const defaults = await api.defaultExtensions();
      setExtInput(defaults.join(", "));
      await api.saveConfig({ ...config, include_extensions: defaults });
      onSaved();
      toast.success("Filter reset to Immich defaults");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Watched folders</h3>
          <button
            onClick={pickFolder}
            disabled={busy || inspecting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {inspecting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FolderPlus size={16} />
            )}
            Add folder
          </button>
        </div>

        {pending && (
          <div className="mb-3 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/30">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium">This is a large folder.</p>
              <p className="mt-0.5 text-xs">
                <span className="font-mono">{pending.path}</span> contains{" "}
                <strong>{pending.info.file_count.toLocaleString()}</strong> matching
                files totaling <strong>{fmtBytes(pending.info.total_bytes)}</strong>.
                All of it will be uploaded to Immich.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setPending(null)}
                  className="rounded-lg border border-amber-400 px-3 py-1 text-xs font-medium dark:border-amber-700"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAdd}
                  className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                >
                  Add anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {config.folders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
            No folders watched yet. Add one to start syncing.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {config.folders.map((f) => (
              <li
                key={f.path}
                className="flex items-center justify-between gap-3 bg-white px-3 py-2.5 text-sm dark:bg-slate-900"
              >
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={(e) => toggleFolder(f.path, e.target.checked)}
                  disabled={busy}
                  className="shrink-0 rounded border-slate-300 text-brand-600"
                  title={f.enabled ? "Watching — click to pause" : "Paused — click to watch"}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate font-mono text-xs ${
                      f.enabled ? "" : "text-slate-400 line-through"
                    }`}
                    title={f.path}
                  >
                    {f.path}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {stats[f.path]
                      ? `${stats[f.path].file_count.toLocaleString()} files · ${fmtBytes(stats[f.path].total_bytes)}`
                      : "…"}
                  </div>
                </div>
                <button
                  onClick={() => toggleRecursive(f.path, !f.recursive)}
                  disabled={busy}
                  className={`shrink-0 rounded p-1 ${
                    f.recursive
                      ? "text-brand-600 dark:text-brand-400"
                      : "text-slate-300 dark:text-slate-600"
                  } hover:bg-slate-100 dark:hover:bg-slate-800`}
                  title={f.recursive ? "Watching subfolders — click for top-level only" : "Top-level only — click to include subfolders"}
                  aria-pressed={f.recursive}
                  aria-label="Toggle recursive watching"
                >
                  <FolderTree size={16} />
                </button>
                <select
                  value={f.album_id ?? ""}
                  onChange={(e) => setAlbum(f.path, e.target.value)}
                  disabled={busy || albums.length === 0}
                  className="max-w-[12rem] rounded-md border-slate-300 text-xs dark:border-slate-700 dark:bg-slate-800"
                  title={albums.length === 0 ? "Configure the server to load albums" : "Target album"}
                >
                  <option value="">No album</option>
                  {albums.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.album_name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => remove(f.path)}
                  disabled={busy}
                  className="text-slate-400 hover:text-immich-600"
                  aria-label="Remove folder"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Create album</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={newAlbum}
            onChange={(e) => setNewAlbum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAlbum()}
            placeholder="New album name"
            disabled={busy || !isConfigured}
            className="flex-1 rounded-lg border-slate-300 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            onClick={createAlbum}
            disabled={busy || !newAlbum.trim() || !isConfigured}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Creates an empty album on your server; assign it to a folder above.
        </p>
      </div>

      {config.folders.some((f) => f.album_id) && (
        <div>
          <button
            onClick={async () => {
              setReorganizing(true);
              try {
                const r = await api.reorganizeAlbums();
                if (r.errors.length > 0) {
                  toast.error(`Reorganize: ${r.errors[0]}`);
                } else if (r.added === 0) {
                  toast.info("All uploaded assets are already in their assigned albums");
                } else {
                  toast.success(
                    `Added ${r.added} asset${r.added === 1 ? "" : "s"} to albums`,
                  );
                }
              } catch (e) {
                toast.error(`Reorganize failed: ${e}`);
              } finally {
                setReorganizing(false);
              }
            }}
            disabled={reorganizing || busy || !isConfigured}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {reorganizing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Reorganize into albums
          </button>
          <p className="mt-1 text-xs text-slate-400">
            Adds previously-uploaded assets to their folder's assigned album.
          </p>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium">File type filter</label>
        <textarea
          value={extInput}
          onChange={(e) => setExtInput(e.target.value)}
          rows={3}
          className="w-full rounded-lg border-slate-300 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
        />
        <p className="mt-1.5 text-xs text-slate-400">
          Comma- or space-separated extensions. Leave blank to allow all files.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={saveExtensions}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Save filter
          </button>
          <button
            onClick={resetExtensions}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Reset to Immich defaults
          </button>
        </div>
      </div>
    </div>
  );
}
