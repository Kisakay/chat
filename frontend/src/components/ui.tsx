import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Loader2, X, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn.ts";

/* ---------- Button ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
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
        variant === "primary" && "bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-zinc-950",
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

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm outline-none transition",
        "placeholder:text-stone-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500",
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
  placeholder = "Select…",
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
  const [open, setOpen] = useState(false);
  const all: PickerGroup[] = groups ?? [{ group: "", options: options ?? [] }];
  const selected = all.flatMap((g) => g.options).find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open ]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex max-w-56 items-center gap-2 rounded-full border border-stone-200 bg-white py-2 pl-3.5 pr-3 text-sm font-medium shadow-sm transition",
          "hover:border-emerald-500/60 hover:shadow disabled:cursor-not-allowed disabled:opacity-50",
          "dark:border-zinc-700 dark:bg-zinc-900",
          open && "border-emerald-500 ring-2 ring-emerald-500/20",
        )}
      >
        {Icon && <Icon size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />}
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className={cn("shrink-0 opacity-50 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label={ariaLabel}
            className={cn(
              "absolute top-full z-50 mt-2 max-h-72 min-w-52 max-w-72 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900",
              align === "right" ? "right-0" : "left-0",
            )}
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
                          ? "bg-emerald-600/10 font-medium text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100"
                          : "hover:bg-stone-100 dark:hover:bg-zinc-800",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && <span className="block truncate text-xs opacity-50">{o.hint}</span>}
                      </span>
                      {active && <Check size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
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

  if (!open) return null;
  const Icon = icon;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative max-h-[85vh] w-full overflow-y-auto rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="mb-4 flex items-center gap-2.5">
          {Icon && (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
              <Icon size={18} />
            </span>
          )}
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-full p-1.5 hover:bg-stone-200/60 dark:hover:bg-zinc-800">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm opacity-80">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="danger" size="sm" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
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

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        className="absolute w-52 overflow-hidden rounded-2xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
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
    </div>
  );
}

/* ---------- Avatar ---------- */

const GRADIENTS = [
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-sky-500 to-cyan-600",
  "from-rose-500 to-pink-600",
];

export function Avatar({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  if (url) {
    return <img src={url} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
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

/* ---------- Misc ---------- */

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
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
      {done ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}
