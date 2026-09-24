import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Boxes, Eye, EyeOff, Flag, Inbox, LayoutDashboard, Mail, Plus, Send, ShieldAlert, SlidersHorizontal, Trash2, TrendingUp, Users } from "lucide-react";
import { api, getToken, type AccessStatus, type AdminSettings, type AdminSettingsPatch, type ReportStatus, type VoicePreview } from "../lib/api.ts";
import { subscribeAccessLive, wsUrl } from "../lib/accessWs.ts";
import { navigate } from "../lib/route.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { AccessRequestsPanel } from "./AccessRequests.tsx";
import { ReportsPanel } from "./ReportsPanel.tsx";
import { ModelsPanel } from "./ModelsPanel.tsx";
import { StatsSection } from "./StatsSection.tsx";
import { Toasts } from "./Toasts.tsx";
import { pushToast } from "../lib/toasts.ts";
import { Button, CopyButton, Field, FlowerMark, Input, LoadingScreen, Picker, Spinner, Switch } from "./ui.tsx";
import { cn } from "../lib/cn.ts";
import { msUntilNextSolarSwitch, resolveThemeDark } from "../lib/solarTheme.ts";
import { useT, type StringKey } from "../lib/i18n.ts";

type Tab = "accounts" | "access" | "reports" | "models" | "stats" | "features" | "mail";

const VALID_TABS: readonly string[] = ["accounts", "access", "reports", "models", "stats", "features", "mail"];

