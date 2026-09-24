/**
 * Browser-local UI persistence (no server round-trip, per browser profile).
 *
 * - Selected model per account (`ka_model:<username>`): restored on boot when
 *   still offered, otherwise the first available model wins.
 * - Failed model attempts (`ka_failed_v1`): the error bubble + retry state
 *   survive a refresh. The fake error text is NEVER stored server-side, so
 *   model history stays clean — the bubble is re-created locally on load and
 *   filtered out of every outgoing payload.
 */

export interface FailedEntry {
  /** Position of the error bubble in the message list (trailing). */
  index: number;
  retryCount: number;
  at: number;
}

const FAILED_KEY = "ka_failed_v1";
const FAILED_MAX_AGE_MS = 30 * 24 * 3600_000;

function readFailedMap(): Record<string, FailedEntry> {
  try {
    const raw = localStorage.getItem(FAILED_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, FailedEntry> = {};
    const now = Date.now();
    for (const [k, v] of Object.entries(obj ?? {})) {
      const e = v as FailedEntry;
      if (
        v !== null &&
        typeof v === "object" &&
        Number.isInteger(e.index) &&
        e.index >= 0 &&
        typeof e.retryCount === "number" &&
        typeof e.at === "number" &&
        now - e.at < FAILED_MAX_AGE_MS
      ) {
        out[k] = { index: e.index, retryCount: e.retryCount, at: e.at };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeFailedMap(map: Record<string, FailedEntry>): void {
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify(map));
  } catch {
    // Private mode / quota — retry simply won't survive a refresh.
  }
}

export function getFailedEntry(convId: string): FailedEntry | null {
  return readFailedMap()[convId] ?? null;
}

export function setFailedEntry(convId: string, entry: FailedEntry): void {
  const map = readFailedMap();
  map[convId] = entry;
  writeFailedMap(map);
}

export function clearFailedEntry(convId: string): void {
  const map = readFailedMap();
  if (map[convId] !== undefined) {
    delete map[convId];
    writeFailedMap(map);
  }
}

function modelKey(username: string): string {
  return `ka_model:${username.trim().toLowerCase()}`;
}

export function getSavedModel(username: string): string | null {
  try {
    return localStorage.getItem(modelKey(username));
  } catch {
    return null;
  }
}

export function setSavedModel(username: string, id: string): void {
  try {
    localStorage.setItem(modelKey(username), id);
  } catch {
    // ignore — falls back to first model next boot
  }
}

/** Saved pick when still offered, otherwise the first available model. */
export function pickModel(available: { id: string }[], saved: string | null): string {
  if (saved && available.some((m) => m.id === saved)) return saved;
  return available[0]?.id ?? "";
}
