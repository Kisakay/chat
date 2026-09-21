import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  MailWarning,
  MessageSquareText,
  Search,
  SendHorizontal,
  XCircle,
} from "lucide-react";
import { api, type AccessMessage, type AccessRequest } from "../lib/api.ts";
import {
  Button,
  CopyButton,
  Field,
  FlowerMark,
  Input,
  Modal,
  Spinner,
} from "./ui.tsx";
import { useT, type StringKey } from "../lib/i18n.ts";
import { cn } from "../lib/cn.ts";

const STATUS_STYLE: Record<
  AccessRequest["status"],
  { cls: string; icon: typeof Clock }
> = {
  pending: {
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: Clock,
  },
  reviewing: {
    cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    icon: Search,
  },
  accepted: {
    cls: "bg-accent-500/10 text-accent-700 dark:text-accent-400",
    icon: CheckCircle2,
  },
  refused: {
    cls: "bg-red-500/10 text-red-600 dark:text-red-400",
    icon: XCircle,
  },
};

function StatusBadge({ status }: { status: AccessRequest["status"] }) {
  const { t } = useT();
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        s.cls,
      )}
    >
      <s.icon size={13} />
      {t(`review.status.${status}` as StringKey)}
    </span>
  );
}

/** Public ticket page: /review/:id — argue your case, follow the decision. */
export function ReviewPage({ ticketId }: { ticketId: string }) {
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [messages, setMessages] = useState<AccessMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const { t } = useT();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await api.accessTicket(ticketId);
      setRequest(res.request);
      setMessages(res.messages);
    } catch {
      setInvalid(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await api.accessReply(ticketId, body);
      setMessages((prev) => [...prev, res.message]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("access.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  const closed =
    request?.status === "accepted" || request?.status === "refused";

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-stone-100 via-stone-50 to-accent-100/60 p-4 dark:from-zinc-950 dark:via-zinc-950 dark:to-accent-950/40 sm:p-6">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-2xl backdrop-blur-xl dark:border-zinc-700/60 dark:bg-zinc-900/80 sm:p-8">
        <FlowerMark size={48} dynamic={false} className="mx-auto mb-3" />
        <h1 className="text-center font-serif text-2xl font-bold tracking-tight">
          {t("review.title")}
        </h1>

        {loading && (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm opacity-60">
            <Spinner size={15} /> {t("review.loadingTicket")}
          </p>
        )}

        {invalid && (
          <div className="mt-4 space-y-3 text-center">
            <p className="flex items-center justify-center gap-2 font-semibold">
              <MailWarning size={18} className="text-red-500" />{" "}
              {t("review.notFound")}
            </p>
            <p className="text-sm opacity-70">{t("review.notFoundSub")}</p>
            <Button size="sm" onClick={() => (window.location.href = "/")}>
              {t("common.backToLogin")}
            </Button>
          </div>
        )}

        {request && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <StatusBadge status={request.status} />
              <span className="text-sm opacity-70">@{request.username}</span>
            </div>
            {request.reason && (
              <p className="rounded-2xl bg-stone-100 px-4 py-2.5 text-center text-sm dark:bg-zinc-800">
                <span className="font-medium">{t("review.adminNote")} </span>
                {request.reason}
              </p>
            )}
            {request.status === "accepted" && (
              <p className="rounded-2xl bg-accent-500/10 px-4 py-2.5 text-center text-sm">
                {t("review.acceptedHint")}
              </p>
            )}

            <div className="max-h-80 space-y-2.5 overflow-y-auto rounded-2xl border border-stone-200/70 p-3 dark:border-zinc-800">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex",
                    m.author === "admin" ? "justify-start" : "justify-end",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                      m.author === "admin"
                        ? "rounded-tl-lg bg-stone-200/70 dark:bg-zinc-800"
                        : "rounded-tr-lg bg-accent-600 text-white dark:bg-accent-500 dark:text-zinc-950",
                    )}
                  >
                    <p className="mb-0.5 text-[11px] font-medium opacity-70">
                      {m.author === "admin"
                        ? t("review.admin")
                        : t("review.you")}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {closed ? (
              <p className="text-center text-xs opacity-60">
                {t("review.closedHint")}
              </p>
            ) : (
              <form onSubmit={send} className="space-y-2">
                <div className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("review.replyPh")}
                    aria-label={t("review.replyAria")}
                    className="max-h-40 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent-500/60 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || sending}
                    aria-label={t("chat.send")}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600 text-white shadow transition hover:bg-accent-500 active:scale-95 disabled:opacity-40 dark:bg-accent-500 dark:text-zinc-950 dark:hover:bg-accent-400"
                  >
                    {sending ? (
                      <Spinner size={16} />
                    ) : (
                      <SendHorizontal size={16} />
                    )}
                  </button>
                </div>
                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )}
                <p className="text-center text-xs opacity-60">
                  {t("review.mailHint")}
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Wishlist form: reserve a username + email with a motivation message. */
export function AccessRequestModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useT();
  const [done, setDone] = useState<{
    reviewUrl: string;
    username: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setUsername("");
      setEmail("");
      setMessage("");
      setError("");
      setDone(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.accessRequest({
        username: username.trim().toLowerCase(),
        email: email.trim(),
        message: message.trim(),
      });
      setDone({ reviewUrl: res.reviewUrl, username: res.request.username });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dlg.reqFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("review.requestTitle")}
      icon={MessageSquareText}
    >
      {done ? (
        <div className="space-y-4 text-center">
          <p className="flex items-center justify-center gap-2 font-semibold text-accent-700 dark:text-accent-400">
            <CheckCircle2 size={18} /> {t("review.received")}
          </p>
          <p className="text-sm opacity-70">
            {t("review.reserved", { user: done.username })}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-2xl bg-stone-100 px-3 py-2.5 text-left text-xs dark:bg-zinc-800">
              {done.reviewUrl}
            </code>
            <CopyButton text={done.reviewUrl} label={t("review.copyLink")} />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={() =>
              (window.location.href = done.reviewUrl.replace(
                window.location.origin,
                "",
              ))
            }
          >
            {t("review.openTicket")}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm opacity-70">{t("review.requestIntro")}</p>
          <Field label={t("common.username")}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice"
              required
              minLength={2}
              maxLength={32}
            />
          </Field>
          <Field label={t("review.emailLabel")} hint={t("review.emailHint")}>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@example.com"
              inputMode="email"
              required
            />
          </Field>
          <Field label={t("review.whyLabel")} hint={t("review.whyHint")}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("review.whyPh")}
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              className="max-h-60 w-full resize-y rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent-500/60 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
            />
          </Field>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" type="submit" disabled={busy}>
              {busy ? <Spinner size={15} /> : t("review.sendRequest")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
