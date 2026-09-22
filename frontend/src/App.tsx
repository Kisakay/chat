import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearToken, getToken } from "./lib/api.ts";
import { featureEnabled, THINKING_SYSTEM_PROMPT } from "./lib/features.ts";
import type {
  Attachment,
  ChatMessage,
  Conversation,
  DriverModel,
  FilePreview,
  User,
} from "./lib/types.ts";
import { chatIdFromPath, isChatPath, navigate, normalizePath, useRoute } from "./lib/route.ts";
import { Login } from "./components/Login.tsx";
import { RegisterPage } from "./components/RegisterPage.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Chat } from "./components/Chat.tsx";
import {
  ConvEditDialog,
  FilePreviewModal,
  SettingsModal,
  ShareModal,
} from "./components/dialogs.tsx";
import { AdminCenter } from "./components/AdminCenter.tsx";
import { SharePage } from "./components/SharePage.tsx";
import { ResetPage } from "./components/ResetPage.tsx";
import { ReviewPage } from "./components/ReviewPage.tsx";
import { ConfirmDialog, LoadingScreen } from "./components/ui.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { pushToast } from "./lib/toasts.ts";
import { msUntilNextSolarSwitch, resolveThemeDark } from "./lib/solarTheme.ts";
import { useT } from "./lib/i18n.ts";

function shareIdFromPath(): string | null {
  const m = window.location.pathname.match(
    /^\/share\/([A-Za-z0-9_-]{6,64})\/?$/,
  );
  return m ? m[1]! : null;
}

// Module-level: the path never changes without a full reload, so hook order stays stable.
const SHARE_ID = typeof window !== "undefined" ? shareIdFromPath() : null;
const RESET_TOKEN = typeof window !== "undefined" ? resetTokenFromPath() : null;
const REVIEW_ID = typeof window !== "undefined" ? reviewIdFromPath() : null;
const IS_ADMIN_PAGE =
  typeof window !== "undefined" &&
  /^\/admin\/?$/.test(window.location.pathname);

function resetTokenFromPath(): string | null {
  const m = window.location.pathname.match(
    /^\/reset\/([A-Za-z0-9_-]{6,80})\/?$/,
  );
  return m ? m[1]! : null;
}

function reviewIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/review\/([0-9a-f-]{36})\/?$/i);
  return m ? m[1]! : null;
}

/** Minimum time the boot splash stays visible, so the bloom animation
 *  actually plays even when the session restores instantly. */
const MIN_SPLASH_MS = 1100;

/** Max footer-arrow retries for the same failed model prompt. */
const MAX_RETRIES = 3;

