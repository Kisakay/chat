import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";

/**
 * Database driver abstraction (SQLite default, Postgres opt-in).
 *
 * - SQLite: Bun's native `bun:sqlite` (synchronous underneath, single file
 *   in DATA_DIR). Zero setup, the historical default.
 * - Postgres: Bun's native `bun:sql` driver (`new SQL(url)`), typically a
 *   docker container pointed at by POSTGRESQL_URL.
 *
 * All queries in the codebase use `?` placeholders (SQLite style); the
 * Postgres client rewrites them to `$1, $2, …` (quote/comment aware).
 * Postgres returns BIGINT cells as JS `bigint` — the client normalizes them
 * to `number` (every integer column fits: ms timestamps, counts, ids).
 */

export type DbKind = "sqlite" | "postgres";
export type SqlParam = string | number | bigint | null;
export type SqlParams = SqlParam[];

export interface DbRunResult {
  changes: number;
  lastInsertId: number | null;
}

export interface DbTx {
  get<T>(sql: string, ...params: SqlParams): Promise<T | null>;
  all<T>(sql: string, ...params: SqlParams): Promise<T[]>;
  run(sql: string, ...params: SqlParams): Promise<DbRunResult>;
  exec(sql: string): Promise<void>;
}

export interface DbClient extends DbTx {
  readonly kind: DbKind;
  /** INSERT a single row and get its auto id back (RETURNING on pg). */
  insertReturningId(sql: string, ...params: SqlParams): Promise<number>;
  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Rewrite `?` placeholders to `$n` for Postgres (skips quoted literals). */
export function sqliteToPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const c = sql[i]!;
    // Single-quoted string literal ('' = escaped quote).
    if (c === "'") {
      out += c;
      i++;
      while (i < len) {
        out += sql[i]!;
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { out += sql[i + 1]!; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Double-quoted identifier ("..." with "" escape).
    if (c === '"') {
      out += c;
      i++;
      while (i < len) {
        out += sql[i]!;
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { out += sql[i + 1]!; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Line comment.
    if (c === "-" && sql[i + 1] === "-") {
      while (i < len && sql[i] !== "\n") out += sql[i++]!;
      continue;
    }
    // Block comment.
    if (c === "/" && sql[i + 1] === "*") {
      out += "/*";
      i += 2;
      while (i < len && !(sql[i] === "*" && sql[i + 1] === "/")) out += sql[i++]!;
      out += "*/";
      i += 2;
      continue;
    }
    if (c === "?") {
      n++;
      out += `$${n}`;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Recursively normalize driver row values (bigint -> number). */
export function normalizeValue<T>(v: T): T {
  if (typeof v === "bigint") return Number(v) as T;
  if (Array.isArray(v)) return v.map(normalizeValue) as T;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = normalizeValue(o[k]);
    return v;
  }
  return v;
}

/** Redacted one-liner for logs (never print credentials). */
export function redactedUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

// --- SQLite implementation (bun:sqlite, sync underneath) ---

class SqliteTx implements DbTx {
  constructor(private d: Database) {}
  async get<T>(sql: string, ...params: SqlParams): Promise<T | null> {
    return (this.d.query(sql).get(...params) as T | null) ?? null;
  }
  async all<T>(sql: string, ...params: SqlParams): Promise<T[]> {
    return this.d.query(sql).all(...params) as T[];
  }
  async run(sql: string, ...params: SqlParams): Promise<DbRunResult> {
    const r = this.d.query(sql).run(...params) as { changes: number; lastInsertRowid: number | bigint };
    return { changes: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  }
  async exec(sql: string): Promise<void> {
    this.d.exec(sql);
  }
}

class SqliteClient extends SqliteTx implements DbClient {
  readonly kind: DbKind = "sqlite";
  constructor(private db: Database) {
    super(db);
  }
  async insertReturningId(sql: string, ...params: SqlParams): Promise<number> {
    const r = await this.run(sql, ...params);
    return r.lastInsertId ?? 0;
  }
  async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    // Manual BEGIN/COMMIT (bun:sqlite's transaction() only takes sync
    // callbacks, so it can't wrap our async bodies — this is equivalent).
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = await fn(this);
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // already rolled back / never began — report the original error
      }
      throw e;
    }
  }
  async close(): Promise<void> {
    this.db.close();
  }
}

// --- Postgres implementation (Bun native bun:sql) ---

type PgRunner = {
  unsafe: (sql: string, params?: SqlParams) => Promise<unknown>;
};

class PgTx implements DbTx {
  constructor(private runner: PgRunner) {}
  async get<T>(sql: string, ...params: SqlParams): Promise<T | null> {
    const rows = (await this.runner.unsafe(sqliteToPgPlaceholders(sql), params)) as T[];
    return rows.length > 0 ? normalizeValue(rows[0]!) : null;
  }
  async all<T>(sql: string, ...params: SqlParams): Promise<T[]> {
    const rows = (await this.runner.unsafe(sqliteToPgPlaceholders(sql), params)) as T[];
    return normalizeValue(rows);
  }
  async run(sql: string, ...params: SqlParams): Promise<DbRunResult> {
    const res = (await this.runner.unsafe(sqliteToPgPlaceholders(sql), params)) as { count?: unknown } | null;
    const changes = typeof res?.count === "number" ? res.count : 0;
    return { changes, lastInsertId: null };
  }
  async exec(sql: string): Promise<void> {
    await this.runner.unsafe(sql);
  }
}

class PgClient extends PgTx implements DbClient {
  readonly kind: DbKind = "postgres";
  constructor(private sql: SQL) {
    super(sql as unknown as PgRunner);
  }
  async insertReturningId(sql: string, ...params: SqlParams): Promise<number> {
    const row = await this.get<{ id: number | bigint }>(`${sql} RETURNING id`, ...params);
    return row ? Number(row.id) : 0;
  }
  async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => fn(new PgTx(tx as unknown as PgRunner)));
  }
  async close(): Promise<void> {
    await this.sql.close();
  }
}

// --- singleton ---

let client: DbClient | null = null;

export function db(): DbClient {
  if (!client) throw new Error("database not initialized — call initDb() first");
  return client;
}

export function dbKind(): DbKind {
  return client?.kind ?? (config.postgresqlUrl ? "postgres" : "sqlite");
}

/** Connect + create schema idempotently. Fails fast when unreachable. */
export async function initDb(): Promise<DbClient> {
  if (client) return client;
  const url = config.postgresqlUrl.trim();
  if (url) {
    if (!/^postgres(ql)?:\/\//i.test(url)) {
      throw new Error(`POSTGRESQL_URL must start with postgres:// or postgresql:// (got ${redactedUrl(url)})`);
    }
    const sql = new SQL(url);
    try {
      await sql`SELECT 1 AS ok`;
    } catch (e) {
      await sql.close().catch(() => {});
      throw new Error(`cannot reach Postgres at ${redactedUrl(url)}: ${(e as Error).message}`);
    }
    client = new PgClient(sql);
    await initPgSchema(client);
    console.log(`[db] using postgres (${redactedUrl(url)})`);
    return client;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const dbo = new Database(join(config.dataDir, "kisassistant.db"), { create: true });
  dbo.exec("PRAGMA journal_mode = WAL;");
  dbo.exec("PRAGMA foreign_keys = ON;");
  client = new SqliteClient(dbo);
  await initSqliteSchema(client);
  console.log(`[db] using sqlite (${join(config.dataDir, "kisassistant.db")})`);
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

// --- core schema (users/sessions/conversations/messages/shares/resets/settings/providers) ---

const CORE_TABLES_SQLITE = `
  CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'auto',
    key_hash TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New chat',
    topic TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS messages(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id);
  CREATE TABLE IF NOT EXISTS shares(
    conv_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    public_id TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resets(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_provider_keys(
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    api_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, provider)
  );
`;

const CORE_TABLES_PG = `
  CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'auto',
    key_hash TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New chat',
    topic TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS messages(
    id BIGSERIAL PRIMARY KEY,
    conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id);
  CREATE TABLE IF NOT EXISTS shares(
    conv_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    public_id TEXT UNIQUE NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resets(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_provider_keys(
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    api_key TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, provider)
  );
`;

/** Columns added after the initial schema — idempotent on both drivers. */
const LATER_COLUMNS = [
  "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN report_shadowbanned INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE conversations ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE messages ADD COLUMN model TEXT NOT NULL DEFAULT ''",
];

/** Split a multi-statement DDL string into single statements. */
function splitStatements(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureAdminRow(c: DbClient): Promise<void> {
  const admin = await c.get<{ id: string }>("SELECT id FROM users WHERE username = 'admin'");
  if (!admin) {
    const { randomUUID } = await import("node:crypto");
    await c.run(
      "INSERT INTO users (id, username, display_name, avatar_url, theme, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      randomUUID(), "admin", "Administrator", "", "auto", "", Date.now(),
    );
  }
}

async function initSqliteSchema(c: DbClient): Promise<void> {
  await c.exec(CORE_TABLES_SQLITE);
  // Column guards via PRAGMA (kept from the single-driver era).
  const cols = await c.all<{ name: string }>("PRAGMA table_info(users)");
  const names = new Set(cols.map((col) => col.name));
  if (!names.has("email")) await c.exec("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  if (!names.has("totp_secret")) await c.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT ''");
  if (!names.has("report_shadowbanned")) await c.exec("ALTER TABLE users ADD COLUMN report_shadowbanned INTEGER NOT NULL DEFAULT 0");
  const convCols = await c.all<{ name: string }>("PRAGMA table_info(conversations)");
  if (!convCols.some((col) => col.name === "archived_at")) {
    await c.exec("ALTER TABLE conversations ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0");
  }
  const msgCols = await c.all<{ name: string }>("PRAGMA table_info(messages)");
  if (!msgCols.some((col) => col.name === "model")) {
    await c.exec("ALTER TABLE messages ADD COLUMN model TEXT NOT NULL DEFAULT ''");
  }
  await ensureAdminRow(c);
}

async function initPgSchema(c: DbClient): Promise<void> {
  for (const stmt of splitStatements(CORE_TABLES_PG)) await c.exec(stmt);
  // ADD COLUMN IF NOT EXISTS is natively idempotent on Postgres.
  for (const ddl of LATER_COLUMNS) {
    const m = ddl.match(/^ALTER TABLE (\S+) ADD COLUMN (\S+) (.+)$/);
    if (!m) continue;
    await c.exec(`ALTER TABLE ${m[1]} ADD COLUMN IF NOT EXISTS ${m[2]} ${m[3]}`);
  }
  await ensureAdminRow(c);
}
