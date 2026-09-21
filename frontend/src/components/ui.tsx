import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, Loader2, X, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { useT } from "../lib/i18n.ts";

/* ---------- Button ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "gradient" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-3.5 py-1.5 text-sm",
        size === "md" && "px-5 py-2.5 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        size === "icon" && "h-9 w-9",
        variant === "primary" && "bg-accent-600 text-white shadow-sm hover:bg-accent-500 dark:bg-accent-500 dark:hover:bg-accent-400 dark:text-zinc-950",
        variant === "gradient" && "bg-gradient-to-r from-accent-600 to-teal-500 text-white shadow-lg shadow-accent-600/25 hover:from-accent-500 hover:to-teal-400 dark:from-accent-500 dark:to-teal-400 dark:text-zinc-950",
        variant === "secondary" && "border border-stone-200 bg-white hover:bg-stone-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800",
        variant === "ghost" && "hover:bg-stone-200/60 dark:hover:bg-zinc-800",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({ className, title, ...props }: ButtonProps & { title: string }) {
  return <Button variant="ghost" size="icon" title={title} aria-label={title} className={cn("rounded-full", className)} {...props} />;
}

/* ---------- Inputs ---------- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium opacity-80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs opacity-60">{hint}</span>}
    </label>
  );
}

export function Input({ variant = "default", className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { variant?: "default" | "soft" }) {
  return (
    <input
      className={cn(
        "w-full text-sm outline-none transition placeholder:text-stone-400 dark:placeholder:text-zinc-500",
        variant === "default" &&
          "rounded-2xl border border-stone-200 bg-white px-4 py-2.5 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-zinc-700 dark:bg-zinc-900",
        // soft: onboarding-style pill field, blends into rounded cards
        variant === "soft" &&
          "rounded-full border border-transparent bg-stone-100 px-5 py-3 focus:border-accent-500/60 focus:bg-white focus:ring-4 focus:ring-accent-500/15 dark:bg-zinc-800/80 dark:focus:bg-zinc-900",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Picker (framework-styled dropdown, replaces native <select>) ---------- */

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

export interface PickerGroup {
  group: string;
  options: PickerOption[];
}

