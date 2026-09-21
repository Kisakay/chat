import { AnthropicDriver, DeepSeekDriver, MistralDriver, OpenAIDriver } from "./apis.ts";
import { OllamaDriver } from "./ollama.ts";
import { PuppeteerOpenAIDriver } from "./puppeteer.ts";
import type { DriverModel, LLMDriver } from "./types.ts";

/**
 * Global driver priority (per spec):
 *   1. ollama (local) -> 2. mistral -> 3. puppeteer-openai (stub)
 *   -> 4. deepseek -> 5. anthropic -> 6. openai
 */
const PRIORITY = ["ollama", "mistral", "puppeteer-openai", "deepseek", "anthropic", "openai"];

export class DriverRegistry {
  private drivers: Map<string, LLMDriver>;

  constructor() {
    const all: LLMDriver[] = [
      new OllamaDriver(),
      new MistralDriver(),
      new PuppeteerOpenAIDriver(),
      new DeepSeekDriver(),
      new AnthropicDriver(),
      new OpenAIDriver(),
    ];
    this.drivers = new Map(all.map((d) => [d.name, d]));
  }

  /** Drivers in priority order (enabled ones only if flag set). */
  ordered(onlyEnabled = false): LLMDriver[] {
    const list = PRIORITY.map((n) => this.drivers.get(n)!).filter(Boolean);
    return onlyEnabled ? list.filter((d) => d.enabled) : list;
  }

  get(name: string): LLMDriver | undefined {
    return this.drivers.get(name);
  }

  /** List models across all enabled drivers. Never throws: a failing driver is skipped. */
  async listAllModels(): Promise<DriverModel[]> {
    const out: DriverModel[] = [];
    for (const d of this.ordered(true)) {
      try {
        out.push(...(await d.listModels()));
      } catch (e) {
        console.error(`[drivers] ${d.name} listModels failed:`, (e as Error).message);
      }
    }
    return out;
  }

  /**
   * Split a fully-qualified "driver:model" id.
   * "ollama:llama3.1:8b" -> driver "ollama", model "llama3.1:8b".
   */
  splitId(fullId: string): { driver: LLMDriver; model: string } {
    const idx = fullId.indexOf(":");
    if (idx === -1) throw new Error(`invalid model id "${fullId}" (expected "driver:model")`);
    const driverName = fullId.slice(0, idx);
    const model = fullId.slice(idx + 1);
    const driver = this.drivers.get(driverName);
    if (!driver) throw new Error(`unknown driver "${driverName}"`);
    if (!driver.enabled) throw new Error(`driver "${driverName}" is disabled`);
    if (!model) throw new Error(`empty model name in "${fullId}"`);
    return { driver, model };
  }
}
