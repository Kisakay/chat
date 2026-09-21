# KisAssistant (kisa's assistant)

Private ChatGPT/Claude-like chat. React + Tailwind + lucide frontend (rounded,
Signal-style, Inter font, light/dark/auto themes), Bun backend with
class-oriented LLM **drivers** and a **SQLite** database (Bun native driver) for
accounts, server-side chats and public shares. No cookies — Bearer keys in
`localStorage`.

Driver priority:

```
1. ollama → 2. mistral API → 3. glm API → 4. arcaic ×3 (arcaic-openai → arcaic-gemini → arcaic-qwen)
→ 5. deepseek → 6. anthropic → 7. openai
```

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (backend, drivers, DB) ·
[`docs/FRONTEND.md`](docs/FRONTEND.md) (components, theming) ·
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) (env, dev, accounts, NixOS) ·
[`docs/NIXOS-HOSTING.md`](docs/NIXOS-HOSTING.md) (server hosting tutorial).
Agent instructions: [`AGENTS.md`](AGENTS.md).

## Quick start

Requirements: [Bun](https://bun.sh) ≥ 1.1, Node 20+ (frontend build), Ollama
reachable at `OLLAMA_HOST` (default `http://10.66.66.4:11434`).

```bash
cp .env.example .env
# edit .env → set APP_PASSWORD (openssl rand -base64 24), check OLLAMA_HOST

bun install
bun run --cwd frontend build   # builds React app into public/
bun run dev                    # http://localhost:3000 (or `bun run start`)
# frontend dev with proxy: bun run --cwd frontend dev  # http://localhost:5173
```

Log in as `admin` with the `APP_PASSWORD` key, then create No-KYC user accounts
from the **Accounts** panel (each gets a one-time access key to hand over).

## Accounts (No-KYC, admin-managed)

- `admin` authenticates with `APP_PASSWORD` from `.env`.
- Admin creates users (`username`, display name, avatar URL, theme) — the API
  returns a `ka_…` access key **once**; keys are stored hashed (sha256).
- Users log in with `{ username, key }`. Regenerating a key revokes old sessions.
- Per-account: display name, avatar (uploaded to the built-in CDN from profile
  settings), theme (`auto`/`light`/`dark`), accent color, feature flags.

## API

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | rate-limited (5/10min/IP) | `{username, key}` → `{token, expiresAt, user}` |
| POST | `/api/auth/register` | public, rate-limited | self-registration (403 when disabled by admin) → `{user, key}` |
| GET | `/api/auth/verify` | Bearer | → `{ok, user}` |
| POST | `/api/auth/logout` | Bearer | revokes token |
| GET/PATCH | `/api/me` | Bearer | profile: displayName, avatarUrl, theme |
| GET/POST | `/api/admin/users` | admin | create returns `{user, key}` (key shown once) |
| PATCH/DELETE | `/api/admin/users/:id` | admin | edit profile / delete + cascade |
| POST | `/api/admin/users/:id/regenerate` | admin | new key, old sessions revoked |
| GET/PATCH | `/api/admin/settings` | admin | feature flags: registrationEnabled, ocrEnabled |
| GET/POST | `/api/conversations` | Bearer | server-persisted chats (title, topic, model) |
| GET | `/api/conversations/search?q=` | Bearer | search titles, topics + old prompts (with snippet) |
| POST | `/api/admin/ollama/pull` | admin | pull a model from the Ollama library (NDJSON progress) |
| DELETE | `/api/admin/ollama/models/:name` | admin | remove a local Ollama model |
| POST | `/api/access/request` | public | reserve username+email with a motivation → ticket (`/review/:id`) |
| GET/POST | `/api/access/ticket/:id` (+`/message`) | ticket bearer | follow + reply on an access request |
| WS | `/api/access/ws/:id` | ticket bearer | live ticket messages + status (ping/pong heartbeat) |
| WS | `/api/admin/ws?token=…` | admin | firehose of all access events (badge + triage list) |
| GET/PATCH/POST | `/api/admin/access…` | admin | wishlist triage: list, accept/refuse/review, reply |
| POST | `/api/reports` | Bearer | flag an AI response (copyright/gore/falseinfo/bug) → `{report}` (201) |
| GET/PATCH | `/api/admin/reports`, `/api/admin/reports/:id` | admin | report triage: list, reviewing/resolved/dismissed + note |
| GET | `/api/admin/mail` | admin | SMTP credentials viewer (password blurred by default in UI) |
| POST | `/api/admin/mail/verify`, `/api/admin/mail/test` | admin | verify SMTP connectivity / send test mail `{to}` |
| POST / DELETE | `/api/me/key/rotate`, `/api/me` | Bearer | rotate own key (sessions revoked) / delete own account |
| GET/POST/DELETE | `/api/me/totp`, `/api/me/totp/setup`, `/api/me/totp/verify` | Bearer | TOTP two-factor status/setup/verify/disable |
| POST | `/api/auth/totp` | challenge | second login step `{totpToken, code}` → session |
| GET/PATCH/DELETE | `/api/conversations/:id` | owner | incl. messages on GET |
| POST/GET/DELETE | `/api/conversations/:id/share` | owner | public link `/share/:publicId` |
| GET | `/api/conversations/archived` | Bearer | archived chats (hidden from sidebar + search) |
| POST | `/api/conversations/:id/archive`, `/api/conversations/:id/unarchive` | owner | archive (read-only) / restore to the list |
| GET | `/api/share/:publicId` | **public** | read-only shared chat JSON |
| GET | `/api/models` | Bearer | `[{id: "driver:model", …}]` across enabled drivers |
| POST | `/api/chat` | Bearer | `{model, messages, conversationId?, stream?}` → JSON or SSE |

`POST /api/chat` with `conversationId` persists the user message + assistant
reply into that conversation (ownership enforced) and auto-titles new chats.

## Database (SQLite, Bun native)

`$DATA_DIR/kisassistant.db` (WAL mode). Tables: `users` (id, username,
display_name, avatar_url, theme, email, key_hash), `sessions` (hashed Bearer tokens),
`conversations` (id, user, title, topic, model, archived_at), `messages`, `shares`,
`resets` (recovery tokens), `settings` (feature flags)
(conv ↔ public id). No migration system — schema is created idempotently at boot.

## Drivers (backend layout)

```
src/drivers/types.ts     LLMDriver interface + DriverModel + errors
src/drivers/ollama.ts    OllamaDriver (priority #1) — /api/tags discovery, NDJSON stream
src/drivers/apiBase.ts   ApiDriverBase (OpenAI-compatible SSE) base class
src/drivers/apis.ts      Mistral / DeepSeek / Anthropic / OpenAI drivers
src/drivers/browser.ts   ArcaicBrowserEngine + site configs (openai/qwen/gemini) — throwaway Firefox profile
src/drivers/arcaic.ts      ArcaicSubDriver ×3 — arcaic-openai / arcaic-gemini / arcaic-qwen (ARCAIC_ENABLED)
src/drivers/registry.ts  DriverRegistry — priority order + "driver:model" routing
src/db.ts                SQLite store (users, sessions, convs, messages, shares)
src/auth.ts              login/sessions/rate-limit (admin key = APP_PASSWORD)
```

Enable an API driver later: `MISTRAL_ENABLED=true` + `MISTRAL_API_KEY=…`, restart.

## NixOS hosting (chat.kisakay.com)

Full tutorial: **[`docs/NIXOS-HOSTING.md`](docs/NIXOS-HOSTING.md)**.

Flake exposes `packages.<system>.default` (backend + prebuilt frontend) and
`nixosModules.default`. The frontend is built offline inside Nix with Bun from
`frontend/bun.lock`; on a deps hash mismatch, paste the `got: sha256-…` value
Nix reports into `bunDepsHash` in `flake.nix`.

```nix
kisassistant.url = "http://git.kisakay.com/k/chat";  # adjust to real repo path

imports = [ kisassistant.nixosModules.default ];
services.kisassistant = {
  enable = true;
  package = kisassistant.packages.${pkgs.system}.default;  # required
  enableNginx = true;                       # nginx reverse proxy + ACME
  domain = "chat.kisakay.com";              # vhost name (required with enableNginx)
  passwordFile = "/run/secrets/kisassistant-password"; # agenix/sops-nix
  ollamaHost = "http://10.66.66.4:11434";
};
security.acme.acceptTerms = true;           # required for the TLS certificate
```

Nginx terminates TLS; the app listens on `127.0.0.1:3000` with
`NODE_ENV=production`. SQLite lives in `/var/lib/kisassistant/data`, avatars
(file CDN) in `/var/lib/kisassistant/cdn`.

## Frontend

`frontend/` — React 18 + Vite + Tailwind 3 + lucide-react + react-markdown/gfm,
Inter Variable (self-hosted, no external requests). `bun run --cwd frontend build`
outputs to `public/` (wiped first). Collapsible sidebar, right-click context menu
(rename / topic / share / delete), share modals, confirm dialogs, admin accounts
panel, profile settings, public read-only `/share/:id` page. English only.
