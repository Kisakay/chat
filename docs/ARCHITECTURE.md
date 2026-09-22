# Architecture (backend)

Single Bun process: `Bun.serve` handles the JSON/SSE API **and** the static
frontend (same origin, no CORS). Persistence is SQLite by default via Bun's
native `bun:sqlite` driver (`$DATA_DIR/kisassistant.db`, WAL mode), or
Postgres when `POSTGRESQL_URL` is set (Bun's native `bun:sql` driver,
typically a docker container — see `docs/OPERATIONS.md`).

```
browser ──► Bun.serve (src/index.ts)
              ├─ /api/* ──► auth gate ──► routes ──► db.ts ──► sqlite file | postgres
              │                              └─────► DriverRegistry ──► ollama / APIs
              └─ /* ──► static files + SPA fallback (index.html, covers /share/:id and /chat/:id)
```

All store functions (`db.ts`, `access.ts`, `reports.ts`, `totp.ts`,
`modelPolicy.ts`, `userProviders.ts`) are `async` and talk through the
`DbClient` interface (`src/db/client.ts`): `get` / `all` / `run` / `exec` /
`insertReturningId` / `transaction`. Queries are written once with `?`
placeholders and translated to `$1, $2, …` for Postgres (quote-aware);
Postgres `BIGINT` cells arrive as `bigint` and are normalized to `number`.
One portable-SQL rule this forces: no bare `GROUP BY pk` with unaggregated
columns (rejected by Postgres) — use correlated subqueries instead.

## Request flow: chat

`POST /api/chat { model: "driver:model", messages, conversationId?, stream? }`

1. Bearer token → `verifyToken` (sha256 lookup in `sessions`, expiry check).
2. `DriverRegistry.splitId` routes to the owning driver (unknown/disabled → 400).
3. If `conversationId` is set: conversation must belong to the caller, the new
   user message is stored (deduped against the last stored message), new chats
   are auto-titled from it.
4. Non-streaming → `driver.chat()` → JSON. Streaming → `driver.chatStream()`
   → SSE events `token` / `done` / `error`. The full reply is persisted after a
  successful stream; on error the partial text is kept as-is (no internal
  markers). Server logs each stream open/done/abort per driver when
  `DRIVER_DEBUG=true`. `POST /api/chat` with an archived `conversationId`
  is rejected (403) — archived chats are read-only.

Streaming guarantees (ChatGPT-style, no buffering):

- Tokens are forwarded via `controller.enqueue` the moment they arrive from the
  LLM; disconnects are detected (`req.signal`, guarded `enqueue`,
  stream `cancel()`) and propagated upstream via an `AbortController` passed as
  `opts.signal`, so the model stops generating when the tab closes.
- `Bun.serve` runs with `idleTimeout: 0` — the default 10 s would kill slow
  streams (cold model load, thinking pauses) mid-generation.
- Responses carry `X-Accel-Buffering: no` and the NixOS nginx vhost sets
  `proxy_buffering off`, otherwise the proxy would buffer the whole reply.

## Database schema

Created idempotently at boot in `initDb()` (no migration framework; keep it
so). On Postgres, timestamps are `BIGINT`, auto ids `BIGSERIAL`, later
columns arrive via `ADD COLUMN IF NOT EXISTS`, and `"window"` (model_usage)
is quoted — `WINDOW` is reserved on Postgres.

| Table | Purpose |
|---|---|
| `users` | `id, username UNIQUE, display_name, avatar_url, theme, email, key_hash, created_at`. The `admin` row is bootstrapped (its `key_hash` is unused — admin auth goes through `APP_PASSWORD`). |
| `sessions` | `token_hash PK, user_id, created_at, expires_at`. Bearer tokens, 256-bit, hashed with sha256. Expired rows are purged lazily on access. |
| `resets` | `token_hash PK, user_id, created_at, expires_at`. One-time key-recovery tokens (single use, consumed on POST). |
| `settings` | `key PK, value, updated_at`. Admin-controlled feature flags (`registration_enabled` default off, `tools_ocr_enabled` default on). |
| `conversations` | `id, user_id, title, topic, model, archived_at, created_at, updated_at`. `archived_at = 0` means live; otherwise a unix-ms archive timestamp (added idempotently via `ALTER TABLE`, like `users.email`). |
| `user_provider_keys` | `user_id, provider PK, api_key, updated_at`. Personal LLM keys (BYOK) — stored reversibly (needed upstream), never returned to clients (GET exposes presence + last4 only). Wiped with the account in `deleteUser()`. |
| `messages` | `id AUTOINCREMENT, conv_id → conversations ON DELETE CASCADE, role, content, created_at`. |
| `shares` | `conv_id PK → conversations ON DELETE CASCADE, public_id UNIQUE, created_at`. |

User deletion cascades manually in `deleteUser()` (messages → shares →
conversations → sessions → user) inside a transaction.

## Auth