function applyTheme(theme: string) {
  const root = document.documentElement;
  const dark = resolveThemeDark(theme);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  // Boot splash ONLY on the platform routes (/ and /chat, with a token).
  // /login and /register never show it — they render instantly.
  const [checking, setChecking] = useState(() => {
    if (SHARE_ID || RESET_TOKEN || REVIEW_ID || IS_ADMIN_PAGE) return false;
    const p = normalizePath(window.location.pathname);
    if (p === "/login" || p === "/register") return false;
    return !!getToken();
  });
  // True once we know whether there is a session (no token = instant).
  const [authReady, setAuthReady] = useState(() => !getToken());
  const rawRoute = useRoute();
  const path = normalizePath(rawRoute);
  const [models, setModels] = useState<DriverModel[]>([]);
  const [model, setModel] = useState("");
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Async callbacks (refreshConvs) need the current selection without
  // re-creating on every render.
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  // True once the conversation list was fetched at least once (so an
  // unknown /chat/<id> can be bounced instead of flashing empty).
  const [convsReady, setConvsReady] = useState(false);
  // Conversation opened from "Archived chats" (read-only, not in the sidebar list).
  const [archivedConv, setArchivedConv] = useState<Conversation | null>(null);
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
  const [reportsEnabled, setReportsEnabled] = useState(true);
  const [usernameChangeEnabled, setUsernameChangeEnabled] = useState(true);
  // Model-error retry: which trailing message is the error bubble (if any),
  // its conversation, and how many times this prompt was already retried.
  const [failed, setFailed] = useState<{ index: number; convId: string } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { t } = useT();

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

  // Reload the sidebar list; resolves the id that ends up selected so
  // callers can sync the URL (/chat/<id>) with it.
  const refreshConvs = useCallback(async (select?: string): Promise<string | null> => {
    try {
      const res = await api.convs();
      setConvs(res.conversations);
      setConvsReady(true);
      let next: string | null = null;
      if (select) {
        next = res.conversations.some((c) => c.id === select) ? select : null;
      } else {
        const cur = activeIdRef.current;
        next =
          cur && res.conversations.some((c) => c.id === cur)
            ? cur
            : (res.conversations[0]?.id ?? null);
      }
      setActiveId(next);
      return next;
    } catch {
      // ignore (session errors reload the page via api layer)
      return activeIdRef.current;
    }
  }, []);

  // Session restore (boot splash stays at least MIN_SPLASH_MS on / and /chat)
  useEffect(() => {
    const t0 = Date.now();
    const done = () => {
      const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - t0));
      window.setTimeout(() => setChecking(false), wait);
    };
    if (!getToken()) {
      setAuthReady(true);
      setChecking(false);
      return;
    }
    api
      .verify()
      .then(async (res) => {
        setUser(res.user);
        applyTheme(res.user.theme);
        const [m, c, t] = await Promise.all([
          api.models().catch(() => ({ models: [] })),
          api.convs().catch(() => ({ conversations: [] })),
          api
            .tools()
            .catch(() => ({
              tools: [] as { name: string; available: boolean }[],
              reportsEnabled: true,
              usernameChangeEnabled: true,
            })),
        ]);
        setOcrAvailable(t.tools.some((x) => x.name === "ocr" && x.available));
        setReportsEnabled(t.reportsEnabled ?? true);
        setUsernameChangeEnabled(t.usernameChangeEnabled ?? true);
        setModels(m.models);
        if (m.models.length > 0) setModel(m.models[0]!.id);
        setConvs(c.conversations);
        setConvsReady(true);
        // Deep link: /chat/<id> opens that conversation directly.
        const urlId = chatIdFromPath(window.location.pathname);
        if (urlId && c.conversations.some((x) => x.id === urlId)) {
          setActiveId(urlId);
        } else if (urlId) {
          navigate("/chat", true); // unknown or deleted id
        } else if (c.conversations.length > 0) {
          const first = c.conversations[0]!.id;
          setActiveId(first);
          navigate(`/chat/${first}`, true);
        }
      })
      .catch(() => {})
      .finally(() => {
        setAuthReady(true);
        done();
      });
  }, []);

  // Route guard: / redirects by session, /chat needs auth, /login and
  // /register bounce logged-in users to /chat. Public routes return above.
  useEffect(() => {
    if (SHARE_ID || RESET_TOKEN || REVIEW_ID || IS_ADMIN_PAGE) return;
    const noToken = !getToken();
    if (path === "/") {
      if (noToken) navigate("/login", true);
      else if (authReady) navigate(user ? "/chat" : "/login", true);
      return;
    }
    if (path === "/login" || path === "/register") {
      if (user) navigate("/chat", true);
      return;
    }
    if (isChatPath(path)) {
      if (noToken || (authReady && !user)) navigate("/login", true);
      return;
    }
    // Unknown path: land on the platform or the login page.
    if (noToken) navigate("/login", true);
    else if (authReady) navigate(user ? "/chat" : "/login", true);
  }, [path, user, authReady]);

  // Browser back/forward (or manual URL edit): the URL is the source of
  // truth for the selected conversation. Own navigations are no-ops here
  // (state already matches), so this never fights the handlers below.
  useEffect(() => {
    if (!user || checking || !isChatPath(path)) return;
    const id = chatIdFromPath(path);
    if (id === activeId) return;
    // Back to bare /chat (id null): empty composer, unless an archived
    // chat is being viewed — archived views always live on bare /chat.
    if (id !== null || !archivedConv) {
      setArchivedConv(null);
      setActiveId(id);
      setMobileNav(false);
    }
  }, [path, user, checking, activeId, archivedConv]);

  // Unknown /chat/<id> (deleted elsewhere, typo): bounce to /chat once
  // the list is loaded. Archived views always live on bare /chat.
  useEffect(() => {
    if (!user || checking || !convsReady || !isChatPath(path)) return;
    const id = chatIdFromPath(path);
    if (id && !convs.some((c) => c.id === id)) navigate("/chat", true);
  }, [path, user, checking, convsReady, convs]);

  // Load messages for active conversation
  useEffect(() => {
    setFailed(null);
    setRetryCount(0);
    if (!activeId) {
      setMessages([]);
      return;
    }
    api
      .getConv(activeId)
      .then((res) => setMessages(res.messages))
      .catch(() => setMessages([]));
  }, [activeId]);

  // Follow OS theme when account theme is auto; follow local time (07:00–19:00)
  // when account theme is sunset — re-applied at each day/night boundary.
  useEffect(() => {
    if (user?.theme === "sunset") {
      let timer: number | undefined;
      const schedule = () => {
        timer = window.setTimeout(() => {
          applyTheme("sunset");
          schedule();
        }, msUntilNextSolarSwitch());
      };
      schedule();
      return () => window.clearTimeout(timer);
    }
    if (user?.theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme("auto");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [user?.theme]);

  function handleLogin(u: User) {
    setUser(u);
    setAuthReady(true);
    setChecking(false);
    applyTheme(u.theme);
    navigate("/chat", true);
    api
      .models()
      .then((m) => {
        setModels(m.models);
        if (m.models.length > 0) setModel(m.models[0]!.id);
      })
      .catch(() => {});
    api
      .tools()
      .then((t) => {
        setOcrAvailable(t.tools.some((x) => x.name === "ocr" && x.available));
        setReportsEnabled(t.reportsEnabled ?? true);
        setUsernameChangeEnabled(t.usernameChangeEnabled ?? true);
      })
      .catch(() => {});
    // Land directly on the latest conversation's own URL.
    refreshConvs().then((id) => {
      if (id) navigate(`/chat/${id}`, true);
    });
  }

  function logout() {
    api.logout().finally(() => {});
    clearToken();
    setUser(null);
    setAuthReady(true);
    setChecking(false);
    setConvs([]);
    setMessages([]);
    setFailed(null);
    setRetryCount(0);
    setActiveId(null);
    setArchivedConv(null);
    setAttachments([]);
    setFilePreview(null);
    navigate("/login", true);
  }

  /** Stream one assistant reply for an exact history; resolves its text. */
  async function streamReply(history: ChatMessage[], convId: string): Promise<string> {
    // "Thinking" feature flag: decorate the outgoing payload only — the
    // system message is never shown nor persisted client-side.
    const outMessages = featureEnabled("thinking")
      ? [
          { role: "system", content: THINKING_SYSTEM_PROMPT } as ChatMessage,
          ...history,
        ]
      : history;
    let full = "";
    await api.chatStream({ model, messages: outMessages, conversationId: convId }, (t) => {
      full += t;
      setStreaming(full);
    });
    return full;
  }

  async function send(text: string) {
    if (sending || !model || archivedConv) return;
    let convId = activeId;
    if (!convId) {
      try {
        const res = await api.createConv({ model });
        convId = res.conversation.id;
        await refreshConvs(convId);
        navigate(`/chat/${convId}`);
      } catch (err) {
        return;
      }
    }
    const userMsg: ChatMessage = { role: "user", content: text };
    // Attachments travel as reviewed text blocks appended to the message.
    const blocks = attachments.map(
      (a) =>
        t("attach.tpl", {
          kind: t(a.kind === "ocr" ? "attach.kindOcr" : "attach.kindText"),
          name: a.name,
        }) + `\n\`\`\`text\n${a.text}\n\`\`\``,
    );
    if (blocks.length > 0)
      userMsg.content = [text, ...blocks].filter(Boolean).join("\n\n");
    const history = [...messages, userMsg];
    setMessages(history);
    setAttachments([]);
    setFailed(null);
    setRetryCount(0);
    setSending(true);
    setStreaming("");
    try {
      const full = await streamReply(history, convId!);
      setMessages([...history, { role: "assistant", content: full }]);
      setStreaming("");
      await refreshConvs();
    } catch {
      setMessages([
        ...history,
        { role: "assistant", content: t("attach.chatError") },
      ]);
      setFailed({ index: history.length, convId: convId! });
      setStreaming("");
    } finally {
      setSending(false);
    }
  }

  /**
   * Re-run the same prompt after a model error (footer retry arrow on the
   * error bubble). The trailing error message is dropped and the untouched
   * history is streamed again — at most MAX_RETRIES times per prompt.
   */
  async function retryFailed() {
    if (sending || !failed || retryCount >= MAX_RETRIES || !model || archivedConv) return;
    const history = messages.slice(0, failed.index);
    const convId = failed.convId;
    setMessages(history);
    setFailed(null);
    setRetryCount((c) => c + 1);
    setSending(true);
    setStreaming("");
    try {
      const full = await streamReply(history, convId);
      setMessages([...history, { role: "assistant", content: full }]);
      setRetryCount(0);
      await refreshConvs();
    } catch {
      setMessages([
        ...history,
        { role: "assistant", content: t("attach.chatError") },
      ]);
      setFailed({ index: history.length, convId });
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
      setAttachError(t("attach.tooBigImg"));
      return;
    }
    if (kind === "text" && file.size > 500 * 1024) {
      setAttachError(t("attach.tooBigText"));
      return;
    }
    setFilePreview({ name: file.name, kind, text: "", truncated: false });
    setPreviewBusy(true);
    try {
      if (kind === "ocr") {
        const r = await api.ocrImage(file);
        setFilePreview({
          name: file.name,
          kind,
          text: r.text,
          truncated: r.truncated,
        });
      } else {
        const key = `${user.id}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
        const put = await fetch(`/cdn/text/${key}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${getToken()}`,
            "Content-Type": "text/plain",
          },
          body: file,
        });
        const pdata = (await put.json().catch(() => ({}))) as {
          error?: string;
          url?: string;
        };
        if (!put.ok || !pdata.url)
          throw new Error(pdata.error || `Upload failed (${put.status})`);
        const text = await (await fetch(pdata.url)).text();
        setFilePreview({ name: file.name, kind, text, truncated: false });
      }
    } catch (e) {
      setFilePreview(null);
      setAttachError(e instanceof Error ? e.message : t("attach.uploadFailed"));
    } finally {
      setPreviewBusy(false);
    }
  }

  function attachPreviewText(text: string) {
    if (!filePreview || !text.trim()) return;
    setAttachments((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: filePreview.name,
        kind: filePreview.kind,
        text,
      },
    ]);
    setFilePreview(null);
  }

  async function removeConv(c: Conversation) {
    try {
      await api.deleteConv(c.id);
      if (activeId === c.id) {
        setActiveId(null);
        setMessages([]);
      }
      if (archivedConv?.id === c.id) {
        setArchivedConv(null);
        setMessages([]);
      }
      const next = await refreshConvs();
      navigate(next ? `/chat/${next}` : "/chat");
      pushToast(t("toast.chatDeleted", { title: c.title }), { icon: "trash" });
    } catch {
      // ignore
    }
  }

  /** Archive from the sidebar menu: the chat leaves the side list. */
  async function archiveConv(c: Conversation) {
    try {
      await api.archiveConv(c.id);
      if (activeId === c.id) {
        setActiveId(null);
        setMessages([]);
      }
      const next = await refreshConvs();
      navigate(next ? `/chat/${next}` : "/chat");
      pushToast(t("toast.chatArchived", { title: c.title }), { icon: "archive" });
    } catch {
      // ignore
    }
  }

  /** Open an archived chat (from settings) read-only in the main view. */
  function openArchived(c: Conversation) {
    setSettingsOpen(false);
    setMobileNav(false);
    setArchivedConv(c);
    setActiveId(null);
    setMessages([]);
    // Archived views always live on bare /chat (no per-conversation URL).
    navigate("/chat");
    api
      .getConv(c.id)
      .then((res) => setMessages(res.messages))
      .catch(() => setMessages([]));
  }

  /** Unarchive the currently viewed archived chat and select it. */
  async function unarchiveActive() {
    if (!archivedConv) return;
    try {
      await api.unarchiveConv(archivedConv.id);
      const id = archivedConv.id;
      pushToast(t("toast.chatUnarchived", { title: archivedConv.title }), { icon: "unarchive" });
      setArchivedConv(null);
      await refreshConvs(id);
      navigate(`/chat/${id}`);
    } catch {
      // ignore
    }
  }

  /**
   * Settings "Archived chats" changed something: refresh the sidebar, and
   * drop the read-only view if its conversation was deleted underneath us.
   */
  async function handleArchivedChanged(deletedId?: string) {
    if (deletedId && archivedConv?.id === deletedId) {
      setArchivedConv(null);
      setMessages([]);
      navigate("/chat");
    }
    await refreshConvs();
  }

  /**
   * Settings "Providers" changed (key saved/removed): reload the model menu
   * so connected providers appear (or disappear) at the top without a
   * page refresh. The current pick survives when still available.
   */
  async function handleProvidersChanged() {
    try {
      const m = await api.models();
      setModels(m.models);
      setModel((cur) =>
        cur && m.models.some((x) => x.id === cur) ? cur : (m.models[0]?.id ?? ""),
      );
    } catch {
      // ignore (session errors reload the page via api layer)
    }
  }

  // Auth pages render instantly (no splash); the platform boots behind one.
  if (path === "/login") {
    if (user) return null; // bounce to /chat imminent
    return <Login onLogin={handleLogin} />;
  }
  if (path === "/register") {
    if (user) return null; // bounce to /chat imminent
    return <RegisterPage />;
  }

  if (checking) {
    return <LoadingScreen />;
  }

  // / (or unknown paths) while the guard above redirects.
  if (!isChatPath(path)) {
    return null;
  }

  if (!user) {
    return null; // bounce to /login imminent (no splash flash)
  }

  const active = convs.find((c) => c.id === activeId) ?? archivedConv;
  const readOnly = (active?.archived_at ?? 0) !== 0;

  return (
    <div className="flex h-full">
      <Sidebar
        user={user}
        convs={convs}
        activeId={activeId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(true)}
        onNew={() => {
          // Bare /chat with an empty composer; the conversation is
          // created lazily on send (then the URL becomes /chat/<id>).
          setArchivedConv(null);
          setActiveId(null);
          setMessages([]);
          setFailed(null);
          setRetryCount(0);
          navigate("/chat");
          setMobileNav(false);
        }}
        onSelect={(id) => {
          setArchivedConv(null);
          setActiveId(id);
          navigate(`/chat/${id}`);
          setMobileNav(false);
        }}
        onRename={setEditConv}
        onTopic={setEditConv}
        onShare={setShareConv}
        onArchive={archiveConv}
        onDelete={setDeleteConv}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setMobileNav(false);
        }}
        onOpenAdmin={() => {
          window.location.href = "/admin";
        }}
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
        onModelChange={(id) => {
          setModel(id);
          pushToast(t("toast.modelChanged", { label: models.find((m) => m.id === id)?.label ?? id }), {
            icon: "model",
            tag: "model",
          });
        }}
        onSend={send}
        onShare={() => active && setShareConv(active)}
        readOnly={readOnly}
        onUnarchive={unarchiveActive}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={() => setSidebarCollapsed(false)}
        onOpenNav={() => setMobileNav(true)}
        attachments={attachments}
        attachError={attachError}
        ocrAvailable={ocrAvailable}
        reportsEnabled={reportsEnabled}
        onRemoveAttachment={(id) =>
          setAttachments((prev) => prev.filter((a) => a.id !== id))
        }
        onPickFile={handlePickFile}
        failedIndex={failed?.index ?? null}
        retryCount={retryCount}
        maxRetries={MAX_RETRIES}
        onRetry={readOnly ? undefined : retryFailed}
      />
      <FilePreviewModal
        preview={filePreview}
        busy={previewBusy}
        onClose={() => {
          if (!previewBusy) setFilePreview(null);
        }}
        onAttach={attachPreviewText}
      />

      <ConvEditDialog
        conv={editConv}
        onClose={() => setEditConv(null)}
        onSaved={(c) => {
          setConvs((prev) => prev.map((x) => (x.id === c.id ? c : x)));
          pushToast(t("toast.convUpdated", { title: c.title }), { icon: "edit" });
        }}
      />
      <ShareModal conv={shareConv} onClose={() => setShareConv(null)} />
      <ConfirmDialog
        open={deleteConv !== null}
        onClose={() => setDeleteConv(null)}
        title={t("app.deleteConvTitle")}
        message={t("app.deleteConvMsg", { title: deleteConv?.title ?? "" })}
        onConfirm={() => deleteConv && removeConv(deleteConv)}
      />
      <SettingsModal
        user={settingsOpen ? user : null}
        usernameChangeEnabled={usernameChangeEnabled}
        onClose={() => setSettingsOpen(false)}
        onSaved={(u) => {
          if (u.theme !== user?.theme) {
            pushToast(t("toast.themeChanged"), { icon: "theme", tag: "theme" });
          } else {
            pushToast(t("toast.settingsSaved"), { icon: "check" });
          }
          setUser(u);
          applyTheme(u.theme);
        }}
        // Key rotated or account deleted: sessions are dead server-side.
        onKeyRotated={() => {
          setSettingsOpen(false);
          logout();
        }}
        onViewArchived={openArchived}
        onArchivedChanged={handleArchivedChanged}
        onProvidersChanged={handleProvidersChanged}
      />
      <Toasts />
    </div>
  );
}
