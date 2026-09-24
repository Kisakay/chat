/**
 * Runtime accent color (settings → accent color). Predefined palettes plus a
 * custom picker; shades 50–950 are derived from a single base hex via HSL and
 * written to the --ka-accent-* CSS variables that back Tailwind's `accent`
 * palette. Persisted per-browser (localStorage), like the feature flags.
 */

export type AccentShades = Record<"50" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" | "950", string>;

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
const SHADE_KEYS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
// Lightness ramps for 50→950 around a mid 500 (HSL L values in %).
const RAMP: Record<(typeof SHADE_KEYS)[number], number> = {
  "50": 97, "100": 93, "200": 86, "300": 76, "400": 64,
  "500": 52, "600": 45, "700": 38, "800": 30, "900": 24, "950": 15,
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

/** Build the 50–950 ramp from a base hex (HSL ramp, emerald-style). */
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
  paintFavicon(base);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

/** Preview without persisting (used while the picker is open). */
export function previewAccent(baseHex: string): void {
  const shades = shadesFor(baseHex);
  const root = document.documentElement;
  for (const k of SHADE_KEYS) root.style.setProperty(`--ka-accent-${k}`, shades[k]);
  paintFavicon(baseHex);
}

function mixHex(hex: string, target: number, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x10b981;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (v: number) => Math.round(v + (target - v) * amount);
  const to = (v: number) => mix(v).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Favicon follows the accent: a mini flower (petals in the accent ramp,
 * amber core like the logo) swapped in as an SVG data URL, so the tab icon
 * always matches the platform dress.
 */
export function paintFavicon(baseHex: string): void {
  if (typeof document === "undefined") return;
  const base = /^#?[0-9a-f]{6}$/i.test(baseHex.trim()) ? baseHex.trim().replace(/^#?/, "#") : "#10b981";
  const dark = mixHex(base, 0, 0.35);
  const light = mixHex(base, 255, 0.55);
  const petals = [8, 80, 151, 223, 295].map(
    (a) => `<ellipse cx="50" cy="28" rx="13" ry="20" fill="${base}" transform="rotate(${a} 50 50)"/>`,
  ).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" rx="22" fill="${dark}"/>${petals}` +
    `<ellipse cx="50" cy="28" rx="13" ry="20" fill="${light}" opacity="0.45" transform="rotate(8 50 50)"/>` +
    `<circle cx="50" cy="50" r="10" fill="#fbbf24"/></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  for (const rel of ["icon", "apple-touch-icon"]) {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.type = rel === "icon" ? "image/svg+xml" : link.type;
    link.href = url;
  }
}

// Restore the saved accent on load.
if (typeof document !== "undefined") {
  applyAccent(currentAccent());
}
