import { randomBytes } from "node:crypto";
import { db, dbKind, getSetting } from "./db.ts";
import { config } from "./config.ts";

/**
 * Multi-node Ollama pool + generation telemetry.
 *
 * - `ollama_nodes`: admin-managed extra Ollama hosts. The env-configured
 *   host (`OLLAMA_HOST`) always exists as the implicit "default" node; its
 *   traffic share is `ollama_default_weight` (0 = never use it).
 * - Routing is firewall-like: nodes are ordered by weight (highest first)
 *   and each generation picks a node by weighted random among the enabled
 *   ones, failing over to the next heaviest node on error/timeout.
 * - `ollama_stats`: one row per generation attempt (node, ok, latency,
 *   token counts from Ollama's final chunk) powering the per-node detail
 *   charts. Rows older than 35 days are pruned on write.
 *
 * NOTE on host metrics: Ollama exposes no CPU/RAM API — only per-model
 * VRAM via /api/ps (surfaced in the node detail view). Load-over-time
 * charts come from app-side telemetry (requests, errors, latency,
 * tokens/s), which is also what drives routing decisions.
 */

export interface OllamaNode {
  id: string;
  name: string;
  host: string;
  weight: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface EffectiveNode {
  /** "default" for the env host, otherwise the row id. */
  id: string;
  name: string;
  host: string;
  weight: number;
}

export const DEFAULT_NODE_ID = "default";
const STATS_RETENTION_MS = 35 * 86400_000;

export async function initOllamaNodes(): Promise<void> {
  const autoId = dbKind() === "postgres" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  await db().exec(`CREATE TABLE IF NOT EXISTS ollama_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL UNIQUE,
    weight INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  await db().exec(`CREATE TABLE IF NOT EXISTS ollama_stats (
    id ${autoId},
    node_id TEXT NOT NULL,
    ts BIGINT NOT NULL,
    ok INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    eval_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT ''
  )`);
  await db().exec(`CREATE INDEX IF NOT EXISTS idx_ollama_stats_node_ts ON ollama_stats(node_id, ts)`);
}

function rowToNode(r: Record<string, number | string>): OllamaNode {
  return {
    id: String(r.id),
    name: String(r.name),
    host: String(r.host),
    weight: Number(r.weight),
    enabled: Number(r.enabled) === 1,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

export async function listOllamaNodes(): Promise<OllamaNode[]> {
  const rows = await db().all<Record<string, number | string>>(
    "SELECT * FROM ollama_nodes ORDER BY weight DESC, created_at ASC",
  );
  return rows.map(rowToNode);
}

export async function getOllamaNode(id: string): Promise<OllamaNode | null> {
  const row = await db().get<Record<string, number | string>>("SELECT * FROM ollama_nodes WHERE id = ?", id);
  return row ? rowToNode(row) : null;
}

function newNodeId(): string {
  return "node_" + randomBytes(9).toString("base64url");
}

/** Normalize + validate an Ollama base URL (scheme + host, no path). */
export function sanitizeNodeHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\/+$/, "");
  if (t.length < 10 || t.length > 200) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || u.username || u.password) return null;
  // Drop default ports and any path/query/fragment for canonical form.
  const port = u.port && !((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443"))
    ? `:${u.port}`
    : "";
  if (u.pathname !== "/" && u.pathname !== "") return null;
  return `${u.protocol}//${u.hostname}${port}`;
}

export function sanitizeNodeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0 || t.length > 60) return null;
  return t;
}

export function sanitizeWeight(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 1000) return null;
  return raw;
}

export async function createOllamaNode(opts: { name: string; host: string; weight: number; enabled: boolean }): Promise<OllamaNode> {
  const now = Date.now();
  const row: OllamaNode = { id: newNodeId(), ...opts, created_at: now, updated_at: now };
  try {
    await db().run(
      "INSERT INTO ollama_nodes (id, name, host, weight, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      row.id, row.name, row.host, row.weight, row.enabled ? 1 : 0, now, now,
    );
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message)) throw new Error("HOST_TAKEN");
    throw e;
  }
  return row;
}

