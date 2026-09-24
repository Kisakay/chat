import { useEffect, useState } from "react";
import { Activity, Pencil, Plus, Server, Trash2, Undo2 } from "lucide-react";
import {
  api,
  type EffectiveOllamaNode,
  type OllamaNode,
  type OllamaNodeStats,
  type OllamaNodeStatus,
} from "../lib/api.ts";
import { Button, ConfirmDialog, Field, Input, Modal, Picker, Spinner, Switch } from "./ui.tsx";
import { useT } from "../lib/i18n.ts";
import { cn } from "../lib/cn.ts";

export function fmtSize(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

type StatsWindowId = "1h" | "6h" | "24h" | "7d" | "30d";
const WINDOWS: StatsWindowId[] = ["1h", "6h", "24h", "7d", "30d"];

/** Admin Ollama pool: nodes with firewall-like weights + generation timeout. */
export function NodesSection() {
  const { t } = useT();
  const [nodes, setNodes] = useState<OllamaNode[]>([]);
  const [effective, setEffective] = useState<EffectiveOllamaNode[]>([]);
  const [statuses, setStatuses] = useState<Record<string, OllamaNodeStatus | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formNode, setFormNode] = useState<OllamaNode | null | "new">(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [timeoutS, setTimeoutS] = useState("300");
  const [defWeight, setDefWeight] = useState("100");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setError("");
    try {
      const [list, settings] = await Promise.all([api.ollamaNodes(), api.adminGetSettings()]);
      setNodes(list.nodes);
      setEffective(list.effective);
      setTimeoutS(String(settings.settings.ollamaTimeoutS));
      setDefWeight(String(settings.settings.ollamaDefaultWeight));
      // Live probes in parallel; a dead node never blocks the list.
      const ids = ["default", ...list.nodes.map((n) => n.id)];
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, await api.ollamaNodeStatus(id)] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      const map: Record<string, OllamaNodeStatus | null> = {};
      for (const [id, st] of results) map[id] = st;
      setStatuses(map);
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

  const totalWeight = effective.reduce((s, n) => s + n.weight, 0);

  async function savePool(patch: { ollamaTimeoutS?: number; ollamaDefaultWeight?: number }) {
    setSaving(true);
    try {
      const res = await api.adminPatchSettings(patch);
      setTimeoutS(String(res.settings.ollamaTimeoutS));
      setDefWeight(String(res.settings.ollamaDefaultWeight));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function commitTimeout(raw: string) {
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 5 || v > 3600) {
      void refresh();
      return;
    }
    void savePool({ ollamaTimeoutS: v });
  }

  function commitDefWeight(raw: string) {
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > 1000) {
      void refresh();
      return;
    }
    void savePool({ ollamaDefaultWeight: v });
  }

  async function toggleEnabled(node: OllamaNode, enabled: boolean) {
    try {
      const res = await api.ollamaNodePatch(node.id, { enabled });
      setNodes((prev) => prev.map((n) => (n.id === res.node.id ? res.node : n)));
      const list = await api.ollamaNodes();
      setEffective(list.effective);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    }
  }

  async function remove(id: string) {
    try {
      await api.ollamaNodeDelete(id);
      setDeleteId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.deleteFailed"));
    }
  }

  const rows: { id: string; name: string; host: string; weight: number; enabled: boolean; builtin: boolean }[] = [
    {
      id: "default",
      name: "default",
      host: statuses["default"]?.host ?? "…",
      weight: effective.find((n) => n.id === "default")?.weight ?? 0,
      enabled: effective.some((n) => n.id === "default"),
      builtin: true,
    },
    ...nodes.map((n) => ({ id: n.id, name: n.name, host: n.host, weight: n.weight, enabled: n.enabled, builtin: false })),
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Server size={14} className="opacity-60" /> {t("nodes.title")}
        </p>
        <p className="mb-4 mt-0.5 text-sm opacity-60">{t("nodes.desc")}</p>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-200/70 px-3.5 py-2.5 dark:border-zinc-800">
            <Field label={t("nodes.timeout")} hint={t("nodes.timeoutUnit")}>
              <Input
                type="number"
                min={5}
                max={3600}
                value={timeoutS}
                disabled={saving}
                onChange={(e) => setTimeoutS(e.target.value)}
                onBlur={(e) => commitTimeout(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
            </Field>
            <p className="mt-1 text-xs opacity-60">{t("nodes.timeoutDesc")}</p>
          </div>
          <div className="rounded-2xl border border-stone-200/70 px-3.5 py-2.5 dark:border-zinc-800">
            <Field label={t("nodes.defWeight")} hint="0–1000">
              <Input
                type="number"
                min={0}
                max={1000}
                value={defWeight}
                disabled={saving}
                onChange={(e) => setDefWeight(e.target.value)}
                onBlur={(e) => commitDefWeight(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
            </Field>
            <p className="mt-1 text-xs opacity-60">{t("nodes.defWeightDesc")}</p>
          </div>
        </div>

        {error && <p className="mb-3 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        {loading && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}

        <ul className="space-y-2">
          {rows.map((r) => {
            const st = statuses[r.id] ?? null;
            const online = st?.reachable === true;
            const share = totalWeight > 0 && r.enabled && r.weight > 0 ? Math.round((r.weight / totalWeight) * 100) : 0;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-stone-200/70 px-3.5 py-2.5 dark:border-zinc-800",
                  !r.enabled && "opacity-60",
                )}
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", st === undefined ? "bg-stone-300 dark:bg-zinc-600" : online ? "bg-emerald-500" : "bg-red-500")} role="status" />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate text-sm font-medium">
                    {r.name}
                    {r.builtin && <span className="ml-2 rounded-full bg-stone-200/70 px-2 py-0.5 font-mono text-[11px] dark:bg-zinc-800">env</span>}
                  </span>
                  <span className="block truncate font-mono text-xs opacity-50">{r.host}</span>
                </span>
                <span className="shrink-0 rounded-full bg-stone-200/70 px-2.5 py-1 font-mono text-xs dark:bg-zinc-800" title={t("nodes.weightHint")}>
                  w:{r.weight} · {r.enabled ? t("nodes.share", { pct: share }) : t("nodes.off")}
                </span>
                {!r.builtin && (
                  <Switch
                    label={t("nodes.enabled")}
                    checked={r.enabled}
                    onChange={(v) => {
                      const full = nodes.find((n) => n.id === r.id);
                      if (full) void toggleEnabled(full, v);
                    }}
                  />
                )}
                <span className="flex shrink-0 gap-1">
                  <button
                    onClick={() => setDetailId(r.id)}
                    className="rounded-full p-2 transition hover:bg-stone-100 dark:hover:bg-zinc-800"
                    title={t("nodes.detail")}
                    aria-label={t("nodes.detail")}
                  >
                    <Activity size={15} />
                  </button>
                  {!r.builtin && (
                    <>
                      <button
                        onClick={() => {
                          const full = nodes.find((n) => n.id === r.id);
                          if (full) setFormNode(full);
                        }}
                        className="rounded-full p-2 transition hover:bg-stone-100 dark:hover:bg-zinc-800"
                        title={t("nodes.edit")}
                        aria-label={t("nodes.edit")}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteId(r.id)}
                        className="rounded-full p-2 text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        title={t("common.delete")}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setFormNode("new")}>
            <Plus size={14} /> {t("nodes.add")}
          </Button>
          <button
            onClick={() => refresh()}
            className="rounded-full p-2 opacity-60 transition hover:bg-stone-200/60 hover:opacity-100 dark:hover:bg-zinc-800"
            title={t("models.refresh")}
            aria-label={t("models.refreshAria")}
          >
            <Undo2 size={15} />
          </button>
        </div>
      </section>

      <NodeFormModal
        node={formNode === "new" ? null : formNode}
        open={formNode !== null}
        onClose={() => {
          setFormNode(null);
          refresh();
        }}
      />
      {detailId && <NodeDetailModal nodeId={detailId} onClose={() => setDetailId(null)} />}
      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title={t("nodes.deleteTitle")}
        message={t("nodes.deleteMsg")}
        onConfirm={() => deleteId && remove(deleteId)}
      />
    </div>
  );
}

/* ---------- add / edit modal ---------- */

function NodeFormModal({ node, open, onClose }: { node: OllamaNode | null; open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [weight, setWeight] = useState("100");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<OllamaNodeStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(node?.name ?? "");
      setHost(node?.host ?? "");
      setWeight(String(node?.weight ?? 100));
      setEnabled(node?.enabled ?? true);
      setProbe(null);
      setError("");
      setBusy(false);
    }
  }, [open, node]);

  async function test() {
    setProbing(true);
    setProbe(null);
    setError("");
    try {
      setProbe(await api.ollamaNodeProbe(host.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("nodes.testFail"));
    } finally {
      setProbing(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const w = Number(weight);
      const payload = { name: name.trim(), host: host.trim(), weight: w, enabled };
      if (node) await api.ollamaNodePatch(node.id, payload);
      else await api.ollamaNodeCreate(payload);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("nodes.invalid");
      setError(/already registered/i.test(msg) ? t("nodes.dupHost") : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={node ? t("nodes.edit") : t("nodes.add")} icon={Server}>
      <form onSubmit={save} className="space-y-4">
        <Field label={t("nodes.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("nodes.namePh")} required maxLength={60} />
        </Field>
        <Field label={t("nodes.host")} hint={t("nodes.hostHint")}>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t("nodes.hostPh")} required inputMode="url" />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Field label={t("nodes.weight")} hint="0–1000">
              <Input type="number" min={0} max={1000} value={weight} onChange={(e) => setWeight(e.target.value)} required />
            </Field>
          </div>
          <div className="pb-2.5">
            <Switch label={t("nodes.enabled")} checked={enabled} onChange={setEnabled} />
          </div>
          <div className="ml-auto pb-1">
            <Button type="button" variant="secondary" size="sm" onClick={test} disabled={probing || !host.trim()}>
              {probing ? <Spinner size={14} /> : <Activity size={14} />} {probing ? t("nodes.probing") : t("nodes.test")}
            </Button>
          </div>
        </div>
        {probe && (
          <p className={cn("rounded-2xl px-4 py-2.5 text-sm", probe.reachable ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400")} role="status">
            {probe.reachable
              ? `${t("nodes.testOk")}${probe.version ? ` · v${probe.version}` : ""} · ${probe.models.length} models`
              : `${t("nodes.testFail")}${probe.error ? ` — ${probe.error}` : ""}`}
          </p>
        )}
        <p className="text-xs opacity-60">{t("nodes.weightHint")}</p>
        {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy ? <Spinner size={14} /> : t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- node detail: live status + load charts ---------- */

function NodeDetailModal({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<OllamaNodeStatus | null>(null);
  const [stats, setStats] = useState<OllamaNodeStats | null>(null);
  const [window, setWindow] = useState<StatsWindowId>("24h");

  useEffect(() => {
    let alive = true;
    api.ollamaNodeStatus(nodeId).then((s) => { if (alive) setStatus(s); }).catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [nodeId]);

  useEffect(() => {
    let alive = true;
    api.ollamaNodeStats(nodeId, window).then((r) => { if (alive) setStats(r.stats); }).catch(() => {});
    return () => { alive = false; };
  }, [nodeId, window]);

  const maxReq = Math.max(1, ...((stats?.buckets ?? []).map((b) => b.req)));

  return (
    <Modal open onClose={onClose} title={t("nodes.detail")} icon={Activity} wide>
      {!status ? (
        <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
              <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("models.connHost")}</dt>
              <dd className="truncate font-mono text-sm" title={status.host}>{status.host}</dd>
            </div>
            <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
              <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("nodes.version")}</dt>
              <dd className="truncate font-mono text-sm">{status.version ?? "—"}</dd>
            </div>
            <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
              <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("nodes.latency")}</dt>
              <dd className="truncate font-mono text-sm">{status.latencyMs === null ? "—" : `${status.latencyMs} ms`}</dd>
            </div>
            <div className="rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
              <dt className="text-[11px] uppercase tracking-wider opacity-50">{t("nodes.diskModels", { n: status.models.length })}</dt>
              <dd className="truncate font-mono text-sm">{status.running.length} running</dd>
            </div>
          </dl>

          {status.running.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider opacity-50">{t("nodes.running")}</p>
              <ul className="space-y-1.5">
                {status.running.map((m) => (
                  <li key={m.name} className="flex items-center gap-3 rounded-2xl border border-stone-200/70 px-3.5 py-2 text-sm dark:border-zinc-800">
                    <span className="min-w-0 flex-1 truncate font-mono">{m.name}</span>
                    <span className="shrink-0 text-xs opacity-60">{t("nodes.vram")}: {fmtSize(m.sizeVram)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider opacity-50">{t("nodes.stats")}</p>
              <span className="ml-auto w-28">
                <Picker
                  ariaLabel={t("nodes.stats")}
                  value={window}
                  onChange={(v) => setWindow(v as StatsWindowId)}
                  align="right"
                  options={WINDOWS.map((w) => ({ value: w, label: w }))}
                />
              </span>
            </div>
            {stats && (
              <>
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs opacity-80">
                  <span>{stats.totals.req} {t("nodes.req")}</span>
                  <span className={stats.totals.err > 0 ? "text-red-500" : undefined}>{stats.totals.err} {t("nodes.err")}</span>
                  <span>{t("nodes.avg")}: {stats.totals.avgMs === null ? "—" : `${Math.round(stats.totals.avgMs)} ms`}</span>
                  <span>{t("nodes.tps")}: {stats.totals.tokPerSec === null ? "—" : stats.totals.tokPerSec.toFixed(1)}</span>
                  <span>{stats.totals.promptTok + stats.totals.evalTok} {t("nodes.tok")}</span>
                </div>
                {stats.totals.req === 0 ? (
                  <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-4 text-center text-sm opacity-50 dark:border-zinc-700">
                    {t("nodes.emptyStats")}
                  </p>
                ) : (
                  <div className="flex h-20 items-end gap-[3px]" role="img" aria-label={`${stats.totals.req} ${t("nodes.req")}`}>
                    {stats.buckets.map((b, i) => {
                      const h = Math.max(2, Math.round((b.req / maxReq) * 100));
                      const errH = b.req > 0 ? Math.round(h * (b.err / b.req)) : 0;
                      return (
                        <div
                          key={i}
                          className="flex min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-sm bg-accent-500/70"
                          style={{ height: `${h}%` }}
                          title={`${new Date(b.t).toLocaleString()} — ${b.req} ${t("nodes.req")}, ${b.err} ${t("nodes.err")}`}
                        >
                          {errH > 0 && <div className="w-full bg-red-500" style={{ height: `${(errH / h) * 100}%` }} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {status.models.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider opacity-50">{t("nodes.diskModels", { n: status.models.length })}</p>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {status.models.map((m) => (
                  <li key={m.name} className="flex items-center gap-3 rounded-2xl border border-stone-200/70 px-3.5 py-2 text-sm dark:border-zinc-800">
                    <span className="min-w-0 flex-1 truncate font-mono">{m.name}</span>
                    <span className="shrink-0 text-xs opacity-60">{fmtSize(m.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs opacity-50">{t("nodes.cpuNote")}</p>
        </div>
      )}
    </Modal>
  );
}