- `POST /api/auth/login { username, key }`, sliding-window rate limit per IP
  (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MIN`, default 5 per 10 min) + 400 ms
  delay on failure. Success clears the IP counter and issues a fresh token.
- `POST /api/auth/register { username, displayName?, email? }` — public
  self-registration, guarded by the `registration_enabled` setting (403 when
  off), same rate limit and validation as admin creation. Returns `{user, key}`
  with the key shown once.
- `admin` is authenticated against `APP_PASSWORD` (timing-safe); users against
  their `ka_…` access key (timing-safe against the stored hash).
- Keys are generated with `crypto.randomBytes` (`ka_` + 24 bytes base64url) and
  **returned once** at creation/regeneration. Regeneration also wipes the
  account's sessions.

## Local file CDN

`src/cdn.ts` + routes in `index.ts`. Generic namespaced layout
(`PUT /cdn/<ns>/<key>` authed, `GET /cdn/<ns>/<key>.<ext>` public) so future
file kinds plug into `CDN_NAMESPACES` without new routes. Today only `avatar`
exists: key = account id (`/cdn/avatar/<id>.png`), ownership enforced.

- Type safety by **magic bytes** (JPEG `FF D8 FF`, PNG signature, `RIFF…WEBP`);
  only `jpg`/`png`/`webp` are representable, the stored extension is always
  detected, everything else is `415`. Route regex charsets make traversal
  unmatchable (attempts fall through to the SPA fallback).
- Per-namespace limits: `avatar` = 5 MB max (`413`), 5 uploads / 2 h /
  account (`429` + `Retry-After`), counted on success. Re-upload replaces all
  stored variants for the key.
- Served with detected `Content-Type`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: public, max-age=3600`.

## Platform tools

`src/tools/`: `PlatformTool` interface + registry (today: `ocr` via the
tesseract binary, availability probed at boot). `POST /api/tools/ocr` takes
raw image bytes (5 MB, magic-verified, 20 jobs/hour/account) and returns
`{ text, truncated, chars }` — transcription happens server-side with
per-driver-style stdout logging; a missing binary yields a clean 501. Text
attachments use the `text` CDN namespace (500 KB, UTF-8 validated). The model
only ever sees reviewed text blocks, never raw files.

## Drivers`src/drivers/`: `LLMDriver` interface (`listModels`, `chat`, `chatStream`),
`DriverRegistry` with global priority
`ollama → mistral → glm → gemini → arcaic-openai → arcaic-gemini → arcaic-qwen → deepseek → anthropic → openai`.
Models are addressed as `"driver:model"` (split on the first `:`).

- `OllamaDriver`: model discovery via `GET {OLLAMA_HOST}/api/tags`, chat via
  `POST /api/chat` with NDJSON streaming.
- `GET /api/models` is served from an in-memory cache in `DriverRegistry`
  (`MODEL_CACHE_TTL_MS` = 60 s) so logins don't hit Ollama every time.
  Concurrent misses share one in-flight upstream fetch. Admins pass
  `?refresh=1` to force a fresh fetch (used by the "Ollama models" view);
  the flag is ignored for non-admins. Admin pull/delete invalidate the cache.
- `ApiDriverBase`: shared OpenAI-compatible `/models` + `/chat/completions`
  (SSE) implementation; concrete drivers only set base URL, key, and fallback
  model list. A driver is enabled only when its `*_ENABLED` flag is set **and**
  its key is non-empty; failing drivers are skipped (not fatal) in listings.
- Personal providers (BYOK, `src/userProviders.ts`): users attach their own
  `openai` / `anthropic` / `deepseek` / `gemini` keys in settings
  (`GET/PUT/DELETE /api/me/providers`, keys stored in `user_provider_keys`,
  never returned — GET exposes presence + last4 only). `GET /api/models`
  merges the caller's own-key models into their menu (a personal entry
  replaces the platform entry with the same id, flagged `personal: true` so
  the picker lists it under its own "driver · personal key" section), and
  `POST /api/chat` prefers the personal key for those four providers (also
  when the global driver is disabled). The admin model policy still applies. Driver
  constructors accept an `apiKeyOverride` for these per-user instances.
- `ArcaicSubDriver` ×3 (`arcaic-openai`, `arcaic-gemini`, `arcaic-qwen`,
  one model each: `chat`) + `browser.ts` engine: web-UI sessions driven by a
  headless browser (WebDriver BiDi) with a **throwaway profile** (mkdtemp
  under /tmp, deleted on close). Each sub-driver owns its engine (own
  browser + profile) and declares a site config — composer selectors, submit
  mode (send-button click vs Enter key), completion signal (newly **visible**
  copy control, or `aria-busy="false"` on the response container for Gemini),
  answer-text selectors. Anonymous sessions work without login; if the
  composer is missing the engine waits up to `ARCAIC_LOGIN_TIMEOUT_S` for a
  manual login in the window. Multi-line prompts are typed with Shift+Enter.
  Off unless `ARCAIC_ENABLED=true`. Headless by default
  (`ARCAIC_HEADLESS=false` for a visible debug window: `bun
  scripts/poc-chatgpt.ts --headed`); on NixOS use
  `services.kisassistant.enableBrowserDriver` for a headless Firefox in the
  service, or wrap it all in a declarative `containers.*` (see
  `docs/NIXOS-HOSTING.md`). Smoke test: `bun scripts/poc-chatgpt.ts
  --site openai|qwen|gemini` (`--probe` for a state report).
