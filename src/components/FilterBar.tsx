import type { LucideIcon } from "lucide-react";
import { Image as ImageIcon, Images, Search, Sparkles, Video } from "lucide-react";

export type TypeFilter = "all" | "IMAGE" | "VIDEO";

export const toggleChip = (active: boolean): string =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "bg-brand-600 text-white"
      : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

const TYPE_OPTS: { id: TypeFilter; label: string; Icon: typeof Images }[] = [
  { id: "all", label: "All", Icon: Images },
  { id: "IMAGE", label: "Photos", Icon: ImageIcon },
  { id: "VIDEO", label: "Videos", Icon: Video },
];

export interface ChipDef {
  key: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onToggle: () => void;
}

export function FilterBar({
  query,
  onQueryChange,
  placeholder = "Search…",
  smartPlaceholder,
  smartMode,
  onSmartModeChange,
  typeFilter,
  onTypeChange,
  chips,
  children,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder?: string;
  smartPlaceholder?: string;
  smartMode?: boolean;
  onSmartModeChange?: (smart: boolean) => void;
  typeFilter?: TypeFilter;
  onTypeChange?: (type: TypeFilter) => void;
  chips?: ChipDef[];
  children?: React.ReactNode;
}) {
  const hasExtra = (chips && chips.length > 0) || children;
  const hasChipRow = typeFilter !== undefined || hasExtra;
  const activePlaceholder =
    smartMode && smartPlaceholder ? smartPlaceholder : placeholder;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            size={15}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={activePlaceholder}
            className="w-full rounded-lg border-slate-300 py-1.5 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        {onSmartModeChange && (
          <button
            onClick={() => onSmartModeChange(!smartMode)}
            aria-pressed={!!smartMode}
            title={
              smartMode
                ? "Switch to metadata search"
                : "Switch to smart (semantic/CLIP) search — needs machine-learning on the server"
            }
            className={toggleChip(!!smartMode)}
          >
            <Sparkles size={14} /> Smart
          </button>
        )}
      </div>

      {hasChipRow && (
        <div className="flex flex-wrap items-center gap-1.5">
          {typeFilter !== undefined &&
            onTypeChange &&
            TYPE_OPTS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => onTypeChange(id)}
                aria-pressed={typeFilter === id}
                className={toggleChip(typeFilter === id)}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          {typeFilter !== undefined && hasExtra && (
            <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-700" />
          )}
          {chips?.map((c) => (
            <button
              key={c.key}
              onClick={c.onToggle}
              aria-pressed={c.active}
              className={toggleChip(c.active)}
            >
              <c.icon size={14} /> {c.label}
            </button>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}