export async function updateOllamaNode(
  id: string,
  patch: { name?: string; host?: string; weight?: number; enabled?: boolean },
): Promise<OllamaNode | null> {
  const cur = await getOllamaNode(id);
  if (!cur) return null;
  const next: OllamaNode = {
    ...cur,
    name: patch.name ?? cur.name,
    host: patch.host ?? cur.host,
    weight: patch.weight ?? cur.weight,
    enabled: patch.enabled ?? cur.enabled,
    updated_at: Date.now(),
  };
  try {
    await db().run(
      "UPDATE ollama_nodes SET name = ?, host = ?, weight = ?, enabled = ?, updated_at = ? WHERE id = ?",
      next.name, next.host, next.weight, next.enabled ? 1 : 0, next.updated_at, id,
    );
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message)) throw new Error("HOST_TAKEN");
    throw e;
  }
  return next;
}

export async function deleteOllamaNode(id: string): Promise<boolean> {
  const r = await db().run("DELETE FROM ollama_nodes WHERE id = ?", id);
  return r.changes > 0;
}

// --- effective pool (env default + custom rows) ---

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const v = Number.parseInt(raw, 10);
  if (!Number.isInteger(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Generation timeout for Ollama chat requests (admin setting, seconds). */
export async function getOllamaTimeoutMs(): Promise<number> {
  return clampInt(await getSetting("ollama_timeout_s", "300"), 5, 3600, 300) * 1000;
}

/** Traffic weight of the implicit env node (0 = never use it). */
export async function getOllamaDefaultWeight(): Promise<number> {
  return clampInt(await getSetting("ollama_default_weight", "100"), 0, 1000, 100);
}

/** All routable nodes, heaviest first (default env node included). */
export async function effectiveOllamaNodes(): Promise<EffectiveNode[]> {
  const out: EffectiveNode[] = [];
  if (config.ollamaEnabled) {
    const w = await getOllamaDefaultWeight();
    if (w > 0) {
      out.push({ id: DEFAULT_NODE_ID, name: "default", host: config.ollamaHost.replace(/\/$/, ""), weight: w });
    }
  }
  for (const n of await listOllamaNodes()) {
    if (n.enabled && n.weight > 0) out.push({ id: n.id, name: n.name, host: n.host, weight: n.weight });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

/**
 * Pick the node for one generation (weighted random) + the failover order
 * (picked node first, then heaviest-first). Throws when nothing is routable.
 */
export async function pickOllamaRoute(): Promise<{ first: EffectiveNode; order: EffectiveNode[] }> {
  const nodes = await effectiveOllamaNodes();
  if (nodes.length === 0) throw new Error('no ollama node available (all disabled or weight 0)');
  const total = nodes.reduce((s, n) => s + n.weight, 0);
  let r = Math.random() * total;
  let first = nodes[0]!;
  for (const n of nodes) {
    r -= n.weight;
    if (r <= 0) {
      first = n;
      break;
    }
  }
  const order = [first, ...nodes.filter((n) => n.id !== first.id)];
  return { first, order };
}

/** Resolve an admin-selected node id (pull/delete/status) to its host. */
export async function resolveOllamaHost(nodeId: string | undefined): Promise<EffectiveNode> {
  if (!nodeId || nodeId === DEFAULT_NODE_ID) {
    return { id: DEFAULT_NODE_ID, name: "default", host: config.ollamaHost.replace(/\/$/, ""), weight: 0 };
  }
  const n = await getOllamaNode(nodeId);
  if (!n) throw new Error("unknown ollama node");
  return { id: n.id, name: n.name, host: n.host, weight: n.weight };
}

// --- telemetry ---

export async function recordOllamaStat(s: {
  node_id: string;
  ok: boolean;
  latency_ms: number;
  prompt_tokens: number;
  eval_tokens: number;
  model: string;
}): Promise<void> {
  const d = db();
  await d.run(
    "INSERT INTO ollama_stats (node_id, ts, ok, latency_ms, prompt_tokens, eval_tokens, model) VALUES (?, ?, ?, ?, ?, ?, ?)",
    s.node_id, Date.now(), s.ok ? 1 : 0, Math.max(0, Math.round(s.latency_ms)),
    Math.max(0, Math.round(s.prompt_tokens)), Math.max(0, Math.round(s.eval_tokens)), s.model.slice(0, 160),
  );
  // Best-effort retention (indexed range delete, cheap).
  try {
    await d.run("DELETE FROM ollama_stats WHERE ts < ?", Date.now() - STATS_RETENTION_MS);
  } catch {
    // stats must never break generations
  }
}

export type StatsWindow = "1h" | "6h" | "24h" | "7d" | "30d";

export function statsWindowMs(w: StatsWindow): number {
  return { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 86400_000, "7d": 7 * 86400_000, "30d": 30 * 86400_000 }[w];
}

export interface StatsBucket {
  t: number;
  req: number;
  err: number;
  avgMs: number | null;
  promptTok: number;
  evalTok: number;
}

export interface NodeStats {
  window: StatsWindow;
  from: number;
  to: number;
  totals: { req: number; err: number; avgMs: number | null; promptTok: number; evalTok: number; tokPerSec: number | null };
  buckets: StatsBucket[];
}

const BUCKETS = 24;

export async function nodeStats(nodeId: string, window: StatsWindow): Promise<NodeStats> {
  const to = Date.now();
  const span = statsWindowMs(window);
  const from = to - span;
  const bucketMs = Math.floor(span / BUCKETS);
  // GROUP BY output alias works on both SQLite and Postgres; AVG may come
  // back as text (pg numeric) so every aggregate is coerced in JS.
  const rows = await db().all<Record<string, number | string | null>>(
    `SELECT CAST((ts - ?) / ? AS INTEGER) AS b, COUNT(*) AS req,
       COUNT(*) - COALESCE(SUM(ok), 0) AS err,
       AVG(CASE WHEN ok = 1 THEN latency_ms END) AS avgms,
       COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(eval_tokens), 0) AS et
     FROM ollama_stats WHERE node_id = ? AND ts >= ? GROUP BY b ORDER BY b ASC`,
    from, bucketMs, nodeId, from,
  );
  const buckets: StatsBucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
    t: from + i * bucketMs,
    req: 0,
    err: 0,
    avgMs: null,
    promptTok: 0,
    evalTok: 0,
  }));
  for (const r of rows) {
    const b = Number(r.b);
    if (!Number.isInteger(b) || b < 0 || b >= BUCKETS) continue;
    const slot = buckets[b]!;
    slot.req = Number(r.req);
    slot.err = Number(r.err);
    slot.avgMs = r.avgms === null ? null : Number(r.avgms);
    slot.promptTok = Number(r.pt);
    slot.evalTok = Number(r.et);
  }
  const totals = buckets.reduce(
    (a, b) => ({ req: a.req + b.req, err: a.err + b.err, promptTok: a.promptTok + b.promptTok, evalTok: a.evalTok + b.evalTok }),
    { req: 0, err: 0, promptTok: 0, evalTok: 0 },
  );
  const latRows = buckets.filter((b) => b.avgMs !== null && b.req - b.err > 0);
  const latWeight = latRows.reduce((s, b) => s + (b.req - b.err), 0);
  const avgMs = latWeight > 0
    ? latRows.reduce((s, b) => s + b.avgMs! * (b.req - b.err), 0) / latWeight
    : null;
  // Tokens/s over the window's active span (first to last non-empty bucket).
  const active = buckets.filter((b) => b.req > 0);
  const activeMs = active.length > 1 ? active[active.length - 1]!.t - active[0]!.t + bucketMs : active.length === 1 ? bucketMs : 0;
  const tokPerSec = activeMs > 0 ? (totals.promptTok + totals.evalTok) / (activeMs / 1000) : null;
  return { window, from, to, totals: { ...totals, avgMs, tokPerSec }, buckets };
}
