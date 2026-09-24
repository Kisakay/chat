import { config } from "../config.ts";
import { isOcrToolEnabled } from "../db.ts";
import { driverLog, fmtMs } from "../drivers/log.ts";
import type { PlatformTool } from "./types.ts";

/**
 * OCR tool: transcribes JPG/PNG/WEBP images to TXT on the backend
 * (tesseract binary) so the model only ever receives text.
 * The frontend shows the transcription for user review before sending.
 */

const OCR_MAX_BYTES = 5 * 1024 * 1024;

// CPU protection: max OCR jobs per account per hour.
const OCR_WINDOW_MS = 3600_000;
const OCR_MAX_JOBS = 20;
const ocrJobs = new Map<string, number[]>();

export function ocrAllowed(userId: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const list = (ocrJobs.get(userId) ?? []).filter((t) => t > now - OCR_WINDOW_MS);
  ocrJobs.set(userId, list);
  if (list.length >= OCR_MAX_JOBS) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0]! + OCR_WINDOW_MS - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function recordOcrJob(userId: string): void {
  const list = ocrJobs.get(userId) ?? [];
  list.push(Date.now());
  ocrJobs.set(userId, list);
}

function tessBin(): string {
  return process.env["TESSERACT_BIN"] || "tesseract";
}

let availableCache: boolean | null = null;

async function checkBinary(): Promise<boolean> {
  try {
    const proc = Bun.spawn([tessBin(), "--version"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export class OcrTool implements PlatformTool {
  readonly name = "ocr";
  readonly description = "Transcribe image (jpg/png/webp) to text on the server (tesseract) for user review before sending to the model.";

  private available: boolean | null = null;

  async init(): Promise<void> {
    if (availableCache === null) {
      availableCache = await checkBinary();
      driverLog("tools", `ocr engine ${tessBin()}: ${availableCache ? "available" : "MISSING — image transcription disabled"}`);
    }
    this.available = availableCache;
  }

  async isAvailable(): Promise<boolean> {
    return (this.available ?? false) && (await isOcrToolEnabled());
  }

  async unavailableReason(): Promise<string | null> {
    if (!(this.available ?? false)) {
      return `tesseract binary not found (looked for "${tessBin()}"). Install tesseract or set TESSERACT_BIN.`;
    }
    if (!(await isOcrToolEnabled())) return "OCR is disabled by the administrator (Admin Center → Features).";
    return null;
  }

  async transcribe(image: Uint8Array): Promise<{ text: string; truncated: boolean }> {
    if (!(await this.isAvailable())) throw new Error((await this.unavailableReason()) ?? "ocr unavailable");
    const t0 = Date.now();
    const maxChars = config.ocrMaxChars;    let proc;
    try {
      proc = Bun.spawn([tessBin(), "stdin", "stdout", "-l", config.ocrLang, "--psm", "3"], {
        stdin: image,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e) {
      throw new Error(`ocr engine failed to start: ${(e as Error).message}`);
    }
    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    }, 120_000);
    try {
      const [code, out, errText] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (code !== 0) {
        throw new Error(`ocr failed (exit ${code}): ${errText.trim().slice(0, 300)}`);
      }
      let text = sanitizeOcrText(out);
      let truncated = false;
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        truncated = true;
      }
      driverLog("tools", `ocr done: ${text.length} chars${truncated ? " (truncated)" : ""} in ${fmtMs(Date.now() - t0)}`);
      return { text, truncated };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Strip unrecognizable output from the OCR engine while preserving every
 * legitimate character (accents, CJK, punctuation, emoji…).
 *
 * Tesseract emits raw control bytes, Unicode private-use / unassigned /
 * surrogate code points and U+FFFD replacement chars when glyphs are
 * unreadable, plus form-feeds between pages and \r line endings. Those
 * poison the model prompt and the attachment preview, so they are removed
 * here. Visible-but-dubious glyphs (|, ~, …) are kept: they may be real
 * content and only the user can judge them in the review step.
 */
export function sanitizeOcrText(raw: string): string {
  // Normalize line endings first; form-feeds are page breaks, not content.
  let text = raw.replace(/\r\n?/g, "\n").replace(/\f/g, "\n");
  // Strip BOMs / zero-width no-break spaces anywhere (keep ZWJ + VS16 so
  // emoji sequences survive).
  text = text.replace(/[\uFEFF\u200B\u200C\u2060\u180E]/g, "");
  let out = "";
  for (const ch of text) {
    if (ch === "\n" || ch === "\t" || ch === "\u200D" || ch === "\uFE0F") {
      out += ch;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    // U+FFFD (replacement char) and U+FFFE/FFFF are the engine's markers
    // for unreadable glyphs — never real content.
    if (cp === 0xfffd || cp === 0xfffe || cp === 0xffff) continue;
    // Keep letters, marks, numbers, punctuation, symbols and spaces.
    // Drops Cc/Cf/Cs/Co/Cn (controls, formats, surrogates, private-use,
    // unassigned) and Zl/Zp separators.
    if (/^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]$/u.test(ch)) {
      out += ch;
    }
    // Anything else is unrecognizable — drop it.
  }
  // Tidy whitespace without touching indentation: trim line ends, collapse
  // 3+ blank lines, drop leading/trailing blank lines.
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t\u00A0]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

export { OCR_MAX_BYTES };
