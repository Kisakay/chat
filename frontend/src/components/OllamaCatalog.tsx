import { useEffect, useRef, useState } from "react";
import { Download, Globe, Server } from "lucide-react";
import { api, type EffectiveOllamaNode } from "../lib/api.ts";
import { Field, Input, Picker, Spinner } from "./ui.tsx";
import { useT } from "../lib/i18n.ts";
import { cn } from "../lib/cn.ts";

interface HfHit {
  id: string;
  downloads: number;
  likes: number;
}

interface HfFile {
  name: string;
  quant: string;
  size: number | null;
}

/** Extract the quantization tag from a GGUF filename (…-Q4_K_M.gguf). */
function quantOf(filename: string): string | null {
  const base = filename.split("/").pop() ?? filename;
  const m = base.match(/[-_.](Q\d(?:_\w+)?|IQ\d_\w+|BF16|F16|F32)(?:\.gguf)$/i);
  return m ? m[1]!.toUpperCase() : null;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Hugging Face GGUF catalog: search, pick a quantization, pull hf.co/… */
export function CatalogSection() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<HfHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [files, setFiles] = useState<Record<string, HfFile[] | null>>({});
  const [nodes, setNodes] = useState<EffectiveOllamaNode[]>([{ id: "default", name: "default", host: "", weight: 0 }]);
  const [nodeId, setNodeId] = useState("default");
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullStatus, setPullStatus] = useState("");
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.ollamaNodes().then((r) => {
      setNodes([{ id: "default", name: "default", host: "", weight: 0 }, ...r.effective.filter((n) => n.id !== "default")]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=15`,
        );
        if (!res.ok) throw new Error(`Hugging Face: ${res.status}`);
        const data = (await res.json()) as { id?: string; downloads?: number; likes?: number }[];
        setHits(
          (Array.isArray(data) ? data : [])
            .filter((m) => typeof m.id === "string")
            .map((m) => ({ id: m.id as string, downloads: m.downloads ?? 0, likes: m.likes ?? 0 })),
        );
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "search failed");
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  async function loadFiles(id: string) {
    if (files[id] !== undefined) return;
    setFiles((prev) => ({ ...prev, [id]: null }));
    try {
      const res = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Hugging Face: ${res.status}`);
      const data = (await res.json()) as { siblings?: { rfilename?: string }[] };
      const list: HfFile[] = [];
      for (const s of data.siblings ?? []) {
        const name = s.rfilename ?? "";
        if (!name.toLowerCase().endsWith(".gguf")) continue;
        const quant = quantOf(name);
        if (quant) list.push({ name, quant, size: null });
      }
      // Biggest quants last (heuristic on the tag, not the file size).
      setFiles((prev) => ({ ...prev, [id]: list }));
    } catch {
      setFiles((prev) => ({ ...prev, [id]: [] }));
    }
  }

  async function pull(id: string, quant: string) {
    const ref = `hf.co/${id}:${quant}`;
    if (pulling) return;
    setPulling(ref);
    setError("");
    setPullStatus(t("catalog.pulling", { name: ref }));
    setPullPct(null);
    try {
      await api.ollamaPull(ref, (p) => {
        if (p.error) {
          setError(p.error);
          return;
        }
        setPullStatus(p.status || ref);
        if (p.total && p.completed) setPullPct(Math.min(100, Math.round((p.completed / p.total) * 100)));
        else setPullPct(null);
      }, { nodeId });
      setPullStatus(ref);
      setPullPct(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "pull failed");
    } finally {
      setPulling(null);
    }
  }

  return (
    <section className="rounded-3xl border border-stone-200/70 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Globe size={14} className="opacity-60" /> {t("catalog.title")}
      </p>
      <p className="mb-3 mt-0.5 text-sm opacity-60">{t("catalog.desc")}</p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("catalog.searchPh")}
            aria-label={t("catalog.searchPh")}
          />
        </div>
        <div className="w-44">
          <Field label={t("catalog.node")}>
            <Picker
              ariaLabel={t("catalog.node")}
              icon={Server}
              value={nodeId}
              onChange={setNodeId}
              align="right"
              options={nodes.map((n) => ({ value: n.id, label: n.id === "default" ? "default" : `${n.name} (w:${n.weight})` }))}
            />
          </Field>
        </div>
      </div>

      {error && <p className="mb-3 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {pulling && (
        <div className="mb-3 rounded-2xl border border-accent-500/40 bg-accent-50 p-4 dark:bg-accent-950/30">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Download size={15} className="animate-bounce" /> {t("catalog.pulling", { name: pulling })}
          </p>
          <p className="mb-2 truncate text-xs opacity-70">{pullStatus}</p>
          {pullPct !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-accent-600 transition-all dark:bg-accent-500" style={{ width: `${pullPct}%` }} />
            </div>
          )}
        </div>
      )}

      {searching && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("common.loading")}</p>}
      {!searching && searched && hits.length === 0 && (
        <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-4 text-center text-sm opacity-50 dark:border-zinc-700">
          {t("catalog.noRes")}
        </p>
      )}

      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.id} className="rounded-2xl border border-stone-200/70 px-3.5 py-2.5 dark:border-zinc-800">
            <button
              onClick={() => loadFiles(h.id)}
              className="flex w-full items-center gap-3 text-left"
              aria-expanded={files[h.id] !== undefined}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm font-medium">{h.id}</span>
                <span className="block text-xs opacity-50">{fmtNum(h.downloads)} {t("catalog.downloads")} · ♥ {fmtNum(h.likes)}</span>
              </span>
              <span className={cn("text-xs opacity-60", files[h.id] === undefined && "underline underline-offset-2")}>
                {t("catalog.files")}
              </span>
            </button>
            {files[h.id] !== undefined && (
              <div className="mt-2 border-t border-stone-200/70 pt-2 dark:border-zinc-800">
                {files[h.id] === null ? (
                  <p className="flex items-center gap-2 py-1 text-xs opacity-60"><Spinner size={13} /> {t("common.loading")}</p>
                ) : files[h.id]!.length === 0 ? (
                  <p className="py-1 text-xs opacity-50">{t("catalog.noRes")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {files[h.id]!.map((f) => {
                      const ref = `hf.co/${h.id}:${f.quant}`;
                      return (
                        <li key={f.name}>
                          <button
                            onClick={() => pull(h.id, f.quant)}
                            disabled={pulling !== null}
                            title={ref}
                            className="rounded-full border border-stone-200/70 px-3 py-1.5 font-mono text-xs transition hover:border-accent-500/60 hover:bg-accent-500/5 disabled:opacity-40 dark:border-zinc-700"
                          >
                            {pulling === ref ? <Spinner size={12} /> : <Download size={12} className="mr-1 inline" />}
                            {f.quant}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-1.5 text-xs opacity-50">{t("catalog.hint")}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
