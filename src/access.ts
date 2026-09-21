import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";

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

export function initAccessTables(): void {
  const d = getDb();
  d.query(`CREATE TABLE IF NOT EXISTS access_requests (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  d.query(`CREATE TABLE IF NOT EXISTS access_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`).run();
  d.query(`CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status, updated_at DESC)`).run();
  d.query(`CREATE INDEX IF NOT EXISTS idx_access_messages_req ON access_messages(request_id, id)`).run();
}

export function createAccessRequest(opts: {
  username: string;
  email: string;
  message: string;
}): AccessRequest {
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
  getDb().query(
    "INSERT INTO access_requests (id, username, email, message, status, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.username, row.email, row.message, row.status, row.reason, row.created_at, row.updated_at);
  return row;
}

export function getAccessRequest(id: string): AccessRequest | null {
  return getDb().query("SELECT * FROM access_requests WHERE id = ?").get(id) as AccessRequest | null;
}

/** Open (non-terminal) request already reserving this username or email. */
export function findOpenAccessRequest(username: string, email: string): AccessRequest | null {
  return getDb().query(
    "SELECT * FROM access_requests WHERE status IN ('pending','reviewing') AND (username = ? OR email = ?) ORDER BY created_at DESC LIMIT 1",
  ).get(username, email) as AccessRequest | null;
}

export function listAccessRequests(): (AccessRequest & { message_count: number })[] {
  return getDb().query(
    `SELECT r.*, (SELECT COUNT(*) FROM access_messages m WHERE m.request_id = r.id) AS message_count
     FROM access_requests r ORDER BY r.updated_at DESC`,
  ).all() as (AccessRequest & { message_count: number })[];
}

export function setAccessStatus(id: string, status: AccessStatus, reason: string): AccessRequest | null {
  getDb().query("UPDATE access_requests SET status = ?, reason = ?, updated_at = ? WHERE id = ?").run(status, reason, Date.now(), id);
  return getAccessRequest(id);
}

export function listAccessMessages(requestId: string): AccessMessage[] {
  return getDb().query("SELECT * FROM access_messages WHERE request_id = ? ORDER BY id ASC").all(requestId) as AccessMessage[];
}

export function addAccessMessage(requestId: string, author: "user" | "admin", body: string): AccessMessage {
  const now = Date.now();
  getDb().query("INSERT INTO access_messages (request_id, author, body, created_at) VALUES (?, ?, ?, ?)").run(requestId, author, body, now);
  getDb().query("UPDATE access_requests SET updated_at = ? WHERE id = ?").run(now, requestId);
  const id = (getDb().query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
  return { id, request_id: requestId, author, body, created_at: now };
}
