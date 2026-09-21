import { useState } from "react";
import { KeyRound, Sparkles, User } from "lucide-react";
import { api, setToken } from "../lib/api.ts";
import type { User as UserType } from "../lib/types.ts";
import { Button, Field, Input, Spinner } from "./ui.tsx";

export function Login({ onLogin }: { onLogin: (user: UserType) => void }) {
  const [username, setUsername] = useState("admin");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-stone-100 via-stone-50 to-emerald-50 p-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-emerald-950/30">
      <div className="w-full max-w-sm rounded-[2rem] border border-stone-200/70 bg-white/90 p-8 shadow-2xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
            <Sparkles size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">KisAssistant</h1>
            <p className="text-sm opacity-60">Private assistant</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <div className="relative">
              <User size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
              <Input className="pl-10" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
          </Field>
          <Field label="Access key" hint="Admin key lives in the server .env; user keys are issued by the admin.">
            <div className="relative">
              <KeyRound size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
              <Input
                className="pl-10"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </Field>
          {error && <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400" role="alert">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? <Spinner /> : "Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}
