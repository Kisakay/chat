import { useEffect, useRef, useState } from "react";
import { BookOpen, Bot, Cpu, FileText, Menu, PanelLeftOpen, Paperclip, ScanText, SendHorizontal, Share2, User as UserIcon, X } from "lucide-react";
import type { Attachment, ChatMessage, Conversation, DriverModel, User } from "../lib/types.ts";
import { AssistantAvatar, Avatar, FlowerMark, IconButton, Picker, type PickerGroup, Spinner } from "./ui.tsx";
import { Markdown } from "./Markdown.tsx";
import { cn } from "../lib/cn.ts";
import { useFeatures } from "../lib/features.ts";

function MessageBubble({ msg, authorAvatar, authorName }: { msg: ChatMessage; authorAvatar?: string; authorName: string }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {isUser
        ? <Avatar name={authorName} url={authorAvatar} size={32} />
        : <AssistantAvatar size={32} />}
      <div className={cn("min-w-0 max-w-[85%]", isUser && "flex flex-col items-end")}>
        <div className="mb-1 flex items-center gap-1.5 text-xs opacity-60">
          {isUser ? <UserIcon size={12} /> : <Bot size={12} />}
          {isUser ? "You" : "KisAssistant"}
        </div>
        {isUser ? (
          <div className="whitespace-pre-wrap rounded-3xl rounded-tr-lg bg-accent-600 px-4 py-2.5 text-[15px] text-white dark:bg-accent-500 dark:text-zinc-950">
            {msg.content}
          </div>
        ) : (
          <div className="rounded-3xl rounded-tl-lg border border-stone-200/70 bg-white px-5 py-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <Markdown text={msg.content} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Chat({
  user,
  conv,
  messages,
  streaming,
  sending,
  models,
  model,
  onModelChange,
  onSend,
  onShare,
  sidebarCollapsed,
  onExpandSidebar,
  onOpenNav,
  attachments,
  attachError,
  ocrAvailable,
  onRemoveAttachment,
  onPickFile,
}: {
  user: User;
  conv: Conversation | null;
  messages: ChatMessage[];
  streaming: string;
  sending: boolean;
  models: DriverModel[];
  model: string;
  onModelChange: (m: string) => void;
  onSend: (text: string) => void;
  onShare: () => void;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  onOpenNav: () => void;
  attachments: Attachment[];
  attachError: string | null;
  ocrAvailable: boolean;
  onRemoveAttachment: (id: string) => void;
  onPickFile: (kind: "ocr" | "text", file: File) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const features = useFeatures();
  const boxRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const txtRef = useRef<HTMLInputElement>(null);

  const modelGroups: PickerGroup[] = (() => {
    const byDriver = new Map<string, { value: string; label: string; hint: string }[]>();
    for (const m of models) {
      const list = byDriver.get(m.driver) ?? [];
      list.push({ value: m.id, label: m.label, hint: m.id });
      byDriver.set(m.driver, list);
    }
    return [...byDriver.entries()].map(([driver, options]) => ({ group: driver, options }));
  })();

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  function autoGrow() {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    requestAnimationFrame(autoGrow);
    onSend(text);
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-stone-200/70 px-4 py-2.5 backdrop-blur dark:border-zinc-800">
        <IconButton title="Open chats" onClick={onOpenNav} className="md:hidden">
          <Menu size={18} />
        </IconButton>
        {sidebarCollapsed && (
          <span className="hidden md:inline">
            <IconButton title="Expand sidebar" onClick={onExpandSidebar}>
              <PanelLeftOpen size={18} />
            </IconButton>
          </span>
        )}
        <span className="hidden items-center gap-2 font-semibold sm:flex">
          <FlowerMark size={24} dynamic={false} />
          {conv?.title || "New chat"}
        </span>
        {conv?.topic && (
          <span className="hidden rounded-full bg-stone-200/70 px-2.5 py-0.5 text-xs opacity-80 md:inline dark:bg-zinc-800">{conv.topic}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Picker
            ariaLabel="Model"
            icon={Cpu}
            value={model}
            onChange={onModelChange}
            groups={modelGroups}
            placeholder={models.length === 0 ? "No models" : "Select model…"}
            disabled={models.length === 0}
          />
          {conv && (
            <IconButton title="Share publicly" onClick={onShare}>
              <Share2 size={17} />
            </IconButton>
          )}
        </div>
      </header>

      <div ref={boxRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          {messages.length === 0 && !streaming && (
            <div className="py-16 text-center">
              <FlowerMark size={56} dynamic={false} className="mx-auto mb-4" />
              <h2 className="text-2xl font-bold tracking-tight">How can I help, {user.displayName.split(" ")[0]}?</h2>
              <p className="mt-1 text-sm opacity-60">Pick a model, then type below. Markdown is supported.</p>
            </div>
          )}
          {messages.filter((m) => m.role !== "system").map((m, i) => (
            <MessageBubble key={i} msg={m} authorAvatar={user.avatarUrl} authorName={user.displayName} />
          ))}
          {streaming !== "" && (
            <div className="flex gap-3">
              <AssistantAvatar size={32} />
              <div className="min-w-0 max-w-[85%]">
                <div className="mb-1 text-xs opacity-60">KisAssistant</div>
                <div className="rounded-3xl rounded-tl-lg border border-stone-200/70 bg-white px-5 py-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="typing-cursor"><Markdown text={streaming} /></div>
                </div>
              </div>
            </div>
          )}
          {sending && streaming === "" && (
            <div className="flex items-center gap-2 opacity-60"><Spinner size={15} /><span className="text-sm">Thinking…</span></div>
          )}
        </div>
      </div>

      <div className="px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          {attachError && (
            <p className="mb-2 rounded-2xl bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400" role="alert">{attachError}</p>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span key={a.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent-600/30 bg-accent-600/10 py-1 pl-3 pr-1.5 text-xs font-medium dark:border-accent-500/30 dark:bg-accent-500/10">
                  {a.kind === "ocr" ? <ScanText size={13} /> : <FileText size={13} />}
                  <span className="max-w-40 truncate">{a.name}</span>
                  <button onClick={() => onRemoveAttachment(a.id)} aria-label={`Remove ${a.name}`} className="rounded-full p-1 transition hover:bg-black/10 dark:hover:bg-white/10">
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="relative mx-auto w-full max-w-3xl">
          {attachOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAttachOpen(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-3xl border border-stone-200 bg-white p-2 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  onClick={() => { setAttachOpen(false); imgRef.current?.click(); }}
                  disabled={!ocrAvailable}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
                    <ScanText size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">Transcribe image {ocrAvailable ? "" : "(unavailable)"}</span>
                    <span className="block text-xs opacity-60">JPG, PNG, WEBP — OCR on the server, you review the text first</span>
                  </span>
                </button>
                <button
                  onClick={() => { setAttachOpen(false); txtRef.current?.click(); }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-stone-100 dark:hover:bg-zinc-800"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
                    <FileText size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">Attach text file</span>
                    <span className="block text-xs opacity-60">TXT or Markdown, max 500KB</span>
                  </span>
                </button>
                <p className="px-3 pb-1.5 pt-2 text-xs opacity-60">
                  Uploads go through platform tools only. Images are sent to the model as reviewed text — never as raw images.
                </p>
              </div>
            </>
          )}
        </div>
        <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[1.75rem] border border-stone-200 bg-white p-2 pl-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {features.attachments && (
            <button
              type="button"
              onClick={() => setAttachOpen((o) => !o)}
              aria-label="Attach a file"
              title="Attach a file"
              className="grid h-10 w-10 shrink-0 -translate-y-[2px] place-items-center rounded-full transition hover:bg-stone-100 active:scale-95 dark:hover:bg-zinc-800"
            >
              <Paperclip size={17} className="opacity-70" />
            </button>
          )}
          <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile("ocr", f); e.target.value = ""; }} />
          <input ref={txtRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile("text", f); e.target.value = ""; }} />
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); autoGrow(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Message KisAssistant…"
            className="max-h-50 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-stone-400 dark:placeholder:text-zinc-500"
            style={{ maxHeight: 200 }}
          />
          <button
            type="submit"
            disabled={(!draft.trim() && attachments.length === 0) || sending}
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600 text-white shadow transition hover:bg-accent-500 active:scale-95 disabled:opacity-40 dark:bg-accent-500 dark:text-zinc-950 dark:hover:bg-accent-400"
          >
            <SendHorizontal size={17} />
          </button>
        </form>
        <p className="py-2 text-center text-xs opacity-50">
          <a href="/wiki" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
            <BookOpen size={12} />
            Wiki & docs
          </a>
        </p>
      </div>
    </div>
  );
}
