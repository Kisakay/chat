import { config } from "../config.ts";
import { ApiDriverBase } from "./apiBase.ts";

/**
 * Concrete API drivers read their key from the server env by default.
 * Pass `apiKeyOverride` to build a per-user (BYOK) instance instead: the
 * driver is then enabled whenever the override key is non-empty, ignoring
 * the global `*_ENABLED` flag. See `src/userProviders.ts`.
 */
function globalEnabled(flag: boolean, key: string): boolean {
  return flag && key.length > 0;
}

/** Mistral API driver. Global priority #2 (after local ollama). */
export class MistralDriver extends ApiDriverBase {
  readonly name = "mistral";
  constructor(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride ?? config.mistralApiKey;
    super({
      baseUrl: "https://api.mistral.ai/v1",
      apiKey,
      enabled: apiKeyOverride !== undefined ? apiKey.length > 0 : globalEnabled(config.mistralEnabled, apiKey),
      defaultModels: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    });
  }
}

/** DeepSeek API driver. Priority within APIs: DeepSeek first. */
export class DeepSeekDriver extends ApiDriverBase {
  readonly name = "deepseek";
  constructor(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride ?? config.deepseekApiKey;
    super({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey,
      enabled: apiKeyOverride !== undefined ? apiKey.length > 0 : globalEnabled(config.deepseekEnabled, apiKey),
      defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    });
  }
}

/** Anthropic driver (OpenAI-compatible endpoint). Priority: after DeepSeek. */
export class AnthropicDriver extends ApiDriverBase {
  readonly name = "anthropic";
  constructor(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride ?? config.anthropicApiKey;
    super({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey,
      enabled: apiKeyOverride !== undefined ? apiKey.length > 0 : globalEnabled(config.anthropicEnabled, apiKey),
      defaultModels: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest"],
    });
  }
}

/** OpenAI API driver. Priority: last among APIs. */
export class OpenAIDriver extends ApiDriverBase {
  readonly name = "openai";
  constructor(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride ?? config.openaiApiKey;
    super({
      baseUrl: "https://api.openai.com/v1",
      apiKey,
      enabled: apiKeyOverride !== undefined ? apiKey.length > 0 : globalEnabled(config.openaiEnabled, apiKey),
      defaultModels: ["gpt-4o", "gpt-4o-mini"],
    });
  }
}

/**
 * Gemini driver (Google AI, OpenAI-compatible endpoint). Priority: after GLM.
 * Docs: https://ai.google.dev/gemini-api/docs/openai — key from
 * https://aistudio.google.com/apikey (server: GEMINI_API_KEY, or per-user
 * BYOK in settings).
 */
export class GeminiDriver extends ApiDriverBase {
  readonly name = "gemini";
  constructor(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride ?? config.geminiApiKey;
    super({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey,
      enabled: apiKeyOverride !== undefined ? apiKey.length > 0 : globalEnabled(config.geminiEnabled, apiKey),
      defaultModels: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    });
  }
}

/**
 * GLM driver (Zhipu AI, OpenAI-compatible endpoint). Priority: after Mistral.
 * Docs: https://docs.z.ai — international base is api.z.ai, mainland China
 * uses https://open.bigmodel.cn/api/paas/v4 (via GLM_BASE_URL).
 */
export class GlmDriver extends ApiDriverBase {
  readonly name = "glm";
  constructor() {
    super({
      baseUrl: config.glmBaseUrl,
      apiKey: config.glmApiKey,
      enabled: config.glmEnabled,
      defaultModels: ["glm-4.7", "glm-4.6", "glm-4.5-air", "glm-4.5-flash"],
    });
  }
}
