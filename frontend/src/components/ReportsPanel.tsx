import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Eye, EyeOff, Flag, Inbox, Search, Undo2, XCircle } from "lucide-react";
import { api, type Report, type ReportStatus } from "../lib/api.ts";
import { Button, ConfirmDialog, Field, Input, Spinner } from "./ui.tsx";
import { useT, type StringKey } from "../lib/i18n.ts";
import { cn } from "../lib/cn.ts";

const STATUS_STYLE: Record<ReportStatus, { cls: string }> = {
  open: { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  reviewing: { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  resolved: { cls: "bg-accent-500/10 text-accent-700 dark:text-accent-400" },
  dismissed: { cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

type Filter = "all" | ReportStatus;
const FILTERS: Filter[] = ["all", "open", "reviewing", "resolved", "dismissed"];

/** Admin triage for user-flagged AI responses: review / resolve / dismiss. */
export function ReportsPanel() {
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { t } = useT();
  const listBusy = useRef(false);

  async function refresh(select?: string) {
    if (listBusy.current) return;
    listBusy.current = true;
    try {
      const res = await api.adminReportList();
      setReports(res.reports);
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
    // Live list: new reports pop without manual refresh.
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = reports.filter((r) => filter === "all" || r.status === filter);
  const openCount = reports.filter((r) => r.status === "open").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const n = f === "all" ? reports.length : reports.filter((r) => r.status === f).length;
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
              {t(`reports.filter.${f}` as StringKey)} · {n}
            </button>
          );
        })}
        <button
          onClick={() => refresh()}
          className="ml-auto rounded-full p-2 opacity-60 transition hover:bg-stone-200/60 hover:opacity-100 dark:hover:bg-zinc-800"
          title={t("reports.refresh")}
          aria-label={t("reports.refreshAria")}
        >
          <Undo2 size={15} />
        </button>
      </div>

      {error && <p className="rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {loading && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}

      {!loading && visible.length === 0 && (
        <p className="flex items-center justify-center gap-2 rounded-3xl border border-dashed border-stone-300 px-4 py-8 text-sm opacity-50 dark:border-zinc-700">
          <Inbox size={16} />
          {openCount > 0 ? t("reports.emptyFiltered") : t("reports.empty")}
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
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-200/70 dark:bg-zinc-800">
                <Flag size={15} className="opacity-70" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {t(`report.reason.${r.reason}` as StringKey)}
                  <span className="font-normal opacity-50"> · @{r.reporter_name} · {new Date(r.created_at).toLocaleString()}</span>
                </span>
                <span className="block truncate text-xs opacity-60">{r.content || t(`report.reason.${r.reason}` as StringKey)}</span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", STATUS_STYLE[r.status].cls)}>
                {t(`reports.status.${r.status}` as StringKey)}
              </span>
              {r.reporter_shadowbanned === 1 && (
                <span className="shrink-0 rounded-full bg-stone-500/10 px-2.5 py-1 text-xs font-medium opacity-70">
                  {t("reports.unreliable")}
                </span>
              )}
            </button>
            {selectedId === r.id && <ReportDetail report={r} onChanged={() => refresh(r.id)} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportDetail({ report, onChanged }: { report: Report; onChanged: () => void }) {
  const [note, setNote] = useState(report.admin_note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmBan, setConfirmBan] = useState<boolean | null>(null);
  const { t } = useT();
  const closed = report.status === "resolved" || report.status === "dismissed";
  const isBanned = report.reporter_shadowbanned === 1;

  useEffect(() => {
    setNote(report.admin_note);
  }, [report.id, report.admin_note]);

  async function setStatus(status: ReportStatus) {
    setBusy(true);
    setError("");
    try {
      await api.adminReportPatch(report.id, { status, adminNote: note.trim() });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reports.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleBan(shadowbanned: boolean) {
    setBusy(true);
    setError("");
    try {
      await api.adminShadowban(report.reporter_id, shadowbanned);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reports.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-3xl border border-stone-200/70 bg-stone-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      {report.prompt && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider opacity-50">{t("reports.prompt")}</p>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-stone-200/70 bg-white px-3.5 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {report.prompt}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wider opacity-50">{t("reports.response")}</p>
        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-stone-200/70 bg-white px-3.5 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {report.content || <span className="opacity-50">{t("reports.noContent")}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs opacity-70">
        <span>{t("reports.model")}: <span className="font-medium opacity-100">{report.model || "—"}</span></span>
        <span>{t("reports.reporter")}: <span className="font-medium opacity-100">@{report.reporter_name}</span></span>
        {report.conversation_id && (
          <span>{t("reports.conversation")}: <code className="font-mono">{report.conversation_id.slice(0, 8)}…</code></span>
        )}
        {report.details && (
          <span className="w-full">{t("reports.detailsGiven")}: <span className="opacity-100">{report.details}</span></span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmBan(!isBanned)}>
          {isBanned ? <Eye size={14} /> : <EyeOff size={14} />}
          {isBanned ? t("reports.unshadowban") : t("reports.shadowban")}
        </Button>
        {isBanned && <span className="text-xs opacity-60">{t("reports.unreliable")}</span>}
      </div>
      <ConfirmDialog
        open={confirmBan !== null}
        onClose={() => setConfirmBan(null)}
        onConfirm={() => {
          const v = confirmBan;
          setConfirmBan(null);
          if (v !== null) void toggleBan(v);
        }}
        title={t(confirmBan === false ? "reports.unshadowbanTitle" : "reports.shadowbanTitle")}
        message={t(confirmBan === false ? "reports.unshadowbanMsg" : "reports.shadowbanMsg", { user: report.reporter_name })}
        confirmLabel={t(confirmBan === false ? "reports.unshadowban" : "reports.shadowban")}
      />

      {!closed ? (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-stone-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="min-w-48 flex-1">
            <Field label={t("reports.noteLabel")}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("reports.notePh")} maxLength={1000} />
            </Field>
          </div>
          <div className="flex gap-2">
            {report.status === "open" && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus("reviewing")}>
                <Search size={14} /> {t("reports.btnReviewing")}
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={() => setStatus("resolved")}>
              <CheckCircle2 size={14} /> {t("reports.btnResolve")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus("dismissed")} className="!text-red-600 dark:!text-red-400">
              <XCircle size={14} /> {t("reports.btnDismiss")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs opacity-60">
          <Clock size={13} /> {t("reports.closedNote", { status: t(`reports.status.${report.status}` as StringKey).toLowerCase() })}
          {report.admin_note && <> {t("reports.noteWord")}: <em>{report.admin_note}</em></>}
        </p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
