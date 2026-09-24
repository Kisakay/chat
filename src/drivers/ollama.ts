import { config } from "../config.ts";
import { driverLog, fmtBytes, fmtMs } from "./log.ts";
import {
  effectiveOllamaNodes,
  getOllamaTimeoutMs,
  pickOllamaRoute,
  recordOllamaStat,
  type EffectiveNode,
} from "../ollamaNodes.ts";
import type { ChatMessage, ChatOptions, DriverModel, LLMDriver } from "./types.ts";

interface OllamaTag {
  name: string;
}

interface OllamaDone {
  done?: boolean;
  error?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Local LLM via Ollama (multi-node pool). Priority #1. */
export class OllamaDriver implements LLMDriver {
  readonly name = "ollama";
  readonly enabled: boolean;

  constructor(public readonly host: string = config.ollamaHost, enabled = config.ollamaEnabled) {
    this.host = host.replace(/\/$/, "");
    this.enabled = enabled;
  }

  /** Model list merged across every enabled node (deduped by name). */
  async listModels(): Promise<DriverModel[]> {
    const t0 = Date.now();
    const nodes = await effectiveOllamaNodes();
    if (nodes.length === 0) throw new Error("no ollama node available (all disabled or weight 0)");
    const seen = new Map<string, DriverModel>();
    const errors: string[] = [];
    await Promise.all(nodes.map(async (n) => {
      try {
        const res = await fetch(`${n.host}/api/tags`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { models?: OllamaTag[] };
        for (const m of data.models ?? []) {
          if (typeof m.name === "string" && !seen.has(m.name)) {
            seen.set(m.name, { id: `ollama:${m.name}`, name: m.name, driver: "ollama", label: m.name });
          }
        }
      } catch (e) {
        errors.push(`${n.name}: ${(e as Error).message}`);
      }
    }));
    const models = [...seen.values()];
    driverLog(this.name, `listModels -> ${models.length} model(s) across ${nodes.length} node(s) (${fmtMs(Date.now() - t0)})${errors.length > 0 ? ` [skipped: ${errors.join("; ")}]` : ""}`);
    if (models.length === 0 && errors.length > 0) throw new Error(`ollama listModels failed: ${errors.join("; ")}`);
    return models;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    let out = "";
    for await (const t of this.chatStream(messages, opts)) out += t;
    return out;
  }

  async *chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string, void, void> {
    const timeoutMs = await getOllamaTimeoutMs();
    const { order } = await pickOllamaRoute();
    let lastError: Error | null = null;
    for (const node of order) {
      // Failover only while nothing was produced yet: once tokens reached
      // the client, restarting on another node would duplicate the reply.
      let produced = false;
      const counting: ChatOptions = {
        ...opts,
        onToken: (t) => {
          produced = true;
          opts.onToken?.(t);
        },
      };
      try {
        yield* this.streamFromNode(node, messages, counting, timeoutMs);
        return;
      } catch (e) {
        // Caller hangup: never fail over (nobody is listening anymore).
        if (opts.signal?.aborted) throw e;
        if (produced) throw e;
        lastError = e as Error;
        driverLog(this.name, `chat model=${opts.model} node ${node.name} failed, failing over: ${lastError.message}`);
      }
    }
    throw lastError ?? new Error("ollama chat failed on every node");
  }

  /** One streaming attempt against a single node (throws on any failure). */
  private async *streamFromNode(
    node: EffectiveNode,
    messages: ChatMessage[],
    opts: ChatOptions,
    timeoutMs: number,
  ): AsyncGenerator<string, void, void> {
    const t0 = Date.now();
    driverLog(this.name, `chat model=${opts.model} node=${node.name} stream=open`);
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (opts.signal) signals.push(opts.signal);
    const signal = typeof AbortSignal.any === "function" ? AbortSignal.any(signals) : signals[0]!;
    const res = await fetch(`${node.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      driverLog(this.name, `chat model=${opts.model} node=${node.name} ERROR: upstream ${res.status} ${text.slice(0, 120)}`);
      await recordOllamaStat({ node_id: node.id, ok: false, latency_ms: Date.now() - t0, prompt_tokens: 0, eval_tokens: 0, model: opts.model });
      throw new Error(`ollama chat failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let chunks = 0;
    let chars = 0;
    let promptTokens = 0;
    let evalTokens = 0;
    let status = "done";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed) as OllamaDone;
            if (obj.error) throw new Error(`ollama error: ${obj.error}`);
            const token = obj.message?.content ?? "";
            if (token) {
              chunks++;
              chars += token.length;
              opts.onToken?.(token);
              yield token;
            }
            if (typeof obj.prompt_eval_count === "number") promptTokens = obj.prompt_eval_count;
            if (typeof obj.eval_count === "number") evalTokens = obj.eval_count;
            if (obj.done) {
              driverLog(this.name, `chat model=${opts.model} node=${node.name} done: ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
              await recordOllamaStat({ node_id: node.id, ok: true, latency_ms: Date.now() - t0, prompt_tokens: promptTokens, eval_tokens: evalTokens, model: opts.model });
              return;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // partial line, ignore
            throw e;
          }
        }
      }
      driverLog(this.name, `chat model=${opts.model} node=${node.name} upstream closed: ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
      // Truncated stream (no done:true): still a usable partial reply.
      await recordOllamaStat({ node_id: node.id, ok: true, latency_ms: Date.now() - t0, prompt_tokens: promptTokens, eval_tokens: evalTokens, model: opts.model });
    } catch (e) {
      const name = (e as Error).name;
      status = name === "AbortError" ? "aborted-by-caller" : name === "TimeoutError" ? "timeout" : `ERROR: ${(e as Error).message}`;
      // Caller aborts are not node failures — don't pollute telemetry.
      if (name !== "AbortError" || !opts.signal?.aborted) {
        await recordOllamaStat({ node_id: node.id, ok: false, latency_ms: Date.now() - t0, prompt_tokens: promptTokens, eval_tokens: evalTokens, model: opts.model });
      }
      throw e;
    } finally {
      // Stop the upstream generation when the consumer goes away
      // (client disconnect) instead of leaking it in the background.
      try {
        await reader.cancel();
      } catch {
        // already closed / consumed — fine
      }
      reader.releaseLock();
      if (status !== "done") {
        driverLog(this.name, `chat model=${opts.model} node=${node.name} ${status} after ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
      }
    }
  }
}
