import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Check, Cpu, Palette, Pencil, SunMoon, Trash2, Unplug, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { removeToast, TOAST_DISPLAY_MS, useToasts, type Toast, type ToastIcon } from "../lib/toasts.ts";

const ICONS: Record<ToastIcon, LucideIcon> = {
  trash: Trash2,
  archive: Archive,
  unarchive: ArchiveRestore,
  model: Cpu,
  theme: SunMoon,
  accent: Palette,
  unshare: Unplug,
  edit: Pencil,
  check: Check,
};

/** Must match the .toast-exit animation duration in index.css. */
const EXIT_MS = 260;

function ToastPill({ toast }: { toast: Toast }) {
  const [leaving, setLeaving] = useState(false);

  // Full visibility window, then the exit animation. Restarted whenever a
  // same-tag push replaces the text (nonce bump).
  useEffect(() => {
    setLeaving(false);
    const t = window.setTimeout(() => setLeaving(true), TOAST_DISPLAY_MS);
    return () => window.clearTimeout(t);
  }, [toast.nonce]);

  // Unmount once the exit animation has played out.
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => removeToast(toast.id), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving, toast.id]);

  const Icon = ICONS[toast.icon];

  return (
    <div
      role="status"
      onClick={() => setLeaving(true)}
      className={cn(
        "pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-full border border-stone-200 bg-white/95 py-2 pl-2.5 pr-4 shadow-xl backdrop-blur",
        "dark:border-zinc-700 dark:bg-zinc-900/95",
        leaving ? "toast-exit" : "toast-enter",
      )}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
        <Icon size={14} />
      </span>
      <span className="max-w-72 truncate text-sm font-medium">{toast.text}</span>
    </div>
  );
}

/**
 * Bottom-center pill stack. Fixed above the composer (bottom-24), over the
 * modals (z-[70] > modal z-50) so settings actions toast visibly too.
 */
export function Toasts() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <ToastPill key={t.id} toast={t} />
      ))}
    </div>
  );
}
