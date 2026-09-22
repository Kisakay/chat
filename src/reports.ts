import { randomUUID } from "node:crypto";
import { getConversation, getMessages, db } from "./db.ts";

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

export async function initReportsTables(): Promise<void> {
  const d = db();
  await d.exec(`CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    reporter_name TEXT NOT NULL DEFAULT '',
    conversation_id TEXT NOT NULL DEFAULT '',
    message_index BIGINT NOT NULL DEFAULT -1,
    content TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    admin_note TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  await d.exec(`CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, updated_at DESC)`);
  await d.exec(`CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at DESC)`);
  await d.exec(`CREATE INDEX IF NOT EXISTS idx_reports_message ON reports(conversation_id, message_index)`);
  if (d.kind === "sqlite") {
    // Prompt snapshot added after the initial schema — keep idempotent.
    const rcols = await d.all<{ name: string }>("PRAGMA table_info(reports)");
    if (!rcols.some((c) => c.name === "prompt")) {
      await d.exec("ALTER TABLE reports ADD COLUMN prompt TEXT NOT NULL DEFAULT ''");
    }
    // Per-user report shadow-ban (unreliable reporters) — keep idempotent.
    const ucols = await d.all<{ name: string }>("PRAGMA table_info(users)");
    if (!ucols.some((c) => c.name === "report_shadowbanned")) {
      await d.exec("ALTER TABLE users ADD COLUMN report_shadowbanned INTEGER NOT NULL DEFAULT 0");
    }
  } else {
    // Postgres: ADD COLUMN IF NOT EXISTS is natively idempotent.
    await d.exec("ALTER TABLE reports ADD COLUMN IF NOT EXISTS prompt TEXT NOT NULL DEFAULT ''");
    await d.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS report_shadowbanned INTEGER NOT NULL DEFAULT 0");
  }
}

/** Max non-terminal reports per reporter (spam guard). */
export const MAX_OPEN_REPORTS = 20;

/** Still-triageable report already covering this message, if any. */
export async function findOpenReport(conversationId: string, messageIndex: number): Promise<Report | null> {
  if (!conversationId || messageIndex < 0) return null;
  return db().get<Report>(
    "SELECT r.*, COALESCE(u.report_shadowbanned, 0) AS reporter_shadowbanned FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.conversation_id = ? AND r.message_index = ? AND r.status IN ('open','reviewing') ORDER BY r.created_at DESC LIMIT 1",
    conversationId, messageIndex,
  );
}

export async function createReport(opts: {
  reporterId: string;
  reporterName: string;
  conversationId: string;
  messageIndex: number;
  reason: ReportReason;
  details: string;
  clientContent: string;
  clientPrompt: string;
  clientModel: string;
}): Promise<Report> {
  const dup = opts.conversationId && opts.messageIndex >= 0
    ? await findOpenReport(opts.conversationId, opts.messageIndex)
    : null;
  if (dup) {
    const err = new Error("ALREADY_REPORTED") as Error & { report: Report };
    err.report = dup;
    throw err;
  }
  const open = await db().get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND status IN ('open','reviewing')",
    opts.reporterId,
  );
  if ((open?.n ?? 0) >= MAX_OPEN_REPORTS) throw new Error("TOO_MANY_OPEN");
  let content = opts.clientContent;
  let prompt = opts.clientPrompt;
  let model = opts.clientModel;
  if (opts.conversationId) {
    const conv = await getConversation(opts.conversationId);
    if (conv && conv.user_id === opts.reporterId) {
      if (conv.model) model = conv.model;
      const msgs = (await getMessages(conv.id)).filter((m) => m.role !== "system");
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
  await db().run(
    "INSERT INTO reports (id, reporter_id, reporter_name, conversation_id, message_index, content, prompt, model, reason, details, status, admin_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    row.id, row.reporter_id, row.reporter_name, row.conversation_id, row.message_index,
    row.content, row.prompt, row.model, row.reason, row.details, row.status, row.admin_note,
    row.created_at, row.updated_at,
  );
  return row;
}

export async function listReports(): Promise<Report[]> {
  return db().all<Report>(
    "SELECT r.*, COALESCE(u.report_shadowbanned, 0) AS reporter_shadowbanned FROM reports r LEFT JOIN users u ON u.id = r.reporter_id ORDER BY r.updated_at DESC LIMIT 500",
  );
}

export async function getReport(id: string): Promise<Report | null> {
  return db().get<Report>(
    "SELECT r.*, COALESCE(u.report_shadowbanned, 0) AS reporter_shadowbanned FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.id = ?",
    id,
  );
}

export async function setReportStatus(id: string, status: ReportStatus, adminNote: string): Promise<Report | null> {
  await db().run("UPDATE reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?",
    status, adminNote, Date.now(), id,
  );
  return getReport(id);
}

/**
 * Shadow-ban a reporter: their reports are still accepted but flagged
 * unreliable (excluded from the admin badge). Returns the new flag.
 */
export async function setReportShadowbanned(userId: string, shadowbanned: boolean): Promise<number> {
  await db().run("UPDATE users SET report_shadowbanned = ? WHERE id = ?", shadowbanned ? 1 : 0, userId);
  const row = await db().get<{ v: number }>("SELECT report_shadowbanned AS v FROM users WHERE id = ?", userId);
  return row?.v ?? 0;
}
