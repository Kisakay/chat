import { config } from "../config.ts";
import { driverLog, fmtBytes, fmtMs } from "./log.ts";
import { ChatGPTBrowserEngine } from "./browser.ts";
import type { ChatMessage, ChatOptions, DriverModel, LLMDriver } from "./types.ts";
import { DriverDisabledError } from "./types.ts";

const MODELS = ["chatgpt"];

function resolveExecutable(): string {
  const conf = config.puppeteerExecutable;
  if (conf.includes("/")) return conf;
  const found = Bun.which(conf);
  if (!found) throw new Error(`browser executable "${conf}" not found in PATH — set PUPPETEER_EXECUTABLE`);
  return found;
}

/**
 * Flatten a KisAssistant conversation into one prompt for the ChatGPT web
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
 * ChatGPT via the web UI: throwaway Firefox profile driven by
 * puppeteer-core (WebDriver BiDi). ToS-risky and fragile by nature —
 * disabled unless PUPPETEER_ENABLED=true. Login is manual for now: the
 * first request opens a window and waits for the composer to appear.
 */
export class PuppeteerOpenAIDriver implements LLMDriver {
  readonly name = "puppeteer-openai";
  readonly enabled = config.puppeteerEnabled;
  private engine: ChatGPTBrowserEngine | null = null;

  constructor() {
    if (this.enabled) driverLog(this.name, "enabled (chatgpt.com via Firefox, throwaway profile, manual login)");
  }

  private ensureEnabled(): void {
    if (!this.enabled) throw new DriverDisabledError(this.name);
  }

  private getEngine(): ChatGPTBrowserEngine {
    this.ensureEnabled();
    if (!this.engine) {
      this.engine = new ChatGPTBrowserEngine({
        executablePath: resolveExecutable(),
        headless: config.puppeteerHeadless,
        loginTimeoutMs: config.puppeteerLoginTimeoutS * 1000,
        responseTimeoutMs: config.puppeteerResponseTimeoutS * 1000,
      });
    }
    return this.engine;
  }

  async listModels(): Promise<DriverModel[]> {
    this.ensureEnabled();
    return MODELS.map((m) => ({ id: `${this.name}:${m}`, name: m, driver: this.name, label: "ChatGPT (web)" }));
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    this.ensureEnabled();
    const t0 = Date.now();
    const text = await this.getEngine().send(flattenMessages(messages), {
      signal: opts.signal,
      fresh: true,
      onLoginHint: () => driverLog(this.name, "login required — complete it inside the browser window"),
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
        signal: opts.signal,
        fresh: true,
        onLoginHint: () => driverLog(this.name, "login required — complete it inside the browser window"),
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
