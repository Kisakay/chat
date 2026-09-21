import { randomUUID } from "node:crypto";
import { getConversation, getDb, getMessages } from "./db.ts";

/**
 * Content reports (user-flagged AI responses). Tables are created
 * idempotently here so db.ts stays untouched — same pattern as access.ts.
 *
 * Flow: user hits "Report" under an assistant message, picks a reason
 * (copyright / gore / falseinfo / bug) -> row in `reports` with a content
 * snapshot (conversation may later be edited or deleted) -> admins triage
 * in the AdminCenter (open / reviewing / resolved / dismissed + note).
 */

export const REPORT_REASONS = ["copyright", "gore", "falseinfo", "bug"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface Report {
  id: string;
  reporter_id: string;
  reporter_name: string;
  conversation_id: string;
  message_index: number;
  /** Snapshot of the reported assistant message. */
  content: string;
  /** Snapshot of the user prompt that triggered it (previous user message). */
  prompt: string;
  model: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  admin_note: string;
  /** Live flag from users.report_shadowbanned (JOIN, not stored). */
  reporter_shadowbanned: number;
  created_at: number;
  updated_at: number;
}

export function initReportsTables(): void {
  const d = getDb();
  d.query(`CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    reporter_name TEXT NOT NULL DEFAULT '',
    conversation_id TEXT NOT NULL DEFAULT '',
    message_index INTEGER NOT NULL DEFAULT -1,
    content TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  d.query(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, updated_at DESC)`).run();
  d.query(`CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at DESC)`).run();
  d.query(`CREATE INDEX IF NOT EXISTS idx_reports_message ON reports(conversation_id, message_index)`).run();
  // Prompt snapshot added after the initial schema — keep idempotent.
  const rcols = d.query("PRAGMA table_info(reports)").all() as { name: string }[];
  if (!rcols.some((c) => c.name === "prompt")) {
    d.query("ALTER TABLE reports ADD COLUMN prompt TEXT NOT NULL DEFAULT ''").run();
  }
  // Per-user report shadow-ban (unreliable reporters) — keep idempotent.
  const ucols = d.query("PRAGMA table_info(users)").all() as { name: string }[];
  if (!ucols.some((c) => c.name === "report_shadowbanned")) {
    d.query("ALTER TABLE users ADD COLUMN report_shadowbanned INTEGER NOT NULL DEFAULT 0").run();
  }
}

/** Max non-terminal reports per reporter (spam guard). */
export const MAX_OPEN_REPORTS = 20;

/** Still-triageable report already covering this message, if any. */
export function findOpenReport(conversationId: string, messageIndex: number): Report | null {
  if (!conversationId || messageIndex < 0) return null;
  return getDb().query(
    "SELECT r.*, COALESCE(u.report_shadowbanned, 0) AS reporter_shadowbanned FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.conversation_id = ? AND r.message_index = ? AND r.status IN ('open','reviewing') ORDER BY r.created_at DESC LIMIT 1",
  ).get(conversationId, messageIndex) as Report | null;
}

export function createReport(opts: {
  reporterId: string;
  reporterName: string;
  conversationId: string;
  messageIndex: number;
  reason: ReportReason;
  details: string;
  clientContent: string;
  clientPrompt: string;
  clientModel: string;
}): Report {
  const d = getDb();
  const dup = opts.conversationId && opts.messageIndex >= 0
    ? findOpenReport(opts.conversationId, opts.messageIndex)
    : null;
  if (dup) {
    const err = new Error("ALREADY_REPORTED") as Error & { report: Report };
    err.report = dup;
    throw err;
  }
  const open = d.query(
    "SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND status IN ('open','reviewing')",
  ).get(opts.reporterId) as { n: number };
  if (open.n >= MAX_OPEN_REPORTS) throw new Error("TOO_MANY_OPEN");
  let content = opts.clientContent;
  let prompt = opts.clientPrompt;
  let model = opts.clientModel;
  if (opts.conversationId) {
    const conv = getConversation(opts.conversationId);
    if (conv && conv.user_id === opts.reporterId) {
      if (conv.model) model = conv.model;
      const msgs = getMessages(conv.id).filter((m) => m.role !== "system");
      if (opts.messageIndex >= 0) {
        const at = msgs[opts.messageIndex];
        if (at) content = at.content;
        const prev = msgs[opts.messageIndex - 1];
        if (prev && prev.role === "user") prompt = prev.content;
      }
    }
  }
  const now = Date.now();
  const row: Report = {
    id: randomUUID(),
    reporter_id: opts.reporterId,
    reporter_name: opts.reporterName,
    conversation_id: opts.conversationId,
    message_index: opts.messageIndex,
    content,
    prompt,
    model,
    reason: opts.reason,
    details: opts.details,
    status: "open",
    admin_note: "",
    reporter_shadowbanned: 0,
    created_at: now,
    updated_at: now,
  };
  d.query(
    "INSERT INTO reports (id, reporter_id, reporter_name, conversation_id, message_index, content, prompt, model, reason, details, status, admin_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    row.id, row.reporter_id, row.reporter_name, row.conversation_id, row.message_index,
    row.content, row.prompt, row.model, row.reason, row.details, row.status, row.admin_note,
    row.created_at, row.updated_at,
  );
  return row;
}

export function listReports(): Report[] {
  return getDb().query(
    "SELECT r.*, COALESCE(u.report_shadowbanned, 0) AS reporter_shadowbanned FROM reports r LEFT JOIN users u ON u.id = r.reporter_id ORDER BY r.updated_at DESC LIMIT 500",
  ).all() as Report[];
}

export function getReport(id: string): Report | null {
  return getDb().query(
    "SELECT r.*, COALESCE(u.report_shadowbanned, 0) AS reporter_shadowbanned FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.id = ?",
  ).get(id) as Report | null;
}

export function setReportStatus(id: string, status: ReportStatus, adminNote: string): Report | null {
  getDb().query("UPDATE reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?").run(
    status, adminNote, Date.now(), id,
  );
  return getReport(id);
}

/**
 * Shadow-ban a reporter: their reports are still accepted but flagged
 * unreliable (excluded from the admin badge). Returns the new flag.
 */
export function setReportShadowbanned(userId: string, shadowbanned: boolean): number {
  getDb().query("UPDATE users SET report_shadowbanned = ? WHERE id = ?").run(shadowbanned ? 1 : 0, userId);
  const row = getDb().query("SELECT report_shadowbanned AS v FROM users WHERE id = ?").get(userId) as { v: number } | null;
  return row?.v ?? 0;
}
