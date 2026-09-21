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

  isAvailable(): boolean {
    return (this.available ?? false) && isOcrToolEnabled();
  }

  unavailableReason(): string | null {
    if (!(this.available ?? false)) {
      return `tesseract binary not found (looked for "${tessBin()}"). Install tesseract or set TESSERACT_BIN.`;
    }
    if (!isOcrToolEnabled()) return "OCR is disabled by the administrator (Admin Center → Features).";
    return null;
  }

  async transcribe(image: Uint8Array): Promise<{ text: string; truncated: boolean }> {
    if (!this.isAvailable()) throw new Error(this.unavailableReason() ?? "ocr unavailable");
    const t0 = Date.now();
    const maxChars = config.ocrMaxChars;
    let proc;
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
      let text = out.replace(/\f/g, "").trim();
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

export { OCR_MAX_BYTES };
