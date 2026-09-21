import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { driverLog } from "./log.ts";

export interface BrowserSite {
  key: string;
  url: string;
  composer: string[];
  submit: "button" | "enter";
  sendButton?: string;
  /** Completion signal (counted visible, before vs after send). */
  copyButton: string;
  /** Restrict the copy-button count to this container (excludes user messages). */
  copyScope?: string;
  /** Latest assistant message container (last match wins). */
  messageContainer: string;
  /** Answer-text nodes inside the container (joined); container innerText if unset. */
  answer?: string;
  /**
   * How completion is detected. "copy-button": a newly visible copy control.
   * "aria-busy": the response container reports aria-busy="false" (plus text).
   */
  completion?: "copy-button" | "aria-busy";
  acceptTexts?: string[];
}

export const OPENAI_SITE: BrowserSite = {
  key: "openai",
  url: "https://chatgpt.com/",
  composer: ["#mobile-composer-prompt", "#prompt-textarea", "div[contenteditable='true']"],
  submit: "button",
  sendButton: "button[data-composer-submit]",
  copyButton: "button[data-copy-message]",
  messageContainer: "div[data-assistant-markdown]",
  answer: "[data-assistant-stream-block]",
  completion: "copy-button",
};

export const QWEN_SITE: BrowserSite = {
  key: "qwen",
  url: "https://chat.qwen.ai/",
  composer: ["textarea.message-input-textarea", "textarea[placeholder='Ask Qwen']"],
  submit: "enter",
  copyButton: "button[aria-label='Copy']",
  copyScope: ".qwen-chat-message-assistant",
  messageContainer: ".qwen-chat-message-assistant",
  answer: ".custom-qwen-markdown",
  completion: "copy-button",
};

export const GEMINI_SITE: BrowserSite = {
  key: "gemini",
  url: "https://gemini.google.com/app",
  composer: [
    "div[aria-label='Enter a prompt for Gemini']",
    "div.ql-editor[contenteditable='true']",
    "[data-test-id='textarea-inner'] div[contenteditable='true']",
  ],
  submit: "enter",
  copyButton: "button[aria-label='Copy']",
  messageContainer: "structured-content-container",
  answer: ".markdown",
  completion: "aria-busy",
};

export const SITES: Record<string, BrowserSite> = {
  openai: OPENAI_SITE,
  qwen: QWEN_SITE,
  gemini: GEMINI_SITE,
};

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
  site: BrowserSite;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
  onLoginHint?: () => void;
  /** Start a fresh conversation before sending. */
  fresh?: boolean;
}

/** Session not ready: the web UI never became interactive in time. */
export class BrowserLoginError extends Error {
  constructor(timeoutMs: number) {
    super(`Arcaic backend is not ready (no session after ${Math.round(timeoutMs / 1000)}s) — try again in a moment`);
    this.name = "BrowserLoginError";
  }
}

/**
 * Throwaway Firefox session driving web-UI backends via puppeteer-core
 * (WebDriver BiDi). Each launch creates a fresh mkdtemp profile that is
 * removed on close(): zero persistence between runs. One engine = one
 * browser + one tab; the per-send site config selects the target
 * (chatgpt.com, chat.qwen.ai, gemini.google.com/app).
 */
export class ArcaicBrowserEngine {
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

  async open(site: BrowserSite): Promise<void> {
    if (this.closed) throw new Error("engine already closed");
    if (!this.browser) {
      this.opening ??= this.launch().finally(() => {
        this.opening = null;
      });
      await this.opening;
    }
    const page = this.requirePage();
    if (!page.url().startsWith(site.url)) {
      await this.gotoSite(page, site);
      await this.dismissCookieBanner(page, site, 10_000);
    }
  }

  /** One-shot state report (used by the POC probe mode). */
  async probe(site: BrowserSite): Promise<{ title: string; url: string; composer: string | null }> {
    await this.open(site);
    const page = this.requirePage();
    await sleep(3000);
    return { title: await page.title(), url: page.url(), composer: await this.findComposer(page, site) };
  }

