import type { ChatMessage, Conversation, DriverModel, SharedChat, User } from "./types.ts";

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

export type ReportReason = "copyright" | "gore" | "falseinfo" | "bug";
export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export interface Report {
  id: string;
  reporter_id: string;
  reporter_name: string;
  conversation_id: string;
  message_index: number;
  content: string;
  prompt: string;
  model: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  admin_note: string;
  reporter_shadowbanned: number;
  created_at: number;
  updated_at: number;
}

export interface ModelPolicyEntry {
  enabled: boolean;
  hourly: number;
  daily: number;
}

export interface UserProvider {
  provider: string;
  label: string;
  hasKey: boolean;
  last4: string | null;
  updatedAt: number;
}

export interface PolicyModel extends DriverModel {
  enabled: boolean;
  hourly: number;
  daily: number;
}

export interface OllamaHostModel {
  name: string;
  size: number;
  modifiedAt: string | null;
}

export interface AdminSettings {
  registrationEnabled: boolean;
  accessRequestEnabled: boolean;
  ocrEnabled: boolean;
  reportsEnabled: boolean;
  usernameChangeEnabled: boolean;
  ollamaTimeoutS: number;
  ollamaDefaultWeight: number;
  recoveryLimitMax: number;
  recoveryLimitWindowMin: number;
}

export interface AdminSettingsPatch {
  registrationEnabled?: boolean;
  accessRequestEnabled?: boolean;
  ocrEnabled?: boolean;
  reportsEnabled?: boolean;
  usernameChangeEnabled?: boolean;
  ollamaTimeoutS?: number;
  ollamaDefaultWeight?: number;
  recoveryLimitMax?: number;
  recoveryLimitWindowMin?: number;
}

