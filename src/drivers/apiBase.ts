import type { ChatMessage, ChatOptions, DriverModel, LLMDriver } from "./types.ts";
import { DriverDisabledError } from "./types.ts";
import { driverLog, fmtBytes, fmtMs } from "./log.ts";

/**
 * Base class for OpenAI-compatible HTTP API drivers
 * (mistral / glm / deepseek / openai / anthropic adapter).
 * Only enabled when an API key is configured. Phase 1: disabled stubs.
 */
export abstract class ApiDriverBase implements LLMDriver {
  abstract readonly name: string;
  readonly enabled: boolean;
  protected baseUrl: string;
  protected apiKey: string;
  protected defaultModels: string[];

  constructor(opts: { baseUrl: string; apiKey: string; enabled: boolean; defaultModels: string[] }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.enabled = opts.enabled && opts.apiKey.length > 0;
    this.defaultModels = opts.defaultModels;
  }

  protected ensureEnabled(): void {
    if (!this.enabled) throw new DriverDisabledError(this.name);
  }

  async listModels(): Promise<DriverModel[]> {
    this.ensureEnabled();
    // Try /models endpoint, fall back to static list.
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { id: string }[] };
        if (Array.isArray(data.data) && data.data.length > 0) {
          driverLog(this.name, `listModels -> ${data.data.length} model(s) via /models`);
          return data.data.map((m) => ({ id: `${this.name}:${m.id}`, name: m.id, driver: this.name, label: m.id }));
        }
      }
    } catch (e) {
      driverLog(this.name, `listModels: /models failed (${(e as Error).message}), using static list`);
    }
    return this.defaultModels.map((m) => ({ id: `${this.name}:${m}`, name: m, driver: this.name, label: m }));
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    this.ensureEnabled();
    let out = "";
    for await (const t of this.chatStream(messages, opts)) out += t;
    return out;
  }

  async *chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string, void, void> {
    this.ensureEnabled();
    const t0 = Date.now();
    driverLog(this.name, `chat model=${opts.model} messages=${messages.length} stream=open`);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      driverLog(this.name, `chat model=${opts.model} ERROR: upstream ${res.status} ${text.slice(0, 120)}`);
      throw new Error(`${this.name} chat failed (${res.status}): ${text.slice(0, 300)}`);
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
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          for (const line of ev.split("\n")) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (payload === "[DONE]") {
              driverLog(this.name, `chat model=${opts.model} done: ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
              return;
            }
            try {
              const obj = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
              const token = obj.choices?.[0]?.delta?.content ?? "";
              if (token) {
                chunks++;
                chars += token.length;
                opts.onToken?.(token);
                yield token;
              }
            } catch {
              continue;
            }
          }
        }
      }
      driverLog(this.name, `chat model=${opts.model} upstream closed: ${chunks} chunks, ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
    } catch (e) {
      status = (e as Error).name === "AbortError" ? "aborted-by-caller" : `ERROR: ${(e as Error).message}`;
      throw e;
    } finally {
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
