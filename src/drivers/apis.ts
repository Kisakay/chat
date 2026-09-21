import { config } from "../config.ts";
import { ApiDriverBase } from "./apiBase.ts";

/** Mistral API driver. Global priority #2 (after local ollama). */
export class MistralDriver extends ApiDriverBase {
  readonly name = "mistral";
  constructor() {
    super({
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: config.mistralApiKey,
      enabled: config.mistralEnabled,
      defaultModels: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    });
  }
}

/** DeepSeek API driver. Priority within APIs: DeepSeek first. */
export class DeepSeekDriver extends ApiDriverBase {
  readonly name = "deepseek";
  constructor() {
    super({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: config.deepseekApiKey,
      enabled: config.deepseekEnabled,
      defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    });
  }
}

/** Anthropic driver (OpenAI-compatible endpoint). Priority: after DeepSeek. */
export class AnthropicDriver extends ApiDriverBase {
  readonly name = "anthropic";
  constructor() {
    super({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: config.anthropicApiKey,
      enabled: config.anthropicEnabled,
      defaultModels: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest"],
    });
  }
}

/** OpenAI API driver. Priority: last among APIs. */
export class OpenAIDriver extends ApiDriverBase {
  readonly name = "openai";
  constructor() {
    super({
      baseUrl: "https://api.openai.com/v1",
      apiKey: config.openaiApiKey,
      enabled: config.openaiEnabled,
      defaultModels: ["gpt-4o", "gpt-4o-mini"],
    });
  }
}
