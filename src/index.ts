import { serveStatic } from "./static.ts";
import { assertConfig, config } from "./config.ts";
import {
  clearAttempts,
  extractBearer,
  hashSecret,
  isRateLimited,
  issueToken,
  login,
  newAccessKey,
  recordAttempt,
  revokeToken,
  verifyToken,
  type PublicUser,
} from "./auth.ts";
import {
  addMessage,
  createConversation,
  createUser,
  deleteConversation,
  deleteShare,
  deleteUser,
  deleteUserSessions,
  ensureShare,
  getConversation,
  getMessages,
  getShareByConv,
  getShareByPublic,
  getUserById,
  getUserByUsername,
  listConversations,
  listUsers,
  toPublicUser,
  touchConversation,
  updateConversation,
  updateUser,
} from "./db.ts";
import type { ChatMessage } from "./drivers/types.ts";
import { DriverRegistry } from "./drivers/registry.ts";
import {
  CDN_NAMESPACES,
  cdnFile,
  cdnMime,
  detectImageType,
  recordUpload,
  uploadAllowed,
  validExt,
  validKey,
  validNamespace,
  writeCdnFile,
} from "./cdn.ts";

assertConfig();
const registry = new DriverRegistry();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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

function requireAuth(req: Request): PublicUser | null {
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

function validTheme(v: unknown): v is string {
  return v === "auto" || v === "light" || v === "dark";
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

async function readJson(req: Request): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    return { ok: true, body: (await req.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, body: {} };
  }
}

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  // SSE chat streams can legitimately go silent for a while (cold model load,
  // slow/thinking models). Bun's default 10s idle timeout would kill them
  // mid-generation — disable it (0). Nginx in front has its own timeouts.
  idleTimeout: 0,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- public: shared chat page data (no auth) ---
    const shareMatch = path.match(/^\/api\/share\/([A-Za-z0-9_-]{6,64})$/);
    if (shareMatch && req.method === "GET") {
      const s = getShareByPublic(shareMatch[1]!);
      if (!s) return json({ error: "share not found" }, 404);
      return json({
        title: s.conv.title,
        topic: s.conv.topic,
        model: s.conv.model,
        authorName: s.authorName,
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
      const user = requireAuth(req);
      if (!user) return json({ error: "unauthorized" }, 401);
      const [, ns, key] = cdnPut as [string, string, string];
      if (!validNamespace(ns) || !validKey(key)) return json({ error: "unknown namespace or key" }, 404);
      const rules = CDN_NAMESPACES[ns]!;
      // Avatar ownership: your own account id, unless admin.
      if (ns === "avatar" && key !== user.id && !user.isAdmin) {
        return json({ error: "forbidden" }, 403);
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
      const ext = detectImageType(buf);
      if (!ext) {
        return json({ error: "unsupported file type: only jpg/png/webp images are accepted (verified by content, not extension)" }, 415);
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
      const user = login(body.username.trim().toLowerCase(), body.key);
      if (!user) {
        recordAttempt(ip);
        await Bun.sleep(400);
        return json({ error: "invalid credentials" }, 401);
      }
      clearAttempts(ip);
      const { token, expiresAt } = issueToken(user);
      return json({ token, expiresAt, user });
    }

    if (path === "/api/auth/verify" && req.method === "GET") {
      const user = requireAuth(req);
      return user ? json({ ok: true, user }) : json({ error: "unauthorized" }, 401);
    }

    if (path === "/api/auth/logout" && req.method === "POST") {
      const token = extractBearer(req);
      if (token) revokeToken(token);
      return json({ ok: true });
    }

    // --- everything below requires auth ---
    if (path.startsWith("/api/")) {
      const user = requireAuth(req);
      if (!user) return json({ error: "unauthorized" }, 401);
      const admin = user.isAdmin;

      // --- self profile ---
      if (path === "/api/me" && req.method === "GET") return json({ user });

      if (path === "/api/me" && req.method === "PATCH") {
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const patch: { displayName?: string; avatarUrl?: string; theme?: string } = {};
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
          if (!validTheme(body.theme)) return json({ error: "theme must be auto|light|dark" }, 400);
          patch.theme = body.theme;
        }
        const updated = updateUser(user.id, patch);
        if (!updated) return json({ error: "user not found" }, 404);
        return json({ user: toPublicUser(updated) });
      }

      // --- admin: user management (No-KYC accounts, keys issued by admin) ---
      if (path === "/api/admin/users" && req.method === "GET") {
        if (!admin) return json({ error: "forbidden" }, 403);
        return json({ users: listUsers().map(toPublicUser) });
      }

      if (path === "/api/admin/users" && req.method === "POST") {
        if (!admin) return json({ error: "forbidden" }, 403);
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const username = validUsername(body.username);
        if (!username) return json({ error: "username: 2-32 chars [a-z0-9._-], 'admin' reserved" }, 400);
        if (getUserByUsername(username)) return json({ error: "username taken" }, 409);
        const displayName = body.displayName === undefined ? username : cleanStr(body.displayName, 60);
        if (displayName === null) return json({ error: "displayName: 1-60 chars" }, 400);
        const avatarUrl = body.avatarUrl === undefined ? "" : validAvatar(body.avatarUrl);
        if (avatarUrl === null) return json({ error: "avatarUrl must be an http(s) URL or empty" }, 400);
        const theme = body.theme === undefined ? "auto" : body.theme;
        if (!validTheme(theme)) return json({ error: "theme must be auto|light|dark" }, 400);
        const key = newAccessKey();
        const created = createUser({ username, displayName, avatarUrl, theme, keyHash: hashSecret(key) });
        // Show the raw key exactly once.
        return json({ user: toPublicUser(created), key }, 201);
      }

      const adminUserMatch = path.match(/^\/api\/admin\/users\/([0-9a-f-]{10,50})(\/regenerate)?$/);
      if (adminUserMatch) {
        if (!admin) return json({ error: "forbidden" }, 403);
        const target = getUserById(adminUserMatch[1]!);
        if (!target || target.username === "admin") return json({ error: "user not found" }, 404);
        if (req.method === "DELETE" && !adminUserMatch[2]) {
          deleteUser(target.id);
          return json({ ok: true });
        }
        if (req.method === "POST" && adminUserMatch[2] === "/regenerate") {
          const key = newAccessKey();
          updateUser(target.id, { keyHash: hashSecret(key) });
          deleteUserSessions(target.id);
          return json({ key });
        }
        if (req.method === "PATCH" && !adminUserMatch[2]) {
          const { ok, body } = await readJson(req);
          if (!ok) return json({ error: "invalid JSON" }, 400);
          const patch: { displayName?: string; avatarUrl?: string; theme?: string } = {};
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
            if (!validTheme(body.theme)) return json({ error: "theme must be auto|light|dark" }, 400);
            patch.theme = body.theme;
          }
          const updated = updateUser(target.id, patch);
          return json({ user: toPublicUser(updated!) });
        }
        return json({ error: "not found" }, 404);
      }

      // --- conversations (server-persisted, per account) ---
      if (path === "/api/conversations" && req.method === "GET") {
        return json({ conversations: listConversations(user.id) });
      }

      if (path === "/api/conversations" && req.method === "POST") {
        const { ok, body } = await readJson(req);
        if (!ok) return json({ error: "invalid JSON" }, 400);
        const conv = createConversation(user.id, {
          title: typeof body.title === "string" ? body.title : undefined,
          topic: typeof body.topic === "string" ? body.topic : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
        });
        return json({ conversation: conv }, 201);
      }

      const convMatch = path.match(/^\/api\/conversations\/([0-9a-f-]{10,50})(\/(share))?$/);
      if (convMatch) {
        const conv = getConversation(convMatch[1]!);
        if (!conv || conv.user_id !== user.id) return json({ error: "conversation not found" }, 404);
        const isShare = convMatch[3] === "share";

        if (isShare) {
          if (req.method === "POST") {
            const publicId = ensureShare(conv.id);
            return json({ publicId, url: `/share/${publicId}` }, 201);
          }
          if (req.method === "GET") {
            const publicId = getShareByConv(conv.id);
            return publicId ? json({ publicId, url: `/share/${publicId}` }) : json({ shared: false });
          }
          if (req.method === "DELETE") {
            deleteShare(conv.id);
            return json({ ok: true });
          }
          return json({ error: "not found" }, 404);
        }

        if (req.method === "GET") {
          return json({ conversation: conv, messages: getMessages(conv.id) });
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
          return json({ conversation: updateConversation(conv.id, patch) });
        }
        if (req.method === "DELETE") {
          deleteConversation(conv.id);
          return json({ ok: true });
        }
        return json({ error: "not found" }, 404);
      }

      if (path === "/api/models" && req.method === "GET") {
        const models = await registry.listAllModels();
        return json({ models });
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
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
        const messages = body.messages as ChatMessage[];
        // Optional persistence into a server-side conversation (must belong to the user).
        let conv = null;
        if (body.conversationId !== undefined) {
          if (typeof body.conversationId !== "string") return json({ error: "bad conversationId" }, 400);
          conv = getConversation(body.conversationId);
          if (!conv || conv.user_id !== user.id) return json({ error: "conversation not found" }, 404);
          // Persist the new user message (dedupe against last stored one).
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          const stored = getMessages(conv.id);
          const lastStored = stored[stored.length - 1];
          if (lastUser && (!lastStored || lastStored.content !== lastUser.content || lastStored.role !== "user")) {
            addMessage(conv.id, "user", lastUser.content);
            if (conv.title === "New chat") {
              updateConversation(conv.id, { title: lastUser.content.slice(0, 50) || "New chat" });
            }
          }
        }
        const wantStream = body.stream === true || req.headers.get("accept") === "text/event-stream";

        const persistReply = (text: string) => {
          if (conv && text) {
            addMessage(conv.id, "assistant", text);
            touchConversation(conv.id, body.model as string);
          }
        };

        if (!wantStream) {
          try {
            const text = await driver.chat(messages, { model, signal: req.signal });
            persistReply(text);
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
              persistReply(full);
              safeSend("done", "{}");
            } catch (e) {
              // Genuine driver error: keep the partial text as-is (no internal
              // markers persisted) and notify the client if still connected.
              if (full) persistReply(full);
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
