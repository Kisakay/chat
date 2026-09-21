# Architecture (backend)

Single Bun process: `Bun.serve` handles the JSON/SSE API **and** the static
frontend (same origin, no CORS). Persistence is SQLite via Bun's native
`bun:sqlite` driver (`$DATA_DIR/kisassistant.db`, WAL mode).

```
browser ──► Bun.serve (src/index.ts)
              ├─ /api/* ──► auth gate ──► routes ──► db.ts ──► kisassistant.db
              │                              └─────► DriverRegistry ──► ollama / APIs
              └─ /* ──► static files + SPA fallback (index.html, covers /share/:id)
```

## Request flow: chat

`POST /api/chat { model: "driver:model", messages, conversationId?, stream? }`

1. Bearer token → `verifyToken` (sha256 lookup in `sessions`, expiry check).
2. `DriverRegistry.splitId` routes to the owning driver (unknown/disabled → 400).
3. If `conversationId` is set: conversation must belong to the caller, the new
   user message is stored (deduped against the last stored message), new chats
   are auto-titled from it.
4. Non-streaming → `driver.chat()` → JSON. Streaming → `driver.chatStream()`
   → SSE events `token` / `done` / `error`. The full reply is persisted after a
   successful stream (partial text + `[interrupted]` marker on failure).

## Database schema

Created idempotently at boot in `getDb()` (no migration framework; keep it so).

| Table | Purpose |
|---|---|
| `users` | `id, username UNIQUE, display_name, avatar_url, theme, key_hash, created_at`. The `admin` row is bootstrapped (its `key_hash` is unused — admin auth goes through `APP_PASSWORD`). |
| `sessions` | `token_hash PK, user_id, created_at, expires_at`. Bearer tokens, 256-bit, hashed with sha256. Expired rows are purged lazily on access. |
| `conversations` | `id, user_id, title, topic, model, created_at, updated_at`. |
| `messages` | `id AUTOINCREMENT, conv_id → conversations ON DELETE CASCADE, role, content, created_at`. |
| `shares` | `conv_id PK → conversations ON DELETE CASCADE, public_id UNIQUE, created_at`. |

User deletion cascades manually in `deleteUser()` (messages → shares →
conversations → sessions → user) inside a transaction.

## Auth

- `POST /api/auth/login { username, key }`, sliding-window rate limit per IP
  (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MIN`, default 5 per 10 min) + 400 ms
  delay on failure. Success clears the IP counter and issues a fresh token.
- `admin` is authenticated against `APP_PASSWORD` (timing-safe); users against
  their `ka_…` access key (timing-safe against the stored hash).
- Keys are generated with `crypto.randomBytes` (`ka_` + 24 bytes base64url) and
  **returned once** at creation/regeneration. Regeneration also wipes the
  account's sessions.

## Drivers

`src/drivers/`: `LLMDriver` interface (`listModels`, `chat`, `chatStream`),
`DriverRegistry` with global priority
`ollama → mistral → puppeteer-openai (stub) → deepseek → anthropic → openai`.
Models are addressed as `"driver:model"` (split on the first `:`).

- `OllamaDriver`: model discovery via `GET {OLLAMA_HOST}/api/tags`, chat via
  `POST /api/chat` with NDJSON streaming.
- `ApiDriverBase`: shared OpenAI-compatible `/models` + `/chat/completions`
  (SSE) implementation; concrete drivers only set base URL, key, and fallback
  model list. A driver is enabled only when its `*_ENABLED` flag is set **and**
  its key is non-empty; failing drivers are skipped (not fatal) in listings.
- `PuppeteerOpenAIDriver`: intentional stub, always disabled (headless scraping
  of chatgpt.com is fragile and against ToS).
