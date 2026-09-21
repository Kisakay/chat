import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { driverLog } from "./log.ts";

export const CHATGPT_URL = "https://chatgpt.com/";

export const CHATGPT_SELECTORS = {
  composer: ["#mobile-composer-prompt", "#prompt-textarea", "div[contenteditable='true']"],
  sendButton: "button[data-composer-submit]",
  copyButton: "button[data-copy-message]",
  assistantMarkdown: "div[data-assistant-markdown]",
  streamBlock: "[data-assistant-stream-block]",
} as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ChatGPTBrowserOptions {
  /** Firefox binary (puppeteer-core requires an explicit executable). */
  executablePath: string;
  headless: boolean;
  /** Grace period for a manual login before giving up on the composer. */
  loginTimeoutMs: number;
  responseTimeoutMs: number;
  pollMs?: number;
}

export interface ChatGPTSendCallbacks {
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
  onLoginHint?: () => void;
  /** Start a fresh conversation (goto CHATGPT_URL) before sending. */
  fresh?: boolean;
}

/** Manual login grace period expired (no composer on the page). */
export class BrowserLoginError extends Error {
  constructor(timeoutMs: number) {
    super(
      `ChatGPT composer not available after ${Math.round(timeoutMs / 1000)}s — login required (run with PUPPETEER_HEADLESS=false and log in inside the window)`,
    );
    this.name = "BrowserLoginError";
  }
}

/**
 * Throwaway Firefox session driving chatgpt.com via puppeteer-core (WebDriver
 * BiDi). Each launch creates a fresh mkdtemp profile that is removed on
 * close(): zero persistence between runs. One engine = one browser + one tab.
 */
export class ChatGPTBrowserEngine {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private profileDir: string | null = null;
  private opening: Promise<void> | null = null;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();
  private currentAbort: AbortController | null = null;

  constructor(private readonly opts: ChatGPTBrowserOptions) {}

  get isOpen(): boolean {
    return this.browser !== null;
  }

  async open(): Promise<void> {
    if (this.browser) return;
    if (this.closed) throw new Error("engine already closed");
    this.opening ??= this.launch().finally(() => {
      this.opening = null;
    });
    await this.opening;
  }

  /** One-shot state report (used by the POC probe mode). */
  async probe(): Promise<{ title: string; url: string; composer: string | null }> {
    await this.open();
    const page = this.requirePage();
    await sleep(3000);
    return { title: await page.title(), url: page.url(), composer: await this.findComposer() };
  }

  /**
   * Type a prompt into the composer, submit, stream the answer through
   * onToken and resolve with the final text. Completion = a new
   * "Copy response" button appearing. Serialized: one send at a time.
   */
  send(prompt: string, cb: ChatGPTSendCallbacks = {}): Promise<string> {
    const task = this.chain
      .catch(() => undefined)
      .then(() => this.doSend(prompt, cb));
    this.chain = task.catch(() => undefined);
    return task;
  }

