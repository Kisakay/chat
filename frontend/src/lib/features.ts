import { useSyncExternalStore } from "react";

/**
 * Per-browser feature flags (localStorage). Gate optional composer
 * capabilities; kept client-side on purpose — they only change what the
 * UI offers / what prompt decorations are sent, never auth or data access.
 */
export type FeatureKey = "thinking" | "attachments" | "deepSearch";

export const FEATURES: { key: FeatureKey; ready: boolean }[] = [
  { key: "thinking", ready: true },
  { key: "attachments", ready: true },
  { key: "deepSearch", ready: false },
];

const STORAGE_KEY = "ka:features";
const DEFAULTS: Record<FeatureKey, boolean> = {
  thinking: false,
  attachments: true,
  deepSearch: false,
};

function load(): Record<FeatureKey, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<FeatureKey, boolean>>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

let flags = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // private mode etc. — flags just won't survive a reload
  }
  listeners.forEach((l) => l());
}

export function featureEnabled(key: FeatureKey): boolean {
  return flags[key];
}

export function setFeature(key: FeatureKey, value: boolean) {
  flags = { ...flags, [key]: value };
  persist();
}

export function useFeatures(): Record<FeatureKey, boolean> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    () => flags,
  );
}

/** System message prepended to /api/chat when the "thinking" flag is on. */
export const THINKING_SYSTEM_PROMPT =
  "Think step-by-step before answering. Start with a short 'Thoughts' section showing your reasoning, then give the final answer under an 'Answer' heading.";