export function Picker({
  value,
  onChange,
  options,
  groups,
  placeholder,
  ariaLabel,
  disabled,
  icon: Icon,
  className,
  align = "right",
}: {
  value: string;
  onChange: (v: string) => void;
  options?: PickerOption[];
  groups?: PickerGroup[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  icon?: LucideIcon;
  className?: string;
  align?: "left" | "right";
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 208 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const all: PickerGroup[] = groups ?? [{ group: "", options: options ?? [] }];
  const selected = all.flatMap((g) => g.options).find((o) => o.value === value);
  const shownPlaceholder = placeholder ?? t("common.select");

  // Position the popover in viewport coords (rendered in a portal so no
  // ancestor overflow — e.g. Modal's overflow-y-auto — can clip it).
  // Re-measured live so the popover stays anchored to its field.
  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false; // not laid out yet
    const width = Math.min(Math.max(r.width, 208), 288);
    let left = align === "right" ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    // Use the popover's real height (not the max-h-72 cap) so short lists
    // (e.g. 3 theme options) stay glued under the button instead of flipping
    // above with a visible gap.
    const popH = Math.min(popRef.current?.offsetHeight || 288, 288);
    const below = r.bottom + 8;
    const top = below + popH > window.innerHeight && r.top - popH - 8 > 8
      ? Math.max(8, r.top - popH - 8) // flip above when there is no room below
      : below;
    setPos({ top, left, width });
    return true;
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    // Second pass after paint: catches late layout shifts (fonts, images).
    const raf = requestAnimationFrame(() => updatePos());
    return () => cancelAnimationFrame(raf);
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return; // scrolling inside the list
      updatePos(); // follow the anchor instead of closing
    };
    const onResize = () => updatePos();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, updatePos]);

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex max-w-56 items-center gap-2 rounded-full border border-stone-200 bg-white py-2 pl-3.5 pr-3 text-sm font-medium shadow-sm transition",
          "hover:border-accent-500/60 hover:shadow disabled:cursor-not-allowed disabled:opacity-50",
          "dark:border-zinc-700 dark:bg-zinc-900",
          open && "border-accent-500 ring-2 ring-accent-500/20",
        )}
      >
        {Icon && <Icon size={15} className="shrink-0 text-accent-600 dark:text-accent-400" />}
        <span className="truncate">{selected?.label ?? shownPlaceholder}</span>
        <ChevronDown size={15} className={cn("shrink-0 opacity-50 transition-transform", open && "rotate-180")} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div
            ref={popRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-50 max-h-72 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {all.map((g) => (
              <div key={g.group || "default"}>
                {g.group && (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider opacity-50">{g.group}</p>
                )}
                {g.options.map((o) => {
                  const active = o.value === value;
                  return (
                    <button
                      key={o.value}
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition",
                        active
                          ? "bg-accent-600/10 font-medium text-accent-900 dark:bg-accent-500/10 dark:text-accent-100"
                          : "hover:bg-stone-100 dark:hover:bg-zinc-800",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && <span className="block truncate text-xs opacity-50">{o.hint}</span>}
                      </span>
                      {active && <Check size={15} className="shrink-0 text-accent-600 dark:text-accent-400" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

/* ---------- Modal / Dialog ---------- */

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Bottom-sheet drag state (mobile): pull the handle down to dismiss.
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  useEffect(() => {
    if (!open) {
      setDragY(0);
      dragStart.current = null;
    }
  }, [open ]);
  const { t } = useT();

  if (!open) return null;
  const Icon = icon;
  // Portal to <body>: ancestors with backdrop-blur / transforms (e.g. the
  // login card) become containing blocks for fixed elements and would trap
  // the dialog inside them. Portaling keeps every modal viewport-centered.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-[1.75rem] border border-stone-200 bg-white p-6 pt-3 shadow-2xl sm:max-h-[85vh] sm:rounded-3xl sm:pt-6 dark:border-zinc-700 dark:bg-zinc-900",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        {/* drag handle — mobile only */}
        <div
          className="sticky top-0 z-10 -mx-6 px-6 pb-3 pt-1 sm:hidden"
          onTouchStart={(e) => { dragStart.current = e.touches[0]!.clientY; }}
          onTouchMove={(e) => {
            if (dragStart.current === null) return;
            const dy = e.touches[0]!.clientY - dragStart.current;
            setDragY(dy > 0 ? dy : 0);
          }}
          onTouchEnd={() => {
            if (dragY > 110) onClose(); // snap shut past threshold…
            setDragY(0); // …otherwise snap back
            dragStart.current = null;
          }}
        >
          <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-300 dark:bg-zinc-600" />
        </div>
        <div className="mb-4 flex items-center gap-2.5">
          {Icon && (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
              <Icon size={18} />
            </span>
          )}
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t("common.close")} className="ml-auto rounded-full p-1.5 hover:bg-stone-200/60 dark:hover:bg-zinc-800">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
}) {
  const { t } = useT();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm opacity-80">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="danger" size="sm" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel ?? t("common.delete")}</Button>
      </div>
    </Modal>
  );
}

/* ---------- Context menu ---------- */

export interface MenuItem {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        x: Math.min(x, window.innerWidth - r.width - 8),
        y: Math.min(y, window.innerHeight - r.height - 8),
      });
    }
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [x, y, onClose]);

  // Rendered in a portal: the sidebar's backdrop-blur would otherwise turn
  // into a containing block, breaking the fullscreen overlay and offsetting
  // the menu (text showing through / misplaced over the composer).
  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        className="fixed z-50 w-52 overflow-hidden rounded-2xl border border-stone-200 bg-white p-1.5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <button
            key={it.label}
            onClick={() => { it.onClick(); onClose(); }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition",
              it.danger
                ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                : "hover:bg-stone-100 dark:hover:bg-zinc-800",
            )}
          >
            <it.icon size={16} />
            {it.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Avatar ---------- */

// Uploaded avatars reuse the same /cdn/avatar/<userId> path, so the <img> URL
// never changes and browsers keep serving the stale cached file. A global
// version counter (bumped after each successful upload) cache-busts every
// /cdn/ URL rendered by <Avatar>, refreshing previews app-wide instantly.
let cdnVersion = 0;
const cdnVersionListeners = new Set<() => void>();

/** Call after a successful CDN upload so every <Avatar> re-fetches the file. */
export function bumpCdnVersion(): void {
  cdnVersion++;
  cdnVersionListeners.forEach((l) => l());
}

function useCdnVersion(): number {
  const [v, setV] = useState(cdnVersion);
  useEffect(() => {
    const l = () => setV(cdnVersion);
    cdnVersionListeners.add(l);
    return () => { cdnVersionListeners.delete(l); };
  }, []);
  return v;
}

function withCdnVersion(url: string, v: number): string {
  if (!url.startsWith("/cdn/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${v}`;
}

const GRADIENTS = [
  "from-accent-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-sky-500 to-cyan-600",
  "from-rose-500 to-pink-600",
];

export function Avatar({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  const cdnV = useCdnVersion();
  if (url) {
    return <img src={withCdnVersion(url, cdnV)} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const initial = (name.trim()[0] || "?").toUpperCase();
  const g = GRADIENTS[(name.charCodeAt(0) || 0) % GRADIENTS.length];
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-white", g)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-label={name}
    >
      {initial}
    </span>
  );
}

/* ---------- Brand logo (single declaration — import anywhere) ---------- */

/**
 * The KisAssistant flower mark. Petals follow the runtime accent color,
 * heart stays amber — same artwork as the loading screen and favicon.
 * `dynamic` controls the bloom animation: pass false for a static,
 * full-bloom mark (e.g. thread bars and headers).
 */
export function FlowerMark({ size, className, dynamic = true }: { size?: number; className?: string; dynamic?: boolean }) {
  const petals = [0, 60, 120, 180, 240, 300];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="KisAssistant"
    >
      {petals.map((r, i) => (
        <g key={r} transform={`rotate(${r} 50 50)`}>
          <ellipse
            cx="50"
            cy="25"
            rx="13"
            ry="21"
            className={dynamic ? "flower-petal fill-accent-500" : "fill-accent-500"}
            style={dynamic ? { animationDelay: `${i * 0.22}s` } : undefined}
          />
        </g>
      ))}
      <circle cx="50" cy="50" r="10" className={dynamic ? "flower-core fill-amber-400" : "fill-amber-400"} />
    </svg>
  );
}

/** Assistant identity: static flower mark on a soft circle (message avatars). */
export function AssistantAvatar({ size = 32 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-accent-600/10"
      style={{ width: size, height: size }}
      aria-label="KisAssistant"
    >
      <FlowerMark size={Math.round(size * 0.78)} dynamic={false} />
    </span>
  );
}

/* ---------- Switch (feature toggle) ---------- */

export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />;
}

/* ---------- Misc ---------- */

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

/** Accessible on/off switch (accent colored when on). Flex-based so the knob
 *  is always perfectly centered — no border/padding math to break. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-accent-600 dark:bg-accent-500" : "bg-stone-300 dark:bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 dark:bg-zinc-100",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium transition hover:bg-stone-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      {done ? <Check size={13} className="text-accent-500" /> : <Copy size={13} />}
      {done ? t("common.copied") : (label ?? t("common.copy"))}
    </button>
  );
}

/* ---------- Loading screen ---------- */

/** Animated blooming flower shown while the app boots (themed, mobile-safe). */
export function LoadingScreen() {
  const { t } = useT();
  return (
    <div className="loading-enter grid min-h-full place-items-center" role="status" aria-label="Loading KisAssistant">
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <FlowerMark className="h-16 w-16 sm:h-20 sm:w-20" />
        <p className="font-serif text-2xl font-bold tracking-tight">KisAssistant</p>
        <p className="loading-dots text-sm opacity-60">{t("loading.tagline")}</p>
      </div>
    </div>
  );
}
