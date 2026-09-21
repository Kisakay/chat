import { useCallback, useEffect, useState } from "react";
import { api, clearToken, getToken } from "./lib/api.ts";
import { featureEnabled, THINKING_SYSTEM_PROMPT } from "./lib/features.ts";
import type { Attachment, ChatMessage, Conversation, DriverModel, FilePreview, User } from "./lib/types.ts";
import { Login } from "./components/Login.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Chat } from "./components/Chat.tsx";
import { ConvEditDialog, FilePreviewModal, SettingsModal, ShareModal } from "./components/dialogs.tsx";
import { AdminCenter } from "./components/AdminCenter.tsx";
import { SharePage } from "./components/SharePage.tsx";
import { ResetPage } from "./components/ResetPage.tsx";
import { ReviewPage } from "./components/ReviewPage.tsx";
import { ConfirmDialog, LoadingScreen } from "./components/ui.tsx";

function shareIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/share\/([A-Za-z0-9_-]{6,64})\/?$/);
  return m ? m[1]! : null;
}

// Module-level: the path never changes without a full reload, so hook order stays stable.
const SHARE_ID = typeof window !== "undefined" ? shareIdFromPath() : null;
const RESET_TOKEN = typeof window !== "undefined" ? resetTokenFromPath() : null;
const REVIEW_ID = typeof window !== "undefined" ? reviewIdFromPath() : null;
const IS_ADMIN_PAGE = typeof window !== "undefined" && /^\/admin\/?$/.test(window.location.pathname);

function resetTokenFromPath(): string | null {
  const m = window.location.pathname.match(/^\/reset\/([A-Za-z0-9_-]{6,80})\/?$/);
  return m ? m[1]! : null;
}

function reviewIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/review\/([0-9a-f-]{36})\/?$/i);
  return m ? m[1]! : null;
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  const dark =
    theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!SHARE_ID && !RESET_TOKEN && !REVIEW_ID && !IS_ADMIN_PAGE && !!getToken());
  const [models, setModels] = useState<DriverModel[]>([]);
  const [model, setModel] = useState("");
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [editConv, setEditConv] = useState<Conversation | null>(null);
  const [shareConv, setShareConv] = useState<Conversation | null>(null);
  const [deleteConv, setDeleteConv] = useState<Conversation | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [ocrAvailable, setOcrAvailable] = useState(false);

  // Public routes: no auth needed. IDs are constant for the page lifetime.
  if (IS_ADMIN_PAGE) {
    return <AdminCenter />;
  }
  if (RESET_TOKEN) {
    return <ResetPage token={RESET_TOKEN} />;
  }
  if (REVIEW_ID) {
    return <ReviewPage ticketId={REVIEW_ID} />;
  }
  if (SHARE_ID) {
    return <SharePage publicId={SHARE_ID} />;
  }

  const refreshConvs = useCallback(async (select?: string) => {
    try {
      const res = await api.convs();
      setConvs(res.conversations);
      if (select) setActiveId(select);
      else if (res.conversations.length > 0) {
        setActiveId((cur) => (cur && res.conversations.some((c) => c.id === cur) ? cur : res.conversations[0]!.id));
      }
    } catch {
      // ignore (session errors reload the page via api layer)
    }
  }, []);

  // Session restore
  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    api.verify()
      .then(async (res) => {
        setUser(res.user);
        applyTheme(res.user.theme);
        const [m, c, t] = await Promise.all([
          api.models().catch(() => ({ models: [] })),
          api.convs().catch(() => ({ conversations: [] })),
          api.tools().catch(() => ({ tools: [] as { name: string; available: boolean }[] })),
        ]);
        setOcrAvailable(t.tools.some((x) => x.name === "ocr" && x.available));
        setModels(m.models);
        if (m.models.length > 0) setModel(m.models[0]!.id);
        setConvs(c.conversations);
        if (c.conversations.length > 0) setActiveId(c.conversations[0]!.id);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    api.getConv(activeId).then((res) => setMessages(res.messages)).catch(() => setMessages([]));
  }, [activeId]);

  // Follow OS theme when account theme is auto
  useEffect(() => {
    if (user?.theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme("auto");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [user?.theme]);

  function handleLogin(u: User) {
    setUser(u);
    applyTheme(u.theme);
    api.models().then((m) => {
      setModels(m.models);
      if (m.models.length > 0) setModel(m.models[0]!.id);
    }).catch(() => {});
    api.tools().then((t) => setOcrAvailable(t.tools.some((x) => x.name === "ocr" && x.available))).catch(() => {});
    refreshConvs();
  }

  function logout() {
    api.logout().finally(() => {});
    clearToken();
    setUser(null);
    setConvs([]);
    setMessages([]);
    setActiveId(null);
    setAttachments([]);
    setFilePreview(null);
  }

  async function newChat() {
    try {
      const res = await api.createConv({ model });
      await refreshConvs(res.conversation.id);
    } catch {
      // fall back to local-only pending state
    }
  }

  async function send(text: string) {
    if (sending || !model) return;
    let convId = activeId;
    if (!convId) {
      try {
        const res = await api.createConv({ model });
        convId = res.conversation.id;
        await refreshConvs(convId);
      } catch (err) {
        return;
      }
    }
    const userMsg: ChatMessage = { role: "user", content: text };
    // Attachments travel as reviewed text blocks appended to the message.
    const blocks = attachments.map((a) =>
      `[attached ${a.kind === "ocr" ? "image transcription" : "text file"}: ${a.name}]\n\`\`\`text\n${a.text}\n\`\`\``,
    );
    if (blocks.length > 0) userMsg.content = [text, ...blocks].filter(Boolean).join("\n\n");
    const history = [...messages, userMsg];
    setMessages(history);
    setAttachments([]);
    setSending(true);
    setStreaming("");
    let full = "";
    try {
      // "Thinking" feature flag: decorate the outgoing payload only — the
      // system message is never shown nor persisted client-side.
      const outMessages = featureEnabled("thinking")
        ? [{ role: "system", content: THINKING_SYSTEM_PROMPT } as ChatMessage, ...history]
        : history;
      await api.chatStream({ model, messages: outMessages, conversationId: convId! }, (t) => {
        full += t;
        setStreaming(full);
      });
      setMessages([...history, { role: "assistant", content: full }]);
      setStreaming("");
      await refreshConvs();
    } catch {
      setMessages([...history, { role: "assistant", content: "**Error:** the model did not respond. Try again." }]);
      setStreaming("");
    } finally {
      setSending(false);
    }
  }

  /** Platform-tools upload flow: image -> OCR, text -> CDN, both previewed before attach. */
  async function handlePickFile(kind: "ocr" | "text", file: File) {
    if (!user) return;
    setAttachError(null);
    if (kind === "ocr" && file.size > 5 * 1024 * 1024) {
      setAttachError("Image too large (max 5MB).");
      return;
    }
    if (kind === "text" && file.size > 500 * 1024) {
      setAttachError("Text file too large (max 500KB).");
      return;
    }
    setFilePreview({ name: file.name, kind, text: "", truncated: false });
    setPreviewBusy(true);
    try {
      if (kind === "ocr") {
        const r = await api.ocrImage(file);
        setFilePreview({ name: file.name, kind, text: r.text, truncated: r.truncated });
      } else {
        const key = `${user.id}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
        const put = await fetch(`/cdn/text/${key}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "text/plain" },
          body: file,
        });
        const pdata = (await put.json().catch(() => ({}))) as { error?: string; url?: string };
        if (!put.ok || !pdata.url) throw new Error(pdata.error || `Upload failed (${put.status})`);
        const text = await (await fetch(pdata.url)).text();
        setFilePreview({ name: file.name, kind, text, truncated: false });
      }
    } catch (e) {
      setFilePreview(null);
      setAttachError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPreviewBusy(false);
    }
  }

  function attachPreviewText(text: string) {
    if (!filePreview || !text.trim()) return;
    setAttachments((prev) => [...prev, { id: crypto.randomUUID(), name: filePreview.name, kind: filePreview.kind, text }]);
    setFilePreview(null);
  }

  async function removeConv(c: Conversation) {    try {
      await api.deleteConv(c.id);
      if (activeId === c.id) {
        setActiveId(null);
        setMessages([]);
      }
      await refreshConvs();
    } catch {
      // ignore
    }
  }

  if (checking) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  const active = convs.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        user={user}
        convs={convs}
        activeId={activeId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(true)}
        onNew={() => { newChat(); setMobileNav(false); }}
        onSelect={(id) => { setActiveId(id); setMobileNav(false); }}
        onRename={setEditConv}
        onTopic={setEditConv}
        onShare={setShareConv}
        onDelete={setDeleteConv}
        onOpenSettings={() => { setSettingsOpen(true); setMobileNav(false); }}
        onOpenAdmin={() => { window.location.href = "/admin"; }}
        onLogout={logout}
        mobileOpen={mobileNav}
        onCloseMobile={() => setMobileNav(false)}
      />
      <Chat
        user={user}
        conv={active}
        messages={messages}
        streaming={streaming}
        sending={sending}
        models={models}
        model={model}
        onModelChange={setModel}
        onSend={send}
        onShare={() => active && setShareConv(active)}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={() => setSidebarCollapsed(false)}
        onOpenNav={() => setMobileNav(true)}
        attachments={attachments}
        attachError={attachError}
        ocrAvailable={ocrAvailable}
        onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        onPickFile={handlePickFile}
      />
      <FilePreviewModal
        preview={filePreview}
        busy={previewBusy}
        onClose={() => { if (!previewBusy) setFilePreview(null); }}
        onAttach={attachPreviewText}
      />

      <ConvEditDialog
        conv={editConv}
        onClose={() => setEditConv(null)}
        onSaved={(c) => {
          setConvs((prev) => prev.map((x) => (x.id === c.id ? c : x)));
        }}
      />
      <ShareModal conv={shareConv} onClose={() => setShareConv(null)} />
      <ConfirmDialog
        open={deleteConv !== null}
        onClose={() => setDeleteConv(null)}
        title="Delete conversation?"
        message={`"${deleteConv?.title}" and all its messages will be permanently removed.`}
        onConfirm={() => deleteConv && removeConv(deleteConv)}
      />
      <SettingsModal
        user={settingsOpen ? user : null}
        onClose={() => setSettingsOpen(false)}
        onSaved={(u) => {
          setUser(u);
          applyTheme(u.theme);
        }}
        // Key rotated or account deleted: sessions are dead server-side.
        onKeyRotated={() => { setSettingsOpen(false); logout(); }}
      />
    </div>
  );
}
