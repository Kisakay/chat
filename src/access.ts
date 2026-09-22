import { randomUUID } from "node:crypto";
import { db } from "./db.ts";

/**
 * Access-request wishlist (registration approval queue) + minimal ticket
 * system. Tables are created idempotently here so db.ts stays untouched.
 *
 * Flow: visitor reserves username+email with a motivation message ->
 * ticket page at /review/<request-id> (UUID, unguessable — same pattern as
 * public share links) -> admin triages in the AdminCenter (reviewing /
 * accepted / refused, each with a reason) -> both sides exchange messages;
 * every admin event emails the requester (notification-only).
 */

export type AccessStatus = "pending" | "reviewing" | "accepted" | "refused";

export interface AccessRequest {
  id: string;
  username: string;
  email: string;
  message: string;
  status: AccessStatus;
  reason: string;
  created_at: number;
  updated_at: number;
}

export interface AccessMessage {
  id: number;
  request_id: string;
  author: "user" | "admin";
  body: string;
  created_at: number;
}

export async function initAccessTables(): Promise<void> {
  const d = db();
  const autoId = d.kind === "postgres" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  await d.exec(`CREATE TABLE IF NOT EXISTS access_requests (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  if (d.kind === "sqlite") {
    await repairSqliteAccessTables();
  }
  await d.exec(`CREATE TABLE IF NOT EXISTS access_messages (
    id ${autoId},
    request_id TEXT NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
  await d.exec(`CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status, updated_at DESC)`);
  await d.exec(`CREATE INDEX IF NOT EXISTS idx_access_messages_req ON access_messages(request_id, id)`);
}

/**
 * SQLite-only repairs for DBs shaped by older builds (PRAGMA / sqlite_master
 * introspection + DROP COLUMN don't exist on Postgres; fresh Postgres tables
 * are created clean above).
 */
async function repairSqliteAccessTables(): Promise<void> {
  const d = db();
  const createRequests = `CREATE TABLE access_requests (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`;
  const createMessages = `CREATE TABLE access_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`;
  // Idempotent migration (must run BEFORE access_messages exists with an FK
  // on access_requests — SQLite rewrites dependent FKs on DROP COLUMN and
  // would otherwise poison access_messages with a dangling reference).
  // Older builds created access_requests with a NOT NULL UNIQUE token_hash
  // column (since removed — tickets are authed by their unguessable UUID).
  // CREATE TABLE IF NOT EXISTS won't fix existing DBs, and inserts without
  // token_hash then fail with SQLITE_CONSTRAINT_NOTNULL.
  try {
    const cols = await d.all<{ name: string }>("PRAGMA table_info(access_requests)");
    if (cols.some((c) => c.name === "token_hash")) {
      try {
        await d.exec("PRAGMA foreign_keys=OFF");
        try {
          await d.exec("ALTER TABLE access_requests DROP COLUMN token_hash");
        } catch {
          // SQLite builds without DROP COLUMN support: rebuild table.
          await d.exec("ALTER TABLE access_requests RENAME TO access_requests_old");
          await d.exec(createRequests);
          await d.exec(`INSERT INTO access_requests (id, username, email, message, status, reason, created_at, updated_at)
            SELECT id, username, email, message, status, reason, created_at, updated_at FROM access_requests_old`);
          await d.exec("DROP TABLE access_requests_old");
        }
      } finally {
        await d.exec("PRAGMA foreign_keys=ON");
      }
    }
  } catch {
    // Leave schema as-is; the insert error will surface normally.
  }
  // Repair: a previous boot migrated in the wrong order (messages table
  // created before the DROP COLUMN), leaving access_messages with
  // REFERENCES "access_requests_old". Rebuild it with the correct FK.
  try {
    const row = await d.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'access_messages'");
    if (row?.sql?.includes("access_requests_old")) {
      await d.exec("PRAGMA foreign_keys=OFF");
      try {
        await d.exec("DROP TABLE IF EXISTS access_messages_old");
        await d.exec("ALTER TABLE access_messages RENAME TO access_messages_old");
        await d.exec(createMessages);
        await d.exec(`INSERT INTO access_messages (id, request_id, author, body, created_at)
          SELECT id, request_id, author, body, created_at FROM access_messages_old`);
        await d.exec("DROP TABLE access_messages_old");
      } finally {
        await d.exec("PRAGMA foreign_keys=ON");
      }
    }
  } catch {
    // Leave schema as-is; errors will surface on write.
  }
}

export async function createAccessRequest(opts: {
  username: string;
  email: string;
  message: string;
}): Promise<AccessRequest> {
  const now = Date.now();
  const row: AccessRequest = {
    id: randomUUID(),
    username: opts.username,
    email: opts.email,
    message: opts.message,
    status: "pending",
    reason: "",
    created_at: now,
    updated_at: now,
  };
  await db().run(
    "INSERT INTO access_requests (id, username, email, message, status, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    row.id, row.username, row.email, row.message, row.status, row.reason, row.created_at, row.updated_at,
  );
  return row;
}

export async function getAccessRequest(id: string): Promise<AccessRequest | null> {
  return db().get<AccessRequest>("SELECT * FROM access_requests WHERE id = ?", id);
}

/** Open (non-terminal) request already reserving this username or email. */
export async function findOpenAccessRequest(username: string, email: string): Promise<AccessRequest | null> {
  return db().get<AccessRequest>(
    "SELECT * FROM access_requests WHERE status IN ('pending','reviewing') AND (username = ? OR email = ?) ORDER BY created_at DESC LIMIT 1",
    username, email,
  );
}

export async function listAccessRequests(): Promise<(AccessRequest & { message_count: number })[]> {
  return db().all<AccessRequest & { message_count: number }>(
    `SELECT r.*, (SELECT COUNT(*) FROM access_messages m WHERE m.request_id = r.id) AS message_count
     FROM access_requests r ORDER BY r.updated_at DESC`,
  );
}

export async function setAccessStatus(id: string, status: AccessStatus, reason: string): Promise<AccessRequest | null> {
  await db().run("UPDATE access_requests SET status = ?, reason = ?, updated_at = ? WHERE id = ?", status, reason, Date.now(), id);
  return getAccessRequest(id);
}

export async function listAccessMessages(requestId: string): Promise<AccessMessage[]> {
  return db().all<AccessMessage>("SELECT * FROM access_messages WHERE request_id = ? ORDER BY id ASC", requestId);
}

export async function addAccessMessage(requestId: string, author: "user" | "admin", body: string): Promise<AccessMessage> {
  const now = Date.now();
  const id = await db().insertReturningId(
    "INSERT INTO access_messages (request_id, author, body, created_at) VALUES (?, ?, ?, ?)",
    requestId, author, body, now,
  );
  await db().run("UPDATE access_requests SET updated_at = ? WHERE id = ?", now, requestId);
  return { id, request_id: requestId, author, body, created_at: now };
}
