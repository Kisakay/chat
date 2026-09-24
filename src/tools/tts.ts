import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { isTtsToolEnabled } from "../db.ts";
import { driverLog, fmtBytes, fmtMs } from "../drivers/log.ts";
import type { PlatformTool } from "./types.ts";

/**
 * Neural TTS tool: turns assistant replies / preview lines into natural
 * speech (far beyond the browser's robotic speechSynthesis).
 *
 * Providers, tried in order (first configured wins; `TTS_PROVIDER` forces
 * one explicitly):
 * - elevenlabs (ELEVENLABS_API_KEY [+ ELEVENLABS_VOICE]) — most natural,
 *   any voice_id (20-char ids, clones included).
 * - openai (OPENAI_API_KEY, reuses the LLM provider key) — tts-1 with the
 *   6 stock voices (alloy/echo/fable/onyx/nova/shimmer).
 * - piper (PIPER_BIN + PIPER_MODEL, local binary like tesseract) — offline,
 *   single configured voice, WAV output.
 *
 * Output is cached on disk (DATA_DIR/tts-cache, sha of provider|voice|text,
 * 200 files cap) so repeated lines cost nothing. Without any provider the
 * tool reports unavailable and the frontend falls back to browser speech.
 */

export type TtsProvider = "elevenlabs" | "openai" | "piper";

export const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

const TTS_MAX_CHARS = 2000;
const TTS_TIMEOUT_MS = 60_000;
const TTS_CACHE_CAP = 200;

// Abuse protection: neural TTS costs money per byte.
const TTS_WINDOW_MS = 3600_000;
const TTS_MAX_JOBS = 30;
const ttsJobs = new Map<string, number[]>();

export function ttsAllowed(userId: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const list = (ttsJobs.get(userId) ?? []).filter((t) => t > now - TTS_WINDOW_MS);
  ttsJobs.set(userId, list);
  if (list.length >= TTS_MAX_JOBS) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0]! + TTS_WINDOW_MS - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

export function recordTtsJob(userId: string): void {
  const list = ttsJobs.get(userId) ?? [];
  list.push(Date.now());
  ttsJobs.set(userId, list);
}

function elevenlabsBase(): string {
  return (process.env["ELEVENLABS_BASE_URL"] || "https://api.elevenlabs.io").replace(/\/$/, "");
}

function openaiBase(): string {
  return (process.env["OPENAI_BASE_URL"] || "https://api.openai.com").replace(/\/$/, "");
}

function piperBin(): string {
  return process.env["PIPER_BIN"] || "piper";
}