  abortCurrent(): void {
    this.currentAbort?.abort();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.abortCurrent();
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    if (browser) {
      try {
        await browser.close();
      } catch {
        // already gone
      }
    }
    const dir = this.profileDir;
    this.profileDir = null;
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      driverLog("chatgpt", `temporary profile removed (${dir})`);
    }
  }

  private async launch(): Promise<void> {
    const puppeteer = await import("puppeteer-core");
    this.profileDir = await mkdtemp(join(tmpdir(), "ka-chatgpt-"));
    driverLog("chatgpt", `launching firefox headless=${this.opts.headless} profile=${this.profileDir}`);
    const browser = await puppeteer.launch({
      browser: "firefox",
      executablePath: this.opts.executablePath,
      headless: this.opts.headless,
      userDataDir: this.profileDir,
      defaultViewport: null,
      protocolTimeout: 300_000,
    });
    browser.once("disconnected", () => {
      if (this.browser === browser) {
        this.browser = null;
        this.page = null;
        driverLog("chatgpt", "browser disconnected unexpectedly");
      }
    });
    this.browser = browser;
    this.page = await browser.newPage();
    await this.gotoChatGPT(this.page);
    await this.dismissCookieBanner(this.page, 10_000);
  }

  /** chatgpt.com intermittently stalls on domcontentloaded — retry a few times. */
  private async gotoChatGPT(page: Page): Promise<void> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
        return;
      } catch (e) {
        lastErr = e;
        driverLog("chatgpt", `navigation failed (attempt ${attempt}/3): ${(e as Error).message}`);
        await sleep(3000);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("navigation to chatgpt.com failed");
  }

  /**
   * Fresh profile = cookie consent banner on first load. It swallows input
   * until "Accept all" (button[type=submit], text) is clicked.
   */
  private async dismissCookieBanner(page: Page, waitMs: number): Promise<void> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const clicked = await page
        .evaluate(() => {
          const btn = Array.from(document.querySelectorAll("button")).find((b) => {
            const t = (b.textContent ?? "").trim().toLowerCase();
            return (t === "accept all" || t === "accept") && (b as HTMLElement).getClientRects().length > 0;
          });
          if (!btn) return false;
          (btn as HTMLElement).click();
          return true;
        })
        .catch(() => false);
      if (clicked) {
        driverLog("chatgpt", "cookie banner dismissed (Accept all)");
        await sleep(800);
        return;
      }
      if (Date.now() >= deadline) return;
      await sleep(1000);
    }
  }

  private async doSend(prompt: string, cb: ChatGPTSendCallbacks): Promise<string> {
    if (this.closed) throw new Error("engine already closed");
    const pollMs = this.opts.pollMs ?? 250;
    const ac = new AbortController();
    this.currentAbort = ac;
    const forward = () => ac.abort();
    cb.signal?.addEventListener("abort", forward);
    const t0 = Date.now();
    try {
      await this.open();
      const page = this.requirePage();
      if (cb.fresh) {
        await this.gotoChatGPT(page);
        await this.dismissCookieBanner(page, 1_500);
      }
      const composer = await this.waitForComposer(cb.onLoginHint);
      const copyBefore = await this.countCopyButtons();
      await this.typeIntoComposer(page, composer, prompt);
      await this.waitSendable(page);
      await page.click(CHATGPT_SELECTORS.sendButton);
      driverLog("chatgpt", `sent ${prompt.length} chars via ${composer}, waiting for response`);
      let last = "";
      const deadline = Date.now() + this.opts.responseTimeoutMs;
      for (;;) {
        if (ac.signal.aborted) {
          await this.stopGenerating();
          throw new DOMException("ChatGPT browser request aborted", "AbortError");
        }
        const text = await this.readAssistantText();
        if (text.startsWith(last) && text.length > last.length) {
          const delta = text.slice(last.length);
          last = text;
          cb.onToken?.(delta);
        }
        if ((await this.countCopyButtons()) > copyBefore) {
          const finalText = await this.readAssistantText();
          if (finalText.length > last.length) cb.onToken?.(finalText.slice(last.length));
          const out = finalText.length ? finalText : last;
          driverLog("chatgpt", `response complete: ${out.length} chars in ${fmtS(Date.now() - t0)}`);
          return out;
        }
        if (Date.now() > deadline) {
          await this.stopGenerating();
          throw new Error(`ChatGPT response timed out after ${Math.round(this.opts.responseTimeoutMs / 1000)}s`);
        }
        await sleep(pollMs);
      }
    } finally {
      cb.signal?.removeEventListener("abort", forward);
      if (this.currentAbort === ac) this.currentAbort = null;
    }
  }

  private async waitForComposer(hint?: () => void): Promise<string> {
    const page = this.requirePage();
    const deadline = Date.now() + this.opts.loginTimeoutMs;
    let hinted = false;
    for (;;) {
      const sel = await this.findComposer();
      if (sel) return sel;
      if (!hinted) {
        hinted = true;
        hint?.();
      }
      if (Date.now() > deadline) throw new BrowserLoginError(this.opts.loginTimeoutMs);
      await sleep(1000);
    }
  }

  private async findComposer(): Promise<string | null> {
    const page = this.page;
    if (!page) return null;
    for (const sel of CHATGPT_SELECTORS.composer) {
      try {
        if (await page.$(sel)) return sel;
      } catch {
        // navigation in flight — retry on next poll
      }
    }
    return null;
  }

  private async typeIntoComposer(page: Page, sel: string, text: string): Promise<void> {
    const input = await page.$(sel);
    if (!input) throw new Error(`composer ${sel} not found`);
    await input.focus();
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await page.keyboard.type(lines[i], { delay: 4 });
      if (i < lines.length - 1) {
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
        await sleep(30);
      }
    }
  }

  private async waitSendable(page: Page): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const ok = await page
        .$eval(CHATGPT_SELECTORS.sendButton, (el) => {
          const b = el as HTMLButtonElement;
          return !b.disabled && b.getAttribute("aria-disabled") !== "true";
        })
        .catch(() => false);
      if (ok) return;
      if (Date.now() > deadline) throw new Error("ChatGPT send button never became clickable");
      await sleep(250);
    }
  }

  private async stopGenerating(): Promise<void> {
    const page = this.page;
    if (!page) return;
    try {
      await page.click(CHATGPT_SELECTORS.sendButton);
    } catch {
      // button already back in send state — nothing to stop
    }
  }

  private async countCopyButtons(): Promise<number> {
    const page = this.page;
    if (!page) return 0;
    try {
      return await page.$$eval(CHATGPT_SELECTORS.copyButton, (els) =>
        els.filter((el) => (el as HTMLElement).getClientRects().length > 0).length,
      );
    } catch {
      return 0;
    }
  }

  private async readAssistantText(): Promise<string> {
    const page = this.page;
    if (!page) return "";
    try {
      return await page.$$eval(
        CHATGPT_SELECTORS.assistantMarkdown,
        (els, blockSel: string) => {
          const last = els[els.length - 1];
          if (!last) return "";
          const blocks = Array.from(last.querySelectorAll(blockSel));
          if (blocks.length === 0) return (last as HTMLElement).innerText;
          return blocks
            .map((b) => (b as HTMLElement).innerText.trim())
            .filter(Boolean)
            .join("\n\n");
        },
        CHATGPT_SELECTORS.streamBlock,
      );
    } catch {
      return "";
    }
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("browser session is not open");
    return this.page;
  }
}

function fmtS(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
