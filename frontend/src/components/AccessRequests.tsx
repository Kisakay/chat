import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Inbox, Search, SendHorizontal, Undo2, XCircle } from "lucide-react";
import { api, type AccessMessage, type AccessRequest, type AccessStatus } from "../lib/api.ts";
import { Button, CopyButton, Field, Input, Spinner } from "./ui.tsx";
import { useT, type StringKey } from "../lib/i18n.ts";
import { cn } from "../lib/cn.ts";

const STATUS_STYLE: Record<AccessStatus, { cls: string }> = {
  pending: { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  reviewing: { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  accepted: { cls: "bg-accent-500/10 text-accent-700 dark:text-accent-400" },
  refused: { cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

type Filter = "all" | AccessStatus;
const FILTERS: Filter[] = ["all", "pending", "reviewing", "accepted", "refused"];

/** Admin triage for the access-request wishlist: accept / refuse / review. */
export function AccessRequestsPanel() {
  const [requests, setRequests] = useState<(AccessRequest & { message_count: number })[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { t } = useT();
  const listBusy = useRef(false);

  async function refresh(select?: string) {
    if (listBusy.current) return;
    listBusy.current = true;
    try {
      const res = await api.adminAccessList();
      setRequests(res.requests);
      if (select) setSelectedId(select);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      listBusy.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // Live list: new requests / replies pop without manual refresh.
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = requests.filter((r) => filter === "all" || r.status === filter);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const n = f === "all" ? requests.length : requests.filter((r) => r.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition",
                filter === f
                  ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-stone-200/70 hover:bg-stone-300/60 dark:bg-zinc-800 dark:hover:bg-zinc-700",
              )}
            >
              {t(`access.filter.${f}` as StringKey)} · {n}
            </button>
          );
        })}
        <button
          onClick={() => refresh()}
          className="ml-auto rounded-full p-2 opacity-60 transition hover:bg-stone-200/60 hover:opacity-100 dark:hover:bg-zinc-800"
          title={t("access.refresh")}
          aria-label={t("access.refreshAria")}
        >
          <Undo2 size={15} />
        </button>
      </div>

      {error && <p className="rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {loading && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}

      {!loading && visible.length === 0 && (
        <p className="flex items-center justify-center gap-2 rounded-3xl border border-dashed border-stone-300 px-4 py-8 text-sm opacity-50 dark:border-zinc-700">
          <Inbox size={16} />
          {pendingCount > 0 ? t("access.emptyFiltered") : t("access.empty")}
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => setSelectedId((cur) => (cur === r.id ? null : r.id))}
              className={cn(
                "flex w-full items-center gap-3 rounded-3xl border p-4 text-left transition",
                selectedId === r.id
                  ? "border-accent-500/50 bg-accent-500/5"
                  : "border-stone-200/70 bg-white hover:border-stone-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700",
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-200/70 text-sm font-semibold dark:bg-zinc-800">
                {(r.username[0] || "?").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">@{r.username} <span className="font-normal opacity-50">{r.email}</span></span>
                <span className="block truncate text-xs opacity-60">{r.message} · {r.message_count === 1 ? t("access.msgOne") : t("access.msgMany", { n: r.message_count })}</span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", STATUS_STYLE[r.status].cls)}>
                {t(`access.status.${r.status}` as StringKey)}
              </span>
            </button>
            {selectedId === r.id && <TicketDetail request={r} onChanged={() => refresh(r.id)} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TicketDetail({ request, onChanged }: { request: AccessRequest; onChanged: () => void }) {
  const [messages, setMessages] = useState<AccessMessage[]>([]);
  const [reason, setReason] = useState(request.reason);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useT();
  const [freshKey, setFreshKey] = useState<string | null>(null);
  // Latest callbacks / server state without restarting the poll loop.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const known = useRef({ status: request.status, reason: request.reason });

  useEffect(() => {
    setReason(request.reason);
    setFreshKey(null);
    known.current = { status: request.status, reason: request.reason };
    let stopped = false;
    let busy = false;
    // Live thread: requester replies appear without manual refresh, and a
    // status change made elsewhere syncs the list (badges, filters).
    async function fetchOnce() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const res = await api.adminAccessGet(request.id);
        if (stopped) return;
        setMessages(res.messages);
        if (
          res.request.status !== known.current.status ||
          res.request.reason !== known.current.reason
        ) {
          known.current = { status: res.request.status, reason: res.request.reason };
          onChangedRef.current();
        }
      } catch {
        // Transient failure: keep last state, retry next tick.
      } finally {
        busy = false;
      }
    }
    fetchOnce();
    const id = setInterval(fetchOnce, 5000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const closed = request.status === "accepted" || request.status === "refused";

  async function setStatus(status: AccessStatus) {
    setBusy(true);
    setError("");
    try {
      const res = await api.adminAccessPatch(request.id, { status, reason: reason.trim() });
      if (res.key) setFreshKey(res.key);
      known.current = { status: res.request.status, reason: res.request.reason };
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("access.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.adminAccessReply(request.id, body);
      setMessages((prev) => [...prev, res.message]);
      setDraft("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("access.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-3xl border border-stone-200/70 bg-stone-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      {freshKey && (
        <div className="rounded-2xl border border-accent-500/40 bg-accent-50 p-3 dark:bg-accent-950/30">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium"><CheckCircle2 size={15} /> {t("access.accountCreated")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 text-sm dark:bg-zinc-900">{freshKey}</code>
            <CopyButton text={freshKey} />
          </div>
        </div>
      )}

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.author === "admin" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
              m.author === "admin"
                ? "rounded-tr-lg bg-accent-600 text-white dark:bg-accent-500 dark:text-zinc-950"
                : "rounded-tl-lg bg-white dark:bg-zinc-800",
            )}>
              <p className="mb-0.5 text-[11px] font-medium opacity-70">
                {m.author === "admin" ? t("access.youAdmin") : `@${request.username}`} · {new Date(m.created_at).toLocaleString()}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={reply} className="flex items-end gap-2">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("access.replyPh")}
          aria-label={t("access.replyAria")}
          className="max-h-32 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent-500/60 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          aria-label={t("chat.send")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600 text-white shadow transition hover:bg-accent-500 active:scale-95 disabled:opacity-40 dark:bg-accent-500 dark:text-zinc-950 dark:hover:bg-accent-400"
        >
          {busy ? <Spinner size={15} /> : <SendHorizontal size={15} />}
        </button>
      </form>

      {!closed ? (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-stone-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="min-w-48 flex-1">
            <Field label={t("access.reasonLabel")}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("access.reasonPh")} maxLength={500} />
            </Field>
          </div>
          <div className="flex gap-2">
            {request.status === "pending" && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus("reviewing")}>
                <Search size={14} /> {t("access.btnReviewing")}
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => setStatus("accepted")}>
              <CheckCircle2 size={14} /> {t("access.btnAccept")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus("refused")} className="!text-red-600 dark:!text-red-400">
              <XCircle size={14} /> {t("access.btnRefuse")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs opacity-60">
          <Clock size={13} /> {t("access.closedNote", { status: t(`access.status.${request.status}` as StringKey).toLowerCase() })}
          {request.reason && <> {t("access.reasonWord")}: <em>{request.reason}</em></>}
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
