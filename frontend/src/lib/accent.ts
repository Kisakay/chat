/**
 * Runtime accent color (settings → accent color). Predefined palettes plus a
 * custom picker; shades 50–900 are derived from a single base hex via HSL and
 * written to the --ka-accent-* CSS variables that back Tailwind's `accent`
 * palette. Persisted per-browser (localStorage), like the feature flags.
 */

export type AccentShades = Record<"50" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900", string>;

export interface AccentPreset {
  id: string;
  label: string;
  base: string; // hex, used as the 500 shade and to derive the ramp
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "emerald", label: "Emerald", base: "#10b981" },
  { id: "rose", label: "Rose", base: "#f43f5e" },
  { id: "blue", label: "Blue", base: "#3b82f6" },
  { id: "violet", label: "Violet", base: "#8b5cf6" },
  { id: "amber", label: "Yellow", base: "#f59e0b" },
  { id: "orange", label: "Orange", base: "#f97316" },
  { id: "teal", label: "Teal", base: "#14b8a6" },
  { id: "pink", label: "Pink", base: "#ec4899" },
];

const STORAGE_KEY = "ka:accent";
const SHADE_KEYS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;
// Lightness ramps for 50→900 around a mid 500 (HSL L values in %).
const RAMP: Record<(typeof SHADE_KEYS)[number], number> = {
  "50": 97, "100": 93, "200": 86, "300": 76, "400": 64,
  "500": 52, "600": 45, "700": 38, "800": 30, "900": 24,
};

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 160, s: 84, l: 52 }; // emerald fallback
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgbTriplet(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255);
  return `${to(r)} ${to(g)} ${to(b)}`;
}

/** Build the 50–900 ramp from a base hex (HSL ramp, emerald-style). */
export function shadesFor(baseHex: string): AccentShades {
  const { h, s } = hexToHsl(baseHex);
  const out = {} as AccentShades;
  for (const k of SHADE_KEYS) {
    // Keep saturation lively at the light end, richer at the dark end.
    const sat = k === "50" || k === "100" ? s * 0.9 : s;
    out[k] = hslToRgbTriplet(h, sat, RAMP[k]);
  }
  return out;
}

export interface AccentState {
  /** preset id, or "custom" */
  presetId: string;
  /** hex for custom (ignored for presets — they derive from their base) */
  customHex: string;
}

export function currentAccent(): AccentState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as AccentState | null;
    if (raw && typeof raw.presetId === "string") return raw;
  } catch { /* ignore */ }
  return { presetId: "emerald", customHex: "#10b981" };
}

export function applyAccent(state: AccentState): void {
  const preset = ACCENT_PRESETS.find((p) => p.id === state.presetId);
  const base = preset ? preset.base : (/^#?[0-9a-f]{6}$/i.test(state.customHex) ? state.customHex : "#10b981");
  const shades = shadesFor(base);
  const root = document.documentElement;
  for (const k of SHADE_KEYS) root.style.setProperty(`--ka-accent-${k}`, shades[k]);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

/** Preview without persisting (used while the picker is open). */
export function previewAccent(baseHex: string): void {
  const shades = shadesFor(baseHex);
  const root = document.documentElement;
  for (const k of SHADE_KEYS) root.style.setProperty(`--ka-accent-${k}`, shades[k]);
}

// Restore the saved accent on load.
if (typeof document !== "undefined") {
  applyAccent(currentAccent());
}
