import type { Transporter } from "nodemailer";
import { config } from "./config.ts";

let transporter: Transporter | null = null;
let warned = false;

export function mailEnabled(): boolean {
  return config.smtpHost.length > 0;
}

/** Sanitized snapshot for the Admin Center mail viewer (admin-only route). */
export function smtpStatus(): {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  hasPass: boolean;
  from: string;
  appUrl: string;
} {
  return {
    enabled: mailEnabled(),
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    user: config.smtpUser,
    pass: config.smtpPass,
    hasPass: config.smtpPass.length > 0,
    from: config.smtpFrom,
    appUrl: config.appUrl,
  };
}

/** Verify SMTP connectivity (connect + auth, no mail sent). Throws on failure. */
export async function verifySmtp(): Promise<void> {
  if (!mailEnabled()) throw new Error("SMTP_HOST not set — mail is disabled");
  const mailer = await loadMailer();
  if (!mailer) throw new Error("nodemailer not installed — run `bun install` for email support");
  const t = mailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
  });
  try {
    await t.verify();
  } finally {
    t.close();
  }
}

/** Send a connectivity test mail to `to`. Throws on failure, returns messageId. */
export async function sendSmtpTestMail(to: string): Promise<string> {
  if (!mailEnabled()) throw new Error("SMTP_HOST not set — mail is disabled");
  const mailer = await loadMailer();
  if (!mailer) throw new Error("nodemailer not installed — run `bun install` for email support");
  const t = mailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
  });
  try {
    const info = await t.sendMail({
      from: config.smtpFrom,
      to,
      subject: "KisAssistant — SMTP test",
      text: "This is a KisAssistant SMTP connectivity test. If you received it, outgoing mail works.",
      html: `<p>This is a <strong>KisAssistant</strong> SMTP connectivity test. If you received it, outgoing mail works.</p>`,
    });
    return info.messageId ?? "";
  } finally {
    t.close();
  }
}

// Lazy import: the backend boots (and serves) fine without node_modules
// installed; SMTP is only needed when actually sending.
async function loadMailer(): Promise<typeof import("nodemailer") | null> {
  try {
    return await import("nodemailer");
  } catch {
    if (!warned) {
      warned = true;
      console.error("[mail] nodemailer not installed — run `bun install` for email support");
    }
    return null;
  }
}

async function getTransporter(): Promise<Transporter | null> {
  if (!mailEnabled()) return null;
  if (!transporter) {
    const mailer = await loadMailer();
    if (!mailer) return null;
    transporter = mailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    });
  }
  return transporter;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Shared branded layout for ticket emails. Every mail states the same rule:
 * email is notification-only — real replies happen on the /review page.
 */
function ticketLayout(title: string, bodyHtml: string, reviewUrl: string): { html: string; text: string } {
  const text = bodyHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;">` +
    `<div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e5e4;">` +
    `<div style="background:#059669;padding:20px 24px;color:#ffffff;">` +
    `<div style="font-size:20px;font-weight:700;">KisAssistant</div>` +
    `<div style="font-size:13px;opacity:.85;">${escHtml(title)}</div>` +
    `</div>` +
    `<div style="padding:24px;color:#1c1917;font-size:14px;line-height:1.6;">${bodyHtml}</div>` +
    `<div style="padding:16px 24px;background:#fafaf9;border-top:1px solid #e7e5e4;font-size:12px;color:#78716c;">` +
    `This email is notification-only — please do not reply to it.<br>` +
    `Respond on the official site: <a href="${escHtml(reviewUrl)}" style="color:#059669;">${escHtml(reviewUrl)}</a>` +
    `</div></div></div></body></html>`;
  return { html, text: `${text}\n\n--\nThis email is notification-only, do not reply. Respond at: ${reviewUrl}\n` };
}

async function sendTicketMail(to: string, subject: string, title: string, bodyHtml: string, reviewUrl: string): Promise<boolean> {
  const t = await getTransporter();
  if (!t) {
    console.error("[mail] SMTP_HOST not set — ticket email skipped");
    return false;
  }
  try {
    const { html, text } = ticketLayout(title, bodyHtml, reviewUrl);
    await t.sendMail({ from: config.smtpFrom, to, subject, text, html });
    console.log(`[mail] ticket email "${subject}" sent`);
    return true;
  } catch (e) {
    console.error("[mail] send failed:", (e as Error).message);
    return false;
  }
}

