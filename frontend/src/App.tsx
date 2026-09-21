import { useCallback, useEffect, useState } from "react";
import { api, clearToken, getToken } from "./lib/api.ts";
import type { ChatMessage, Conversation, DriverModel, User } from "./lib/types.ts";
import { Login } from "./components/Login.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Chat } from "./components/Chat.tsx";
import { ConvEditDialog, SettingsModal, ShareModal } from "./components/dialogs.tsx";
import { AdminPanel } from "./components/AdminPanel.tsx";
import { SharePage } from "./components/SharePage.tsx";
import { ConfirmDialog } from "./components/ui.tsx";

function shareIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/share\/([A-Za-z0-9_-]{6,64})\/?$/);
  return m ? m[1]! : null;
}

// Module-level: the path never changes without a full reload, so hook order stays stable.
const SHARE_ID = typeof window !== "undefined" ? shareIdFromPath() : null;

function applyTheme(theme: string) {
  const root = document.documentElement;
  const dark =
    theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!SHARE_ID && !!getToken());
  const [models, setModels] = useState<DriverModel[]>([]);
  const [model, setModel] = useState("");
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editConv, setEditConv] = useState<Conversation | null>(null);
  const [shareConv, setShareConv] = useState<Conversation | null>(null);
  const [deleteConv, setDeleteConv] = useState<Conversation | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  // Public share route: no auth needed. SHARE_ID is constant for the page lifetime.
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
        const [m, c] = await Promise.all([api.models().catch(() => ({ models: [] })), api.convs().catch(() => ({ conversations: [] }))]);
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
    refreshConvs();
  }

  function logout() {
    api.logout().finally(() => {});
    clearToken();
    setUser(null);
    setConvs([]);
    setMessages([]);
    setActiveId(null);
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
    const history = [...messages, userMsg];
    setMessages(history);
    setSending(true);
    setStreaming("");
    let full = "";
    try {
      await api.chatStream({ model, messages: history, conversationId: convId! }, (t) => {
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

  async function removeConv(c: Conversation) {
    try {
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
    return <div className="grid min-h-full place-items-center text-sm opacity-60">Loading…</div>;
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
        onNew={newChat}
        onSelect={setActiveId}
        onRename={setEditConv}
        onTopic={setEditConv}
        onShare={setShareConv}
        onDelete={setDeleteConv}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
        onLogout={logout}
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
      />
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
    </div>
  );
}
