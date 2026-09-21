import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, MessageSquareText, ShieldCheck, User, UserPlus, Zap } from "lucide-react";
import { api, setToken } from "../lib/api.ts";
import type { User as UserType } from "../lib/types.ts";
import { Button, FlowerMark, Input, Spinner } from "./ui.tsx";
import { RecoverDialog, RegisterDialog } from "./dialogs.tsx";
import { AccessRequestModal } from "./ReviewPage.tsx";

const PERKS = [
  { icon: ShieldCheck, text: "Private by design — no cookies, no tracking" },
  { icon: Zap, text: "Your own models, streamed in real time" },
];

export function Login({ onLogin }: { onLogin: (user: UserType) => void }) {
  const [username, setUsername] = useState("admin");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoveryOn, setRecoveryOn] = useState(false);
  const [recoveryFrom, setRecoveryFrom] = useState<string | undefined>(undefined);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registrationOn, setRegistrationOn] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestOn, setRequestOn] = useState(false);

  useEffect(() => {
    api.methods().then((m) => {
      setRecoveryOn(m.recovery);
      setRecoveryFrom(m.from);
      setRegistrationOn(m.registration);
      setRequestOn(m.accessRequest);
    }).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await api.login(username.trim().toLowerCase(), key);
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center overflow-y-auto bg-gradient-to-br from-stone-100 via-stone-50 to-accent-100/60 p-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-accent-950/40">
      <div className="w-full max-w-sm">
        <div className="rounded-[2rem] border border-white/60 bg-white/80 p-8 shadow-2xl shadow-accent-900/5 backdrop-blur-xl dark:border-zinc-700/60 dark:bg-zinc-900/80">
          <div className="mb-2 flex flex-col items-center text-center">
            <FlowerMark size={68} className="mb-4 drop-shadow-lg" />
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm opacity-60">Sign in to KisAssistant to continue</p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <div className="relative">
              <User size={17} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-500" />
              <Input
                variant="soft"
                className="pl-12"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="Username"
                aria-label="Username"
                required
              />
            </div>
            <div className="relative">
              <KeyRound size={17} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-500" />
              <Input
                variant="soft"
                className="pl-12"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="current-password"
                placeholder="Access key"
                aria-label="Access key"
                required
              />
            </div>
            {error && (
              <p className="rounded-full bg-red-500/10 px-5 py-2.5 text-center text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="gradient" size="lg" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : (<>Unlock <ArrowRight size={17} /></>)}
            </Button>
          </form>
          <div className="mt-4 flex items-center gap-3 text-xs opacity-40">
            <span className="h-px flex-1 bg-current" />
            New here?
            <span className="h-px flex-1 bg-current" />
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="mt-3 w-full"
            disabled={!registrationOn}
            title={registrationOn ? "Create an account" : "Registration currently disabled on this platform"}
            onClick={() => setRegisterOpen(true)}
          >
            <UserPlus size={16} />
            Register
          </Button>
          <RegisterDialog
            open={registerOpen}
            onClose={() => setRegisterOpen(false)}
            onDone={(u, k) => { setUsername(u); setKey(k); }}
          />
          {/* Wishlist path: only when open registration is off AND the admin
              enabled access requests. They are mutually exclusive server-side. */}
          {!registrationOn && requestOn && (
            <Button
              variant="secondary"
              size="lg"
              className="mt-3 w-full"
              onClick={() => setRequestOpen(true)}
            >
              <MessageSquareText size={16} />
              Request access
            </Button>
          )}
          <AccessRequestModal open={requestOpen} onClose={() => setRequestOpen(false)} />
          {recoveryOn && (
            <button onClick={() => setRecoverOpen(true)} className="mt-3 w-full text-center text-sm opacity-60 transition hover:opacity-100 hover:underline">
              Forgot your access key?
            </button>
          )}
          <RecoverDialog open={recoverOpen} onClose={() => setRecoverOpen(false)} from={recoveryFrom} />

          <ul className="mt-6 space-y-2 border-t border-stone-200/70 pt-5 dark:border-zinc-800">
            {PERKS.map((p) => (
              <li key={p.text} className="flex items-center gap-2.5 text-[13px] opacity-70">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
                  <p.icon size={14} />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-center text-xs opacity-50">
          Admin key lives in the server <code>.env</code>; user keys are issued by the admin.
        </p>
      </div>
    </div>
  );
}
