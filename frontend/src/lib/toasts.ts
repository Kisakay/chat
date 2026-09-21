import { useSyncExternalStore } from "react";

/**
 * Bottom-pill notifications (toasts): one-line confirmations when the user
 * takes an action (chat deleted/archived, model/theme/accent changed…).
 * Same subscribe pattern as features.ts / i18n.ts — callable from anywhere
 * (App, settings sections) without prop drilling.
 */

export type ToastIcon =
  | "trash"
  | "archive"
  | "unarchive"
  | "model"
  | "theme"
  | "accent"
  | "unshare"
  | "edit"
  | "check";

export interface Toast {
  id: number;
  text: string;
  icon: ToastIcon;
  /** Same-tag pushes replace the pill instead of stacking (accent, model). */
  tag: string | null;
  /** Bumped on replace so the pill restarts its enter/dismiss timers. */
  nonce: number;
}

/** How long a pill stays fully visible before its exit animation. */
export const TOAST_DISPLAY_MS = 3000;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function pushToast(text: string, opts: { icon?: ToastIcon; tag?: string } = {}): void {
  const icon = opts.icon ?? "check";
  const tag = opts.tag ?? null;
  if (tag) {
    const existing = toasts.find((t) => t.tag === tag);
    if (existing) {
      toasts = toasts.map((t) =>
        t.id === existing.id ? { ...t, text, icon, nonce: t.nonce + 1 } : t,
      );
      emit();
      return;
    }
  }
  // Cap the stack so rapid actions never flood the bottom of the screen.
  toasts = [...toasts.slice(-2), { id: nextId++, text, icon, tag, nonce: 0 }];
  emit();
}

export function removeToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => toasts,
  );
}
