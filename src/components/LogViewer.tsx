import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ClipboardCopy, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { api } from "../lib/tauri";
import { useToast } from "./Toast";

type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE";

interface ParsedLine {
  raw: string;
  timestamp: string;
  module: string;
  category: string;
  level: LogLevel;
  message: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: "text-red-500 dark:text-red-400",
  WARN: "text-amber-500 dark:text-amber-400",
  INFO: "text-slate-600 dark:text-slate-300",
  DEBUG: "text-sky-500 dark:text-sky-400",
  TRACE: "text-slate-400 dark:text-slate-500",
};

const CATEGORIES: Record<string, string> = {
  engine: "Sync",
  watcher: "Watcher",
  client: "API",
  queue: "Queue",
  hasher: "Hash",
  cleanup: "Cleanup",
  config: "Config",
  db: "DB",
};

const LINE_RE =
  /^\[([^\]]+)\]\[([^\]]+)\]\[([^\]]+)\]\[([A-Z]+)\]\s*(.*)$/;

function parseLine(raw: string): ParsedLine | null {
  const m = raw.match(LINE_RE);
  if (!m) return null;
  const module = m[3];
  const parts = module.split("::");
  const lastPart = parts[parts.length - 1];
  const category = CATEGORIES[lastPart] ?? lastPart;
  return {
    raw,
    timestamp: `${m[1]} ${m[2]}`,
    module,
    category,
    level: m[4] as LogLevel,
    message: m[5],
  };
}

const LEVEL_FILTERS: { value: LogLevel | "ALL"; label: string }[] = [
  { value: "ALL", label: "All levels" },
  { value: "ERROR", label: "Errors" },
  { value: "WARN", label: "Warnings" },
  { value: "INFO", label: "Info" },
  { value: "DEBUG", label: "Debug" },
];

export function LogViewer() {
  const [rawLog, setRawLog] = useState("");
  const [auto, setAuto] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
    new Set(),
  );
  const preRef = useRef<HTMLPreElement>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const text = await api.readLog(2000);
      setRawLog(text);
    } catch (e) {
      setRawLog(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!auto) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh, auto]);

  const parsed = useMemo(() => {
    const lines = rawLog.split("\n");
    const result: ParsedLine[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const p = parseLine(line);
      if (p) {
        result.push(p);
      } else if (result.length > 0) {
        result[result.length - 1].message += "\n" + line;
        result[result.length - 1].raw += "\n" + line;
      }
    }
    return result;
  }, [rawLog]);

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of parsed) cats.add(p.category);
    return Array.from(cats).sort();
  }, [parsed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parsed.filter((p) => {
      if (levelFilter !== "ALL" && LEVEL_ORDER[p.level] > LEVEL_ORDER[levelFilter])
        return false;
      if (hiddenCategories.has(p.category)) return false;
      if (q && !p.raw.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [parsed, levelFilter, hiddenCategories, search]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [filtered]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const el = preRef.current;
      if (!el) return;
      const top = el.scrollTop;
      el.style.display = "none";
      void el.offsetHeight;
      el.style.display = "";
      el.scrollTop = top;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const openFolder = async () => {
    try {
      const path = await api.getLogPath();
      await revealItemInDir(path);
    } catch {
      /* ignore */
    }
  };

  const copyLog = async () => {
    const text = filtered.map((p) => p.raw).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${filtered.length} log lines to clipboard`);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const toggleCategory = (cat: string) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LogLevel | "ALL")}
          title="Filter by log level"
          className="rounded-lg border-slate-300 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
        >
          {LEVEL_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="w-full rounded-lg border-slate-300 py-1.5 pl-8 pr-8 text-xs dark:border-slate-700 dark:bg-slate-800"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <label
          className="flex items-center gap-1.5 text-xs text-slate-500"
          title="Automatically refresh the log every 2 seconds"
        >
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            className="rounded border-slate-300 text-brand-600"
          />
          Auto
        </label>
        <button
          onClick={refresh}
          title="Refresh log now"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={copyLog}
          title="Copy filtered log to clipboard"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <ClipboardCopy size={13} />
        </button>
        <button
          onClick={openFolder}
          title="Open log file location in Finder"
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <FolderOpen size={13} />
        </button>
      </div>

      {allCategories.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {allCategories.map((cat) => {
            const active = !hiddenCategories.has(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                    : "bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {filtered.length} of {parsed.length} lines
          {search && " matching"}
        </span>
      </div>

      <pre
        ref={preRef}
        className="h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed dark:border-slate-800 dark:bg-slate-950"
      >
        {filtered.length === 0 ? (
          <span className="text-slate-400">
            {parsed.length === 0
              ? "No log output yet."
              : "No lines match the current filters."}
          </span>
        ) : (
          filtered.map((p, i) => (
            <div key={i} className="hover:bg-slate-100 dark:hover:bg-slate-900">
              <span className="text-slate-400">{p.timestamp} </span>
              <span
                className={`font-semibold ${LEVEL_COLORS[p.level]}`}
              >
                {p.level.padEnd(5)}
              </span>{" "}
              <span className="text-slate-500">[{p.category}]</span>{" "}
              <span className="text-slate-800 dark:text-slate-200">
                {p.message}
              </span>
            </div>
          ))
        )}
      </pre>
    </div>
  );
}
