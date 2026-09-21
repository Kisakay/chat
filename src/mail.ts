import type { Transporter } from "nodemailer";
import { config } from "./config.ts";

let transporter: Transporter | null = null;
let warned = false;

export function mailEnabled(): boolean {
  return config.smtpHost.length > 0;
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
