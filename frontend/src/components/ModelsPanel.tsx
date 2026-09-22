import { useCallback, useEffect, useState } from "react";
import { Activity, Bot, Undo2 } from "lucide-react";
import { api, type OllamaStatus, type PolicyModel } from "../lib/api.ts";
import { OllamaModelsModal } from "./AdminPanel.tsx";
import { Button, Input, Spinner, Switch } from "./ui.tsx";
import { useT } from "../lib/i18n.ts";
import { cn } from "../lib/cn.ts";

/** Admin models section: per-model kill-switch + rate limits, Ollama library. */
export function ModelsPanel() {
  const [models, setModels] = useState<PolicyModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ollamaOpen, setOllamaOpen] = useState(false);
  const { t } = useT();

  async function refresh(force = false) {
    setError("");
    try {
      const res = await api.adminModelPolicy(force);
      setModels(res.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(updated: PolicyModel) {
    setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  const groups = (() => {
    const byGroup = new Map<string, PolicyModel[]>();
    for (const m of models) {
      const g = m.group ?? m.driver;
      const list = byGroup.get(g) ?? [];
      list.push(m);
      byGroup.set(g, list);
    }
    return [...byGroup.entries()];
  })();

  return (
    <div className="space-y-5">
      <OllamaConnectivity />

      <section>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-sm font-medium">{t("models.title")}</p>
          <button
            onClick={() => refresh(true)}
            className="ml-auto rounded-full p-2 opacity-60 transition hover:bg-stone-200/60 hover:opacity-100 dark:hover:bg-zinc-800"
            title={t("models.refresh")}
            aria-label={t("models.refreshAria")}
          >
            <Undo2 size={15} />
          </button>
        </div>
        <p className="mb-3 text-sm opacity-60">{t("models.desc")}</p>
        {error && <p className="mb-3 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        {loading && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}
        {!loading && models.length === 0 && !error && (
          <p className="rounded-3xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm opacity-50 dark:border-zinc-700">
            {t("models.empty")}
          </p>
        )}
        {groups.map(([group, list]) => (
          <div key={group} className="mb-4">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wider opacity-50">{group}</p>
            <ul className="space-y-2">
              {list.map((m) => (
                <ModelRow key={m.id} model={m} onChanged={apply} onError={setError} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium">{t("models.ollamaTitle")}</p>
        <p className="mt-0.5 text-sm opacity-60">{t("models.ollamaDesc")}</p>
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOllamaOpen(true)}
          >
            <Bot size={14} /> {t("ollama.models")}
          </Button>
        </div>
      </section>

      <OllamaModelsModal
        open={ollamaOpen}
        onClose={() => {
          setOllamaOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

/* ---------- Ollama connectivity probe (admin) ---------- */

function fmtSize(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Live Ollama host status: reachability, version, latency, on-disk models. */
function OllamaConnectivity() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const { t } = useT();

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.ollamaStatus());
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const state = !status ? "unknown" : !status.enabled ? "disabled" : status.reachable ? "online" : "offline";
  const dot =
    state === "online"
      ? "bg-emerald-500"
      : state === "offline"
        ? "bg-red-500"
        : "bg-stone-400 dark:bg-zinc-500";
  const stateLabel =
    state === "online"
      ? t("models.connOnline")
      : state === "offline"
        ? t("models.connOffline")
        : state === "disabled"
          ? t("models.connDisabledState")
          : t("common.loading");

  return (
    <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Activity size={14} className="opacity-60" /> {t("models.connTitle")}
        </p>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            state === "online" && "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
            state === "offline" && "bg-red-500/10 text-red-600 dark:text-red-400",
            (state === "disabled" || state === "unknown") && "bg-stone-200/70 dark:bg-zinc-800",
          )}
          role="status"
        >
          <span className={cn("h-2 w-2 rounded-full", dot, checking && "animate-pulse")} />
          {checking && !status ? t("common.loading") : stateLabel}
        </span>
        <button
          onClick={() => void check()}
          disabled={checking}
          className="ml-auto rounded-full p-2 opacity-60 transition hover:bg-stone-200/60 hover:opacity-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          title={t("models.connCheck")}
          aria-label={t("models.connCheckAria")}
        >
          <Undo2 size={15} className={checking ? "animate-spin" : undefined} />
        </button>
      </div>
      <p className="mb-3 text-sm opacity-60">{t("models.connDesc")}</p>

      {status && (
        <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
            <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("models.connHost")}</dt>
            <dd className="truncate font-mono text-sm" title={status.host}>{status.host}</dd>
          </div>
          <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
            <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("models.connVersion")}</dt>
            <dd className="truncate font-mono text-sm">{status.version ?? "—"}</dd>
          </div>
          <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
            <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("models.connLatency")}</dt>
            <dd className="truncate font-mono text-sm">{status.latencyMs === null ? "—" : `${status.latencyMs} ms`}</dd>
          </div>
          <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
            <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("models.connModels")}</dt>
            <dd className="truncate font-mono text-sm">{status.models.length}</dd>
          </div>
        </dl>
      )}

      {!checking && !status && (
        <p className="mb-3 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">
          {t("admin.loadFailed")}
        </p>
      )}
      {status && status.error && (
        <p className="mb-3 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">
          <span className="block font-mono text-[13px]">{status.error}</span>
          <span className="mt-0.5 block opacity-80">{t("models.connHint")}</span>
        </p>
      )}

      {status && status.reachable && (
        status.models.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-4 text-center text-sm opacity-50 dark:border-zinc-700">
            {t("models.connEmpty")}
          </p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {status.models.map((m) => (
              <li
                key={m.name}
                className="flex items-center gap-3 rounded-2xl border border-stone-200/70 px-3.5 py-2 dark:border-zinc-800"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{m.name}</span>
                <span className="shrink-0 text-xs opacity-60">{fmtSize(m.size)}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}

function ModelRow({ model, onChanged, onError }: {
  model: PolicyModel;
  onChanged: (m: PolicyModel) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useT();
  const [hourly, setHourly] = useState(model.hourly === 0 ? "" : String(model.hourly));
  const [daily, setDaily] = useState(model.daily === 0 ? "" : String(model.daily));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHourly(model.hourly === 0 ? "" : String(model.hourly));
    setDaily(model.daily === 0 ? "" : String(model.daily));
  }, [model.hourly, model.daily]);

  async function patch(p: { enabled?: boolean; hourly?: number; daily?: number }) {
    setBusy(true);
    try {
      const res = await api.adminModelPolicyPatch(model.id, p);
      onChanged(res.model);
      onError("");
    } catch (err) {
      onError(err instanceof Error ? err.message : t("models.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function commitNumber(kind: "hourly" | "daily", raw: string) {
    const v = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > 1000000) {
      if (kind === "hourly") setHourly(model.hourly === 0 ? "" : String(model.hourly));
      else setDaily(model.daily === 0 ? "" : String(model.daily));
      return;
    }
    if (v === model[kind]) return;
    void patch({ [kind]: v });
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-stone-200/70 bg-white px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900",
        !model.enabled && "opacity-60",
      )}
    >
      <span className="min-w-0 flex-1 basis-44">
        <span className="block truncate text-sm font-medium">{model.label || model.id}</span>
        <span className="block truncate font-mono text-xs opacity-50">{model.id}</span>
      </span>
      <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs opacity-80">
        <span className="w-24 shrink-0">
          <Input
            type="number"
            min={0}
            max={1000000}
            value={hourly}
            disabled={busy}
            placeholder={t("models.unlimited")}
            aria-label={t("models.hourly")}
            onChange={(e) => setHourly(e.target.value)}
            onBlur={(e) => commitNumber("hourly", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </span>
        {t("models.hourly")}
      </label>
      <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs opacity-80">
        <span className="w-24 shrink-0">
          <Input
            type="number"
            min={0}
            max={1000000}
            value={daily}
            disabled={busy}
            placeholder={t("models.unlimited")}
            aria-label={t("models.daily")}
            onChange={(e) => setDaily(e.target.value)}
            onBlur={(e) => commitNumber("daily", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </span>
        {t("models.daily")}
      </label>
      <Switch
        label={t("models.enabled")}
        checked={model.enabled}
        disabled={busy}
        onChange={(v) => void patch({ enabled: v })}
      />
    </li>
  );
}
