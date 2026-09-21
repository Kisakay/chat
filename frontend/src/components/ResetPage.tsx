import { useEffect, useState } from "react";
import { KeyRound, MailWarning, Sparkles } from "lucide-react";
import { api } from "../lib/api.ts";
import { Button, CopyButton, FlowerMark, Spinner } from "./ui.tsx";
import { useT } from "../lib/i18n.ts";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "ready"; username: string }
  | { kind: "working" }
  | { kind: "done"; key: string }
  | { kind: "error"; message: string };

/** Public one-time key reset page: /reset/:token */
export function ResetPage({ token }: { token: string }) {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    api.resetCheck(token)
      .then((r) => setState({ kind: "ready", username: r.username }))
      .catch(() => setState({ kind: "invalid" }));
  }, [token]);

  async function consume() {
    setState({ kind: "working" });
    try {
      const r = await api.resetConsume(token);
      setState({ kind: "done", key: r.key });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : t("reset.failed") });
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-stone-100 via-stone-50 to-accent-100/60 p-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-accent-950/40">
      <div className="w-full max-w-sm rounded-[2rem] border border-white/60 bg-white/80 p-8 text-center shadow-2xl backdrop-blur-xl dark:border-zinc-700/60 dark:bg-zinc-900/80">
        <FlowerMark size={56} dynamic={false} className="mx-auto mb-4" />
        {state.kind === "loading" && <p className="flex items-center justify-center gap-2 text-sm opacity-60"><Spinner size={15} /> {t("reset.checking")}</p>}
        {state.kind === "invalid" && (
          <div className="space-y-3">
            <p className="flex items-center justify-center gap-2 font-semibold"><MailWarning size={18} className="text-red-500" /> {t("reset.invalid")}</p>
            <p className="text-sm opacity-70">{t("reset.invalidSub")}</p>
            <Button size="sm" onClick={() => (window.location.href = "/")}>{t("common.backToLogin")}</Button>
          </div>
        )}
        {state.kind === "ready" && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">{t("reset.readyTitle", { user: state.username })}</h1>
            <p className="text-sm opacity-70">{t("reset.readySub")}</p>
            <Button variant="gradient" size="lg" className="w-full" onClick={consume}>
              <KeyRound size={16} /> {t("reset.issue")}
            </Button>
          </div>
        )}
        {state.kind === "working" && <p className="flex items-center justify-center gap-2 text-sm opacity-60"><Spinner size={15} /> {t("reset.issuing")}</p>}
        {state.kind === "done" && (
          <div className="space-y-4">
            <h1 className="flex items-center justify-center gap-2 text-xl font-bold"><Sparkles size={18} className="text-accent-500" /> {t("reset.doneTitle")}</h1>
            <p className="text-sm opacity-70">{t("reset.doneSub")}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-2xl bg-stone-100 px-3 py-2.5 text-sm dark:bg-zinc-800">{state.key}</code>
              <CopyButton text={state.key} />
            </div>
            <Button size="lg" className="w-full" onClick={() => (window.location.href = "/")}>{t("reset.goLogin")}</Button>
          </div>
        )}
        {state.kind === "error" && (
          <div className="space-y-3">
            <p className="font-semibold text-red-600 dark:text-red-400">{t("reset.failed")}</p>
            <p className="text-sm opacity-70">{state.message}</p>
            <Button size="sm" onClick={() => (window.location.href = "/")}>{t("common.backToLogin")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
