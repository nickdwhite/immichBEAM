import { useMemo, useRef, useState } from "react";
import { Tag, X } from "lucide-react";
import type { Tag as TagType } from "../types";

const tagLabel = (t: TagType) => t.value ?? t.name ?? t.id;

export function TagInput({
  tags,
  selectedIds,
  onChange,
}: {
  tags: TagType[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags.filter(
      (t) =>
        !selectedIds.includes(t.id) &&
        (!q || tagLabel(t).toLowerCase().includes(q)),
    );
  }, [tags, selectedIds, query]);

  const select = (id: string) => {
    onChange([...selectedIds, id]);
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  };

  const remove = (id: string) => {
    onChange(selectedIds.filter((i) => i !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open && options[highlight]) {
      e.preventDefault();
      select(options[highlight].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && selectedIds.length > 0) {
      remove(selectedIds[selectedIds.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800"
        onClick={() => inputRef.current?.focus()}
      >
        <Tag
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          size={15}
        />
        {selectedIds.map((id) => {
          const t = tagMap.get(id);
          if (!t) return null;
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-brand-600 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-white"
            >
              {tagLabel(t)}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(id);
                }}
                className="rounded-full p-0.5 transition-colors hover:bg-white/20"
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={selectedIds.length === 0 ? "Filter by tags…" : "Add tag…"}
          className="min-w-[80px] flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0 placeholder:text-slate-400"
        />
      </div>

      {open && options.length > 0 && (
        <ul className="absolute z-20 mt-1.5 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {options.map((t, i) => (
            <li key={t.id}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(t.id)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  i === highlight
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {tagLabel(t)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
