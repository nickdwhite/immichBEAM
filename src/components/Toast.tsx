import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Fire transient toasts from anywhere inside <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, kind, message }]);
      setTimeout(() => remove(id), 3500);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const STYLES: Record<
  ToastKind,
  { Icon: typeof CheckCircle2; ring: string; icon: string }
> = {
  success: {
    Icon: CheckCircle2,
    ring: "border-emerald-200 dark:border-emerald-900",
    icon: "text-emerald-500",
  },
  error: {
    Icon: XCircle,
    ring: "border-immich-200 dark:border-immich-900",
    icon: "text-immich-500",
  },
  info: {
    Icon: Info,
    ring: "border-brand-200 dark:border-brand-900",
    icon: "text-brand-500",
  },
};

function ToastCard({
  toast,
  onClose,
}: {
  toast: ToastItem;
  onClose: () => void;
}) {
  const { Icon, ring, icon } = STYLES[toast.kind];
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border ${ring} bg-white p-3 shadow-lg dark:bg-slate-900`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${icon}`} />
      <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
        {toast.message}
      </span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
      >
        <X size={15} />
      </button>
    </div>
  );
}
