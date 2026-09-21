import { config } from "../config.ts";
import { driverLog, fmtBytes, fmtMs } from "./log.ts";
import type { ChatMessage, ChatOptions, DriverModel, LLMDriver } from "./types.ts";

interface OllamaTag {
  name: string;
}

/** Local LLM via Ollama. Priority #1. */
export class OllamaDriver implements LLMDriver {
  readonly name = "ollama";
  readonly enabled: boolean;

  constructor(public readonly host: string = config.ollamaHost, enabled = config.ollamaEnabled) {
    this.host = host.replace(/\/$/, "");
    this.enabled = enabled;
  }

  async listModels(): Promise<DriverModel[]> {
    const t0 = Date.now();
    const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      driverLog(this.name, `listModels ERROR: /api/tags -> ${res.status} (${fmtMs(Date.now() - t0)})`);
      throw new Error(`ollama /api/tags failed: ${res.status}`);
    }
    const data = (await res.json()) as { models?: OllamaTag[] };
    const models = data.models ?? [];
    driverLog(this.name, `listModels -> ${models.length} model(s) [${models.map((m) => m.name).join(", ")}] (${fmtMs(Date.now() - t0)})`);
    return models.map((m) => ({
      id: `ollama:${m.name}`,
      name: m.name,
      driver: "ollama",
      label: m.name,
    }));
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    let out = "";
    for await (const t of this.chatStream(messages, opts)) out += t;
    return out;
  }

  async *chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string, void, void> {
    const t0 = Date.now();
    driverLog(this.name, `chat model=${opts.model} messages=${messages.length} stream=open`);
    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      driverLog(this.name, `chat model=${opts.model} ERROR: upstream ${res.status} ${text.slice(0, 120)}`);
      throw new Error(`ollama chat failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let chunks = 0;
    let chars = 0;
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
            const obj = JSON.parse(trimmed) as { message?: { content?: string }; error?: string; done?: boolean };
            if (obj.error) throw new Error(`ollama error: ${obj.error}`);
            const token = obj.message?.content ?? "";
            if (token) {
              chunks++;
              chars += token.length;
              opts.onToken?.(token);
              yield token;
            }
            if (obj.done) {
              driverLog(this.name, `chat model=${opts.model} done: ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
              return;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // partial line, ignore
            throw e;
          }
        }
      }
      driverLog(this.name, `chat model=${opts.model} upstream closed: ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
    } catch (e) {
      status = (e as Error).name === "AbortError" ? "aborted-by-caller" : `ERROR: ${(e as Error).message}`;
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
        driverLog(this.name, `chat model=${opts.model} ${status} after ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
      }
    }
  }
}