/** Confirm a wishlist request was received, with the /review ticket link. */
export async function sendAccessReceivedEmail(to: string, username: string, reviewUrl: string): Promise<boolean> {
  return sendTicketMail(
    to,
    "KisAssistant — access request received",
    "Access request received",
    `<p>Hello <strong>${escHtml(username)}</strong>,</p>` +
      `<p>We received your request for a KisAssistant account. An admin will review it shortly.</p>` +
      `<p>Follow the discussion and add arguments here:<br>` +
      `<a href="${escHtml(reviewUrl)}" style="color:#059669;">${escHtml(reviewUrl)}</a></p>` +
      `<p>Keep this link — it is your personal ticket page.</p>`,
    reviewUrl,
  );
}

/** Notify status changes. `key` is set only on acceptance (shown once). */
export async function sendAccessStatusEmail(
  to: string,
  username: string,
  status: "reviewing" | "accepted" | "refused",
  reason: string,
  reviewUrl: string,
  key?: string,
): Promise<boolean> {
  if (status === "accepted") {
    return sendTicketMail(
      to,
      "KisAssistant — access granted",
      "Access granted",
      `<p>Hello <strong>${escHtml(username)}</strong>,</p>` +
        `<p>Good news — your KisAssistant account was created${reason ? ` (${escHtml(reason)})` : ""}.</p>` +
        `<p>Your access key (shown <strong>once</strong> — save it now):</p>` +
        `<p style="background:#f5f5f4;border-radius:8px;padding:12px 16px;font-family:monospace;font-size:15px;">${escHtml(key ?? "")}</p>` +
        `<p>Log in with your username and this key. You can still discuss on your ticket page:<br>` +
        `<a href="${escHtml(reviewUrl)}" style="color:#059669;">${escHtml(reviewUrl)}</a></p>`,
      reviewUrl,
    );
  }
  if (status === "refused") {
    return sendTicketMail(
      to,
      "KisAssistant — access request refused",
      "Access refused",
      `<p>Hello <strong>${escHtml(username)}</strong>,</p>` +
        `<p>Your request for a KisAssistant account was refused${reason ? ` for this reason: <em>${escHtml(reason)}</em>` : ""}.</p>` +
        `<p>You may still reply on your ticket page if you think this is a mistake:<br>` +
        `<a href="${escHtml(reviewUrl)}" style="color:#059669;">${escHtml(reviewUrl)}</a></p>`,
      reviewUrl,
    );
  }
  return sendTicketMail(
    to,
    "KisAssistant — access request under review",
    "Under review",
    `<p>Hello <strong>${escHtml(username)}</strong>,</p>` +
      `<p>An admin is now reviewing your request${reason ? `: <em>${escHtml(reason)}</em>` : ""}.</p>` +
      `<p>You can add arguments on your ticket page:<br>` +
      `<a href="${escHtml(reviewUrl)}" style="color:#059669;">${escHtml(reviewUrl)}</a></p>`,
    reviewUrl,
  );
}

/** Forward each new ticket message to the requester (notification-only). */
export async function sendAccessMessageEmail(
  to: string,
  username: string,
  fromAdmin: boolean,
  body: string,
  reviewUrl: string,
): Promise<boolean> {
  const excerpt = body.length > 500 ? `${body.slice(0, 500)}…` : body;
  return sendTicketMail(
    to,
    `KisAssistant — new message on your access request`,
    "New ticket message",
    `<p>Hello <strong>${escHtml(username)}</strong>,</p>` +
      `<p><strong>${fromAdmin ? "An admin" : "You"}</strong> wrote on your access-request ticket:</p>` +
      `<p style="background:#f5f5f4;border-left:4px solid #059669;border-radius:0 8px 8px 0;padding:12px 16px;white-space:pre-wrap;">${escHtml(excerpt)}</p>` +
      `<p>Reply on your ticket page:<br>` +
      `<a href="${escHtml(reviewUrl)}" style="color:#059669;">${escHtml(reviewUrl)}</a></p>`,
    reviewUrl,
  );
}

/** Send a key-recovery email with a one-time reset link. Fire-and-forget safe. */
export async function sendRecoveryEmail(to: string, username: string, resetUrl: string): Promise<boolean> {
  const t = await getTransporter();
  if (!t) {
    if (!warned) {
      warned = true;
      console.error("[mail] SMTP_HOST not set — recovery emails disabled");
    }
    return false;
  }
  try {
    await t.sendMail({
      from: config.smtpFrom,
      to,
      subject: "KisAssistant — recover your access key",
      text:
        `Hello ${username},\n\n` +
        `Someone requested a new access key for your KisAssistant account.\n` +
        `Open this link within 60 minutes to get a fresh key (your old one stops working):\n\n` +
        `${resetUrl}\n\n` +
        `If you did not request this, just ignore this email.\n`,
    });
    console.log(`[mail] recovery email sent to ${username}`);
    return true;
  } catch (e) {
    console.error("[mail] send failed:", (e as Error).message);
    return false;
  }
}
