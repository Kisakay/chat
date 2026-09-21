import { useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Inbox, LayoutDashboard, Mail, Send, ShieldAlert, SlidersHorizontal, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { AccessRequestsPanel } from "./AccessRequests.tsx";
import { Button, CopyButton, FlowerMark, Input, LoadingScreen, Spinner, Switch } from "./ui.tsx";
import { cn } from "../lib/cn.ts";
import { useT } from "../lib/i18n.ts";

type Tab = "accounts" | "access" | "features" | "mail";

function applyTheme(theme: string) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function AdminCenter() {
  const { t } = useT();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("accounts");
  const [settings, setSettings] = useState<{ registrationEnabled: boolean; accessRequestEnabled: boolean; ocrEnabled: boolean } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [openAccessCount, setOpenAccessCount] = useState(0);

  const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "accounts", label: t("center.tabAccounts"), icon: Users },
    { id: "access", label: t("center.tabAccess"), icon: Inbox },
    { id: "features", label: t("center.tabFeatures"), icon: SlidersHorizontal },
    { id: "mail", label: t("center.tabMail"), icon: Mail },
  ];

  useEffect(() => {
    api.verify()
      .then((r) => {
        if (!r.user.isAdmin) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        applyTheme(r.user.theme);
        api.adminGetSettings().then((s) => setSettings(s.settings)).catch((e) => setError(e instanceof Error ? e.message : t("admin.loadFailed")));
      })
      .catch(() => setAllowed(false));
  }, []);

  // Live badge on the Access tab: poll the open (pending + reviewing)
  // request count so new demands pop without opening the tab.
  useEffect(() => {
    if (!allowed) return;
    let stopped = false;
    async function fetchCount() {
      try {
        const res = await api.adminAccessList();
        if (stopped) return;
        setOpenAccessCount(
          res.requests.filter((r) => r.status === "pending" || r.status === "reviewing").length,
        );
      } catch {
        // Transient failure: keep last count, retry next tick.
      }
    }
    fetchCount();
    const id = setInterval(() => {
      if (!document.hidden) fetchCount();
    }, 15000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [allowed]);

  async function toggle(patch: { registrationEnabled?: boolean; accessRequestEnabled?: boolean; ocrEnabled?: boolean }) {
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
                onClick={() => setTab(t.id)}
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
                    className="absolute -right-0.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold leading-5 text-white shadow"
                  >
                    {openAccessCount > 99 ? "99+" : openAccessCount}
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
            {saving && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.saving")}</p>}
            {!settings && !error && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}
          </section>
        )}

        {tab === "mail" && <MailPanel />}
      </main>
    </div>
  );
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

  useEffect(() => {
    api.adminMailStatus().then((r) => setSmtp(r.smtp)).catch((e) => setError(e instanceof Error ? e.message : t("admin.loadFailed")));
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
    </div>
  );
}
