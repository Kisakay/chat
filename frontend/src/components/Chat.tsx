import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, BookOpen, Bot, Check, Copy, Cpu, FileText, Flag, Menu, PanelLeftOpen, Paperclip, ScanText, Search, SendHorizontal, Share2, User as UserIcon, X } from "lucide-react";
import type { Attachment, ChatMessage, Conversation, DriverModel, User } from "../lib/types.ts";
import { api, ApiError, type ReportReason } from "../lib/api.ts";
import { AssistantAvatar, Avatar, Button, Field, FlowerMark, IconButton, Modal, Picker, type PickerGroup, Spinner } from "./ui.tsx";
import { Markdown } from "./Markdown.tsx";
import { UserMessageContent } from "./MessageContent.tsx";
import { cn } from "../lib/cn.ts";
import { useFeatures } from "../lib/features.ts";
import { useT, type StringKey } from "../lib/i18n.ts";

const REPORT_REASONS: ReportReason[] = ["copyright", "gore", "falseinfo", "bug"];

function MessageBubble({ msg, index, authorAvatar, authorName, onReport }: { msg: ChatMessage; index: number; authorAvatar?: string; authorName: string; onReport?: (index: number) => void }) {
  const { t } = useT();
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }
  function searchWeb() {
    window.open(`https://duckduckgo.com/?q=${encodeURIComponent(msg.content.slice(0, 400))}`, "_blank", "noopener,noreferrer");
  }
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {isUser
        ? <Avatar name={authorName} url={authorAvatar} size={32} />
        : <AssistantAvatar size={32} />}
      <div className={cn("min-w-0 max-w-[85%]", isUser && "flex flex-col items-end")}>
        <div className="mb-1 flex items-center gap-1.5 text-xs opacity-60">
          {isUser ? <UserIcon size={12} /> : <Bot size={12} />}
          {isUser ? t("chat.you") : "KisAssistant"}
        </div>
        {isUser ? (
          <div className="break-words whitespace-pre-wrap rounded-3xl rounded-tr-lg bg-accent-600 px-4 py-2.5 text-[15px] text-white dark:bg-accent-500 dark:text-zinc-950">
            <UserMessageContent content={msg.content} />
          </div>
        ) : (
          <div className="rounded-3xl rounded-tl-lg border border-stone-200/70 bg-white px-5 py-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <Markdown text={msg.content} />
          </div>
        )}
        {!isUser && onReport && (
          <div className="mt-1.5 flex items-center gap-0.5 opacity-70 transition hover:opacity-100">
            <IconButton title={copied ? t("common.copied") : t("msg.copy")} onClick={copy}>
              {copied ? <Check size={14} className="text-accent-500" /> : <Copy size={14} />}
            </IconButton>
            <IconButton title={t("msg.search")} onClick={searchWeb}>
              <Search size={14} />
            </IconButton>
            <IconButton title={t("msg.report")} onClick={() => onReport(index)}>
              <Flag size={14} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportDialog({ open, onClose, conversationId, messageIndex, content, prompt, model }: {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  messageIndex: number;
  content: string;
  prompt: string;
  model: string;
}) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [duplicate, setDuplicate] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setDetails("");
      setError("");
      setSent(false);
      setDuplicate(false);
    }
  }, [open, messageIndex]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.createReport({
        conversationId: conversationId ?? undefined,
        messageIndex,
        reason: reason as ReportReason,
        details: details.trim(),
        content,
        prompt,
        model,
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDuplicate(true);
      } else {
        setError(err instanceof Error ? err.message : t("report.failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("report.title")} icon={Flag}>
      {sent || duplicate ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 rounded-2xl bg-emerald-600/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
            <Check size={16} /> {duplicate ? t("report.alreadyReported") : t("report.sent")}
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("report.reason")}>
            <Picker
              value={reason}
              onChange={setReason}
              options={REPORT_REASONS.map((r) => ({ value: r, label: t(`report.reason.${r}` as StringKey) }))}
              placeholder={t("report.reasonPh")}
              ariaLabel={t("report.reason")}
              align="left"
            />
          </Field>
          <Field label={t("report.details")}>
            <textarea
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t("report.detailsPh")}
              aria-label={t("report.details")}
              maxLength={2000}
              className="max-h-40 w-full resize-none rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent-500/60 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
            />
          </Field>
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={!reason || busy}>
              {busy ? <Spinner size={14} /> : <Flag size={14} />} {t("report.submit")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
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
  onUnarchive,
  readOnly,
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
  /** Archived chats render read-only; the banner offers to unarchive. */
  readOnly?: boolean;
  onUnarchive?: () => void;
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
  const [reportIndex, setReportIndex] = useState<number | null>(null);
  const { t } = useT();
  const features = useFeatures();
  const boxRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const txtRef = useRef<HTMLInputElement>(null);

  const modelGroups: PickerGroup[] = (() => {
    const byDriver = new Map<string, { value: string; label: string; hint: string }[]>();
    for (const m of models) {
      const group = m.group ?? m.driver;
      const list = byDriver.get(group) ?? [];
      list.push({ value: m.id, label: m.label, hint: m.id });
      byDriver.set(group, list);
    }
    return [...byDriver.entries()].map(([group, options]) => ({ group, options }));
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
    if (readOnly) return;
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    requestAnimationFrame(autoGrow);
    onSend(text);
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-stone-200/70 px-4 py-2.5 backdrop-blur dark:border-zinc-800">
        <IconButton title={t("chat.openNav")} onClick={onOpenNav} className="md:hidden">
          <Menu size={18} />
        </IconButton>
        {sidebarCollapsed && (
          <span className="hidden md:inline">
            <IconButton title={t("chat.expand")} onClick={onExpandSidebar}>
              <PanelLeftOpen size={18} />
            </IconButton>
          </span>
        )}
        <span className="hidden items-center gap-2 font-semibold sm:flex">
          <FlowerMark size={24} dynamic={false} />
          {conv?.title || t("sidebar.newChat")}
        </span>
        {conv?.topic && (
          <span className="hidden rounded-full bg-stone-200/70 px-2.5 py-0.5 text-xs opacity-80 md:inline dark:bg-zinc-800">{conv.topic}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Picker
            ariaLabel={t("chat.modelAria")}
            icon={Cpu}
            value={model}
            onChange={onModelChange}
            groups={modelGroups}
            placeholder={models.length === 0 ? t("chat.noModels") : t("chat.selectModel")}
            disabled={models.length === 0}
          />
          {conv && !readOnly && (
            <IconButton title={t("sidebar.share")} onClick={onShare}>
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
              <h2 className="text-2xl font-bold tracking-tight">{t("chat.greet", { name: user.displayName.split(" ")[0]! })}</h2>
              <p className="mt-1 text-sm opacity-60">{t("chat.greetSub")}</p>
            </div>
          )}
          {messages.filter((m) => m.role !== "system").map((m, i) => (
            <MessageBubble key={i} msg={m} index={i} authorAvatar={user.avatarUrl} authorName={user.displayName} onReport={readOnly ? undefined : setReportIndex} />
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
            <div className="flex items-center gap-2 opacity-60"><Spinner size={15} /><span className="text-sm">{t("chat.thinking")}</span></div>
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
                  <button onClick={() => onRemoveAttachment(a.id)} aria-label={t("chat.removeAttach", { name: a.name })} className="rounded-full p-1 transition hover:bg-black/10 dark:hover:bg-white/10">
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
                    <span className="block text-sm font-medium">{t("chat.ocrOpt")} {ocrAvailable ? "" : t("chat.unavailable")}</span>
                    <span className="block text-xs opacity-60">{t("chat.ocrHint")}</span>
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
                    <span className="block text-sm font-medium">{t("chat.textOpt")}</span>
                    <span className="block text-xs opacity-60">{t("chat.textHint")}</span>
                  </span>
                </button>
                <p className="px-3 pb-1.5 pt-2 text-xs opacity-60">
                  {t("chat.attachNote")}
                </p>
              </div>
            </>
          )}
        </div>
        {readOnly ? (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 rounded-[1.75rem] border border-stone-200 bg-stone-100 p-2 pl-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-800/60">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
              <Archive size={17} />
            </span>
            <p className="min-w-0 flex-1 text-sm opacity-70">{t("archived.readonly")}</p>
            <button
              type="button"
              onClick={onUnarchive}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-500 dark:bg-accent-500 dark:text-zinc-950 dark:hover:bg-accent-400"
            >
              <ArchiveRestore size={15} />
              {t("archived.unarchive")}
            </button>
          </div>
        ) : (
        <form onSubmit={submit} className={`mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[1.75rem] border border-stone-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${features.attachments ? "pl-2" : "pl-5"}`}>
          {features.attachments && (
            <button
              type="button"
              onClick={() => setAttachOpen((o) => !o)}
              aria-label={t("chat.attachTip")}
              title={t("chat.attachTip")}
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
            placeholder={t("chat.placeholder")}
            className="max-h-50 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-stone-400 dark:placeholder:text-zinc-500"
            style={{ maxHeight: 200 }}
          />
          <button
            type="submit"
            disabled={(!draft.trim() && attachments.length === 0) || sending}
            aria-label={t("chat.send")}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600 text-white shadow transition hover:bg-accent-500 active:scale-95 disabled:opacity-40 dark:bg-accent-500 dark:text-zinc-950 dark:hover:bg-accent-400"
          >
            <SendHorizontal size={17} />
          </button>
        </form>
        )}
        <p className="py-2 text-center text-xs opacity-50">
          <a href="/wiki" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
            <BookOpen size={12} />
            {t("chat.wiki")}
          </a>
        </p>
      </div>
      {(() => {
        const shown = messages.filter((m) => m.role !== "system");
        const target = reportIndex !== null ? shown[reportIndex] : undefined;
        const prev = reportIndex !== null && reportIndex > 0 ? shown[reportIndex - 1] : undefined;
        return (
          <ReportDialog
            open={reportIndex !== null}
            onClose={() => setReportIndex(null)}
            conversationId={conv?.id ?? null}
            messageIndex={reportIndex ?? 0}
            content={target?.content ?? ""}
            prompt={prev && prev.role === "user" ? prev.content : ""}
            model={conv?.model || model}
          />
        );
      })()}
    </div>
  );
}
