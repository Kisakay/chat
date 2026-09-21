import { useEffect, useState } from "react";
import { Bot, Undo2 } from "lucide-react";
import { api, type PolicyModel } from "../lib/api.ts";
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
      <label className="flex items-center gap-1.5 text-xs opacity-80">
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
          className="w-24"
        />
        {t("models.hourly")}
      </label>
      <label className="flex items-center gap-1.5 text-xs opacity-80">
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
          className="w-24"
        />
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