async function piperAvailable(): Promise<boolean> {
  if (!config.piperModel) return false;
  try {
    const proc = Bun.spawn([piperBin(), "--version"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/** Which provider would serve right now (null = none configured). */
export async function activeTtsProvider(): Promise<TtsProvider | null> {
  const forced = (process.env["TTS_PROVIDER"] || "auto").toLowerCase();
  const eleven = config.elevenlabsApiKey.length > 0;
  const openai = config.openaiApiKey.length > 0;
  const piper = await piperAvailable();
  const pick = (p: TtsProvider): TtsProvider | null =>
    p === "elevenlabs" ? (eleven ? p : null) : p === "openai" ? (openai ? p : null) : piper ? p : null;
  if (forced === "elevenlabs" || forced === "openai" || forced === "piper") return pick(forced);
  return pick("elevenlabs") ?? pick("openai") ?? pick("piper");
}

export function sanitizeTtsVoice(provider: TtsProvider, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (provider === "openai") {
    return (OPENAI_VOICES as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() : null;
  }
  if (provider === "elevenlabs") {
    return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
  }
  return null; // piper: single configured model voice
}

function cacheDir(): string {
  const dir = join(config.dataDir, "tts-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheKey(provider: TtsProvider, voice: string, text: string): string {
  return createHash("sha256").update(`${provider}|${voice}|${text}`).digest("hex");
}

function cachedPath(key: string, ext: string): string {
  return join(cacheDir(), `${key}.${ext}`);
}

function pruneCache(): void {
  try {
    const dir = cacheDir();
    const files = readdirSync(dir)
      .map((f) => {
        try {
          return { f, mtime: statSync(join(dir, f)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((x): x is { f: string; mtime: number } => x !== null)
      .sort((a, b) => a.mtime - b.mtime);
    for (const old of files.slice(0, Math.max(0, files.length - TTS_CACHE_CAP))) {
      try {
        rmSync(join(dir, old.f));
      } catch {
        // ignore
      }
    }
  } catch {
    // cache must never break synthesis
  }
}

async function synthElevenlabs(text: string, voiceId: string): Promise<{ audio: Uint8Array; contentType: string }> {
  const res = await fetch(`${elevenlabsBase()}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
      "xi-api-key": config.elevenlabsApiKey,
    },
    body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`elevenlabs tts failed (${res.status}): ${err.slice(0, 200)}`);
  }
  return { audio: new Uint8Array(await res.arrayBuffer()), contentType: "audio/mpeg" };
}

async function synthOpenai(text: string, voice: string): Promise<{ audio: Uint8Array; contentType: string }> {
  const res = await fetch(`${openaiBase()}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openaiApiKey}` },
    body: JSON.stringify({ model: "tts-1", input: text, voice, response_format: "mp3" }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`openai tts failed (${res.status}): ${err.slice(0, 200)}`);
  }
  return { audio: new Uint8Array(await res.arrayBuffer()), contentType: "audio/mpeg" };
}

async function synthPiper(text: string): Promise<{ audio: Uint8Array; contentType: string }> {
  const out = join(cacheDir(), `piper-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}.wav`);
  let proc;
  try {
    proc = Bun.spawn([piperBin(), "--model", config.piperModel, "--output_file", out], {
      stdin: new TextEncoder().encode(text),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    throw new Error(`tts engine failed to start: ${(e as Error).message}`);
  }
  const timeout = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // already exited
    }
  }, TTS_TIMEOUT_MS);
  try {
    const [code, errText] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(`piper failed (exit ${code}): ${errText.trim().slice(0, 200)}`);
    const file = Bun.file(out);
    if (!(await file.exists())) throw new Error("piper produced no output");
    return { audio: new Uint8Array(await file.arrayBuffer()), contentType: "audio/wav" };
  } finally {
    clearTimeout(timeout);
    try {
      rmSync(out);
    } catch {
      // ignore
    }
  }
}

export class TtsTool implements PlatformTool {
  readonly name = "tts";
  readonly description = "Neural text-to-speech (ElevenLabs / OpenAI / local piper) for natural voice playback.";

  async init(): Promise<void> {
    const p = await activeTtsProvider();
    driverLog("tools", `tts engine: ${p ?? "none configured — browser speech fallback only"}`);
  }

  async isAvailable(): Promise<boolean> {
    return (await activeTtsProvider()) !== null && (await isTtsToolEnabled());
  }

  async unavailableReason(): Promise<string | null> {
    if ((await activeTtsProvider()) === null) {
      return "no TTS provider configured (ELEVENLABS_API_KEY, OPENAI_API_KEY or PIPER_BIN+PIPER_MODEL). Browser speech is used instead.";
    }
    if (!(await isTtsToolEnabled())) return "TTS is disabled by the administrator (Admin Center → Features).";
    return null;
  }

  async providerInfo(): Promise<{ provider: TtsProvider | null; voices: string[] }> {
    const p = await activeTtsProvider();
    if (!p) return { provider: null, voices: [] };
    if (p === "openai") return { provider: p, voices: [...OPENAI_VOICES] };
    if (p === "elevenlabs") return { provider: p, voices: config.elevenlabsVoice ? [config.elevenlabsVoice] : [] };
    return { provider: p, voices: [] };
  }

  defaultVoice(provider: TtsProvider): string {
    if (provider === "openai") {
      const v = sanitizeTtsVoice("openai", config.ttsVoice);
      return v ?? "alloy";
    }
    if (provider === "elevenlabs") return config.elevenlabsVoice || "pNInz6obpgDQGcFmaJgB";
    return "";
  }

  async synthesize(text: string, voice?: string): Promise<{ audio: Uint8Array; contentType: string; provider: TtsProvider; fromCache: boolean }> {
    const provider = await activeTtsProvider();
    if (!provider) throw new Error((await this.unavailableReason()) ?? "tts unavailable");
    if (!(await isTtsToolEnabled())) throw new Error("tts disabled");
    const clean = text.trim().slice(0, TTS_MAX_CHARS);
    if (!clean) throw new Error("empty text");
    const resolved = sanitizeTtsVoice(provider, voice) ?? this.defaultVoice(provider);
    const ext = provider === "piper" ? "wav" : "mp3";
    const key = cacheKey(provider, resolved, clean);
    const hit = Bun.file(cachedPath(key, ext));
    if (await hit.exists()) {
      return {
        audio: new Uint8Array(await hit.arrayBuffer()),
        contentType: provider === "piper" ? "audio/wav" : "audio/mpeg",
        provider,
        fromCache: true,
      };
    }
    const t0 = Date.now();
    const out = provider === "elevenlabs"
      ? await synthElevenlabs(clean, resolved)
      : provider === "openai"
        ? await synthOpenai(clean, resolved)
        : await synthPiper(clean);
    await Bun.write(cachedPath(key, ext), out.audio);
    pruneCache();
    driverLog("tools", `tts ${provider} voice=${resolved || "default"}: ${fmtBytes(out.audio.length)} in ${fmtMs(Date.now() - t0)}`);
    return { ...out, provider, fromCache: false };
  }
}

export { TTS_MAX_CHARS };
