import type { ChatMessage, ChatOptions, DriverModel, LLMDriver } from "./types.ts";

/**
 * Puppeteer/headless-browser driver stub (scrapes chatgpt.com).
 * Intentionally NOT implemented: fragile, ToS-risky, needs a real
 * account session. Kept as a stub so the Driver interface reserves
 * its slot at global priority #3.
 */
export class PuppeteerOpenAIDriver implements LLMDriver {
  readonly name = "puppeteer-openai";
  readonly enabled = false;

  async listModels(): Promise<DriverModel[]> {
    return [];
  }

  async chat(_messages: ChatMessage[], _opts: ChatOptions): Promise<string> {
    throw new Error(
      'driver "puppeteer-openai" is a stub and is not implemented (headless scraping of chatgpt.com is fragile and against ToS; use ollama or official APIs instead)',
    );
  }

  async *chatStream(): AsyncGenerator<string, void, void> {
    throw new Error('driver "puppeteer-openai" is a stub and is not implemented');
    void 0;
  }
}
