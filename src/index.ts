import { serveStatic } from "./static.ts";
import { assertConfig, config } from "./config.ts";
import {
  clearAttempts,
  extractBearer,
  hashSecret,
  isRateLimited,
  isRecoveryLimited,
  issueToken,
  login,
  newAccessKey,
  recordAttempt,
  recordRecoveryAttempt,
  recoveryLimitMax,
  recoveryLimitWindowMs,
  revokeToken,
  verifyToken,
  type PublicUser,
} from "./auth.ts";
import {
  createOllamaNode,
  DEFAULT_NODE_ID,
  deleteOllamaNode,
  effectiveOllamaNodes,
  getOllamaDefaultWeight,
  getOllamaNode,
  getOllamaTimeoutMs,
  listOllamaNodes,
  nodeStats,
  resolveOllamaHost,
  sanitizeNodeHost,
  sanitizeNodeName,
  sanitizeWeight,
  updateOllamaNode,
  type StatsWindow,
} from "./ollamaNodes.ts";
import {
  addMessage,
  consumeReset,
  createConversation,
  createReset,
  createUser,
  deleteConversation,
  deleteShare,
  deleteUser,
  deleteUserSessions,
  ensureShare,
  getConversation,
  db,
  getMessages,
  getShareByConv,
  getShareByPublic,
  getSetting,
  getUserById,
  getUserByUsername,
  initDb,
  isRegistrationEnabled,
  isReportsEnabled,
  isUsernameChangeEnabled,
  listConversations,
  listArchivedConversations,
  listUsers,
  peekReset,
  setConversationArchived,
  setSetting,
  toPublicUser,
  touchConversation,
  updateConversation,
  updateUser,
} from "./db.ts";
import type { ChatMessage } from "./drivers/types.ts";
import {
  consumeTotpChallenge,
  createTotpChallenge,
  deleteTotpChallenges,
  getTotpSecret,
  initTotpTables,
  newTotpSecret,
  setTotpSecret,
  totpAuthUrl,
  verifyTotp,
} from "./totp.ts";
import {
  addAccessMessage,
  createAccessRequest,
  findOpenAccessRequest,
  getAccessRequest,
  initAccessTables,
  listAccessMessages,
  listAccessRequests,
  setAccessStatus,
  type AccessStatus,
} from "./access.ts";import { broadcastAccessLive, subscribeAccessLive } from "./accessLive.ts";
import {
  REPORT_REASONS,
  REPORT_STATUSES,
  createReport,
  getReport,
  initReportsTables,
  listReports,
  setReportShadowbanned,
  setReportStatus,
  type ReportReason,
  type ReportStatus,
} from "./reports.ts";
import {
  checkModelAccess,
  getModelPolicy,
  initModelUsageTables,
  policyFor,
  recordModelUse,
  setModelPolicyEntry,
} from "./modelPolicy.ts";
import {
  buildUserProviderDriver,
  deleteUserProviderKey,
  getUserProviderKey,
  isUserProviderId,
  listUserProviders,
  listUserProviderModels,
  setUserProviderKey,
  validProviderKey,
  type UserProviderId,
} from "./userProviders.ts";
import type { ConversationRow } from "./db.ts";
import type { OllamaDriver } from "./drivers/ollama.ts";
import { DriverRegistry } from "./drivers/registry.ts";
import { createHash, randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { mailEnabled, sendAccessMessageEmail, sendAccessReceivedEmail, sendAccessStatusEmail, sendRecoveryEmail, sendSmtpTestMail, smtpStatus, verifySmtp } from "./mail.ts";
import {
  CDN_NAMESPACES,
  cdnFile,
  cdnMime,
  detectCdnType,
  detectImageType,
  namespaceAccepts,
  recordUpload,
  uploadAllowed,
  validExt,
  validKey,
  validNamespace,
  writeCdnFile,
} from "./cdn.ts";
import { OCR_MAX_BYTES, ocrAllowed, recordOcrJob } from "./tools/ocr.ts";
import { TTS_MAX_CHARS, recordTtsJob, ttsAllowed } from "./tools/tts.ts";
import { tools } from "./tools/registry.ts";
import { initOllamaNodes } from "./ollamaNodes.ts";

assertConfig();
await initDb();
const registry = new DriverRegistry();
// Ollama handles admin model pulls/deletes (host is loopback/LAN, no auth).
const ollamaDriver = registry.get("ollama") as OllamaDriver;
await tools.init();
await initAccessTables();
await initReportsTables();
await initModelUsageTables();
await initTotpTables();
await initOllamaNodes();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Live probe of one Ollama host: version, latency, on-disk models and
 * running models (/api/ps — the only load signal Ollama exposes, with
 * per-model VRAM usage). Always resolves (reachability is data).
 */
async function probeOllamaHost(host: string): Promise<{
  reachable: boolean;
  host: string;
  version: string | null;
  latencyMs: number | null;
  models: { name: string; size: number; modifiedAt: string | null }[];
  running: { name: string; sizeVram: number; size: number; expiresAt: string | null }[];
  error: string | null;
}> {
  const t0 = Date.now();
  try {
    const verRes = await fetch(`${host}/api/version`, { signal: AbortSignal.timeout(8000) });
    if (!verRes.ok) {
      return { reachable: false, host, version: null, latencyMs: Date.now() - t0, models: [], running: [], error: `ollama /api/version failed: ${verRes.status}` };
    }
    const ver = (await verRes.json().catch(() => ({}))) as { version?: unknown };
    const tagsRes = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(8000) });
    const tags = (await tagsRes.json().catch(() => ({}))) as { models?: { name?: unknown; size?: unknown; modified_at?: unknown }[] };
    const models = tagsRes.ok && Array.isArray(tags.models)
      ? tags.models
        .filter((m) => typeof m.name === "string")
        .map((m) => ({
          name: m.name as string,
          size: typeof m.size === "number" ? m.size : 0,
          modifiedAt: typeof m.modified_at === "string" ? (m.modified_at as string) : null,
        }))
      : [];
    const psRes = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(8000) });
    const ps = (await psRes.json().catch(() => ({}))) as { models?: { name?: unknown; size_vram?: unknown; size?: unknown; expires_at?: unknown }[] };
    const running = psRes.ok && Array.isArray(ps.models)
      ? ps.models
        .filter((m) => typeof m.name === "string")
        .map((m) => ({
          name: m.name as string,
          sizeVram: typeof m.size_vram === "number" ? m.size_vram : 0,
          size: typeof m.size === "number" ? m.size : 0,
          expiresAt: typeof m.expires_at === "string" ? (m.expires_at as string) : null,
        }))
      : [];
    return {
      reachable: true,
      host,
      version: typeof ver.version === "string" ? ver.version : null,
      latencyMs: Date.now() - t0,
      models,
      running,
      error: null,
    };
  } catch (e) {
    return { reachable: false, host, version: null, latencyMs: Date.now() - t0, models: [], running: [], error: (e as Error).message };
  }
}

/**
 * Voice-preview lines (admin-editable, resettable). Each line carries its
 * OWN voice character — timbre/rate/pitch/lang — so previews sound
 * different from each other instead of sharing the user's playback voice:
 * deep-hesitant masculine, deep-serious masculine, cute feminine,
 * medium feminine.
 */
export interface VoicePreview {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  timbre: "masculine" | "feminine" | "any";
  /** Server neural voice id (ElevenLabs voice_id / OpenAI voice name). Empty = provider default. */
  voice: string;
}

const DEFAULT_VOICE_PREVIEWS: VoicePreview[] = [
  { text: "Salut, euhm, comment je peux t'aider aujourd'hui ?", lang: "fr", rate: 0.85, pitch: 0.75, timbre: "masculine", voice: "" },
  { text: "5 sur 5 je recois ! Que veux-tu ?", lang: "fr", rate: 1, pitch: 0.8, timbre: "masculine", voice: "" },
  { text: "Owww, ce chat est trop mignon, oops, pardon. Je me concentre, que puis-je faire pour toi ?", lang: "fr", rate: 1.05, pitch: 1.35, timbre: "feminine", voice: "" },
  { text: "Hey, que puis-je faire pour toi ?", lang: "fr", rate: 1, pitch: 1.1, timbre: "feminine", voice: "" },
];

function sanitizePreviewLine(v: unknown): VoicePreview | null {
  // Legacy plain-string lines (first version) still play, neutrally.
  if (typeof v === "string") {
    const text = v.trim();
    if (text.length === 0 || text.length > 500) return null;
    return { text, lang: "auto", rate: 1, pitch: 1, timbre: "any", voice: "" };
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text !== "string") return null;
  const text = o.text.trim();
  if (text.length === 0 || text.length > 500) return null;
  const lang = typeof o.lang === "string" && o.lang.length > 0 && o.lang.length <= 12 ? o.lang : "auto";
  const rate = typeof o.rate === "number" && o.rate >= 0.5 && o.rate <= 2 ? o.rate : 1;
  const pitch = typeof o.pitch === "number" && o.pitch >= 0.5 && o.pitch <= 2 ? o.pitch : 1;
  const timbre = o.timbre === "masculine" || o.timbre === "feminine" ? o.timbre : "any";
  const voice = typeof o.voice === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.voice.trim()) ? o.voice.trim() : "";
  return { text, lang, rate, pitch, timbre, voice };
}

async function getVoicePreviews(): Promise<VoicePreview[]> {
  try {
    const raw = await getSetting("voice_previews", "");
    if (!raw) return DEFAULT_VOICE_PREVIEWS.map((p) => ({ ...p }));
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return DEFAULT_VOICE_PREVIEWS.map((p) => ({ ...p }));
    const clean = arr.map(sanitizePreviewLine).filter((p): p is VoicePreview => p !== null).slice(0, 6);
    return clean.length > 0 ? clean : DEFAULT_VOICE_PREVIEWS.map((p) => ({ ...p }));
  } catch {
    return DEFAULT_VOICE_PREVIEWS.map((p) => ({ ...p }));
  }
}

function sanitizeVoicePreviews(v: unknown): VoicePreview[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 6) return null;
  const clean = v.map(sanitizePreviewLine).filter((p): p is VoicePreview => p !== null);
  return clean.length > 0 ? clean.slice(0, 6) : null;
}

