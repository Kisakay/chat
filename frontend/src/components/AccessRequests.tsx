import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Inbox, Search, SendHorizontal, Undo2, XCircle } from "lucide-react";
import { api, getToken, type AccessMessage, type AccessRequest, type AccessStatus } from "../lib/api.ts";
import { subscribeAccessLive, wsUrl } from "../lib/accessWs.ts";
import { Button, CopyButton, Field, Input, Spinner } from "./ui.tsx";
import { pushToast } from "../lib/toasts.ts";
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

/**
 * Message ids already applied (WS echo + HTTP response race). Shared by the
 * list (count bumps) and the open thread (appends) so each message lands
 * exactly once no matter which arrives first.
 */
const seenAccessMsgIds = new Set<number>();
function markAccessMsgSeen(msg: AccessMessage): boolean {
  if (seenAccessMsgIds.has(msg.id)) return false;
  seenAccessMsgIds.add(msg.id);
  if (seenAccessMsgIds.size > 1000) {
    const oldest = seenAccessMsgIds.values().next().value;
    if (oldest !== undefined) seenAccessMsgIds.delete(oldest);
  }
  return true;
}

/** Admin triage for the access-request wishlist: accept / refuse / review. */
export function AccessRequestsPanel() {
  const [requests, setRequests] = useState<(AccessRequest & { message_count: number })[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { t } = useT();
  // State mirrors for the WS handler (no side effects inside updaters).
  const rowsRef = useRef(requests);
  const selectedRef = useRef(selectedId);
  rowsRef.current = requests;
  selectedRef.current = selectedId;
  function setRows(fn: (prev: (AccessRequest & { message_count: number })[]) => (AccessRequest & { message_count: number })[]): void {
    setRequests((prev) => {
      const next = fn(prev);
      rowsRef.current = next;
      return next;
    });
  }

  async function refresh(select?: string) {
    try {
      const res = await api.adminAccessList();
      setRows(() => res.requests);
      if (select) setSelectedId(select);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // Live list: the admin firehose pushes full payloads, so rows update
    // incrementally with zero HTTP (shares its socket with the AdminCenter
    // badge via the pool). Full resync only on (re)connect (offline gap).
    const token = getToken();
    if (!token) return;
    return subscribeAccessLive(wsUrl(`/api/admin/ws?token=${encodeURIComponent(token)}`), {
      onEvent: (evt) => {
        if (evt.type === "pong") return;
        if (evt.type === "access_created") {
          markAccessMsgSeen(evt.message);
          setRows((prev) =>
            prev.some((r) => r.id === evt.request_id)
              ? prev
              : [{ ...evt.request, message_count: evt.message_count }, ...prev],
          );
        } else if (evt.type === "access_message") {
          if (!markAccessMsgSeen(evt.message)) return;
          const row = rowsRef.current.find((r) => r.id === evt.request_id);
          if (row && evt.message.author === "user" && selectedRef.current !== evt.request_id) {
            pushToast(t("live.newMessage", { user: row.username }), { icon: "mail" });
          }
          setRows((prev) =>
            prev.map((r) =>
              r.id === evt.request_id ? { ...r, message_count: r.message_count + 1 } : r,
            ),
          );
        } else if (evt.type === "access_status") {
          setRows((prev) =>
            prev.map((r) =>
              r.id === evt.request_id ? { ...evt.request, message_count: r.message_count } : r,
            ),
          );
        }
        // Report events: the ReportsPanel owns them; badges own the counts.
      },
      onSync: () => {
        refresh();
      },
    });
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
            {selectedId === r.id && <TicketDetail request={r} onUpdated={(updated) => setRows((prev) => prev.map((x) => x.id === updated.id ? { ...updated, message_count: x.message_count } : x))} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TicketDetail({ request, onUpdated }: { request: AccessRequest; onUpdated: (r: AccessRequest) => void }) {
  const [messages, setMessages] = useState<AccessMessage[]>([]);
  const [reason, setReason] = useState(request.reason);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useT();
  const [freshKey, setFreshKey] = useState<string | null>(null);

  useEffect(() => {
    setReason(request.reason);
    setFreshKey(null);
    // Live thread: requester replies arrive instantly with their full
    // payload (no refetch); status changes made elsewhere arrive on the
    // parent's firehose and flow back down as props. Full reload only on
    // (re)connect (offline gap).
    async function fetchOnce() {
      try {
        const res = await api.adminAccessGet(request.id);
        for (const m of res.messages) markAccessMsgSeen(m);
        setMessages(res.messages);
      } catch {
        // Transient failure: keep last state.
      }
    }
    fetchOnce();
    return subscribeAccessLive(wsUrl(`/api/access/ws/${request.id}`), {
      onEvent: (evt) => {
        // Report events only travel the admin firehose — never ticket sockets.
        if (evt.type === "pong" || evt.type === "report_created" || evt.type === "report_status") return;
        if (evt.request_id !== request.id) return;
        if (evt.type === "access_message") {
          if (!markAccessMsgSeen(evt.message)) return;
          setMessages((prev) => [...prev, evt.message]);
        }
        // access_status flows via the parent firehose -> onUpdated -> props.
      },
      onSync: () => {
        fetchOnce();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const closed = request.status === "accepted" || request.status === "refused";

  async function setStatus(status: AccessStatus) {
    setBusy(true);
    setError("");
    try {
      const res = await api.adminAccessPatch(request.id, { status, reason: reason.trim() });
      if (res.key) setFreshKey(res.key);
      onUpdated(res.request);
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
      // The broadcast echo of our own message may already be applied —
      // the shared seen-set keeps exactly one copy either way.
      if (markAccessMsgSeen(res.message)) setMessages((prev) => [...prev, res.message]);
      setDraft("");
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
