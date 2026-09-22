import { db, getSetting, setSetting } from "./db.ts";

/**
 * Per-model access policy (admin kill-switch + per-user rate limits).
 * Stored as one JSON blob in the `settings` table (`model_policy` key);
 * usage counters live in `model_usage` (hourly + daily fixed windows).
 *
 * Policy is global, not per-user; admins always bypass checks.
 * Limits of 0 mean "unlimited". Models without an entry use the default
 * (enabled, no limits); entries equal to the default are pruned.
 */

export interface ModelPolicyEntry {
  enabled: boolean;
  /** Max requests per UTC hour (0 = unlimited). */
  hourly: number;
  /** Max requests per UTC day (0 = unlimited). */
  daily: number;
}

export const DEFAULT_POLICY: ModelPolicyEntry = { enabled: true, hourly: 0, daily: 0 };
export type ModelPolicy = Record<string, ModelPolicyEntry>;

const SETTINGS_KEY = "model_policy";
export const MAX_LIMIT = 1_000_000;

function numOrZero(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_LIMIT ? v : 0;
}

function sanitizeEntry(v: unknown): ModelPolicyEntry {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : true,
    hourly: numOrZero(o.hourly),
    daily: numOrZero(o.daily),
  };
}

function isDefault(e: ModelPolicyEntry): boolean {
  return e.enabled && e.hourly === 0 && e.daily === 0;
}

export async function getModelPolicy(): Promise<ModelPolicy> {
  const raw = await getSetting(SETTINGS_KEY, "");
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return {};
    const out: ModelPolicy = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k && k.length <= 200) out[k] = sanitizeEntry(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function policyFor(policy: ModelPolicy, modelId: string): ModelPolicyEntry {
  return policy[modelId] ?? { ...DEFAULT_POLICY };
}

export async function setModelPolicyEntry(
  modelId: string,
  patch: { enabled?: boolean; hourly?: number; daily?: number },
): Promise<ModelPolicyEntry> {
  if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") throw new Error("BAD_POLICY");
  if (patch.hourly !== undefined && !Number.isInteger(patch.hourly)) throw new Error("BAD_POLICY");
  if (patch.daily !== undefined && !Number.isInteger(patch.daily)) throw new Error("BAD_POLICY");
  const policy = await getModelPolicy();
  const cur = policy[modelId] ?? { ...DEFAULT_POLICY };
  const next: ModelPolicyEntry = {
    enabled: patch.enabled ?? cur.enabled,
    hourly: patch.hourly ?? cur.hourly,
    daily: patch.daily ?? cur.daily,
  };
  if (next.hourly < 0 || next.hourly > MAX_LIMIT || next.daily < 0 || next.daily > MAX_LIMIT) {
    throw new Error("BAD_POLICY");
  }
  if (isDefault(next)) delete policy[modelId];
  else policy[modelId] = next;
  await setSetting(SETTINGS_KEY, JSON.stringify(policy));
  return { ...DEFAULT_POLICY, ...policy[modelId] };
}

export async function initModelUsageTables(): Promise<void> {
  // "window" is quoted: WINDOW is a reserved keyword on Postgres (and the
  // quotes are harmless on SQLite).
  await db().exec(`CREATE TABLE IF NOT EXISTS model_usage (
    user_id TEXT NOT NULL,
    model TEXT NOT NULL,
    "window" TEXT NOT NULL,
    bucket BIGINT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, model, "window", bucket)
  )`);
}

function buckets(now = Date.now()): { h: number; d: number } {
  return { h: Math.floor(now / 3600_000), d: Math.floor(now / 86400_000) };
}

async function windowCount(userId: string, modelId: string, window: "h" | "d", bucket: number): Promise<number> {
  const row = await db().get<{ n: number }>(
    'SELECT count AS n FROM model_usage WHERE user_id = ? AND model = ? AND "window" = ? AND bucket = ?',
    userId, modelId, window, bucket,
  );
  return row?.n ?? 0;
}

export type ModelAccess = { ok: true } | { ok: false; code: 403 | 429; message: string };

export async function checkModelAccess(userId: string, modelId: string): Promise<ModelAccess> {
  const p = policyFor(await getModelPolicy(), modelId);
  if (!p.enabled) return { ok: false, code: 403, message: "model disabled by administrator" };
  const { h, d } = buckets();
  if (p.hourly > 0 && (await windowCount(userId, modelId, "h", h)) >= p.hourly) {
    return { ok: false, code: 429, message: "hourly limit reached for this model, try again later" };
  }
  if (p.daily > 0 && (await windowCount(userId, modelId, "d", d)) >= p.daily) {
    return { ok: false, code: 429, message: "daily limit reached for this model, try again tomorrow" };
  }
  return { ok: true };
}

export async function recordModelUse(userId: string, modelId: string): Promise<void> {
  const d = db();
  const { h, d: day } = buckets();
  await d.run(`INSERT INTO model_usage (user_id, model, "window", bucket, count) VALUES (?, ?, 'h', ?, 1)
    ON CONFLICT(user_id, model, "window", bucket) DO UPDATE SET count = count + 1`, userId, modelId, h);
  await d.run(`INSERT INTO model_usage (user_id, model, "window", bucket, count) VALUES (?, ?, 'd', ?, 1)
    ON CONFLICT(user_id, model, "window", bucket) DO UPDATE SET count = count + 1`, userId, modelId, day);
  await d.run('DELETE FROM model_usage WHERE ("window" = \'h\' AND bucket < ?) OR ("window" = \'d\' AND bucket < ?)', h - 1, day - 1);
}
