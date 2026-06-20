import {
  CheckCircle2,
  CloudOff,
  Loader2,
  PauseCircle,
  AlertTriangle,
} from "lucide-react";
import type { SyncState } from "../types";

const MAP: Record<
  SyncState,
  { label: string; color: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  idle: { label: "Up to date", color: "text-emerald-500", Icon: CheckCircle2 },
  syncing: { label: "Syncing", color: "text-brand-500", Icon: Loader2, spin: true },
  paused: { label: "Paused", color: "text-amber-500", Icon: PauseCircle },
  error: { label: "Error", color: "text-immich-500", Icon: AlertTriangle },
  offline: { label: "Offline", color: "text-slate-400", Icon: CloudOff },
};

export function StatusIndicator({
  state,
  size = 18,
}: {
  state: SyncState;
  size?: number;
}) {
  const { label, color, Icon, spin } = MAP[state];
  return (
    <span className={`inline-flex items-center gap-2 ${color}`}>
      <Icon size={size} className={spin ? "animate-spin" : ""} />
      <span className="text-sm font-medium">{label}</span>
    </span>
  );
}
