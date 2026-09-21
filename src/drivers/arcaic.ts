import { config } from "../config.ts";
import { driverLog, fmtBytes, fmtMs } from "./log.ts";
import {
  ArcaicBrowserEngine,
  GEMINI_SITE,
  OPENAI_SITE,
  QWEN_SITE,
  type BrowserSite,
} from "./browser.ts";
import type { ChatMessage, ChatOptions, DriverModel, LLMDriver } from "./types.ts";
import { DriverDisabledError } from "./types.ts";

export interface ArcaicSpec {
  key: string;
  label: string;
  site: BrowserSite;
}

const SPECS: ArcaicSpec[] = [
  { key: "arcaic-openai", label: "arcaic-openai", site: OPENAI_SITE },
  { key: "arcaic-gemini", label: "arcaic-gemini", site: GEMINI_SITE },
  { key: "arcaic-qwen", label: "arcaic-qwen", site: QWEN_SITE },
];

/**
 * Flatten a KisAssistant conversation into one prompt for the Arcaic web
 * composer: system text as a preamble, earlier turns as a transcript, and
 * the latest user message sent as-is.
 */
export function flattenMessages(messages: ChatMessage[]): string {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n")
    .trim();
  const rest = messages.filter((m) => m.role !== "system");
  const last = rest[rest.length - 1];
  const earlier = rest.slice(0, -1);
  const parts: string[] = [];
  if (system) parts.push(`[Instructions]\n${system}\n`);
  if (earlier.length) {
    parts.push("[Conversation so far]");
    for (const m of earlier) parts.push(`${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
    parts.push("[End of conversation so far]\n");
  }
  if (last) parts.push(last.content);
  return parts.join("\n");
}

/** Buffers tokens produced by a push-style callback into a pull-style iterator. */
class AsyncTokenQueue implements AsyncIterable<string> {
  private buf: string[] = [];
  private error: Error | null = null;
  private ended = false;
  private waiters: Array<(r: IteratorResult<string> | null) => void> = [];

  push(token: string): void {
    const w = this.waiters.shift();
    if (w) w({ value: token, done: false });
    else this.buf.push(token);
  }

  end(err?: Error): void {
    if (err) this.error = err;
    this.ended = true;
    for (const w of this.waiters.splice(0)) w(null);
  }

  async next(): Promise<IteratorResult<string>> {
    for (;;) {
      if (this.buf.length) return { value: this.buf.shift() as string, done: false };
      if (this.ended) {
        if (this.error) throw this.error;
        return { value: undefined, done: true };
      }
      const wake = await new Promise<IteratorResult<string> | null>((resolve) => this.waiters.push(resolve));
      if (wake) return wake;
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this;
  }
}

/**
 * One Arcaic sub-driver: a named web-UI backend (openai / gemini / qwen)
 * sharing the throwaway-browser engine logic. Each sub-driver owns its
 * engine — one browser + one temp profile per backend.
 */
export class ArcaicSubDriver implements LLMDriver {
  readonly name: string;
  readonly enabled = config.arcaicEnabled;
  private readonly spec: ArcaicSpec;
  private engine: ArcaicBrowserEngine | null = null;

  constructor(spec: ArcaicSpec) {
    this.spec = spec;
    this.name = spec.key;
    if (this.enabled) driverLog(this.name, "enabled (web UI session, throwaway profile, headless)");
  }

  private ensureEnabled(): void {
    if (!this.enabled) throw new DriverDisabledError(this.name);
  }

  private getEngine(): ArcaicBrowserEngine {
    this.ensureEnabled();
    if (!this.engine) {
      this.engine = new ArcaicBrowserEngine({
        executablePath: resolveExecutable(),
        headless: config.arcaicHeadless,
        loginTimeoutMs: config.arcaicLoginTimeoutS * 1000,
        responseTimeoutMs: config.arcaicResponseTimeoutS * 1000,
      });
    }
    return this.engine;
  }

  async listModels(): Promise<DriverModel[]> {
    this.ensureEnabled();
    return [
      {
        id: `${this.name}:chat`,
        name: "chat",
        driver: this.name,
        label: this.spec.label,
        group: "arcaic",
      },
    ];
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    this.ensureEnabled();
    const t0 = Date.now();
    const text = await this.getEngine().send(flattenMessages(messages), {
      site: this.spec.site,
      signal: opts.signal,
      fresh: true,
      onLoginHint: () => driverLog(this.name, "session not ready — waiting for it inside the browser window"),
    });
    driverLog(this.name, `chat model=${opts.model} done: ${fmtBytes(text.length)} in ${fmtMs(Date.now() - t0)}`);
    return text;
  }

  async *chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string, void, void> {
    this.ensureEnabled();
    const t0 = Date.now();
    driverLog(this.name, `chat model=${opts.model} messages=${messages.length} stream=open`);
    const queue = new AsyncTokenQueue();
    let chars = 0;
    let jobDone = false;
    const job = this.getEngine()
      .send(flattenMessages(messages), {
        site: this.spec.site,
        signal: opts.signal,
        fresh: true,
        onLoginHint: () => driverLog(this.name, "session not ready — waiting for it inside the browser window"),
        onToken: (tok) => {
          chars += tok.length;
          opts.onToken?.(tok);
          queue.push(tok);
        },
      })
      .then(
        () => {
          jobDone = true;
          queue.end();
        },
        (e) => {
          jobDone = true;
          queue.end(e as Error);
        },
      );
    try {
      yield* queue;
    } finally {
      if (!jobDone) this.getEngine().abortCurrent();
      void job;
    }
    driverLog(this.name, `chat model=${opts.model} done: ${fmtBytes(chars)} in ${fmtMs(Date.now() - t0)}`);
  }
}

export function createArcaicDrivers(): ArcaicSubDriver[] {
  return SPECS.map((spec) => new ArcaicSubDriver(spec));
}

function resolveExecutable(): string {
  const conf = config.arcaicExecutable;
  if (conf.includes("/")) return conf;
  const found = Bun.which(conf);
  if (!found) throw new Error("Arcaic backend is not configured (browser executable missing) — contact the administrator");
  return found;
}