function clientIp(req: Request, server: { requestIP?: (r: Request) => { address: string } | null }): string {
  try {
    const info = server.requestIP?.(req);
    if (info?.address) return info.address;
  } catch {
    // ignore
  }
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function requireAuth(req: Request): Promise<PublicUser | null> {
  const token = extractBearer(req);
  if (!token) return null;
  return verifyToken(token);
}

function validMessages(v: unknown): v is ChatMessage[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 200) return false;
  return v.every(
    (m) =>
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant" || m.role === "system") &&
      typeof m.content === "string" &&
      m.content.length <= 100_000,
  );
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

// Optional free-text fields (report details, admin notes, decision reasons):
// missing or blank → "", otherwise length-checked. Without this, sending ""
// (which is what the frontend does when the field is left empty) would hit
// cleanStr's empty check and wrongly 400 with a "max N chars" error.
function cleanOptionalStr(v: unknown, max: number): string | null {
  if (v === undefined) return "";
  if (typeof v === "string" && v.trim() === "") return "";
  return cleanStr(v, max);
}

function validTheme(v: unknown): v is string {
  return v === "auto" || v === "light" || v === "dark" || v === "sunset";
}

function validAvatar(v: unknown): string | null {
  if (v === "" || v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length > 2048) return null;
  // Local CDN avatar (uploaded via PUT /cdn/…) or remote http(s) URL.
  if (/^\/cdn\/[a-z0-9]{1,16}\/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$/.test(t)) return t;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

function validUsername(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,32}$/.test(t) || t === "admin") return null;
  return t;
}

/** Empty string (unset) or a plausible email address. */
function validEmail(v: unknown): string | null {
  if (v === "" || v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length > 320) return null;
  if (!/^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(t)) return null;
  return t;
}

async function readJson(req: Request): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    return { ok: true, body: (await req.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, body: {} };
  }
}

/** WebSocket -> hub unsubscribe (cleaned up on close). */
const wsUnsub = new WeakMap<object, () => void>();

