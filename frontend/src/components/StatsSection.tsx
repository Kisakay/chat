import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Cpu, Globe, HardDrive, Network, Server, Spline } from "lucide-react";
import {
  api,
  type EffectiveOllamaNode,
  type OllamaNodeStats,
  type PlatformInfo,
} from "../lib/api.ts";
import { fmtSize } from "./OllamaNodes.tsx";
import { Picker, Spinner } from "./ui.tsx";
import { useT } from "../lib/i18n.ts";
import { cn } from "../lib/cn.ts";

type StatsWindowId = "1h" | "6h" | "24h" | "7d" | "30d";
const WINDOWS: StatsWindowId[] = ["1h", "6h", "24h", "7d", "30d"];

type ChartKind = "bar" | "area" | "line";
const CHARTS: { id: ChartKind; label: string; icon: typeof BarChart3 }[] = [
  { id: "bar", label: "Bar", icon: BarChart3 },
  { id: "area", label: "Area", icon: Spline },
  { id: "line", label: "Line", icon: Spline },
];

function fmtUptime(totalS: number): string {
  const d = Math.floor(totalS / 86400);
  const h = Math.floor((totalS % 86400) / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtClock(t: number): string {
  const d = new Date(t);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${d.getDate()}/${d.getMonth() + 1} ${hh}:${mm}`;
}

/** Admin telemetry sub-page: pool load charts + platform host facts. */
export function StatsSection() {
  const { t } = useT();
  const [nodes, setNodes] = useState<EffectiveOllamaNode[]>([{ id: "default", name: "default", host: "", weight: 0 }]);
  const [nodeId, setNodeId] = useState("default");
  const [window, setWindow] = useState<StatsWindowId>("24h");
  const [kind, setKind] = useState<ChartKind>("bar");
  const [stats, setStats] = useState<OllamaNodeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);

  useEffect(() => {
    api.ollamaNodes()
      .then((r) => setNodes([{ id: "default", name: "default", host: "", weight: 0 }, ...r.effective.filter((n) => n.id !== "default")]))
      .catch(() => {});
    api.platform().then((r) => setPlatform(r.platform)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.ollamaNodeStats(nodeId, window)
      .then((r) => setStats(r.stats))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [nodeId, window]);

  const totals = stats?.totals;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Server size={14} className="opacity-60" /> {t("stats.poolTitle")}
          </p>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="w-40">
              <Picker
                ariaLabel={t("stats.node")}
                value={nodeId}
                onChange={setNodeId}
                align="right"
                options={nodes.map((n) => ({ value: n.id, label: n.id === "default" ? "default" : n.name }))}
              />
            </span>
            <span className="w-24">
              <Picker
                ariaLabel={t("stats.window")}
                value={window}
                onChange={(v) => setWindow(v as StatsWindowId)}
                align="right"
                options={WINDOWS.map((w) => ({ value: w, label: w }))}
              />
            </span>
          </span>
        </div>
        <p className="mb-3 text-sm opacity-60">{t("stats.poolDesc")}</p>

        {/* Chart-type dock */}
        <div className="mb-3 inline-flex gap-1 rounded-full border border-stone-200/70 bg-stone-100/70 p-1 dark:border-zinc-800 dark:bg-zinc-900" role="tablist" aria-label={t("stats.chart")}>
          {CHARTS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={kind === c.id}
              onClick={() => setKind(c.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                kind === c.id
                  ? "bg-white text-stone-900 shadow dark:bg-zinc-800 dark:text-zinc-100"
                  : "opacity-60 hover:opacity-100",
              )}
            >
              <c.icon size={13} />
              {c.label}
            </button>
          ))}
        </div>

        {loading && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}

        {totals && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <StatTile label={t("nodes.req")} value={String(totals.req)} />
            <StatTile label={t("nodes.err")} value={String(totals.err)} alert={totals.err > 0} />
            <StatTile label={t("nodes.avg")} value={totals.avgMs === null ? "—" : `${Math.round(totals.avgMs)} ms`} />
            <StatTile label={t("nodes.tps")} value={totals.tokPerSec === null ? "—" : totals.tokPerSec.toFixed(1)} />
            <StatTile label={t("nodes.tok")} value={String(totals.promptTok + totals.evalTok)} />
          </div>
        )}

        {stats && (stats.totals.req === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm opacity-50 dark:border-zinc-700">
            {t("nodes.emptyStats")}
          </p>
        ) : (
          <LoadChart stats={stats} kind={kind} />
        ))}
        <p className="mt-2 text-xs opacity-50">{t("nodes.cpuNote")}</p>
      </section>

      <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <Cpu size={14} className="opacity-60" /> {t("stats.hostTitle")}
        </p>
        <p className="mb-3 text-sm opacity-60">{t("stats.hostDesc")}</p>
        {!platform ? (
          <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label={t("stats.hostname")} value={platform.hostname} mono />
              <StatTile label={t("stats.kernel")} value={platform.kernel} mono />
              <StatTile label={t("stats.cpu")} value={`${platform.cpus} × ${platform.cpuModel?.split("@")[0]?.trim() ?? "?"}`} mono />
              <StatTile label={t("stats.runtime")} value={platform.runtime} mono />
              <StatTile label={t("stats.uptime")} value={fmtUptime(platform.uptimeS)} />
              <StatTile label={t("stats.appUptime")} value={fmtUptime(platform.appUptimeS)} />
              <StatTile label={t("stats.load")} value={platform.loadavg.map((v) => v.toFixed(2)).join(" ")} mono />
              <StatTile
                label={t("stats.memory")}
                value={`${fmtSize(platform.memTotal - platform.memFree)} / ${fmtSize(platform.memTotal)}`}
              />
            </div>
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-zinc-800" title={t("stats.memory")}>
                <div
                  className="h-full rounded-full bg-accent-600 dark:bg-accent-500"
                  style={{ width: `${Math.min(100, Math.round(((platform.memTotal - platform.memFree) / Math.max(1, platform.memTotal)) * 100))}%` }}
                />
              </div>
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider opacity-50">
                <Network size={12} /> {t("stats.network")}
              </p>
              <ul className="space-y-1.5">
                {platform.nets
                  .filter((n) => !n.address.startsWith("fe80"))
                  .sort((a, b) => Number(a.internal) - Number(b.internal))
                  .map((n, i) => (
                    <li key={`${n.name}-${n.address}-${i}`} className="flex items-center gap-3 rounded-2xl border border-stone-200/70 px-3.5 py-2 text-sm dark:border-zinc-800">
                      <Globe size={13} className="shrink-0 opacity-50" />
                      <span className="min-w-0 flex-1 truncate font-mono">{n.address}</span>
                      <span className="shrink-0 text-xs opacity-60">{n.name} · {n.family}{n.internal ? " · lo" : ""}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs opacity-50">
                <HardDrive size={12} /> {t("stats.diskNote")}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value, mono, alert }: { label: string; value: string; mono?: boolean; alert?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-stone-100/70 px-3 py-2 dark:bg-zinc-800/60">
      <p className="truncate text-[11px] uppercase tracking-wider opacity-50">{label}</p>
      <p className={cn("truncate text-sm font-medium", mono && "font-mono", alert && "text-red-500")} title={value}>{value}</p>
    </div>
  );
}

/* ---------- SVG load chart with tooltip ---------- */

const W = 480;
const H = 180;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 22;

function LoadChart({ stats, kind }: { stats: OllamaNodeStats; kind: ChartKind }) {
  const { t } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const buckets = stats.buckets;
  const n = buckets.length;
  const maxReq = Math.max(1, ...buckets.map((b) => b.req));
  const maxAvg = Math.max(1, ...buckets.map((b) => b.avgMs ?? 0));

  const iw = W - PAD_L - PAD_R;
  const ih = H - PAD_T - PAD_B;
  const step = iw / n;
  const bw = Math.max(2, step - 2);

  const { points, areaPath, errPoints } = useMemo(() => {
    const pts = buckets.map((b, i) => ({
      x: PAD_L + i * step + step / 2,
      y: PAD_T + ih - (b.req / maxReq) * ih,
    }));
    const area = `M${PAD_L},${PAD_T + ih} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + ` L${(PAD_L + iw).toFixed(1)},${PAD_T + ih} Z`;
    const err = buckets.map((b, i) => ({
      x: PAD_L + i * step + step / 2,
      y: PAD_T + ih - (b.err / maxReq) * ih,
    }));
    return { points: pts, areaPath: area, errPoints: err };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, kind]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = W / rect.width;
    const x = (e.clientX - rect.left) * sx - PAD_L;
    const i = Math.round(x / step - 0.5);
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const hb = hover !== null ? buckets[hover]! : null;
  // Latency sparkline (normalized, bottom-anchored, subtle).
  const latPath = useMemo(() => {
    const pts = buckets.map((b, i) => {
      const x = PAD_L + i * step + step / 2;
      const v = b.avgMs ?? 0;
      return `L${x.toFixed(1)},${(PAD_T + ih - (v / maxAvg) * ih * 0.5).toFixed(1)}`;
    });
    return `M${PAD_L},${PAD_T + ih} ` + pts.join(" ");
  }, [buckets, maxAvg, step, ih]);

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${stats.totals.req} ${t("nodes.req")}`}
      >
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + ih * f}
            y2={PAD_T + ih * f}
            className="stroke-stone-200 dark:stroke-zinc-800"
            strokeWidth={1}
          />
        ))}
        {kind === "bar" && buckets.map((b, i) => {
          const h = Math.max(1.5, (b.req / maxReq) * ih);
          const x = PAD_L + i * step + (step - bw) / 2;
          const y = PAD_T + ih - h;
          const errH = b.req > 0 ? h * (b.err / b.req) : 0;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={h} rx={1.5} style={{ fill: "rgb(var(--ka-accent-500) / 0.75)" }} opacity={hover === i ? 1 : 0.85} />
              {errH > 0 && <rect x={x} y={y} width={bw} height={errH} rx={1.5} className="fill-red-500" />}
            </g>
          );
        })}
        {kind === "area" && (
          <>
            <path d={areaPath} style={{ fill: "rgb(var(--ka-accent-500) / 0.25)" }} />
            <polyline
              points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
              fill="none"
              style={{ stroke: "rgb(var(--ka-accent-500))" }}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <polyline points={errPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" className="stroke-red-500" strokeWidth={1.5} strokeDasharray="3 2" />
          </>
        )}
        {kind === "line" && (
          <>
            <polyline points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" style={{ stroke: "rgb(var(--ka-accent-500))" }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={errPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" className="stroke-red-500" strokeWidth={1.5} strokeDasharray="3 2" />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 3.5 : 2} style={{ fill: "rgb(var(--ka-accent-500))" }} />
            ))}
          </>
        )}
        {/* latency underlay */}
        <path d={latPath} fill="none" className="stroke-sky-400" strokeWidth={1} opacity={0.5} />
        {/* hover cursor */}
        {hover !== null && (
          <line x1={points[hover]!.x} x2={points[hover]!.x} y1={PAD_T} y2={PAD_T + ih} className="stroke-stone-400 dark:stroke-zinc-500" strokeWidth={1} strokeDasharray="2 2" />
        )}
        {/* x labels */}
        {[0, Math.floor(n / 2), n - 1].map((i) => (
          <text key={i} x={PAD_L + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize={9} className="fill-stone-400 dark:fill-zinc-500">
            {fmtClock(buckets[i]!.t)}
          </text>
        ))}
      </svg>
      {hb && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-2xl border border-stone-200 bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
          style={{
            left: `clamp(4px, ${(points[hover]!.x / W) * 100}%, calc(100% - 150px))`,
            top: 0,
            transform: "translateX(-50%)",
          }}
        >
          <p className="mb-1 font-medium opacity-70">{fmtClock(hb.t)}</p>
          <p>{hb.req} {t("nodes.req")} · <span className="text-red-500">{hb.err} {t("nodes.err")}</span></p>
          <p className="opacity-70">{t("nodes.avg")}: {hb.avgMs === null ? "—" : `${Math.round(hb.avgMs)} ms`}</p>
          <p className="opacity-70">{hb.promptTok + hb.evalTok} {t("nodes.tok")}</p>
        </div>
      )}
      <div className="mt-1 flex items-center gap-4 text-[11px] opacity-60">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "rgb(var(--ka-accent-500))" }} /> {t("nodes.req")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> {t("nodes.err")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" /> {t("nodes.avg")}</span>
      </div>
    </div>
  );
}