function validTab(v: string | null | undefined): Tab {
  return v !== null && v !== undefined && (VALID_TABS as readonly string[]).includes(v) ? (v as Tab) : "accounts";
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  const dark = resolveThemeDark(theme);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function AdminCenter({ initialTab }: { initialTab?: string | null }) {
  const { t } = useT();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(() => validTab(initialTab));
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [openAccessCount, setOpenAccessCount] = useState(0);
  const [openReportCount, setOpenReportCount] = useState(0);
  // Deep links (/admin, /admin/models, …): unknown sections bounce to /admin.
  useEffect(() => {
    if (initialTab !== null && initialTab !== undefined && !VALID_TABS.includes(initialTab)) {
      navigate("/admin", true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTab(id: Tab): void {
    setTab(id);
    navigate(id === "accounts" ? "/admin" : `/admin/${id}`);
  }

  // Full badge resync (HTTP) — only for mount, reconnect gaps and rare
  // actions with no WS event (reporter shadow-ban). Hot path is incremental.
  const resyncBadgesRef = useRef<() => void>(() => {});

  const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "accounts", label: t("center.tabAccounts"), icon: Users },
    { id: "access", label: t("center.tabAccess"), icon: Inbox },
    { id: "reports", label: t("center.tabReports"), icon: Flag },
    { id: "models", label: t("center.tabModels"), icon: Boxes },
    { id: "stats", label: t("center.tabStats"), icon: TrendingUp },
    { id: "features", label: t("center.tabFeatures"), icon: SlidersHorizontal },
    { id: "mail", label: t("center.tabMail"), icon: Mail },
  ];

  useEffect(() => {
    let timer: number | undefined;
    api.verify()
      .then((r) => {
        if (!r.user.isAdmin) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        applyTheme(r.user.theme);
        if (r.user.theme === "sunset") {
          const schedule = (): void => {
            timer = window.setTimeout(() => {
              applyTheme("sunset");
              schedule();
            }, msUntilNextSolarSwitch());
          };
          schedule();
        }
        api.adminGetSettings().then((s) => setSettings(s.settings)).catch((e) => setError(e instanceof Error ? e.message : t("admin.loadFailed")));
      })
      .catch(() => setAllowed(false));
    return () => window.clearTimeout(timer);
  }, []);

  // Live badges on the Access/Reports tabs: the admin firehose pushes full
  // payloads, so the open counts update incrementally with zero HTTP.
  // Resync on (re)connect covers events missed while offline.
  useEffect(() => {
    if (!allowed) return;
    const accessById = new Map<string, AccessStatus>();
    const reportById = new Map<string, { status: ReportStatus; shadowbanned: number }>();
    function recount() {
      let access = 0;
      for (const s of accessById.values()) if (s === "pending" || s === "reviewing") access++;
      let reports = 0;
      for (const r of reportById.values()) {
        if ((r.status === "open" || r.status === "reviewing") && r.shadowbanned !== 1) reports++;
      }
      setOpenAccessCount(access);
      setOpenReportCount(reports);
    }
    async function resync() {
      try {
        const res = await api.adminAccessList();
        accessById.clear();
        for (const r of res.requests) accessById.set(r.id, r.status);
      } catch {
        // Transient failure: keep last counts.
      }
      try {
        const res = await api.adminReportList();
        reportById.clear();
        for (const r of res.reports) {
          reportById.set(r.id, { status: r.status, shadowbanned: r.reporter_shadowbanned });
        }
      } catch {
        // Transient failure: keep last counts.
      }
      recount();
    }
    resyncBadgesRef.current = resync;
    resync();
    const token = getToken();
    if (!token) return;
    return subscribeAccessLive(wsUrl(`/api/admin/ws?token=${encodeURIComponent(token)}`), {
      onEvent: (evt) => {
        if (evt.type === "pong" || evt.type === "access_message") return;
        if (evt.type === "access_created") {
          accessById.set(evt.request_id, evt.request.status);
          recount();
          pushToast(t("live.newRequest", { user: evt.request.username }), { icon: "inbox" });
        } else if (evt.type === "access_status") {
          accessById.set(evt.request_id, evt.request.status);
          recount();
        } else if (evt.type === "report_created") {
          reportById.set(evt.report.id, { status: evt.report.status, shadowbanned: evt.report.reporter_shadowbanned });
          recount();
          pushToast(t("live.newReport", { reason: evt.report.reason }), { icon: "mail" });
        } else if (evt.type === "report_status") {
          const prev = reportById.get(evt.report.id);
          reportById.set(evt.report.id, {
            status: evt.report.status,
            shadowbanned: prev?.shadowbanned ?? evt.report.reporter_shadowbanned,
          });
          recount();
        }
      },
      onSync: () => {
        resync();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  async function toggle(patch: AdminSettingsPatch) {
    setSaving(true);
    setError("");
    try {
      const res = await api.adminPatchSettings(patch);
      setSettings(res.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (allowed === null) {
    return <LoadingScreen />;
  }

  if (!allowed) {
    return (
      <div className="grid min-h-full place-items-center p-6">
        <div className="w-full max-w-sm rounded-[2rem] border border-stone-200 bg-white p-8 text-center shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <ShieldAlert size={28} className="mx-auto mb-3 text-red-500" />
          <h1 className="text-lg font-bold">{t("center.locked")}</h1>
          <p className="mt-1 text-sm opacity-60">{t("center.lockedSub")}</p>
          <a href="/" className="mt-4 inline-block rounded-full bg-accent-600 px-5 py-2.5 text-sm font-medium text-white dark:bg-accent-500 dark:text-zinc-950">{t("common.backToLogin")}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200/70 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3">
          <a href="/" aria-label={t("center.back")} className="rounded-full p-2 transition hover:bg-stone-200/60 dark:hover:bg-zinc-800">
            <ArrowLeft size={18} />
          </a>
          <FlowerMark size={32} dynamic={false} />
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <LayoutDashboard size={18} className="text-accent-600 dark:text-accent-400" />
            {t("center.title")}
          </h1>
        </div>
        <div className="mx-auto w-full max-w-4xl px-4 pb-3">
          <div className="flex gap-1 overflow-x-auto rounded-full border border-stone-200/70 bg-stone-100/70 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                className={cn(
                  "relative flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition",
                  tab === t.id
                    ? "bg-white text-stone-900 shadow dark:bg-zinc-800 dark:text-zinc-100"
                    : "opacity-60 hover:opacity-100",
                )}
              >
                <t.icon size={15} />
                {t.label}
                {t.id === "access" && openAccessCount > 0 && (
                  <span
                    role="status"
                    aria-label={`${t.label}: ${openAccessCount}`}
                    className="absolute -right-0.5 -top-0.5 z-10 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white shadow"
                  >
                    {openAccessCount > 99 ? "99+" : openAccessCount}
                  </span>
                )}
                {t.id === "reports" && openReportCount > 0 && (
                  <span
                    role="status"
                    aria-label={`${t.label}: ${openReportCount}`}
                    className="absolute -right-0.5 -top-0.5 z-10 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white shadow"
                  >
                    {openReportCount > 99 ? "99+" : openReportCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
        {error && <p className="rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

        {tab === "accounts" && (
          <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <AdminPanel open bare onClose={() => {}} />
          </section>
        )}

        {tab === "access" && (
          <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <AccessRequestsPanel />
          </section>
        )}

        {tab === "reports" && (
          <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <ReportsPanel onShadowbanChanged={() => resyncBadgesRef.current()} />
          </section>
        )}

        {tab === "models" && (
          <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <ModelsPanel />
          </section>
        )}

        {tab === "stats" && <StatsSection />}

        {tab === "features" && (
          <section className="space-y-3">
            <div className="flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("center.regTitle")}</p>
                <p className="text-sm opacity-60">{t("center.regDesc")}</p>
              </div>
              <Switch label={t("center.regTitle")} checked={settings?.registrationEnabled ?? false} onChange={(v) => toggle({ registrationEnabled: v })} />
            </div>
            <div className={cn(
              "flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
              settings?.registrationEnabled && "opacity-60",
            )}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("center.accTitle")}</p>
                <p className="text-sm opacity-60">
                  {settings?.registrationEnabled
                    ? t("center.accDescOn")
                    : t("center.accDescOff")}
                </p>
              </div>
              <Switch
                label={t("center.accTitle")}
                checked={settings?.accessRequestEnabled ?? false}
                disabled={settings?.registrationEnabled ?? false}
                onChange={(v) => toggle({ accessRequestEnabled: v })}
              />
            </div>
            <div className="flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("center.ocrTitle")}</p>
                <p className="text-sm opacity-60">{t("center.ocrDesc")}</p>
              </div>
              <Switch label={t("center.ocrTitle")} checked={settings?.ocrEnabled ?? false} onChange={(v) => toggle({ ocrEnabled: v })} />
            </div>
            <div className="flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("center.reportsTitle")}</p>
                <p className="text-sm opacity-60">{t("center.reportsDesc")}</p>
              </div>
              <Switch label={t("center.reportsTitle")} checked={settings?.reportsEnabled ?? false} onChange={(v) => toggle({ reportsEnabled: v })} />
            </div>
            <div className="flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("center.usernameChangeTitle")}</p>
                <p className="text-sm opacity-60">{t("center.usernameChangeDesc")}</p>
              </div>
              <Switch label={t("center.usernameChangeTitle")} checked={settings?.usernameChangeEnabled ?? false} onChange={(v) => toggle({ usernameChangeEnabled: v })} />
            </div>
            <div className="flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("center.ttsTitle")}</p>
                <p className="text-sm opacity-60">{t("center.ttsDesc")}</p>
              </div>
              <Switch label={t("center.ttsTitle")} checked={settings?.ttsEnabled ?? false} onChange={(v) => toggle({ ttsEnabled: v })} />
            </div>
            {saving && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.saving")}</p>}
            {!settings && !error && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}
            <VoicePreviewsCard />
          </section>
        )}

        {tab === "mail" && <MailPanel />}
      </main>
      <Toasts />
    </div>
  );
}

/** Admin voice-preview lines (Settings → Voice for users). Empty = reset. */
function VoicePreviewsCard() {
  const { t } = useT();
  const [lines, setLines] = useState<VoicePreview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverVoices, setServerVoices] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api.adminGetSettings()
      .then((r) => {
        setLines(r.settings.voicePreviews);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    api.ttsInfo().then((r) => setServerVoices(r.voices)).catch(() => {});
  }, []);

  async function save(next: VoicePreview[]) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.adminPatchSettings({ voicePreviews: next });
      setLines(res.settings.voicePreviews);
      setMsg({ ok: true, text: t("vfeat.saved") });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : t("vfeat.invalid") });
    } finally {
      setBusy(false);
    }
  }

  /** Commit one line after editing (empty text drops the row). */
  function commit(i: number) {
    const line = lines[i];
    if (!line) return;
    const text = line.text.trim();
    if (text === "") {
      const next = lines.filter((_, j) => j !== i);
      if (next.length === 0) {
        setMsg({ ok: false, text: t("vfeat.invalid") });
        void refreshLines();
        return;
      }
      void save(next);
      return;
    }
    void save(lines.map((l, j) => (j === i ? { ...l, text } : l)));
  }

  function patch(i: number, p: Partial<VoicePreview>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...p } : l)));
  }

  async function refreshLines() {
    try {
      const r = await api.adminGetSettings();
      setLines(r.settings.voicePreviews);
    } catch {
      // keep current
    }
  }

  if (!loaded) return null;

  return (
    <div className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium">{t("vfeat.title")}</p>
      <p className="mb-3 mt-0.5 text-sm opacity-60">{t("vfeat.desc")}</p>
      <ul className="space-y-3">
        {lines.map((line, i) => (
          <li key={i} className="rounded-2xl border border-stone-200/70 p-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <Input
                  value={line.text}
                  disabled={busy}
                  maxLength={500}
                  aria-label={t("vfeat.line", { n: i + 1 })}
                  onChange={(e) => patch(i, { text: e.target.value })}
                  onBlur={() => commit(i)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
              </span>
              <button
                type="button"
                disabled={busy || lines.length <= 1}
                onClick={() => void save(lines.filter((_, j) => j !== i))}
                aria-label={t("vfeat.remove", { n: i + 1 })}
                className="shrink-0 rounded-full p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <span className="w-36">
                <Field label={t("vfeat.timbre")}>
                  <Picker
                    ariaLabel={t("vfeat.timbre")}
                    value={line.timbre}
                    onChange={(v) => {
                      patch(i, { timbre: v as VoicePreview["timbre"] });
                      // Persist timbre/rate/pitch tweaks live (text commits on blur).
                      const next = lines.map((l, j) => (j === i ? { ...l, timbre: v as VoicePreview["timbre"] } : l));
                      if (next[i]!.text.trim() !== "") void save(next);
                    }}
                    align="left"
                    options={(["masculine", "feminine", "any"] as const).map((v) => ({ value: v, label: t(`voice.timbre.${v}` as StringKey) }))}
                  />
                </Field>
              </span>
              <span className="w-40">
                <Field label={t("vfeat.voice")} hint={t("vfeat.voiceHint")}>
                  {serverVoices.length > 0 ? (
                    <Picker
                      ariaLabel={t("vfeat.voice")}
                      value={line.voice}
                      onChange={(v) => {
                        patch(i, { voice: v });
                        const next = lines.map((l, j) => (j === i ? { ...l, voice: v } : l));
                        if (next[i]!.text.trim() !== "") void save(next);
                      }}
                      align="left"
                      options={[{ value: "", label: t("vfeat.voicePh") }, ...serverVoices.map((v) => ({ value: v.id, label: v.name }))]}
                    />
                  ) : (
                    <Input
                      value={line.voice}
                      disabled={busy}
                      maxLength={64}
                      placeholder={t("vfeat.voicePh")}
                      aria-label={t("vfeat.voice")}
                      onChange={(e) => patch(i, { voice: e.target.value })}
                      onBlur={() => commit(i)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                  )}
                </Field>
              </span>
              <label className="min-w-32 flex-1 text-xs opacity-80">
                <span className="mb-1 block font-medium">{t("voice.rate")} · {line.rate.toFixed(2)}×</span>
                <input
                  type="range" min={0.5} max={1.5} step={0.05} value={line.rate}
                  disabled={busy}
                  onChange={(e) => patch(i, { rate: Number(e.target.value) })}
                  onMouseUp={() => commitSliders(i)}
                  onTouchEnd={() => commitSliders(i)}
                  className="w-full accent-[rgb(var(--ka-accent-600))]"
                  aria-label={t("voice.rate")}
                />
              </label>
              <label className="min-w-32 flex-1 text-xs opacity-80">
                <span className="mb-1 block font-medium">{t("voice.pitch")} · {line.pitch.toFixed(2)}×</span>
                <input
                  type="range" min={0.5} max={2} step={0.05} value={line.pitch}
                  disabled={busy}
                  onChange={(e) => patch(i, { pitch: Number(e.target.value) })}
                  onMouseUp={() => commitSliders(i)}
                  onTouchEnd={() => commitSliders(i)}
                  className="w-full accent-[rgb(var(--ka-accent-600))]"
                  aria-label={t("voice.pitch")}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {lines.length < 6 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setLines((prev) => [...prev, { text: "", lang: "auto", rate: 1, pitch: 1, timbre: "any" as const, voice: "" }])}
          >
            <Plus size={14} /> {t("vfeat.add")}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save([])}>
          {t("vfeat.reset")}
        </Button>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={cn("mt-3 rounded-2xl px-4 py-2.5 text-sm", msg.ok ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400")}>
          {msg.text}
        </p>
      )}
    </div>
  );

  function commitSliders(i: number) {
    const line = lines[i];
    if (!line || line.text.trim() === "") return;
    void save(lines.map((l, j) => (j === i ? { ...l } : l)));
  }
}

type SmtpInfo = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  hasPass: boolean;
  from: string;
  appUrl: string;
};

function MailPanel() {
  const { t } = useT();
  const [smtp, setSmtp] = useState<SmtpInfo | null>(null);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [to, setTo] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [recMax, setRecMax] = useState("5");
  const [recWindow, setRecWindow] = useState("60");
  const [recSaving, setRecSaving] = useState(false);
  const [recMsg, setRecMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.adminMailStatus().then((r) => setSmtp(r.smtp)).catch((e) => setError(e instanceof Error ? e.message : t("admin.loadFailed")));
    api.adminGetSettings().then((r) => {
      setRecMax(String(r.settings.recoveryLimitMax));
      setRecWindow(String(r.settings.recoveryLimitWindowMin));
    }).catch(() => {});
  }, []);

  async function verify() {
    setVerifying(true);
    setResult(null);
    try {
      await api.adminMailVerify();
      setResult({ ok: true, text: t("center.connOk") });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : t("center.verifyFailed") });
    } finally {
      setVerifying(false);
    }
  }

  async function sendTest() {
    setSending(true);
    setResult(null);
    try {
      const r = await api.adminMailTest(to.trim());
      setResult({ ok: true, text: t("center.testSent", { to: to.trim(), tail: r.messageId ? ` (${r.messageId})` : "" }) });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : t("center.mailSendFailed") });
    } finally {
      setSending(false);
    }
  }

  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="flex items-center gap-3 py-2">
        <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider opacity-50">{label}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{children}</span>
      </div>
    );
  }

  async function saveRecoveryLimits() {
    const max = Number(recMax);
    const win = Number(recWindow);
    if (!Number.isInteger(max) || max < 1 || max > 100 || !Number.isInteger(win) || win < 1 || win > 1440) {
      setRecMsg({ ok: false, text: t("rec.invalid") });
      return;
    }
    setRecSaving(true);
    setRecMsg(null);
    try {
      const res = await api.adminPatchSettings({ recoveryLimitMax: max, recoveryLimitWindowMin: win });
      setRecMax(String(res.settings.recoveryLimitMax));
      setRecWindow(String(res.settings.recoveryLimitWindowMin));
      setRecMsg({ ok: true, text: t("rec.saved") });
    } catch (e) {
      setRecMsg({ ok: false, text: e instanceof Error ? e.message : t("common.saveFailed") });
    } finally {
      setRecSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
            <Mail size={17} />
          </span>
          <div>
            <p className="text-sm font-medium">{t("center.mailTitle")}</p>
            <p className="text-sm opacity-60">
              {smtp == null ? t("center.mailChecking") : smtp.enabled ? t("center.mailFrom", { from: smtp.from }) : t("center.mailOff")}
            </p>
          </div>
          <span className={cn(
            "ml-auto rounded-full px-3 py-1 text-xs font-medium",
            smtp?.enabled ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-stone-200/70 dark:bg-zinc-800",
          )}>
            {smtp?.enabled ? t("center.on") : t("center.off")}
          </span>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        {!smtp && !error && <p className="mt-3 flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}
        {smtp && (
          <div className="mt-3 divide-y divide-stone-200/70 rounded-2xl border border-stone-200/70 px-4 dark:divide-zinc-800 dark:border-zinc-800">
            <Row label={t("center.smtpHost")}>{smtp.host || <span className="opacity-50">{t("center.notSet")}</span>}</Row>
            <Row label={t("center.smtpPort")}>{smtp.port} · {smtp.secure ? t("center.tlsImplicit") : t("center.tlsStarttls")}</Row>
            <Row label={t("center.smtpUser")}>{smtp.user || <span className="opacity-50">{t("center.noAuth")}</span>}</Row>
            <Row label={t("center.smtpPass")}>
              <span className="flex items-center gap-2">
                {!smtp.hasPass ? (
                  <span className="opacity-50">{t("center.notSet")}</span>
                ) : showPass ? (
                  <code className="truncate font-mono">{smtp.pass}</code>
                ) : (
                  <code className="select-none blur-sm" aria-label={t("center.hiddenPass")}>••••••••••</code>
                )}
                {smtp.hasPass && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      aria-label={showPass ? t("center.hidePass") : t("center.showPass")}
                      className="rounded-full p-1.5 transition hover:bg-stone-200/60 dark:hover:bg-zinc-800"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    {showPass && <CopyButton text={smtp.pass} />}
                  </>
                )}
              </span>
            </Row>
            <Row label={t("center.smtpFrom")}><span className="truncate">{smtp.from}</span></Row>
            <Row label={t("center.smtpAppUrl")}><span className="truncate">{smtp.appUrl}</span></Row>
          </div>
        )}
        <p className="mt-3 text-sm opacity-60">
          {t("center.credsNote")}
        </p>
      </section>

      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium">{t("center.mailTestTitle")}</p>
        <p className="mt-0.5 text-sm opacity-60">{t("center.mailTestDesc")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={verify} disabled={verifying || !smtp?.enabled}>
            {verifying ? <Spinner size={14} /> : null}
            {verifying ? t("center.verifying") : t("center.verifyConn")}
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="you@example.com"
            aria-label={t("center.testToAria")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="flex-1"
          />
          <Button size="sm" onClick={sendTest} disabled={sending || !smtp?.enabled || !/^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(to.trim())}>
            {sending ? <Spinner size={14} /> : <Send size={14} />}
            {sending ? t("center.sendingMail") : t("center.sendTest")}
          </Button>
        </div>
        {result && (
          <p
            role={result.ok ? "status" : "alert"}
            className={cn(
              "mt-3 rounded-2xl px-4 py-2.5 text-sm",
              result.ok
                ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400",
            )}
          >
            {result.text}
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium">{t("rec.title")}</p>
        <p className="mt-0.5 text-sm opacity-60">{t("rec.desc")}</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Field label={t("rec.max")} hint={t("rec.maxHint")}>
              <Input type="number" min={1} max={100} value={recMax} onChange={(e) => setRecMax(e.target.value)} disabled={recSaving} />
            </Field>
          </div>
          <div className="w-32">
            <Field label={t("rec.window")} hint={t("rec.windowHint")}>
              <Input type="number" min={1} max={1440} value={recWindow} onChange={(e) => setRecWindow(e.target.value)} disabled={recSaving} />
            </Field>
          </div>
          <Button size="sm" onClick={saveRecoveryLimits} disabled={recSaving}>
            {recSaving ? <Spinner size={14} /> : null} {t("rec.save")}
          </Button>
        </div>
        {recMsg && (
          <p role={recMsg.ok ? "status" : "alert"} className={cn("mt-3 rounded-2xl px-4 py-2.5 text-sm", recMsg.ok ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400")}>
            {recMsg.text}
          </p>
        )}
      </section>
    </div>
  );
}