const server = Bun.serve<{ ticketId: string | null; isAdmin: boolean }>({
  port: config.port,
  hostname: config.host,
  // SSE chat streams can legitimately go silent for a while (cold model load,
  // slow/thinking models). Bun's default 10s idle timeout would kill them
  // mid-generation — disable it (0). Nginx in front has its own timeouts.
  idleTimeout: 0,
  websocket: {
    open(ws) {
      wsUnsub.set(
        ws,
        subscribeAccessLive({
          ticketId: ws.data.ticketId,
          isAdmin: ws.data.isAdmin,
          send: (frame) => {
            try {
              ws.send(frame);
              return true;
            } catch {
              return false;
            }
          },
        }),
      );
    },
    message(ws, msg) {
      // Heartbeat only — clients ping, we pong. Anything else is ignored.
      try {
        const m = JSON.parse(typeof msg === "string" ? msg : Buffer.from(msg as Uint8Array).toString());
        if (m?.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch {
        // malformed frame — ignore
      }
    },
    close(ws) {
      wsUnsub.get(ws)?.();
      wsUnsub.delete(ws);
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- public: shared chat page data (no auth) ---
    const shareMatch = path.match(/^\/api\/share\/([A-Za-z0-9_-]{6,64})$/);
    if (shareMatch && req.method === "GET") {
      const s = await getShareByPublic(shareMatch[1]!);
      if (!s) return json({ error: "share not found" }, 404);
      return json({
        title: s.conv.title,
        topic: s.conv.topic,
        model: s.conv.model,
        authorName: s.authorName,
        authorAvatarUrl: s.authorAvatarUrl,
        archived: s.archived,
        sharedAt: s.sharedAt,
        messages: s.messages.map((m) => ({ role: m.role, content: m.content })),
      });
    }

    // --- public: /wiki redirects to the remote docs wiki (git forge) ---
    if ((path === "/wiki" || path === "/wiki/") && req.method === "GET") {
      return Response.redirect(config.wikiUrl, 302);
    }

    // --- public: local file CDN (avatars today, more namespaces tomorrow) ---
    // GET /cdn/<ns>/<key>.<ext> — serves stored images, nothing else.
    const cdnGet = path.match(/^\/cdn\/([a-z0-9]{1,16})\/([A-Za-z0-9_-]{1,64})\.([a-z0-9]{1,8})$/);
    if (cdnGet && req.method === "GET") {
      const [, ns, key, ext] = cdnGet as [string, string, string, string];
      if (!validNamespace(ns) || !validKey(key) || !validExt(ext)) {
        return new Response("not found", { status: 404 });
      }
      const f = await cdnFile(ns, key, ext);
      if (!f.exists) return new Response("not found", { status: 404 });
      if (ns === "avatar") {
        // Same URL, new bytes after a re-upload: force revalidation (ETag)
        // so the fresh picture shows immediately without a page refresh.
        let etag = "";
        try {
          const st = statSync(f.path);
          etag = `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`;
        } catch {
          // stat failed — serve without ETag
        }
        if (etag && req.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304 });
        }
        return new Response(Bun.file(f.path), {
          headers: {
            "Content-Type": cdnMime(ext),
            "Cache-Control": "no-cache",
            ...(etag ? { ETag: etag } : {}),
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return new Response(Bun.file(f.path), {
        headers: {
          "Content-Type": cdnMime(ext),
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // --- authed (non-/api/): CDN upload ---
    // PUT /cdn/<ns>/<key> with the raw file bytes as body. The stored
    // extension always comes from magic-byte detection, never the client.
    const cdnPut = path.match(/^\/cdn\/([a-z0-9]{1,16})\/([A-Za-z0-9_-]{1,64})$/);
    if (cdnPut && req.method === "PUT") {
      const user = await requireAuth(req);
      if (!user) return json({ error: "unauthorized" }, 401);
      const [, ns, key] = cdnPut as [string, string, string];
      if (!validNamespace(ns) || !validKey(key)) return json({ error: "unknown namespace or key" }, 404);
      const rules = CDN_NAMESPACES[ns]!;
      // Ownership: avatar keys are exactly your account id; text keys must
      // live under your account id prefix. Admin may write for anyone.
      if (!user.isAdmin) {
        if (ns === "avatar" && key !== user.id) return json({ error: "forbidden" }, 403);
        if (ns === "text" && !key.startsWith(user.id)) return json({ error: "forbidden" }, 403);
      }
      const declared = Number(req.headers.get("content-length") || "0");
      const maxMb = (rules.maxBytes / (1024 * 1024)).toFixed(0);
      if (declared > rules.maxBytes) return json({ error: `file too large (max ${maxMb}MB)` }, 413);
      let buf: Uint8Array;
      try {
        buf = new Uint8Array(await req.arrayBuffer());
      } catch {
        return json({ error: "unreadable body" }, 400);
      }
      if (buf.length < 16) return json({ error: "empty file" }, 400);
      if (buf.length > rules.maxBytes) return json({ error: `file too large (max ${maxMb}MB)` }, 413);
      const ext = detectCdnType(ns, buf);
      if (!ext) {
        return json({ error: `unsupported file type: this namespace only accepts ${namespaceAccepts(ns)} (verified by content, not extension)` }, 415);
      }
      const rl = uploadAllowed(user.id, ns);
      if (!rl.ok) {
        return new Response(
          JSON.stringify({ error: `rate limited: ${rules.maxUploads} uploads per ${rules.windowMs / 3600_000}h`, retryAfterSec: rl.retryAfterSec }),
          { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSec) } },
        );
      }
      const url = await writeCdnFile(ns, key, ext, buf);
      recordUpload(user.id, ns);
      return json({ url }, 201);
    }

    // --- auth: login (rate limited) ---
    if (path === "/api/auth/login" && req.method === "POST") {
      const ip = clientIp(req, server);
      if (isRateLimited(ip)) return json({ error: "too many attempts, try again later" }, 429);
      const { ok, body } = await readJson(req);
      if (!ok || typeof body.username !== "string" || typeof body.key !== "string") {
        recordAttempt(ip);
        return json({ error: 'expected { username, key }' }, 400);
      }
      const user = await login(body.username.trim().toLowerCase(), body.key);
      if (!user) {
        recordAttempt(ip);
        await Bun.sleep(400);
        return json({ error: "invalid credentials" }, 401);
      }
      clearAttempts(ip);
      // Second factor: correct key but TOTP enabled -> short-lived challenge,
      // the session is only issued after POST /api/auth/totp verifies a code.
      if (await getTotpSecret(user.id)) {
        const totpToken = await createTotpChallenge(user.id);
        return json({ totpRequired: true, totpToken, username: user.username });
      }
      const { token, expiresAt } = await issueToken(user);
      return json({ token, expiresAt, user });
    }

    // --- auth: TOTP second step (rate limited, challenge is single-use) ---
    if (path === "/api/auth/totp" && req.method === "POST") {
      const ip = clientIp(req, server);
      if (isRateLimited(ip)) return json({ error: "too many attempts, try again later" }, 429);
      const { ok, body } = await readJson(req);
      const userId =
        ok && typeof body.totpToken === "string" ? await consumeTotpChallenge(body.totpToken) : null;
      const code = ok && typeof body.code === "string" ? body.code : "";
      const target = userId ? await getUserById(userId) : null;
      if (!target || !verifyTotp(await getTotpSecret(target.id), code)) {
        recordAttempt(ip);
        await Bun.sleep(400);
        return json({ error: "invalid code" }, 401);
      }
      clearAttempts(ip);
      const { token, expiresAt } = await issueToken(toPublicUser(target));
      return json({ token, expiresAt, user: toPublicUser(target) });
    }

    if (path === "/api/auth/verify" && req.method === "GET") {
      const user = await requireAuth(req);
      return user ? json({ ok: true, user }) : json({ error: "unauthorized" }, 401);
    }

    if (path === "/api/auth/logout" && req.method === "POST") {
      const token = extractBearer(req);
      if (token) await revokeToken(token);
      return json({ ok: true });
    }

    // --- key recovery via email (optional — needs SMTP configured) ---
    if (path === "/api/auth/methods" && req.method === "GET") {
      return json({
        recovery: mailEnabled(),
        from: mailEnabled() ? config.smtpFrom : undefined,
        registration: await isRegistrationEnabled(),
        accessRequest: (await getSetting("registration_request_enabled", "1")) === "1",
      });
    }

    // --- public self-registration (admin can disable it on the fly) ---
    if (path === "/api/auth/register" && req.method === "POST") {
      const ip = clientIp(req, server);
      if (isRateLimited(ip)) return json({ error: "too many attempts, try again later" }, 429);
      if (!await isRegistrationEnabled()) {
        recordAttempt(ip);
        return json({ error: "registration is currently disabled on this platform" }, 403);
      }
      const { ok, body } = await readJson(req);
      if (!ok) {
        recordAttempt(ip);
        return json({ error: "invalid JSON" }, 400);
      }
      const username = validUsername(body.username);
      if (!username) {
        recordAttempt(ip);
        return json({ error: "username: 2-32 chars [a-z0-9._-], 'admin' reserved" }, 400);
      }
      if (await getUserByUsername(username)) {
        recordAttempt(ip);
        return json({ error: "username taken" }, 409);
      }
      const displayName = body.displayName === undefined ? username : cleanStr(body.displayName, 60);
      if (displayName === null) {
        recordAttempt(ip);
        return json({ error: "displayName: 1-60 chars" }, 400);
      }
      const email = body.email === undefined ? "" : validEmail(body.email);
      if (email === null) {
        recordAttempt(ip);
        return json({ error: "invalid email address" }, 400);
      }
      const key = newAccessKey();
      const created = await createUser({ username, displayName, avatarUrl: "", theme: "auto", email, keyHash: hashSecret(key) });
      clearAttempts(ip);
      // Show the raw key exactly once.
      return json({ user: toPublicUser(created), key }, 201);
    }

    if (path === "/api/auth/recover" && req.method === "POST") {
      const ip = clientIp(req, server);
      if (isRateLimited(ip)) return json({ error: "too many attempts, try again later" }, 429);
      // Dedicated recovery envelope (admin-configurable, stricter than
      // login): every hit counts, successes included (anonymous by design).
      const rl = await isRecoveryLimited(ip);
      if (rl.limited) {
        return new Response(
          JSON.stringify({ error: "too many recovery attempts, try again later", retryAfterSec: rl.retryAfterSec }),
          { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSec) } },
        );
      }
      recordRecoveryAttempt(ip);
      const { ok, body } = await readJson(req);
      // Never enumerate accounts: always answer ok.
      if (ok && typeof body.username === "string") {
        const name = body.username.trim().toLowerCase();
        const target = name === "admin" ? null : await getUserByUsername(name);
        if (target && target.email && mailEnabled()) {
          const token = "rt_" + randomBytes(24).toString("base64url");
          await createReset(createHash("sha256").update(token).digest("hex"), target.id, Date.now() + config.resetTtlMs);
          sendRecoveryEmail(target.email, target.username, `${config.appUrl}/reset/${token}`).catch(() => {});
          clearAttempts(ip);
          return json({ ok: true });
        }
      }
      recordAttempt(ip);
      await Bun.sleep(400);
      return json({ ok: true });
    }

    const resetMatch = path.match(/^\/api\/auth\/reset\/([A-Za-z0-9_-]{6,80})$/);
    if (resetMatch) {
      const ip = clientIp(req, server);
      const rl = await isRecoveryLimited(ip);
      if (rl.limited) {
        return new Response(
          JSON.stringify({ error: "too many recovery attempts, try again later", retryAfterSec: rl.retryAfterSec }),
          { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSec) } },
        );
      }
      recordRecoveryAttempt(ip);
      const tokenHash = createHash("sha256").update(resetMatch[1]!).digest("hex");
      if (req.method === "GET") {
        const r = await peekReset(tokenHash);
        const u = r ? await getUserById(r.user_id) : null;
        if (!r || !u) return json({ error: "invalid or expired link" }, 404);
        return json({ ok: true, username: u.username });
      }
      if (req.method === "POST") {
        const r = await consumeReset(tokenHash);
        const u = r ? await getUserById(r.user_id) : null;
        if (!r || !u || u.username === "admin") return json({ error: "invalid or expired link" }, 404);
        // Recovery = instant key rotation; the new key is shown exactly once.
        const key = newAccessKey();
        await updateUser(u.id, { keyHash: hashSecret(key) });
        await deleteUserSessions(u.id);
        return json({ key });
      }
    }

    // --- access-request wishlist (public ticket system, email-notified) ---
    // Reserve a username + email with a motivation; triaged in the AdminCenter.
    if (path === "/api/access/request" && req.method === "POST") {
      const ip = clientIp(req, server);
      if (isRateLimited(ip)) return json({ error: "too many attempts, try again later" }, 429);
      // Wishlist is mutually exclusive with open registration: when anyone
      // can register, there is nothing to request.
      if ((await isRegistrationEnabled()) || (await getSetting("registration_request_enabled", "1")) !== "1") {
        recordAttempt(ip);
        return json({ error: "access requests are currently disabled on this platform" }, 403);
      }
      const { ok, body } = await readJson(req);
      if (!ok) {
        recordAttempt(ip);
        return json({ error: "invalid JSON" }, 400);
      }
      const username = validUsername(body.username);
      const email = validEmail(body.email);
      const message = cleanStr(body.message, 2000);
      if (!username || !email || !message || message.length < 10) {
        recordAttempt(ip);
        return json({ error: "username (2-32 chars), valid email and a motivation (10+ chars) are required" }, 400);
      }
      if (await getUserByUsername(username)) {
        recordAttempt(ip);
        return json({ error: "username taken" }, 409);
      }
      if (await findOpenAccessRequest(username, email)) {
        recordAttempt(ip);
        return json({ error: "a request for this username or email is already open" }, 409);
      }
      const created = await createAccessRequest({ username, email, message });
      const firstMsg = await addAccessMessage(created.id, "user", message);
      clearAttempts(ip);
      // One event carries the whole creation (ticket + its first message):
      // subscribers apply it directly, no HTTP refetch. No ticket socket
      // can exist for this id yet, so nothing needs the message separately.
      broadcastAccessLive({ type: "access_created", request_id: created.id, request: created, message: firstMsg, message_count: 1 });
      // Ticket page: /review/<uuid> (unguessable, same pattern as share links).
      const reviewUrl = `${config.appUrl}/review/${created.id}`;
      sendAccessReceivedEmail(email, username, reviewUrl).catch(() => {});
      return json({ request: created, reviewUrl }, 201);
    }

    const ticketMatch = path.match(/^\/api\/access\/ticket\/([0-9a-f-]{36})(\/message)?$/);
    if (ticketMatch) {
      const r = await getAccessRequest(ticketMatch[1]!);
      if (!r) return json({ error: "invalid ticket link" }, 404);
      if (req.method === "GET" && !ticketMatch[2]) {
        return json({ request: r, messages: await listAccessMessages(r.id) });
      }
      if (req.method === "POST" && ticketMatch[2] === "/message") {
        const ip = clientIp(req, server);
        if (isRateLimited(ip)) return json({ error: "too many attempts, try again later" }, 429);
        if (r.status === "accepted" || r.status === "refused") {
          return json({ error: "ticket closed" }, 403);
        }
        const { ok, body } = await readJson(req);
        const text = ok ? cleanStr(body.body, 2000) : null;
        if (!text) {
          recordAttempt(ip);
          return json({ error: "message: 1-2000 chars" }, 400);
        }
        const msg = await addAccessMessage(r.id, "user", text);
        clearAttempts(ip);
        broadcastAccessLive({ type: "access_message", request_id: r.id, message: msg });
        return json({ message: msg }, 201);
      }
      return json({ error: "not found" }, 404);
    }

    // --- live access-request updates (WebSocket, replaces HTTP polling) ---
    // Ticket socket: capability auth by unguessable UUID, exactly like
    // GET /api/access/ticket/:id above. Admin socket: admin Bearer via
    // ?token= (browsers can't set WS headers) or Authorization header.
    const ticketWsMatch = path.match(/^\/api\/access\/ws\/([0-9a-f-]{36})$/);
    if (ticketWsMatch && req.method === "GET") {
      const t = await getAccessRequest(ticketWsMatch[1]!);
      if (!t) return json({ error: "invalid ticket link" }, 404);
      if (server.upgrade(req, { data: { ticketId: t.id, isAdmin: false } })) return;
      return json({ error: "websocket upgrade failed" }, 500);
    }
    if (path === "/api/admin/ws" && req.method === "GET") {
      const token = url.searchParams.get("token") ?? extractBearer(req);
      const u = token ? await verifyToken(token) : null;
      if (!u?.isAdmin) return json({ error: "unauthorized" }, 401);
      if (server.upgrade(req, { data: { ticketId: null, isAdmin: true } })) return;
      return json({ error: "websocket upgrade failed" }, 500);
    }

    // --- everything below requires auth ---
    if (path.startsWith("/api/")) {
      const user = await requireAuth(req);
      if (!user) return json({ error: "unauthorized" }, 401);
      const admin = user.isAdmin;

      // --- self profile ---
      if (path === "/api/me" && req.method === "GET") return json({ user });

      if (path === "/api/me" && req.method === "PATCH") {
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const patch: { username?: string; displayName?: string; avatarUrl?: string; theme?: string; email?: string } = {};
        if (body.username !== undefined) {
          // No-op when unchanged (settings forms send the whole profile):
          // don't fail the entire save for the admin account when the
          // username field just echoes the current value.
          const raw = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
          if (raw !== user.username) {
            if (user.username === "admin") return json({ error: "the admin account cannot be renamed" }, 403);
            if (!await isUsernameChangeEnabled()) return json({ error: "username changes are disabled" }, 403);
            const u = validUsername(body.username);
            if (!u) return json({ error: "username: 2-32 chars [a-z0-9._-], 'admin' reserved" }, 400);
            const taken = await getUserByUsername(u);
            if (taken && taken.id !== user.id) return json({ error: "username taken" }, 409);
            patch.username = u;
          }
        }
        if (body.displayName !== undefined) {
          const d = cleanStr(body.displayName, 60);
          if (d === null) return json({ error: "displayName: 1-60 chars" }, 400);
          patch.displayName = d;
        }
        if (body.avatarUrl !== undefined) {
          const a = validAvatar(body.avatarUrl);
          if (a === null) return json({ error: "avatarUrl must be an http(s) URL or empty (e.g. catbox.moe link)" }, 400);
          patch.avatarUrl = a;
        }
        if (body.theme !== undefined) {
          if (!validTheme(body.theme)) return json({ error: "theme must be auto|light|dark|sunset" }, 400);
          patch.theme = body.theme;
        }
        if (body.email !== undefined) {
          const e = validEmail(body.email);
          if (e === null) return json({ error: "invalid email address" }, 400);
          patch.email = e;
        }
        const updated = await updateUser(user.id, patch);
        if (!updated) return json({ error: "user not found" }, 404);
        return json({ user: toPublicUser(updated) });
      }

      // --- self-service security: rotate access key (old sessions revoked) ---
      if (path === "/api/me/key/rotate" && req.method === "POST") {
        const key = newAccessKey();
        await updateUser(user.id, { keyHash: hashSecret(key) });
        await deleteUserSessions(user.id);
        return json({ key });
      }

      // --- self-service: delete your own account (chats, shares, sessions gone) ---
      if (path === "/api/me" && req.method === "DELETE") {
        if (user.username === "admin") return json({ error: "the admin account cannot be deleted" }, 403);
        await deleteUser(user.id);
        await deleteTotpChallenges(user.id);
        return json({ ok: true });
      }

      // --- self-service security: TOTP two-factor ---
      if (path === "/api/me/totp" && req.method === "GET") {
        return json({ enabled: (await getTotpSecret(user.id)).length > 0 });
      }
      if (path === "/api/me/totp/setup" && req.method === "POST") {
        if (await getTotpSecret(user.id)) return json({ error: "TOTP already enabled — disable it first" }, 409);
        const secret = newTotpSecret();
        return json({ secret, otpauthUrl: totpAuthUrl(secret, user.username) });
      }
      if (path === "/api/me/totp/verify" && req.method === "POST") {
        const { ok, body } = await readJson(req);
        const secret = ok && typeof body.secret === "string" ? body.secret : "";
        const code = ok && typeof body.code === "string" ? body.code : "";
        if (!/^[A-Z2-7]{16,64}$/.test(secret.trim().toUpperCase())) return json({ error: "invalid secret" }, 400);
        if (!verifyTotp(secret, code)) return json({ error: "invalid code" }, 401);
        await setTotpSecret(user.id, secret.trim().toUpperCase());
        return json({ enabled: true });
      }
      if (path === "/api/me/totp" && req.method === "DELETE") {
        const { ok, body } = await readJson(req);
        const code = ok && typeof body.code === "string" ? body.code : "";
        if (!verifyTotp(await getTotpSecret(user.id), code)) return json({ error: "invalid code" }, 401);
        await setTotpSecret(user.id, "");
        return json({ enabled: false });
      }

      // --- self-service: personal LLM providers (BYOK) ---
      // Keys are stored server-side and never returned: GET only exposes
      // presence + last4. Connected providers add their models to this
      // user's /api/models list and /api/chat honors the personal key.
      if (path === "/api/me/providers" && req.method === "GET") {
        return json({ providers: await listUserProviders(user.id) });
      }

      const providerMatch = path.match(/^\/api\/me\/providers\/([a-z]{3,12})$/);
      if (providerMatch) {
        const pid = providerMatch[1]!;
        if (!isUserProviderId(pid)) {
          return json({ error: "unknown provider (openai|anthropic|deepseek|gemini)" }, 400);
        }
        const provider = pid as UserProviderId;
        if (req.method === "PUT") {
          const { ok, body } = await readJson(req);
          const key = ok ? validProviderKey(body.apiKey) : null;
          if (!key) return json({ error: "apiKey: 8-256 chars, no whitespace" }, 400);
          await setUserProviderKey(user.id, provider, key);
          return json({ providers: await listUserProviders(user.id) });
        }
        if (req.method === "DELETE") {
          await deleteUserProviderKey(user.id, provider);
          return json({ providers: await listUserProviders(user.id) });
        }
        return json({ error: "not found" }, 404);
      }

      // --- admin: user management (No-KYC accounts, keys issued by admin) ---
      if (path === "/api/admin/users" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        // Listing with search / sort / filter / pagination for the Admin Center.
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const sort = url.searchParams.get("sort") || "newest";
        const filter = url.searchParams.get("filter") || "all"; // all | with-email | no-email
        const per = Math.min(Math.max(Number(url.searchParams.get("per")) || 10, 1), 50);
        const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
        let users = await listUsers();
        if (q) {
          users = users.filter(
            (u) =>
              u.username.includes(q) ||
              u.display_name.toLowerCase().includes(q) ||
              (u.email || "").toLowerCase().includes(q),
          );
        }
        if (filter === "with-email") users = users.filter((u) => u.email);
        else if (filter === "no-email") users = users.filter((u) => !u.email);
        const sorts: Record<string, (a: (typeof users)[number], b: (typeof users)[number]) => number> = {
          newest: (a, b) => b.created_at - a.created_at,
          oldest: (a, b) => a.created_at - b.created_at,
          az: (a, b) => a.username.localeCompare(b.username),
          za: (a, b) => b.username.localeCompare(a.username),
        };
        users.sort(sorts[sort] ?? sorts.newest);
        const total = users.length;
        const pages = Math.max(1, Math.ceil(total / per));
        const safePage = Math.min(page, pages);
        const slice = users.slice((safePage - 1) * per, safePage * per);
        return json({ users: slice.map(toPublicUser), total, page: safePage, perPage: per, pages });
      }

      if (path === "/api/admin/users" && req.method === "POST") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const username = validUsername(body.username);
        if (!username) return json({ error: "username: 2-32 chars [a-z0-9._-], 'admin' reserved" }, 400);
        if (await getUserByUsername(username)) return json({ error: "username taken" }, 409);
        const displayName = body.displayName === undefined ? username : cleanStr(body.displayName, 60);
        if (displayName === null) return json({ error: "displayName: 1-60 chars" }, 400);
        const avatarUrl = body.avatarUrl === undefined ? "" : validAvatar(body.avatarUrl);
        if (avatarUrl === null) return json({ error: "avatarUrl must be an http(s) URL or empty" }, 400);
        const theme = body.theme === undefined ? "auto" : body.theme;
        if (!validTheme(theme)) return json({ error: "theme must be auto|light|dark|sunset" }, 400);
        const email = body.email === undefined ? "" : validEmail(body.email);
        if (email === null) return json({ error: "invalid email address" }, 400);
        const key = newAccessKey();
        const created = await createUser({ username, displayName, avatarUrl, theme, email, keyHash: hashSecret(key) });
        // Show the raw key exactly once.
        return json({ user: toPublicUser(created), key }, 201);
      }

      const adminUserMatch = path.match(/^\/api\/admin\/users\/([0-9a-f-]{10,50})(\/regenerate|\/shadowban)?$/);
      if (adminUserMatch) {
        if (!admin) return json({ error: "forbidden" }, 403);
        const target = await getUserById(adminUserMatch[1]!);
        if (!target || target.username === "admin") return json({ error: "user not found" }, 404);
        if (req.method === "DELETE" && !adminUserMatch[2]) {
          await deleteUser(target.id);
          return json({ ok: true });
        }
        if (req.method === "POST" && adminUserMatch[2] === "/regenerate") {
          const key = newAccessKey();
          await updateUser(target.id, { keyHash: hashSecret(key) });
          await deleteUserSessions(target.id);
          return json({ key });
        }
        if (req.method === "POST" && adminUserMatch[2] === "/shadowban") {
          const { ok, body } = await readJson(req);
          if (!ok || typeof body.shadowbanned !== "boolean") {
            return json({ error: "expected { shadowbanned: boolean }" }, 400);
          }
          return json({ shadowbanned: (await setReportShadowbanned(target.id, body.shadowbanned)) === 1 });
        }
        if (req.method === "PATCH" && !adminUserMatch[2]) {
          const { ok, body } = await readJson(req);
          if (!ok) return json({ error: "invalid JSON" }, 400);
          const patch: { username?: string; displayName?: string; avatarUrl?: string; theme?: string; email?: string } = {};
          if (body.username !== undefined) {
            const raw = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
            if (raw !== target.username) {
              if (target.username === "admin") return json({ error: "the admin account cannot be renamed" }, 403);
              const u = validUsername(body.username);
              if (!u) return json({ error: "username: 2-32 chars [a-z0-9._-], 'admin' reserved" }, 400);
              const taken = await getUserByUsername(u);
              if (taken && taken.id !== target.id) return json({ error: "username taken" }, 409);
              patch.username = u;
            }
          }
          if (body.displayName !== undefined) {
            const d = cleanStr(body.displayName, 60);
            if (d === null) return json({ error: "displayName: 1-60 chars" }, 400);
            patch.displayName = d;
          }
          if (body.avatarUrl !== undefined) {
            const a = validAvatar(body.avatarUrl);
            if (a === null) return json({ error: "avatarUrl must be an http(s) URL or empty" }, 400);
            patch.avatarUrl = a;
          }
          if (body.theme !== undefined) {
          if (!validTheme(body.theme)) return json({ error: "theme must be auto|light|dark|sunset" }, 400);
            patch.theme = body.theme;
          }
          if (body.email !== undefined) {
            const e = validEmail(body.email);
            if (e === null) return json({ error: "invalid email address" }, 400);
            patch.email = e;
          }
          const updated = await updateUser(target.id, patch);
          return json({ user: toPublicUser(updated!) });
        }
        return json({ error: "not found" }, 404);
      }

      // --- admin: platform settings (feature flags) ---
      if (path === "/api/admin/settings" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        return json({
          settings: {
            registrationEnabled: await isRegistrationEnabled(),
            accessRequestEnabled: (await getSetting("registration_request_enabled", "1")) === "1",
            ocrEnabled: (await getSetting("tools_ocr_enabled", "1")) === "1",
            reportsEnabled: await isReportsEnabled(),
            usernameChangeEnabled: await isUsernameChangeEnabled(),
            ollamaTimeoutS: Math.round(await getOllamaTimeoutMs() / 1000),
            ollamaDefaultWeight: await getOllamaDefaultWeight(),
            recoveryLimitMax: await recoveryLimitMax(),
            recoveryLimitWindowMin: Math.round(await recoveryLimitWindowMs() / 60_000),
            voicePreviews: await getVoicePreviews(),
            ttsEnabled: (await getSetting("tools_tts_enabled", "1")) === "1",
          },
        });
      }

      if (path === "/api/admin/settings" && req.method === "PATCH") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        if (body.registrationEnabled !== undefined) {
          if (typeof body.registrationEnabled !== "boolean") return json({ error: "registrationEnabled must be boolean" }, 400);
          await setSetting("registration_enabled", body.registrationEnabled ? "1" : "0");
          // Opening registration retires the wishlist automatically.
          if (body.registrationEnabled) await setSetting("registration_request_enabled", "0");
        }
        if (body.accessRequestEnabled !== undefined) {
          if (typeof body.accessRequestEnabled !== "boolean") return json({ error: "accessRequestEnabled must be boolean" }, 400);
          // Mutually exclusive with open registration: the wishlist only
          // makes sense when anyone-can-register is off.
          if (body.accessRequestEnabled && (body.registrationEnabled ?? await isRegistrationEnabled())) {
            return json({ error: "disable public registration first — the wishlist replaces it" }, 409);
          }
          await setSetting("registration_request_enabled", body.accessRequestEnabled ? "1" : "0");
        }
        if (body.ocrEnabled !== undefined) {
          if (typeof body.ocrEnabled !== "boolean") return json({ error: "ocrEnabled must be boolean" }, 400);
          await setSetting("tools_ocr_enabled", body.ocrEnabled ? "1" : "0");
        }
        if (body.reportsEnabled !== undefined) {
          if (typeof body.reportsEnabled !== "boolean") return json({ error: "reportsEnabled must be boolean" }, 400);
          await setSetting("reports_enabled", body.reportsEnabled ? "1" : "0");
        }
        if (body.usernameChangeEnabled !== undefined) {
          if (typeof body.usernameChangeEnabled !== "boolean") return json({ error: "usernameChangeEnabled must be boolean" }, 400);
          await setSetting("username_change_enabled", body.usernameChangeEnabled ? "1" : "0");
        }
        if (body.ollamaTimeoutS !== undefined) {
          if (!Number.isInteger(body.ollamaTimeoutS) || (body.ollamaTimeoutS as number) < 5 || (body.ollamaTimeoutS as number) > 3600) {
            return json({ error: "ollamaTimeoutS must be an integer 5-3600 (seconds)" }, 400);
          }
          await setSetting("ollama_timeout_s", String(body.ollamaTimeoutS));
        }
        if (body.ollamaDefaultWeight !== undefined) {
          if (!Number.isInteger(body.ollamaDefaultWeight) || (body.ollamaDefaultWeight as number) < 0 || (body.ollamaDefaultWeight as number) > 1000) {
            return json({ error: "ollamaDefaultWeight must be an integer 0-1000 (0 = never use the default node)" }, 400);
          }
          await setSetting("ollama_default_weight", String(body.ollamaDefaultWeight));
        }
        if (body.recoveryLimitMax !== undefined) {
          if (!Number.isInteger(body.recoveryLimitMax) || (body.recoveryLimitMax as number) < 1 || (body.recoveryLimitMax as number) > 100) {
            return json({ error: "recoveryLimitMax must be an integer 1-100" }, 400);
          }
          await setSetting("recovery_limit_max", String(body.recoveryLimitMax));
        }
        if (body.recoveryLimitWindowMin !== undefined) {
          if (!Number.isInteger(body.recoveryLimitWindowMin) || (body.recoveryLimitWindowMin as number) < 1 || (body.recoveryLimitWindowMin as number) > 1440) {
            return json({ error: "recoveryLimitWindowMin must be an integer 1-1440 (minutes)" }, 400);
          }
          await setSetting("recovery_limit_window_min", String(body.recoveryLimitWindowMin));
        }
        if (body.voicePreviews !== undefined) {
          if (Array.isArray(body.voicePreviews) && body.voicePreviews.length === 0) {
            // Empty array = reset to the built-in default lines.
            await setSetting("voice_previews", "");
          } else {
            const clean = sanitizeVoicePreviews(body.voicePreviews);
            if (!clean) return json({ error: "voicePreviews must be 1-6 lines {text, lang?, rate?, pitch?, timbre?, voice?}, or [] to reset" }, 400);
            await setSetting("voice_previews", JSON.stringify(clean));
          }
        }
        if (body.ttsEnabled !== undefined) {
          if (typeof body.ttsEnabled !== "boolean") return json({ error: "ttsEnabled must be boolean" }, 400);
          await setSetting("tools_tts_enabled", body.ttsEnabled ? "1" : "0");
        }
        return json({
          settings: {
            registrationEnabled: await isRegistrationEnabled(),
            accessRequestEnabled: (await getSetting("registration_request_enabled", "1")) === "1",
            ocrEnabled: (await getSetting("tools_ocr_enabled", "1")) === "1",
            reportsEnabled: await isReportsEnabled(),
            usernameChangeEnabled: await isUsernameChangeEnabled(),
            ollamaTimeoutS: Math.round(await getOllamaTimeoutMs() / 1000),
            ollamaDefaultWeight: await getOllamaDefaultWeight(),
            recoveryLimitMax: await recoveryLimitMax(),
            recoveryLimitWindowMin: Math.round(await recoveryLimitWindowMs() / 60_000),
            voicePreviews: await getVoicePreviews(),
            ttsEnabled: (await getSetting("tools_tts_enabled", "1")) === "1",
          },
        });
      }

      // --- admin: Ollama model management (connectivity probe, pull from the library, delete) ---
      // Connectivity probe: is the Ollama host reachable, which version,
      // and what sits on its disk (name + bytes + modification time).
      // Always 200 for admins (reachability is data, not an error code).
      if (path === "/api/admin/ollama/status" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const host = ollamaDriver.host;
        if (!ollamaDriver.enabled) {
          return json({ enabled: false, host, reachable: false, version: null, latencyMs: null, models: [], error: "ollama driver is disabled" });
        }
        const t0 = Date.now();
        try {
          const verRes = await fetch(`${host}/api/version`, { signal: AbortSignal.timeout(8000) });
          if (!verRes.ok) {
            return json({ enabled: true, host, reachable: false, version: null, latencyMs: Date.now() - t0, models: [], error: `ollama /api/version failed: ${verRes.status}` });
          }
          const ver = (await verRes.json().catch(() => ({}))) as { version?: unknown };
          const tagsRes = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(8000) });
          if (!tagsRes.ok) {
            return json({ enabled: true, host, reachable: false, version: typeof ver.version === "string" ? ver.version : null, latencyMs: Date.now() - t0, models: [], error: `ollama /api/tags failed: ${tagsRes.status}` });
          }
          const tags = (await tagsRes.json().catch(() => ({}))) as { models?: { name?: unknown; size?: unknown; modified_at?: unknown }[] };
          const models = Array.isArray(tags.models)
            ? tags.models
                .filter((m) => typeof m.name === "string")
                .map((m) => ({
                  name: m.name as string,
                  size: typeof m.size === "number" ? m.size : 0,
                  modifiedAt: typeof m.modified_at === "string" ? (m.modified_at as string) : null,
                }))
            : [];
          return json({
            enabled: true,
            host,
            reachable: true,
            version: typeof ver.version === "string" ? ver.version : null,
            latencyMs: Date.now() - t0,
            models,
            error: null,
          });
        } catch (e) {
          return json({ enabled: true, host, reachable: false, version: null, latencyMs: Date.now() - t0, models: [], error: (e as Error).message });
        }
      }

      // Pull streams Ollama's NDJSON progress straight to the admin client.
      if (path === "/api/admin/ollama/pull" && req.method === "POST") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!/^[a-z0-9._:\/-]{1,100}$/i.test(name)) return json({ error: "invalid model name" }, 400);
        if (!ollamaDriver.enabled) return json({ error: "ollama driver is disabled" }, 502);
        // Target node for the pull (library tags AND hf.co/... references).
        let pullHost = ollamaDriver.host;
        if (body.nodeId !== undefined) {
          if (typeof body.nodeId !== "string") return json({ error: "nodeId must be a string" }, 400);
          try {
            pullHost = (await resolveOllamaHost(body.nodeId === DEFAULT_NODE_ID ? undefined : body.nodeId)).host;
          } catch {
            return json({ error: "unknown ollama node" }, 404);
          }
        }
        const abortUpstream = new AbortController();
        const onClientAbort = () => abortUpstream.abort();
        req.signal.addEventListener("abort", onClientAbort);
        let clientGone = false;
        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (obj: unknown): boolean => {
              if (clientGone || req.signal.aborted) return false;
              try {
                controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
                return true;
              } catch {
                clientGone = true;
                return false;
              }
            };
            try {
              const res = await fetch(`${pullHost}/api/pull`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: name, stream: true }),
                signal: abortUpstream.signal,
              });
              if (!res.ok || !res.body) {
                const errText = await res.text().catch(() => "");
                send({ error: `ollama /api/pull failed: ${res.status}${errText ? ` — ${errText.slice(0, 200)}` : ""}` });
                return;
              }
              // Passthrough of the NDJSON progress lines (status/digest/completed/total).
              const dec = new TextDecoder();
              let buf = "";
              let pulledOk = true;
              for await (const chunk of res.body) {
                if (req.signal.aborted) { pulledOk = false; break; }
                buf += dec.decode(chunk, { stream: true });
                let nl: number;
                while ((nl = buf.indexOf("\n")) >= 0) {
                  const line = buf.slice(0, nl).trim();
                  buf = buf.slice(nl + 1);
                  if (line && !send(JSON.parse(line))) { pulledOk = false; break; }
                }
                if (!pulledOk) break;
              }
              // A new model landed on the Ollama host: drop the cached list
              // so the next user request picks it up (subject to TTL).
              if (pulledOk && !req.signal.aborted) registry.invalidateModelsCache();
              send({ status: "done" });
            } catch (e) {
              if (!req.signal.aborted && !clientGone) send({ error: (e as Error).message });
            } finally {
              req.signal.removeEventListener("abort", onClientAbort);
              abortUpstream.abort();
              if (!clientGone) {
                try { controller.close(); } catch { /* already closed */ }
              }
            }
          },
          cancel() {
            clientGone = true;
            abortUpstream.abort();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
        });
      }

      // Admin-only model removal (frees disk on the Ollama host).
      const ollamaDeleteMatch = path.match(/^\/api\/admin\/ollama\/models\/([a-z0-9._:\/-]{1,100})$/i);
      if (ollamaDeleteMatch && req.method === "DELETE") {
        if (!admin) return json({ error: "forbidden" }, 403);
        if (!ollamaDriver.enabled) return json({ error: "ollama driver is disabled" }, 502);
        const nodeParam = url.searchParams.get("node");
        let deleteHost = ollamaDriver.host;
        if (nodeParam) {
          try {
            deleteHost = (await resolveOllamaHost(nodeParam === DEFAULT_NODE_ID ? undefined : nodeParam)).host;
          } catch {
            return json({ error: "unknown ollama node" }, 404);
          }
        }
        try {
          const res = await fetch(`${deleteHost}/api/delete`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: ollamaDeleteMatch[1] }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) return json({ error: `ollama /api/delete failed: ${res.status}` }, 502);
          registry.invalidateModelsCache();
          return json({ ok: true });
        } catch (e) {
          return json({ error: (e as Error).message }, 502);
        }
      }

      // --- content reports (flagged AI responses) ---
      if (path === "/api/reports" && req.method === "POST") {
        if (!await isReportsEnabled()) return json({ error: "reports are disabled" }, 403);
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const reason = body.reason as ReportReason | undefined;
        if (!reason || !(REPORT_REASONS as readonly string[]).includes(reason)) {
          return json({ error: "reason must be copyright|gore|falseinfo|bug" }, 400);
        }
        const details = cleanOptionalStr(body.details, 2000);
        if (details === null) return json({ error: "details: max 2000 chars" }, 400);
        const clientContent = typeof body.content === "string" ? body.content.slice(0, 20000) : "";
        const clientPrompt = typeof body.prompt === "string" ? body.prompt.slice(0, 20000) : "";
        const clientModel = typeof body.model === "string" ? body.model.slice(0, 160) : "";
        let conversationId = "";
        let messageIndex = -1;
        if (body.conversationId !== undefined) {
          if (typeof body.conversationId !== "string" || !body.conversationId) {
            return json({ error: "bad conversationId" }, 400);
          }
          const conv = await getConversation(body.conversationId);
          if (!conv || conv.user_id !== user.id) return json({ error: "conversation not found" }, 404);
          conversationId = conv.id;
          if (body.messageIndex !== undefined) {
            if (!Number.isInteger(body.messageIndex) || (body.messageIndex as number) < 0) {
              return json({ error: "bad messageIndex" }, 400);
            }
            messageIndex = body.messageIndex as number;
          }
        }
        try {
          const report = await createReport({
            reporterId: user.id,
            reporterName: user.displayName,
            conversationId,
            messageIndex,
            reason,
            details,
            clientContent,
            clientPrompt,
            clientModel,
          });
          broadcastAccessLive({ type: "report_created", report });
          return json({ report }, 201);
        } catch (e) {
          if ((e as Error).message === "TOO_MANY_OPEN") return json({ error: "too many open reports" }, 429);
          if ((e as Error).message === "ALREADY_REPORTED") {
            return json({ error: "already reported", report: (e as Error & { report: unknown }).report }, 409);
          }
          throw e;
        }
      }

      if (path === "/api/admin/reports" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        return json({ reports: await listReports() });
      }

      const reportMatch = path.match(/^\/api\/admin\/reports\/([0-9a-f-]{36})$/);
      if (reportMatch) {
        if (!admin) return json({ error: "forbidden" }, 403);
        const target = await getReport(reportMatch[1]!);
        if (!target) return json({ error: "report not found" }, 404);
        if (req.method === "PATCH") {
          const { ok, body } = await readJson(req);
          if (!ok) return json({ error: "invalid JSON" }, 400);
          const status = body.status as ReportStatus | undefined;
          if (!status || !(REPORT_STATUSES as readonly string[]).includes(status)) {
            return json({ error: "status must be open|reviewing|resolved|dismissed" }, 400);
          }
          const adminNote = cleanOptionalStr(body.adminNote, 1000);
          if (adminNote === null) return json({ error: "adminNote: max 1000 chars" }, 400);
          const updated = await setReportStatus(target.id, status, adminNote);
          if (updated) broadcastAccessLive({ type: "report_status", report: updated });
          return json({ report: updated });
        }
      }

      // --- admin: per-model access policy (kill-switch + rate limits) ---
      if (path === "/api/admin/model-policy" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        if (/^(1|true|yes)$/i.test(url.searchParams.get("refresh") ?? "")) {
          registry.invalidateModelsCache();
        }
        // Full list (policy never hides models from admins) merged with policy.
        const models = await registry.listAllModelsCached();
        const policy = await getModelPolicy();
        return json({
          models: models.map((m) => ({ ...m, ...policyFor(policy, m.id) })),
        });
      }

      if (path === "/api/admin/model-policy" && req.method === "PATCH") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const b = body as { model?: unknown; enabled?: unknown; hourly?: unknown; daily?: unknown };
        if (typeof b.model !== "string" || b.model.length < 3 || b.model.length > 200 || !b.model.includes(":")) {
          return json({ error: 'model must look like "driver:model"' }, 400);
        }
        if (b.enabled === undefined && b.hourly === undefined && b.daily === undefined) {
          return json({ error: "nothing to update (enabled, hourly, daily)" }, 400);
        }
        try {
          const entry = await setModelPolicyEntry(b.model, {
            enabled: b.enabled as boolean | undefined,
            hourly: b.hourly as number | undefined,
            daily: b.daily as number | undefined,
          });
          return json({ model: { id: b.model, ...entry } });
        } catch {
          return json({ error: "enabled must be boolean, hourly/daily integers 0-1000000" }, 400);
        }
      }

      // --- admin: ollama nodes (multi-host pool, firewall-like weights) ---
      if (path === "/api/admin/ollama/nodes" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        return json({ nodes: await listOllamaNodes(), effective: await effectiveOllamaNodes() });
      }

      if (path === "/api/admin/ollama/nodes" && req.method === "POST") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const name = sanitizeNodeName(body.name);
        const host = sanitizeNodeHost(body.host);
        const weight = sanitizeWeight(body.weight ?? 100);
        if (!name) return json({ error: "name: 1-60 chars" }, 400);
        if (!host) return json({ error: "host: http(s) base URL without path (e.g. http://10.0.0.5:11434)" }, 400);
        if (weight === null) return json({ error: "weight: integer 0-1000" }, 400);
        if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
          return json({ error: "enabled must be boolean" }, 400);
        }
        try {
          const node = await createOllamaNode({ name, host, weight, enabled: body.enabled ?? true });
          registry.invalidateModelsCache();
          return json({ node }, 201);
        } catch (e) {
          if ((e as Error).message === "HOST_TAKEN") return json({ error: "this host is already registered" }, 409);
          throw e;
        }
      }

      const nodeMatch = path.match(/^\/api\/admin\/ollama\/nodes\/([A-Za-z0-9_-]{1,64})$/);
      if (nodeMatch && !path.endsWith("/status") && !path.endsWith("/stats")) {
        if (!admin) return json({ error: "forbidden" }, 403);
        const id = nodeMatch[1]!;
        if (id === DEFAULT_NODE_ID) return json({ error: "the default node comes from OLLAMA_HOST and cannot be edited here" }, 400);
        if (req.method === "DELETE") {
          if (!await deleteOllamaNode(id)) return json({ error: "node not found" }, 404);
          registry.invalidateModelsCache();
          return json({ ok: true });
        }
        if (req.method === "PATCH") {
          const { ok, body } = await readJson(req);
          if (!ok) return json({ error: "invalid JSON" }, 400);
          const patch: { name?: string; host?: string; weight?: number; enabled?: boolean } = {};
          if (body.name !== undefined) {
            const name = sanitizeNodeName(body.name);
            if (!name) return json({ error: "name: 1-60 chars" }, 400);
            patch.name = name;
          }
          if (body.host !== undefined) {
            const host = sanitizeNodeHost(body.host);
            if (!host) return json({ error: "host: http(s) base URL without path" }, 400);
            patch.host = host;
          }
          if (body.weight !== undefined) {
            const weight = sanitizeWeight(body.weight);
            if (weight === null) return json({ error: "weight: integer 0-1000" }, 400);
            patch.weight = weight;
          }
          if (body.enabled !== undefined) {
            if (typeof body.enabled !== "boolean") return json({ error: "enabled must be boolean" }, 400);
            patch.enabled = body.enabled;
          }
          try {
            const updated = await updateOllamaNode(id, patch);
            if (!updated) return json({ error: "node not found" }, 404);
            registry.invalidateModelsCache();
            return json({ node: updated });
          } catch (e) {
            if ((e as Error).message === "HOST_TAKEN") return json({ error: "this host is already registered" }, 409);
            throw e;
          }
        }
        return json({ error: "not found" }, 404);
      }

      // Per-node live probe: version, latency, on-disk models, running models
      // (/api/ps — the only load signal Ollama exposes, with VRAM usage).
      const nodeStatusMatch = path.match(/^\/api\/admin\/ollama\/nodes\/([A-Za-z0-9_-]{1,64})\/status$/);
      if (nodeStatusMatch && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        let host: string;
        try {
          host = (await resolveOllamaHost(nodeStatusMatch[1] === DEFAULT_NODE_ID ? undefined : nodeStatusMatch[1])).host;
        } catch {
          return json({ error: "unknown ollama node" }, 404);
        }
        return json(await probeOllamaHost(host));
      }

      // Probe an arbitrary (not yet registered) host from the node form.
      if (path === "/api/admin/ollama/probe" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const host = sanitizeNodeHost(url.searchParams.get("host"));
        if (!host) return json({ error: "host: http(s) base URL without path" }, 400);
        return json(await probeOllamaHost(host));
      }

      // Per-node generation telemetry aggregated over a window.
      const nodeStatsMatch = path.match(/^\/api\/admin\/ollama\/nodes\/([A-Za-z0-9_-]{1,64})\/stats$/);
      if (nodeStatsMatch && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const raw = (url.searchParams.get("window") ?? "24h").toLowerCase();
        const win: StatsWindow = raw === "1h" || raw === "6h" || raw === "24h" || raw === "7d" || raw === "30d" ? raw : "24h";
        try {
          await resolveOllamaHost(nodeStatsMatch[1] === DEFAULT_NODE_ID ? undefined : nodeStatsMatch[1]);
        } catch {
          return json({ error: "unknown ollama node" }, 404);
        }
        return json({ stats: await nodeStats(nodeStatsMatch[1]!, win) });
      }

      // --- admin: access-request wishlist triage ---
      if (path === "/api/admin/access" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        return json({ requests: await listAccessRequests() });
      }

      const accessMatch = path.match(/^\/api\/admin\/access\/([0-9a-f-]{36})(\/message)?$/);
      if (accessMatch) {
        if (!admin) return json({ error: "forbidden" }, 403);
        const target = await getAccessRequest(accessMatch[1]!);
        if (!target) return json({ error: "request not found" }, 404);
        const reviewUrl = `${config.appUrl}/review/${target.id}`;
        if (req.method === "GET" && !accessMatch[2]) {
          return json({ request: target, messages: await listAccessMessages(target.id) });
        }
        if (req.method === "POST" && accessMatch[2] === "/message") {
          const { ok, body } = await readJson(req);
          const text = ok ? cleanStr(body.body, 2000) : null;
          if (!text) return json({ error: "message: 1-2000 chars" }, 400);
          const msg = await addAccessMessage(target.id, "admin", text);
          // Every admin reply is forwarded to the requester (notification-only).
          sendAccessMessageEmail(target.email, target.username, true, text, reviewUrl).catch(() => {});
          broadcastAccessLive({ type: "access_message", request_id: target.id, message: msg });
          return json({ message: msg });
        }
        if (req.method === "PATCH" && !accessMatch[2]) {
          const { ok, body } = await readJson(req);
          if (!ok) return json({ error: "invalid JSON" }, 400);
          const status = body.status as AccessStatus | undefined;
          if (status !== "pending" && status !== "reviewing" && status !== "accepted" && status !== "refused") {
            return json({ error: "status must be pending|reviewing|accepted|refused" }, 400);
          }
          const reason = cleanOptionalStr(body.reason, 500);
          if (reason === null) return json({ error: "reason: max 500 chars" }, 400);
          if ((target.status === "accepted" || target.status === "refused") && status !== target.status) {
            return json({ error: "ticket closed" }, 409);
          }
          let key: string | undefined;
          if (status === "accepted" && target.status !== "accepted") {
            if (await getUserByUsername(target.username)) return json({ error: "username taken" }, 409);
            key = newAccessKey();
            await createUser({ username: target.username, displayName: target.username, avatarUrl: "", theme: "auto", email: target.email, keyHash: hashSecret(key) });
          }
          const updated = await setAccessStatus(target.id, status, reason);
          if (status !== target.status && status !== "pending") {
            sendAccessStatusEmail(target.email, target.username, status, reason, reviewUrl, key).catch(() => {});
          }
          if (updated) broadcastAccessLive({ type: "access_status", request_id: updated.id, request: updated });
          return json({ request: updated, ...(key ? { key } : {}) });
        }
        return json({ error: "not found" }, 404);
      }

      // --- admin: platform host facts (hostname, kernel, uptime, net, ips) ---
      // This box only (Ollama hosts expose no such API — see node probes).
      if (path === "/api/admin/platform" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        try {
          const os = await import("node:os");
          const nets: { name: string; address: string; family: string; internal: boolean }[] = [];
          for (const [name, list] of Object.entries(os.networkInterfaces())) {
            for (const ni of list ?? []) {
              if (ni.family === "IPv4" || ni.family === "IPv6") {
                nets.push({ name, address: ni.address, family: ni.family, internal: ni.internal });
              }
            }
          }
          return json({
            platform: {
              hostname: os.hostname(),
              kernel: `${os.type()} ${os.release()}`,
              arch: os.arch(),
              uptimeS: Math.floor(os.uptime()),
              appUptimeS: Math.floor(process.uptime()),
              loadavg: os.loadavg(),
              cpus: os.cpus().length,
              cpuModel: os.cpus()[0]?.model ?? null,
              memTotal: os.totalmem(),
              memFree: os.freemem(),
              runtime: `bun ${Bun.version}`,
              nets,
            },
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 502);
        }
      }

      // --- admin: SMTP connectivity (viewer + tester) ---
      if (path === "/api/admin/mail" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        return json({ smtp: smtpStatus() });
      }

      if (path === "/api/admin/mail/verify" && req.method === "POST") {
        if (!admin) return json({ error: "forbidden" }, 403);
        try {
          await verifySmtp();
          return json({ ok: true });
        } catch (e) {
          return json({ error: (e as Error).message }, 502);
        }
      }

      if (path === "/api/admin/mail/test" && req.method === "POST") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const ip = clientIp(req, server);
        if (isRateLimited(ip)) return json({ error: "too many attempts, try again later" }, 429);
        const { ok, body } = await readJson(req);
        const to = ok ? validEmail(body.to) : null;
        if (!to) {
          recordAttempt(ip);
          return json({ error: "to: valid email address required" }, 400);
        }
        try {
          const messageId = await sendSmtpTestMail(to);
          clearAttempts(ip);
          return json({ ok: true, messageId });
        } catch (e) {
          recordAttempt(ip);
          return json({ error: (e as Error).message }, 502);
        }
      }

      // --- conversations (server-persisted, per account) ---
      if (path === "/api/conversations" && req.method === "GET") {
        return json({ conversations: await listConversations(user.id) });
      }

      // Archived chats (hidden from the sidebar, managed in settings).
      if (path === "/api/conversations/archived" && req.method === "GET") {
        return json({ conversations: await listArchivedConversations(user.id) });
      }

      // Full-text-ish search over your own chats: titles, topics AND old
      // prompts/replies. Returns the matching conversations, most recent
      // first, with a short snippet of the first hit.
      // Correlated subqueries (not GROUP BY c.id + bare m.* columns): the
      // loose form runs on SQLite but Postgres rejects it.
      if (path === "/api/conversations/search" && req.method === "GET") {
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
        if (q.length < 2) return json({ conversations: [] });
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const rows = await db().all<ConversationRow & { hit: string | null; hit_role: string | null }>(
          `SELECT c.*,
             (SELECT m.content FROM messages m WHERE m.conv_id = c.id AND m.content LIKE ? ESCAPE '\\' ORDER BY m.id ASC LIMIT 1) AS hit,
             (SELECT m.role FROM messages m WHERE m.conv_id = c.id AND m.content LIKE ? ESCAPE '\\' ORDER BY m.id ASC LIMIT 1) AS hit_role
           FROM conversations c
           WHERE c.user_id = ? AND c.archived_at = 0
             AND (c.title LIKE ? ESCAPE '\\' OR c.topic LIKE ? ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.content LIKE ? ESCAPE '\\'))
           ORDER BY c.updated_at DESC LIMIT 30`,
          like, like, user.id, like, like, like,
        );
        return json({
          conversations: rows.map(({ hit, hit_role, ...c }) => {
            let snippet: string | null = null;
            if (typeof hit === "string" && hit.length > 0) {
              if (hit.length <= 140) {
                snippet = hit;
              } else {
                const at = hit.toLowerCase().indexOf(q.toLowerCase());
                const from = Math.max(0, (at < 0 ? 0 : at) - 40);
                snippet = `…${hit.slice(from, from + 140)}…`;
              }
            }
            return { ...c, snippet, snippetRole: hit_role ?? null };
          }),
        });
      }

      if (path === "/api/conversations" && req.method === "POST") {
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const conv = await createConversation(user.id, {
          title: typeof body.title === "string" ? body.title : undefined,
          topic: typeof body.topic === "string" ? body.topic : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
        });
        return json({ conversation: conv }, 201);
      }

      const archiveMatch = path.match(/^\/api\/conversations\/([0-9a-f-]{10,50})\/(archive|unarchive)$/);
      if (archiveMatch && req.method === "POST") {
        const conv = await getConversation(archiveMatch[1]!);
        if (!conv || conv.user_id !== user.id) return json({ error: "conversation not found" }, 404);
        return json({ conversation: await setConversationArchived(conv.id, archiveMatch[2] === "archive") });
      }

      const convMatch = path.match(/^\/api\/conversations\/([0-9a-f-]{10,50})(\/(share))?$/);
      if (convMatch) {
        const conv = await getConversation(convMatch[1]!);
        if (!conv || conv.user_id !== user.id) return json({ error: "conversation not found" }, 404);
        const isShare = convMatch[3] === "share";

        if (isShare) {
          if (req.method === "POST") {
            const publicId = await ensureShare(conv.id);
            return json({ publicId, url: `/share/${publicId}` }, 201);
          }
          if (req.method === "GET") {
            const publicId = await getShareByConv(conv.id);
            return publicId ? json({ publicId, url: `/share/${publicId}` }) : json({ shared: false });
          }
          if (req.method === "DELETE") {
            await deleteShare(conv.id);
            return json({ ok: true });
          }
          return json({ error: "not found" }, 404);
        }

        if (req.method === "GET") {
          return json({ conversation: conv, messages: await getMessages(conv.id) });
        }
        if (req.method === "PATCH") {
          const { ok, body } = await readJson(req);
          if (!ok) return json({ error: "invalid JSON" }, 400);
          const patch: { title?: string; topic?: string; model?: string } = {};
          if (body.title !== undefined) {
            if (typeof body.title !== "string" || body.title.length > 120) return json({ error: "title too long" }, 400);
            patch.title = body.title.trim();
          }
          if (body.topic !== undefined) {
            if (typeof body.topic !== "string" || body.topic.length > 120) return json({ error: "topic too long" }, 400);
            patch.topic = body.topic.trim();
          }
          if (body.model !== undefined) {
            if (typeof body.model !== "string" || body.model.length > 160) return json({ error: "model too long" }, 400);
            patch.model = body.model;
          }
          return json({ conversation: await updateConversation(conv.id, patch) });
        }
        if (req.method === "DELETE") {
          await deleteConversation(conv.id);
          return json({ ok: true });
        }
        return json({ error: "not found" }, 404);
      }

      if (path === "/api/models" && req.method === "GET") {
        // User-facing list is served from an in-memory cache (TTL 60s) so
        // every login doesn't hit Ollama. Admins pass ?refresh=1 to force
        // a fresh upstream fetch (Ollama models view).
        const wantRefresh = /^(1|true|yes)$/i.test(
          url.searchParams.get("refresh") ?? url.searchParams.get("force") ?? "",
        );
        // Copy: the cached array is shared across users and must never be
        // mutated by the per-user merge below.
        const models = [...(await registry.listAllModelsCached(wantRefresh && admin))];
        // Personal providers (BYOK): merge the caller's own-key models.
        // A personal entry replaces the platform entry with the same id so
        // the menu shows one clearly-marked (personal: true) section per
        // connected provider — matching /api/chat, which bills those ids
        // to the personal key.
        try {
          const personal = await listUserProviderModels(user.id);
          const at = new Map(models.map((m, i) => [m.id, i]));
          for (const m of personal) {
            const idx = at.get(m.id);
            if (idx === undefined) models.push(m);
            else models[idx] = m;
          }
        } catch {
          // personal listing is best-effort — global models still served
        }
        if (admin) return json({ models });
        // Users never see admin-disabled models (nor select them — /api/chat
        // enforces the same policy server-side).
        const policy = await getModelPolicy();
        return json({ models: models.filter((m) => policyFor(policy, m.id).enabled) });
      }

      // --- platform tools (uploads always go through tools) ---
      if (path === "/api/tools" && req.method === "GET") {
        return json({
          tools: await tools.list(),
          reportsEnabled: await isReportsEnabled(),
          usernameChangeEnabled: await isUsernameChangeEnabled(),
          voicePreviews: await getVoicePreviews(),
        });
      }

      if (path === "/api/tools/ocr" && req.method === "POST") {
        const ocr = tools.ocr;
        if (!await ocr.isAvailable()) return json({ error: (await ocr.unavailableReason()) ?? "ocr unavailable" }, 501);
        const declared = Number(req.headers.get("content-length") || "0");
        if (declared > OCR_MAX_BYTES) return json({ error: "image too large (max 5MB)" }, 413);
        let buf: Uint8Array;
        try {
          buf = new Uint8Array(await req.arrayBuffer());
        } catch {
          return json({ error: "unreadable body" }, 400);
        }
        if (buf.length < 16) return json({ error: "empty file" }, 400);
        if (buf.length > OCR_MAX_BYTES) return json({ error: "image too large (max 5MB)" }, 413);
        if (!detectImageType(buf)) {
          return json({ error: "only jpg/png/webp images are accepted (verified by content, not extension)" }, 415);
        }
        const rl = ocrAllowed(user.id);
        if (!rl.ok) {
          return json({ error: "ocr rate limited: 20 jobs per hour", retryAfterSec: rl.retryAfterSec }, 429);
        }
        recordOcrJob(user.id);
        try {
          const { text, truncated } = await ocr.transcribe(buf);
          return json({ text, truncated, chars: text.length });
        } catch (e) {
          const msg = (e as Error).message;
          if (/not available|failed to start/i.test(msg)) return json({ error: msg }, 501);
          return json({ error: msg }, 502);
        }
      }

      // --- platform tools: neural TTS (natural voices, cached) ---
      if (path === "/api/tools/tts/info" && req.method === "GET") {
        const tts = tools.tts;
        return json({ ...(await tts.providerInfo()), available: await tts.isAvailable(), reason: await tts.unavailableReason() });
      }

      if (path === "/api/tools/tts" && req.method === "POST") {
        const tts = tools.tts;
        if (!await tts.isAvailable()) return json({ error: (await tts.unavailableReason()) ?? "tts unavailable" }, 501);
        const { ok, body } = await readJson(req);
        if (!ok || typeof body.text !== "string") return json({ error: "expected { text, voice? }" }, 400);
        const text = body.text.trim();
        if (text.length === 0 || text.length > TTS_MAX_CHARS) {
          return json({ error: `text: 1-${TTS_MAX_CHARS} chars` }, 400);
        }
        const rl = ttsAllowed(user.id);
        if (!rl.ok) {
          return json({ error: "tts rate limited: 30 jobs per hour", retryAfterSec: rl.retryAfterSec }, 429);
        }
        recordTtsJob(user.id);
        try {
          const { audio, contentType } = await tts.synthesize(text, typeof body.voice === "string" ? body.voice : undefined);
          const bytes = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
          return new Response(bytes, {
            headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=86400" },
          });
        } catch (e) {
          const msg = (e as Error).message;
          if (/not available|disabled|failed to start/i.test(msg)) return json({ error: msg }, 501);
          return json({ error: msg }, 502);
        }
      }

      if (path === "/api/chat" && req.method === "POST") {
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        if (typeof body.model !== "string" || !validMessages(body.messages)) {
          return json({ error: 'expected { model: "driver:model", messages: [{role, content}] }' }, 400);
        }
        let driver, model: string;
        try {
          ({ driver, model } = registry.splitId(body.model));
          // BYOK precedence: when the caller connected this provider with
          // their own key, the request is billed to them, not the platform.
          if (isUserProviderId(driver.name)) {
            const personalKey = await getUserProviderKey(user.id, driver.name);
            if (personalKey) driver = buildUserProviderDriver(driver.name, personalKey);
          }
        } catch (e) {
          // Unknown/disabled global driver — maybe the caller connected it
          // personally (e.g. platform key unset, user key set).
          const fullId = body.model as string;
          const idx = fullId.indexOf(":");
          const pname = idx === -1 ? "" : fullId.slice(0, idx);
          const sub = idx === -1 ? "" : fullId.slice(idx + 1);
          if (!isUserProviderId(pname)) return json({ error: (e as Error).message }, 400);
          const personalKey = await getUserProviderKey(user.id, pname);
          if (!personalKey || !sub) return json({ error: (e as Error).message }, 400);
          driver = buildUserProviderDriver(pname, personalKey);
          model = sub;
        }
        // Per-model access policy (kill-switch + per-user rate limits).
        // Admins bypass; attempts count even when generation later fails.
        if (!user.isAdmin) {
          const access = await checkModelAccess(user.id, body.model);
          if (!access.ok) return json({ error: access.message }, access.code);
          await recordModelUse(user.id, body.model);
        }
        const messages = body.messages as ChatMessage[];
        // Optional persistence into a server-side conversation (must belong to the user).
        let conv = null;
        if (body.conversationId !== undefined) {
          if (typeof body.conversationId !== "string") return json({ error: "bad conversationId" }, 400);
          conv = await getConversation(body.conversationId);
          if (!conv || conv.user_id !== user.id) return json({ error: "conversation not found" }, 404);
          // Archived chats are read-only: no new messages may be written.
          if (conv.archived_at) return json({ error: "conversation is archived (read-only) — unarchive it to write again" }, 403);
          // Persist the new user message (dedupe against last stored one).
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          const stored = await getMessages(conv.id);
          const lastStored = stored[stored.length - 1];
          if (lastUser && (!lastStored || lastStored.content !== lastUser.content || lastStored.role !== "user")) {
            await addMessage(conv.id, "user", lastUser.content);
            if (conv.title === "New chat") {
              await updateConversation(conv.id, { title: lastUser.content.slice(0, 50) || "New chat" });
            }
          }
        }
        const wantStream = body.stream === true || req.headers.get("accept") === "text/event-stream";

        const persistReply = async (text: string): Promise<void> => {
          if (conv && text) {
            await addMessage(conv.id, "assistant", text);
            await touchConversation(conv.id, body.model as string);
          }
        };

        if (!wantStream) {
          try {
            const text = await driver.chat(messages, { model, signal: req.signal });
            await persistReply(text);
            return json({ model: body.model, message: { role: "assistant", content: text } });
          } catch (e) {
            return json({ error: (e as Error).message }, 502);
          }
        }

        // True streaming (ChatGPT-style): driver tokens are forwarded as SSE
        // events the moment they arrive. Client disconnects are propagated
        // upstream so the model stops generating, and we never write to a
        // closed controller (the old "[interrupted: Controller is already
        // closed]" crash).
        const abortUpstream = new AbortController();
        const onClientAbort = () => abortUpstream.abort();
        req.signal.addEventListener("abort", onClientAbort);
        let clientGone = false;
        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const safeSend = (event: string, data: string): boolean => {
              if (clientGone || req.signal.aborted) return false;
              try {
                controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
                return true;
              } catch {
                // Controller already closed (client gone) — stop pulling upstream.
                clientGone = true;
                abortUpstream.abort();
                return false;
              }
            };
            let full = "";
            try {
              for await (const token of driver.chatStream(messages, { model, signal: abortUpstream.signal })) {
                if (req.signal.aborted) break;
                full += token;
                if (!safeSend("token", JSON.stringify({ token }))) break;
              }
              await persistReply(full);
              safeSend("done", "{}");
            } catch (e) {
              // Genuine driver error: keep the partial text as-is (no internal
              // markers persisted) and notify the client if still connected.
              if (full) await persistReply(full);
              if (!req.signal.aborted && !clientGone) {
                safeSend("error", JSON.stringify({ error: (e as Error).message }));
              }
            } finally {
              req.signal.removeEventListener("abort", onClientAbort);
              abortUpstream.abort();
              if (!clientGone) {
                try {
                  controller.close();
                } catch {
                  // already closed — fine
                }
              }
            }
          },
          cancel() {
            clientGone = true;
            abortUpstream.abort();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no", // nginx: never buffer SSE
          },
        });
      }

      return json({ error: "not found" }, 404);
    }

    // --- static frontend (SPA fallback covers /share/:id) ---
    return serveStatic(req, url);
  },
});

console.log(`KisAssistant listening on http://${config.host}:${config.port}`);
console.log(`Drivers (priority order): ${registry.ordered().map((d) => `${d.name}${d.enabled ? "" : " [disabled]"}`).join(" -> ")}`);
void server;
