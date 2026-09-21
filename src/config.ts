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
  // "production" under the NixOS module / CI builds, "development" locally.
  nodeEnv: env("NODE_ENV", "development"),
  isProduction: env("NODE_ENV", "development") === "production",

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

  glmApiKey: env("GLM_API_KEY", ""),
  glmEnabled: envBool("GLM_ENABLED", false),
  // Zhipu has two platforms: international (api.z.ai, default) and
  // mainland China (open.bigmodel.cn) — override for the latter.
  glmBaseUrl: env("GLM_BASE_URL", "https://api.z.ai/api/paas/v4"),

  // Arcaic web-UI backend (headless browser, throwaway profile per process).
  arcaicEnabled: envBool("ARCAIC_ENABLED", false),
  arcaicExecutable: env("ARCAIC_EXECUTABLE", "firefox"),
  arcaicHeadless: envBool("ARCAIC_HEADLESS", true),
  arcaicLoginTimeoutS: envInt("ARCAIC_LOGIN_TIMEOUT_S", 300),
  arcaicResponseTimeoutS: envInt("ARCAIC_RESPONSE_TIMEOUT_S", 300),

  // Public docs wiki (served by the hosted git forge, e.g. Gitea wiki pages).
  // The app redirects GET /wiki there (302) so the target stays configurable.
  wikiUrl: env("WIKI_URL", "https://git.kisakay.com/k/chat/wiki"),

  // Per-driver debug logging to stdout ([driver:name] lines).
  // On by default in development, off unless asked for in production.
  driverDebug: envBool("DRIVER_DEBUG", !env("NODE_ENV", "development")),

  // Local file CDN (avatars today, more namespaces tomorrow).
  // Dev default is a folder next to the codebase; NixOS module points it
  // under the service state dir.
  cdnDir: env("CDN_DIR", "./cdn"),

  // OCR tool (tesseract binary).
  ocrLang: env("OCR_LANG", "eng"),
  ocrMaxChars: envInt("OCR_MAX_CHARS", 100_000),

  // Key recovery via email (optional — empty SMTP_HOST disables it).
  smtpHost: env("SMTP_HOST", ""),
  smtpPort: envInt("SMTP_PORT", 587),
  smtpSecure: envBool("SMTP_SECURE", false), // true = implicit TLS (port 465)
  smtpUser: env("SMTP_USER", ""),
  smtpPass: env("SMTP_PASS", ""),
  smtpFrom: env("SMTP_FROM", "KisAssistant <chatkisakai@ihorizon.org>"),
  appUrl: env("APP_URL", "http://localhost:3000").replace(/\/$/, ""),
  resetTtlMs: envInt("RESET_TTL_MIN", 60) * 60_000,
};

export function assertConfig(): void {
  if (!config.appPassword) {
    console.error("FATAL: APP_PASSWORD is not set. Copy .env.example to .env and set it.");
    process.exit(1);
  }
}
