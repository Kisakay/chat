import { config } from "../config.ts";
import type { ChatMessage, ChatOptions, DriverModel, LLMDriver } from "./types.ts";

interface OllamaTag {
  name: string;
}

/** Local LLM via Ollama. Priority #1. */
export class OllamaDriver implements LLMDriver {
  readonly name = "ollama";
  readonly enabled: boolean;

  constructor(private host: string = config.ollamaHost, enabled = config.ollamaEnabled) {
    this.host = host.replace(/\/$/, "");
    this.enabled = enabled;
  }

  async listModels(): Promise<DriverModel[]> {
    const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`ollama /api/tags failed: ${res.status}`);
    const data = (await res.json()) as { models?: OllamaTag[] };
    const models = data.models ?? [];
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
    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`ollama chat failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
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
              opts.onToken?.(token);
              yield token;
            }
            if (obj.done) return;
          } catch (e) {
            if (e instanceof SyntaxError) continue; // partial line, ignore
            throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
