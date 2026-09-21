import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, UserPlus } from "lucide-react";
import { api } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { navigate } from "../lib/route.ts";
import { Button, CopyButton, Field, FlowerMark, Input, LangPicker, Spinner } from "./ui.tsx";

const PREFILL_KEY = "ka_login_prefill";

/** Full-page self-registration (/register). No boot splash on this route. */
export function RegisterPage() {
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registrationOn, setRegistrationOn] = useState(true);

  useEffect(() => {
    api.methods().then((m) => setRegistrationOn(m.registration)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.register({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || undefined,
        email: email.trim() || undefined,
      });
      setKey(res.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dlg.regFailed"));
    } finally {
      setBusy(false);
    }
  }

  function goLogin() {
    const u = username.trim().toLowerCase();
    if (key && u) {
      try {
        sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ username: u, key }));
      } catch {
        // private mode — the login form just stays empty
      }
    }
    navigate("/login");
  }

  return (
    <div className="grid min-h-full place-items-center overflow-y-auto bg-gradient-to-br from-stone-100 via-stone-50 to-accent-100/60 p-4 dark:from-zinc-950 dark:via-zinc-950 dark:to-accent-950/40">
      <div className="w-full max-w-md">
        <div className="rounded-[2rem] border border-white/60 bg-white/80 px-6 py-6 shadow-2xl shadow-accent-900/5 backdrop-blur-xl sm:px-8 dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <div className="mb-1 flex flex-col items-center text-center">
            <FlowerMark size={52} dynamic={false} className="mb-2 drop-shadow-lg" />
            <h1 className="text-2xl font-bold tracking-tight">{t("dlg.registerTitle")}</h1>
          </div>

          {key ? (
            <div className="mt-4 space-y-3">
              <p className="text-center text-sm opacity-80">
                {t("dlg.regWelcome", { user: username.trim().toLowerCase() })}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-2xl bg-stone-100 px-3 py-2.5 text-sm dark:bg-zinc-800">{key}</code>
                <CopyButton text={key} />
              </div>
              <Button variant="gradient" size="lg" className="w-full" onClick={goLogin}>
                {t("dlg.regContinue")} <ArrowRight size={17} />
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <Field label={t("common.username")}>
                  <Input
                    variant="soft"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="alice"
                    maxLength={32}
                    autoComplete="username"
                    required
                  />
                </Field>
                <Field label={t("common.displayName")}>
                  <Input
                    variant="soft"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Alice"
                    maxLength={60}
                    autoComplete="nickname"
                  />
                </Field>
              </div>
              <Field label={t("dlg.emailOpt")}>
                <Input
                  variant="soft"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@example.com"
                  inputMode="email"
                  autoComplete="email"
                />
              </Field>
              {error && (
                <p className="rounded-full bg-red-500/10 px-5 py-2.5 text-center text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="gradient"
                size="lg"
                className="w-full"
                disabled={busy || !registrationOn}
                title={registrationOn ? undefined : t("login.regTipOff")}
              >
                {busy ? <Spinner /> : (<><UserPlus size={16} /> {t("login.register")}</>)}
              </Button>
              {!registrationOn && (
                <p className="text-center text-sm opacity-60">{t("login.regTipOff")}</p>
              )}
            </form>
          )}

          <button
            onClick={() => navigate("/login")}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 text-center text-sm opacity-60 transition hover:opacity-100 hover:underline"
          >
            <ArrowLeft size={15} />
            {t("common.backToLogin")}
          </button>

          <div className="mt-3 flex justify-center">
            <LangPicker />
          </div>
        </div>
      </div>
    </div>
  );
}
