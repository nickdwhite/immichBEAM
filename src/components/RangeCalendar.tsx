import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/// A self-contained month-grid range calendar (no native/OS pop-out). First
/// click sets the start, the second sets the end; clicking before the start
/// restarts the range.
export function RangeCalendar({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const fromD = parseYmd(from);
  const toD = parseYmd(to);
  const today = ymd(new Date());

  const [view, setView] = useState(() => {
    const d = fromD ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Keep the start of the range visible when it changes (e.g. via a preset).
  useEffect(() => {
    if (fromD) setView(new Date(fromD.getFullYear(), fromD.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(year, month, day));
  }

  // Next click targets "from" when there's no start yet, or once a full range
  // is set; otherwise it targets "to".
  const selecting: "from" | "to" = !from ? "from" : !to ? "to" : "from";

  const inRange = (d: Date): boolean => {
    if (!fromD) return false;
    const end = toD ?? fromD;
    const t = d.getTime();
    return (
      t >= Math.min(fromD.getTime(), end.getTime()) &&
      t <= Math.max(fromD.getTime(), end.getTime())
    );
  };
  const isEdge = (d: Date): boolean =>
    (fromD !== null && ymd(d) === from) || (toD !== null && ymd(d) === to);

  const pick = (d: Date) => {
    const s = ymd(d);
    if (selecting === "from") {
      onChange(s, "");
    } else if (fromD && d.getTime() < fromD.getTime()) {
      onChange(s, "");
    } else {
      onChange(from, s);
    }
  };

  const monthLabel = view.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          aria-label="Previous month"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          aria-label="Next month"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-slate-400">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="py-0.5">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) =>
          d ? (
            <button
              key={i}
              type="button"
              onClick={() => pick(d)}
              className={`flex aspect-square items-center justify-center rounded-md text-xs transition-colors ${
                isEdge(d)
                  ? "bg-brand-600 font-semibold text-white"
                  : inRange(d)
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                    : ymd(d) === today
                      ? "text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-800"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {d.getDate()}
            </button>
          ) : (
            <div key={i} />
          ),
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-slate-500 dark:text-slate-400">
          {from || to ? `${from || "…"} → ${to || "…"}` : "Click a start date"}
        </span>
        {(from || to) && (
          <button
            type="button"
            onClick={() => onChange("", "")}
            className="text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
