import { useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Inbox, LayoutDashboard, Mail, Send, ShieldAlert, SlidersHorizontal, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { AccessRequestsPanel } from "./AccessRequests.tsx";
import { Button, CopyButton, FlowerMark, Input, LoadingScreen, Spinner, Switch } from "./ui.tsx";
import { cn } from "../lib/cn.ts";

type Tab = "accounts" | "access" | "features" | "mail";

function applyTheme(theme: string) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "accounts", label: "Accounts", icon: Users },
  { id: "access", label: "Access", icon: Inbox },
  { id: "features", label: "Features", icon: SlidersHorizontal },
  { id: "mail", label: "Mail", icon: Mail },
];

export function AdminCenter() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("accounts");
  const [settings, setSettings] = useState<{ registrationEnabled: boolean; accessRequestEnabled: boolean; ocrEnabled: boolean } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.verify()
      .then((r) => {
        if (!r.user.isAdmin) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        applyTheme(r.user.theme);
        api.adminGetSettings().then((s) => setSettings(s.settings)).catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
      })
      .catch(() => setAllowed(false));
  }, []);

  async function toggle(patch: { registrationEnabled?: boolean; accessRequestEnabled?: boolean; ocrEnabled?: boolean }) {
    setSaving(true);
    setError("");
    try {
      const res = await api.adminPatchSettings(patch);
      setSettings(res.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
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
          <h1 className="text-lg font-bold">Admins only</h1>
          <p className="mt-1 text-sm opacity-60">Log in with the admin account to open the Admin Center.</p>
          <a href="/" className="mt-4 inline-block rounded-full bg-accent-600 px-5 py-2.5 text-sm font-medium text-white dark:bg-accent-500 dark:text-zinc-950">Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200/70 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3">
          <a href="/" aria-label="Back to chat" className="rounded-full p-2 transition hover:bg-stone-200/60 dark:hover:bg-zinc-800">
            <ArrowLeft size={18} />
          </a>
          <FlowerMark size={32} dynamic={false} />
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <LayoutDashboard size={18} className="text-accent-600 dark:text-accent-400" />
            Admin Center
          </h1>
        </div>
        <div className="mx-auto w-full max-w-4xl px-4 pb-3">
          <div className="flex gap-1 overflow-x-auto rounded-full border border-stone-200/70 bg-stone-100/70 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition",
                  tab === t.id
                    ? "bg-white text-stone-900 shadow dark:bg-zinc-800 dark:text-zinc-100"
                    : "opacity-60 hover:opacity-100",
                )}
              >
                <t.icon size={15} />
                {t.label}
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
                <p className="text-sm font-medium">Public registration</p>
                <p className="text-sm opacity-60">Show the Register button on the login page. Off = admin-created accounts only. Turning it on retires the wishlist below.</p>
              </div>
              <Switch label="Public registration" checked={settings?.registrationEnabled ?? false} onChange={(v) => toggle({ registrationEnabled: v })} />
            </div>
            <div className={cn(
              "flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
              settings?.registrationEnabled && "opacity-60",
            )}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Access requests (wishlist)</p>
                <p className="text-sm opacity-60">
                  {settings?.registrationEnabled
                    ? "Unavailable while public registration is on — it replaces the wishlist."
                    : "Show Request access on the login page. Visitors reserve a username and plead their case; you triage them in the Access tab."}
                </p>
              </div>
              <Switch
                label="Access requests"
                checked={settings?.accessRequestEnabled ?? false}
                disabled={settings?.registrationEnabled ?? false}
                onChange={(v) => toggle({ accessRequestEnabled: v })}
              />
            </div>
            <div className="flex items-center gap-4 rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">OCR tool</p>
                <p className="text-sm opacity-60">Server-side image transcription for attachments. Requires the tesseract binary.</p>
              </div>
              <Switch label="OCR tool" checked={settings?.ocrEnabled ?? false} onChange={(v) => toggle({ ocrEnabled: v })} />
            </div>
            {saving && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> Saving…</p>}
            {!settings && !error && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> Loading…</p>}
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
  const [smtp, setSmtp] = useState<SmtpInfo | null>(null);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [to, setTo] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.adminMailStatus().then((r) => setSmtp(r.smtp)).catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  async function verify() {
    setVerifying(true);
    setResult(null);
    try {
      await api.adminMailVerify();
      setResult({ ok: true, text: "Connection OK — SMTP host reachable, auth accepted." });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Verification failed" });
    } finally {
      setVerifying(false);
    }
  }

  async function sendTest() {
    setSending(true);
    setResult(null);
    try {
      const r = await api.adminMailTest(to.trim());
      setResult({ ok: true, text: `Test mail sent to ${to.trim()}${r.messageId ? ` (${r.messageId})` : ""}.` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Send failed" });
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
            <p className="text-sm font-medium">Key recovery emails</p>
            <p className="text-sm opacity-60">
              {smtp == null ? "Checking…" : smtp.enabled ? `Enabled — sent from ${smtp.from}` : "Disabled — set SMTP_HOST on the server to enable"}
            </p>
          </div>
          <span className={cn(
            "ml-auto rounded-full px-3 py-1 text-xs font-medium",
            smtp?.enabled ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-stone-200/70 dark:bg-zinc-800",
          )}>
            {smtp?.enabled ? "On" : "Off"}
          </span>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        {!smtp && !error && <p className="mt-3 flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> Loading…</p>}
        {smtp && (
          <div className="mt-3 divide-y divide-stone-200/70 rounded-2xl border border-stone-200/70 px-4 dark:divide-zinc-800 dark:border-zinc-800">
            <Row label="Host">{smtp.host || <span className="opacity-50">(not set)</span>}</Row>
            <Row label="Port">{smtp.port} · {smtp.secure ? "implicit TLS (465)" : "STARTTLS (587)"}</Row>
            <Row label="User">{smtp.user || <span className="opacity-50">(no auth)</span>}</Row>
            <Row label="Password">
              <span className="flex items-center gap-2">
                {!smtp.hasPass ? (
                  <span className="opacity-50">(not set)</span>
                ) : showPass ? (
                  <code className="truncate font-mono">{smtp.pass}</code>
                ) : (
                  <code className="select-none blur-sm" aria-label="hidden password">••••••••••</code>
                )}
                {smtp.hasPass && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      aria-label={showPass ? "Hide SMTP password" : "Show SMTP password"}
                      className="rounded-full p-1.5 transition hover:bg-stone-200/60 dark:hover:bg-zinc-800"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    {showPass && <CopyButton text={smtp.pass} />}
                  </>
                )}
              </span>
            </Row>
            <Row label="From"><span className="truncate">{smtp.from}</span></Row>
            <Row label="App URL"><span className="truncate">{smtp.appUrl}</span></Row>
          </div>
        )}
        <p className="mt-3 text-sm opacity-60">
          Credentials live in the server environment (see <code>docs/OPERATIONS.md</code>), read-only here.
          Users set their recovery address in profile settings or at account creation.
        </p>
      </section>

      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium">Connectivity test</p>
        <p className="mt-0.5 text-sm opacity-60">Verify the connection, then send a real test mail to an address you control.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={verify} disabled={verifying || !smtp?.enabled}>
            {verifying ? <Spinner size={14} /> : null}
            {verifying ? "Verifying…" : "Verify connection"}
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="you@example.com"
            aria-label="Test recipient email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="flex-1"
          />
          <Button size="sm" onClick={sendTest} disabled={sending || !smtp?.enabled || !/^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(to.trim())}>
            {sending ? <Spinner size={14} /> : <Send size={14} />}
            {sending ? "Sending…" : "Send test mail"}
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
