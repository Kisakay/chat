import { useEffect, useState } from "react";
import { ArrowLeft, Inbox, LayoutDashboard, Mail, ShieldAlert, SlidersHorizontal, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { AccessRequestsPanel } from "./AccessRequests.tsx";
import { FlowerMark, LoadingScreen, Logo, Spinner, Switch } from "./ui.tsx";
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
  const [mail, setMail] = useState<{ recovery: boolean; from?: string } | null>(null);
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
        api.methods().then((m) => setMail(m)).catch(() => {});
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
          <Logo size={32} className="rounded-xl" />
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

        {tab === "mail" && (
          <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
                <Mail size={17} />
              </span>
              <div>
                <p className="text-sm font-medium">Key recovery emails</p>
                <p className="text-sm opacity-60">
                  {mail == null ? "Checking…" : mail.recovery ? `Enabled — sent from ${mail.from ?? "the configured sender"}` : "Disabled — set SMTP_HOST on the server to enable"}
                </p>
              </div>
              <span className={cn(
                "ml-auto rounded-full px-3 py-1 text-xs font-medium",
                mail?.recovery ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-stone-200/70 dark:bg-zinc-800",
              )}>
                {mail?.recovery ? "On" : "Off"}
              </span>
            </div>
            <p className="mt-3 text-sm opacity-60">
              SMTP credentials live in the server environment (see <code>docs/OPERATIONS.md</code>), never in this UI.
              Users set their recovery address in profile settings or at account creation.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
