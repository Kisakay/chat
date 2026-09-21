import type { ChatMessage, Conversation, DriverModel, SharedChat, User } from "./types.ts";

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
    req<{ token: string; expiresAt: number; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, key }),
    }, false),
  verify: () => req<{ ok: boolean; user: User }>("/api/auth/verify"),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => ({ ok: true as const })),

  methods: () => req<{ recovery: boolean; from?: string }>("/api/auth/methods", {}, false),
  recover: (username: string) =>
    req<{ ok: boolean }>("/api/auth/recover", { method: "POST", body: JSON.stringify({ username }) }, false),
  resetCheck: (token: string) => req<{ ok: boolean; username: string }>(`/api/auth/reset/${token}`, {}, false),
  resetConsume: (token: string) => req<{ key: string }>(`/api/auth/reset/${token}`, { method: "POST" }, false),

  me: () => req<{ user: User }>("/api/me"),
  updateMe: (patch: { displayName?: string; avatarUrl?: string; theme?: string; email?: string }) =>
    req<{ user: User }>("/api/me", { method: "PATCH", body: JSON.stringify(patch) }),

  adminList: () => req<{ users: User[] }>("/api/admin/users"),
  adminCreate: (u: { username: string; displayName?: string; avatarUrl?: string; theme?: string; email?: string }) =>
    req<{ user: User; key: string }>("/api/admin/users", { method: "POST", body: JSON.stringify(u) }),
  adminDelete: (id: string) => req<{ ok: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" }),
  adminRegenerate: (id: string) => req<{ key: string }>(`/api/admin/users/${id}/regenerate`, { method: "POST" }),
  adminPatch: (id: string, patch: { displayName?: string; avatarUrl?: string; theme?: string; email?: string }) =>
    req<{ user: User }>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  convs: () => req<{ conversations: Conversation[] }>("/api/conversations"),
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

  models: () => req<{ models: DriverModel[] }>("/api/models"),

  tools: () => req<{ tools: { name: string; description: string; available: boolean; reason: string | null }[] }>("/api/tools"),

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