  /**
   * Type a prompt into the composer, submit, stream the answer through
   * onToken and resolve with the final text. Serialized: one send at a time.
   */
  send(prompt: string, cb: ChatGPTSendCallbacks): Promise<string> {
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
      driverLog("arcaic", `temporary profile removed (${dir})`);
    }
  }

  private async launch(): Promise<void> {
    const puppeteer = await import("puppeteer-core");
    this.profileDir = await mkdtemp(join(tmpdir(), "ka-arcaic-"));
    driverLog("arcaic", `launching firefox headless=${this.opts.headless} profile=${this.profileDir}`);
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
        driverLog("arcaic", "browser disconnected unexpectedly");
      }
    });
    this.browser = browser;
    this.page = await browser.newPage();
  }

  /** Target site stalls on domcontentloaded sometimes — retry a few times. */
  private async gotoSite(page: Page, site: BrowserSite): Promise<void> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        return;
      } catch (e) {
        lastErr = e;
        driverLog("arcaic", `${site.key}: navigation failed (attempt ${attempt}/3): ${(e as Error).message}`);
        await sleep(3000);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("navigation to the Arcaic backend failed — try again");
  }

  /**
   * Fresh profile = cookie consent banner on first load. It swallows input
   * until accepted.
   */
  private async dismissCookieBanner(page: Page, site: BrowserSite, waitMs: number): Promise<void> {
    const accept = site.acceptTexts ?? ["accept all", "accept"];
    const deadline = Date.now() + waitMs;
    for (;;) {
      const clicked = await page
        .evaluate((texts: string[]) => {
          const btn = Array.from(document.querySelectorAll("button")).find((b) => {
            const t = (b.textContent ?? "").trim().toLowerCase();
            return texts.includes(t) && (b as HTMLElement).getClientRects().length > 0;
          });
          if (!btn) return false;
          (btn as HTMLElement).click();
          return true;
        }, accept)
        .catch(() => false);
      if (clicked) {
        driverLog("arcaic", `${site.key}: cookie banner dismissed`);
        await sleep(800);
        return;
      }
      if (Date.now() >= deadline) return;
      await sleep(1000);
    }
  }

  private async doSend(prompt: string, cb: ChatGPTSendCallbacks): Promise<string> {
    if (this.closed) throw new Error("engine already closed");
    const site = cb.site;
    const pollMs = this.opts.pollMs ?? 250;
    const ac = new AbortController();
    this.currentAbort = ac;
    const forward = () => ac.abort();
    cb.signal?.addEventListener("abort", forward);
    const t0 = Date.now();
    try {
      await this.open(site);
      const page = this.requirePage();
      if (cb.fresh) {
        await this.gotoSite(page, site);
        await this.dismissCookieBanner(page, site, 1_500);
      }
      const composer = await this.waitForComposer(page, site, cb.onLoginHint);
      const copyBefore = await this.countVisible(page, site);
      await this.typeIntoComposer(page, composer, prompt);
      await this.submitMessage(page, site);
      driverLog("arcaic", `${site.key}: sent ${prompt.length} chars via ${composer}, waiting for response`);
      let last = "";
      let stableTicks = 0;
      const deadline = Date.now() + this.opts.responseTimeoutMs;
      for (;;) {
        if (ac.signal.aborted) {
          await this.stopGenerating(page, site);
          throw new DOMException("Arcaic backend request aborted", "AbortError");
        }
        const read = await this.readAnswer(page, site).catch(() => ({ text: "", busy: null as string | null }));
        if (!read.text) {
          stableTicks++;
        } else if (read.text !== last) {
          if (read.text.length > last.length && read.text.startsWith(last)) {
            const delta = read.text.slice(last.length);
            last = read.text;
            cb.onToken?.(delta);
          } else {
            last = read.text;
          }
          stableTicks = 0;
        } else {
          stableTicks++;
        }
        let signaled: boolean;
        if (site.completion === "aria-busy") {
          signaled =
            read.busy === null
              ? last.length > 0 && stableTicks >= 3
              : last.length > 0 && read.busy !== "true";
        } else {
          signaled = (await this.countVisible(page, site)) > copyBefore;
        }
        if (signaled && stableTicks >= 1) {
          const finalText = (await this.readAnswer(page, site).catch(() => null))?.text ?? "";
          if (finalText.length > last.length) cb.onToken?.(finalText.slice(last.length));
          const out = finalText.length ? finalText : last;
          driverLog("arcaic", `${site.key}: response complete: ${out.length} chars in ${fmtS(Date.now() - t0)}`);
          return out;
        }
        if (Date.now() > deadline) {
          await this.stopGenerating(page, site);
          throw new Error(`Arcaic backend timed out after ${Math.round(this.opts.responseTimeoutMs / 1000)}s — try again`);
        }
        await sleep(pollMs);
      }
    } finally {
      cb.signal?.removeEventListener("abort", forward);
      if (this.currentAbort === ac) this.currentAbort = null;
    }
  }

  private async waitForComposer(page: Page, site: BrowserSite, hint?: () => void): Promise<string> {
    const deadline = Date.now() + this.opts.loginTimeoutMs;
    let hinted = false;
    for (;;) {
      const sel = await this.findComposer(page, site);
      if (sel) return sel;
      if (!hinted) {
        hinted = true;
        hint?.();
      }
      if (Date.now() > deadline) throw new BrowserLoginError(this.opts.loginTimeoutMs);
      await sleep(1000);
    }
  }

  private async findComposer(page: Page, site: BrowserSite): Promise<string | null> {
    for (const sel of site.composer) {
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
    if (!input) throw new Error("Arcaic backend session error — try again");
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

  private async composerHasText(page: Page, sel: string): Promise<boolean> {
    try {
      const text = await page.$eval(sel, (el) => {
        const v = (el as HTMLTextAreaElement).value;
        if (typeof v === "string") return v;
        return (el as HTMLElement).innerText ?? "";
      });
      return text.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async submitMessage(page: Page, site: BrowserSite): Promise<void> {
    if (site.submit === "button" && site.sendButton) {
      await this.waitSendable(page, site);
      await page.click(site.sendButton);
      return;
    }
    if (!(await this.composerHasText(page, site.composer[0]))) {
      throw new Error("Arcaic backend is not responding (send failed) — try again");
    }
    await page.keyboard.press("Enter");
  }

  private async waitSendable(page: Page, site: BrowserSite): Promise<void> {
    if (!site.sendButton) return;
    const sendButton = site.sendButton;
    const deadline = Date.now() + 10_000;
    for (;;) {
      const ok = await page
        .$eval(sendButton, (el) => {
          const b = el as HTMLButtonElement;
          return !b.disabled && b.getAttribute("aria-disabled") !== "true";
        })
        .catch(() => false);
      if (ok) return;
      if (Date.now() > deadline) throw new Error("Arcaic backend is not responding (send failed) — try again");
      await sleep(250);
    }
  }

  private async stopGenerating(page: Page, site: BrowserSite): Promise<void> {
    if (site.submit !== "button" || !site.sendButton) return;
    try {
      await page.click(site.sendButton);
    } catch {
      // button already back in send state — nothing to stop
    }
  }

  private async countVisible(page: Page, site: BrowserSite): Promise<number> {
    try {
      if (site.copyScope) {
        const scope = site.copyScope;
        const sel = site.copyButton;
        return await page.$$eval(
          scope,
          (els, s: string) => {
            let n = 0;
            for (const el of els) {
              n += Array.from(el.querySelectorAll(s)).filter((b) => (b as HTMLElement).getClientRects().length > 0)
                .length;
            }
            return n;
          },
          sel,
        );
      }
      return await page.$$eval(site.copyButton, (els) =>
        els.filter((el) => (el as HTMLElement).getClientRects().length > 0).length,
      );
    } catch {
      return 0;
    }
  }

  private async readAnswer(page: Page, site: BrowserSite): Promise<{ text: string; busy: string | null }> {
    return await page.$$eval(
      site.messageContainer,
      (els, answerSel: string) => {
        const last = els[els.length - 1];
        if (!last) return { text: "", busy: null as string | null };
        const el = last as HTMLElement;
        const busyEl = el.querySelector("[aria-busy]");
        const busy = busyEl ? busyEl.getAttribute("aria-busy") : null;
        if (!answerSel) return { text: el.innerText ?? "", busy };
        const parts = Array.from(el.querySelectorAll(answerSel));
        if (parts.length === 0) return { text: el.innerText ?? "", busy };
        return {
          text: parts
            .map((b) => (b as HTMLElement).innerText.trim())
            .filter(Boolean)
            .join("\n\n"),
          busy,
        };
      },
      site.answer ?? "",
    );
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("browser session is not open");
    return this.page;
  }
}

function fmtS(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