export interface OllamaNode {
  id: string;
  name: string;
  host: string;
  weight: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface EffectiveOllamaNode {
  id: string;
  name: string;
  host: string;
  weight: number;
}

export interface OllamaNodeStatus {
  reachable: boolean;
  host: string;
  version: string | null;
  latencyMs: number | null;
  models: OllamaHostModel[];
  running: { name: string; sizeVram: number; size: number; expiresAt: string | null }[];
  error: string | null;
}

export interface OllamaStatsBucket {
  t: number;
  req: number;
  err: number;
  avgMs: number | null;
  promptTok: number;
  evalTok: number;
}

export interface OllamaNodeStats {
  window: string;
  from: number;
  to: number;
  totals: { req: number; err: number; avgMs: number | null; promptTok: number; evalTok: number; tokPerSec: number | null };
  buckets: OllamaStatsBucket[];
}

export interface OllamaStatus {
  enabled: boolean;
  host: string;
  reachable: boolean;
  version: string | null;
  latencyMs: number | null;
  models: OllamaHostModel[];
  error: string | null;
}

const TOKEN_KEY = "kisassistant_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, opts: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers as Record<string, string> | undefined) } });
  if (res.status === 401 && auth) {
    clearToken();
    if (!window.location.pathname.startsWith("/share/")) window.location.reload();
    throw new ApiError(401, "Session expired, please log in again.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  login: (username: string, key: string) =>
    req<{ token: string; expiresAt: number; user: User } | { totpRequired: true; totpToken: string; username: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, key }),
    }, false),
  totpLogin: (totpToken: string, code: string) =>
    req<{ token: string; expiresAt: number; user: User }>("/api/auth/totp", {
      method: "POST",
      body: JSON.stringify({ totpToken, code }),
    }, false),
  verify: () => req<{ ok: boolean; user: User }>("/api/auth/verify"),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => ({ ok: true as const })),

  methods: () => req<{ recovery: boolean; from?: string; registration: boolean; accessRequest: boolean }>("/api/auth/methods", {}, false),
  register: (u: { username: string; displayName?: string; email?: string }) =>
    req<{ user: User; key: string }>("/api/auth/register", { method: "POST", body: JSON.stringify(u) }, false),
  recover: (username: string) =>
    req<{ ok: boolean }>("/api/auth/recover", { method: "POST", body: JSON.stringify({ username }) }, false),
  resetCheck: (token: string) => req<{ ok: boolean; username: string }>(`/api/auth/reset/${token}`, {}, false),
  resetConsume: (token: string) => req<{ key: string }>(`/api/auth/reset/${token}`, { method: "POST" }, false),

  me: () => req<{ user: User }>("/api/me"),
  updateMe: (patch: { username?: string; displayName?: string; avatarUrl?: string; theme?: string; email?: string }) =>
    req<{ user: User }>("/api/me", { method: "PATCH", body: JSON.stringify(patch) }),

  /** Rotate your own access key (old sessions revoked, key shown once). */
  rotateKey: () => req<{ key: string }>("/api/me/key/rotate", { method: "POST" }),

  /** Permanently delete your own account (chats, shares, sessions). */
  deleteMe: () => req<{ ok: boolean }>("/api/me", { method: "DELETE" }),

  /** TOTP two-factor self-service. */
  totpStatus: () => req<{ enabled: boolean }>("/api/me/totp"),
  totpSetup: () => req<{ secret: string; otpauthUrl: string }>("/api/me/totp/setup", { method: "POST" }),
  totpVerify: (secret: string, code: string) =>
    req<{ enabled: boolean }>("/api/me/totp/verify", { method: "POST", body: JSON.stringify({ secret, code }) }),
  totpDisable: (code: string) =>
    req<{ enabled: boolean }>("/api/me/totp", { method: "DELETE", body: JSON.stringify({ code }) }),

  adminList: (p: { q?: string; sort?: string; filter?: string; page?: number; per?: number } = {}) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set("q", p.q);
    if (p.sort) qs.set("sort", p.sort);
    if (p.filter) qs.set("filter", p.filter);
    if (p.page) qs.set("page", String(p.page));
    if (p.per) qs.set("per", String(p.per));
    const s = qs.toString();
    return req<{ users: User[]; total: number; page: number; perPage: number; pages: number }>(
      `/api/admin/users${s ? `?${s}` : ""}`,
    );
  },
  adminCreate: (u: { username: string; displayName?: string; avatarUrl?: string; theme?: string; email?: string }) =>
    req<{ user: User; key: string }>("/api/admin/users", { method: "POST", body: JSON.stringify(u) }),
  adminDelete: (id: string) => req<{ ok: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" }),
  adminRegenerate: (id: string) => req<{ key: string }>(`/api/admin/users/${id}/regenerate`, { method: "POST" }),
  adminShadowban: (id: string, shadowbanned: boolean) =>
    req<{ shadowbanned: boolean }>(`/api/admin/users/${id}/shadowban`, {
      method: "POST",
      body: JSON.stringify({ shadowbanned }),
    }),

  /** Admin: per-model access policy (kill-switch + rate limits). */
  adminModelPolicy: (refresh = false) =>
    req<{ models: PolicyModel[] }>(`/api/admin/model-policy${refresh ? "?refresh=1" : ""}`),
  adminModelPolicyPatch: (model: string, patch: { enabled?: boolean; hourly?: number; daily?: number }) =>
    req<{ model: PolicyModel }>(`/api/admin/model-policy`, {
      method: "PATCH",
      body: JSON.stringify({ model, ...patch }),
    }),
  adminPatch: (id: string, patch: { username?: string; displayName?: string; avatarUrl?: string; theme?: string; email?: string }) =>
    req<{ user: User }>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  adminGetSettings: () => req<{ settings: AdminSettings }>("/api/admin/settings"),
  adminPatchSettings: (patch: AdminSettingsPatch) =>
    req<{ settings: AdminSettings }>("/api/admin/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  /** Admin: SMTP credentials viewer (password included, blur it by default) + connectivity. */
  adminMailStatus: () =>
    req<{ smtp: { enabled: boolean; host: string; port: number; secure: boolean; user: string; pass: string; hasPass: boolean; from: string; appUrl: string } }>("/api/admin/mail"),
  adminMailVerify: () => req<{ ok: boolean }>("/api/admin/mail/verify", { method: "POST", body: JSON.stringify({}) }),
  adminMailTest: (to: string) =>
    req<{ ok: boolean; messageId: string }>("/api/admin/mail/test", { method: "POST", body: JSON.stringify({ to }) }),

  convs: () => req<{ conversations: Conversation[] }>("/api/conversations"),
  /** Search your old chats (titles, topics and message content). */
  searchConvs: (q: string) =>
    req<{ conversations: (Conversation & { snippet: string | null; snippetRole: string | null })[] }>(
      `/api/conversations/search?q=${encodeURIComponent(q)}`,
    ),
  createConv: (c: { title?: string; topic?: string; model?: string }) =>
    req<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: JSON.stringify(c) }),
  getConv: (id: string) => req<{ conversation: Conversation; messages: ChatMessage[] }>(`/api/conversations/${id}`),
  patchConv: (id: string, patch: { title?: string; topic?: string; model?: string }) =>
    req<{ conversation: Conversation }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteConv: (id: string) => req<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),

  share: (id: string) => req<{ publicId: string; url: string }>(`/api/conversations/${id}/share`, { method: "POST" }),
  getShare: (id: string) => req<{ publicId: string; url: string } | { shared: false }>(`/api/conversations/${id}/share`),
  unshare: (id: string) => req<{ ok: boolean }>(`/api/conversations/${id}/share`, { method: "DELETE" }),
  publicShare: (publicId: string) => req<SharedChat>(`/api/share/${publicId}`, {}, false),

  /** Archived chats (hidden from the sidebar, managed in settings). */
  archivedConvs: () => req<{ conversations: Conversation[] }>("/api/conversations/archived"),
  archiveConv: (id: string) =>
    req<{ conversation: Conversation }>(`/api/conversations/${id}/archive`, { method: "POST" }),
  unarchiveConv: (id: string) =>
    req<{ conversation: Conversation }>(`/api/conversations/${id}/unarchive`, { method: "POST" }),

  models: (opts: { refresh?: boolean } = {}) =>
    req<{ models: DriverModel[] }>(`/api/models${opts.refresh ? "?refresh=1" : ""}`),

  /** Access-request wishlist (public, no auth). */
  accessRequest: (a: { username: string; email: string; message: string }) =>
    req<{ request: AccessRequest; reviewUrl: string }>("/api/access/request", {
      method: "POST",
      body: JSON.stringify(a),
    }, false),
  accessTicket: (id: string) =>
    req<{ request: AccessRequest; messages: AccessMessage[] }>(`/api/access/ticket/${id}`, {}, false),
  accessReply: (id: string, body: string) =>
    req<{ message: AccessMessage }>(`/api/access/ticket/${id}/message`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, false),

  /** Admin: access-request triage. */
  adminAccessList: () => req<{ requests: (AccessRequest & { message_count: number })[] }>("/api/admin/access"),
  adminAccessGet: (id: string) =>
    req<{ request: AccessRequest; messages: AccessMessage[] }>(`/api/admin/access/${id}`),
  adminAccessPatch: (id: string, patch: { status: AccessStatus; reason?: string }) =>
    req<{ request: AccessRequest; key?: string }>(`/api/admin/access/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  adminAccessReply: (id: string, body: string) =>
    req<{ message: AccessMessage }>(`/api/admin/access/${id}/message`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  /** Content reports (flagged AI responses). */
  createReport: (r: {
    conversationId?: string;
    messageIndex?: number;
    reason: ReportReason;
    details?: string;
    content?: string;
    prompt?: string;
    model?: string;
  }) =>
    req<{ report: Report }>("/api/reports", {
      method: "POST",
      body: JSON.stringify(r),
    }),

  /** Admin: report triage. */
  adminReportList: () => req<{ reports: Report[] }>("/api/admin/reports"),
  adminReportPatch: (id: string, patch: { status: ReportStatus; adminNote?: string }) =>
    req<{ report: Report }>(`/api/admin/reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  ollamaPull: async (
    name: string,
    onProgress: (p: { status?: string; digest?: string; total?: number; completed?: number; error?: string }) => void,
    opts: { nodeId?: string } = {},
  ): Promise<void> => {
    const res = await fetch("/api/admin/ollama/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ name, ...(opts.nodeId ? { nodeId: opts.nodeId } : {}) }),
    });
    if (res.status === 401) {
      clearToken();
      window.location.reload();
      throw new ApiError(401, "Session expired.");
    }
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, err.error || `Pull failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (t) onProgress(JSON.parse(t));
      }
    }
  },

  /** Admin: delete a local Ollama model (frees disk on the Ollama host). */
  ollamaDelete: (name: string, nodeId?: string) =>
    req<{ ok: boolean }>(`/api/admin/ollama/models/${encodeURIComponent(name)}${nodeId ? `?node=${encodeURIComponent(nodeId)}` : ""}`, { method: "DELETE" }),

  /** Admin: Ollama node pool (extra hosts with firewall-like weights). */
  ollamaNodes: () => req<{ nodes: OllamaNode[]; effective: EffectiveOllamaNode[] }>("/api/admin/ollama/nodes"),
  ollamaNodeCreate: (n: { name: string; host: string; weight: number; enabled: boolean }) =>
    req<{ node: OllamaNode }>("/api/admin/ollama/nodes", { method: "POST", body: JSON.stringify(n) }),
  ollamaNodePatch: (id: string, patch: { name?: string; host?: string; weight?: number; enabled?: boolean }) =>
    req<{ node: OllamaNode }>(`/api/admin/ollama/nodes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  ollamaNodeDelete: (id: string) =>
    req<{ ok: boolean }>(`/api/admin/ollama/nodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  ollamaNodeStatus: (id: string) =>
    req<OllamaNodeStatus>(`/api/admin/ollama/nodes/${encodeURIComponent(id)}/status`),
  ollamaNodeProbe: (host: string) =>
    req<OllamaNodeStatus>(`/api/admin/ollama/probe?host=${encodeURIComponent(host)}`),
  ollamaNodeStats: (id: string, window: string) =>
    req<{ stats: OllamaNodeStats }>(`/api/admin/ollama/nodes/${encodeURIComponent(id)}/stats?window=${encodeURIComponent(window)}`),

  /** Admin: Ollama connectivity probe (reachability, version, on-disk models). */
  ollamaStatus: () => req<OllamaStatus>("/api/admin/ollama/status"),

  /** Personal LLM providers (BYOK): presence + last4 only, keys never leave the server. */
  providers: () => req<{ providers: UserProvider[] }>("/api/me/providers"),
  setProvider: (provider: string, apiKey: string) =>
    req<{ providers: UserProvider[] }>(`/api/me/providers/${provider}`, {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    }),
  deleteProvider: (provider: string) =>
    req<{ providers: UserProvider[] }>(`/api/me/providers/${provider}`, { method: "DELETE" }),

  tools: () => req<{ tools: { name: string; description: string; available: boolean; reason: string | null }[]; reportsEnabled: boolean; usernameChangeEnabled: boolean }>("/api/tools"),

  /** Send an image to the platform OCR tool. Returns editable text (never the raw image). */
  ocrImage: async (file: File): Promise<{ text: string; truncated: boolean; chars: number }> => {
    const res = await fetch("/api/tools/ocr", {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (res.status === 401) {
      clearToken();
      window.location.reload();
      throw new ApiError(401, "Session expired.");
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; text?: string; truncated?: boolean; chars?: number };
    if (!res.ok) throw new ApiError(res.status, data.error || `OCR failed (${res.status})`);
    return { text: data.text ?? "", truncated: !!data.truncated, chars: data.chars ?? 0 };
  },

  /** Avatar upload to the local CDN. Returns the public /cdn/… URL. */
  uploadAvatar: async (userId: string, file: File): Promise<{ url: string }> => {
    const res = await fetch(`/cdn/avatar/${userId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (res.status === 401) {
      clearToken();
      window.location.reload();
      throw new ApiError(401, "Session expired.");
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
    if (!res.ok) throw new ApiError(res.status, data.error || `Upload failed (${res.status})`);
    return { url: data.url! };
  },

  /** Streaming chat. Calls onToken per token; resolves with the full text. */
  chatStream: async (
    args: { model: string; messages: ChatMessage[]; conversationId?: string },
    onToken: (t: string) => void,
  ): Promise<string> => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ ...args, stream: true }),
    });
    if (res.status === 401) {
      clearToken();
      window.location.reload();
      throw new ApiError(401, "Session expired.");
    }
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, err.error || `Chat failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const ev of events) {
        const m = ev.match(/^event: (\w+)\ndata: ([\s\S]*)$/m);
        if (!m) continue;
        const [, event, data] = m as [string, string, string];
        if (event === "token") {
          const token = (JSON.parse(data) as { token: string }).token;
          full += token;
          onToken(token);
        } else if (event === "error") {
          throw new ApiError(502, (JSON.parse(data) as { error?: string }).error || "stream error");
        }
      }
    }
    return full;
  },
};
