import { AnthropicDriver, DeepSeekDriver, GlmDriver, MistralDriver, OpenAIDriver } from "./apis.ts";
import { OllamaDriver } from "./ollama.ts";
import { PuppeteerOpenAIDriver } from "./puppeteer.ts";
import type { DriverModel, LLMDriver } from "./types.ts";

/**
 * Global driver priority (per spec):
 *   1. ollama (local) -> 2. mistral -> 3. glm -> 4. puppeteer-openai (stub)
 *   -> 5. deepseek -> 6. anthropic -> 7. openai
 */
const PRIORITY = ["ollama", "mistral", "glm", "puppeteer-openai", "deepseek", "anthropic", "openai"];

/** How long the user-facing model list stays in memory before re-hitting upstream. */
export const MODEL_CACHE_TTL_MS = 60_000;

export class DriverRegistry {
  private drivers: Map<string, LLMDriver>;
  // In-memory model list cache: user requests are served from here so we
  // don't hit Ollama (/api/tags) on every login. Refreshed at most once
  // per MODEL_CACHE_TTL_MS; admins can force a refresh.
  private modelsCache: { models: DriverModel[]; at: number } | null = null;
  private modelsInflight: Promise<DriverModel[]> | null = null;

  constructor() {
    const all: LLMDriver[] = [
      new OllamaDriver(),
      new MistralDriver(),
      new GlmDriver(),
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
   * Cached variant of listAllModels for user-facing requests.
   * - Serves the in-memory list when fresher than MODEL_CACHE_TTL_MS.
   * - Otherwise refetches upstream once (concurrent callers share the
   *   same in-flight promise instead of hammering Ollama).
   * - `force=true` bypasses the cache (admin "Ollama models" view).
   */
  async listAllModelsCached(force = false): Promise<DriverModel[]> {
    const now = Date.now();
    if (!force && this.modelsCache && now - this.modelsCache.at < MODEL_CACHE_TTL_MS) {
      return this.modelsCache.models;
    }
    if (!force && this.modelsInflight) return this.modelsInflight;
    const p = this.listAllModels().then((models) => {
      this.modelsCache = { models, at: Date.now() };
      return models;
    }).finally(() => {
      if (this.modelsInflight === p) this.modelsInflight = null;
    });
    // Only share the promise for non-forced loads; a forced admin refresh
    // always goes upstream even if a user load is in flight.
    if (!force) this.modelsInflight = p;
    return p;
  }

  /** Drop the cached model list (e.g. after an admin pull/delete). */
  invalidateModelsCache(): void {
    this.modelsCache = null;
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
