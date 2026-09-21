function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

export const config = {
  port: envInt("PORT", 3000),
  host: env("HOST", "127.0.0.1"),
  appPassword: env("APP_PASSWORD", ""),
  sessionTtlMs: envInt("SESSION_TTL_HOURS", 720) * 3600_000,
  dataDir: env("DATA_DIR", "./data"),

  rateLimitMax: envInt("RATE_LIMIT_MAX", 5),
  rateLimitWindowMs: envInt("RATE_LIMIT_WINDOW_MIN", 10) * 60_000,

  ollamaHost: env("OLLAMA_HOST", "http://localhost:11434"),
  ollamaEnabled: envBool("OLLAMA_ENABLED", true),

  mistralApiKey: env("MISTRAL_API_KEY", ""),
  mistralEnabled: envBool("MISTRAL_ENABLED", false),

  deepseekApiKey: env("DEEPSEEK_API_KEY", ""),
  deepseekEnabled: envBool("DEEPSEEK_ENABLED", false),

  anthropicApiKey: env("ANTHROPIC_API_KEY", ""),
  anthropicEnabled: envBool("ANTHROPIC_ENABLED", false),

  openaiApiKey: env("OPENAI_API_KEY", ""),
  openaiEnabled: envBool("OPENAI_ENABLED", false),
};

export function assertConfig(): void {
  if (!config.appPassword) {
    console.error("FATAL: APP_PASSWORD is not set. Copy .env.example to .env and set it.");
    process.exit(1);
  }
}
