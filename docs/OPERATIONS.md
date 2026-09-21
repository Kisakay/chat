# Operations

## Environment

Copy `.env.example` to `.env`. Full list:

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` under the NixOS module (and CI); gates the `DRIVER_DEBUG` default |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | listen address (keep localhost behind nginx) |
| `APP_PASSWORD` | *(required)* | **admin** access key — generate with `openssl rand -base64 24` |
| `SESSION_TTL_HOURS` | `720` | Bearer session lifetime (30 days) |
| `DATA_DIR` | `./data` | holds `kisassistant.db` (SQLite) |
| `CDN_DIR` | `./cdn` | local file CDN storage (avatars; NixOS: under state dir) |
| `OCR_LANG` | `eng` | tesseract language(s) for the OCR tool |
| `OCR_MAX_CHARS` | `100000` | transcription cap (longer results are truncated + flagged) |
| `TESSERACT_BIN` | `tesseract` | path to the tesseract binary (NixOS module puts it on PATH; missing binary cleanly disables OCR with 501) |
| `DRIVER_DEBUG` | `true` dev / `false` prod | per-driver debug logging to stdout |
| `WIKI_URL` | `https://git.kisakay.com/k/chat/wiki` | remote docs wiki — `GET /wiki` redirects (302) there |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | *(empty)* / `587` / `false` | key-recovery mailer — empty host disables it (`false` = STARTTLS, `true` = implicit TLS/465) |
| `SMTP_USER` / `SMTP_PASS` | *(empty)* | SMTP auth (omit both for open relays / local catchers) |
| `SMTP_FROM` | `KisAssistant <chatkisakai@ihorizon.org>` | sender address |
| `APP_URL` | `http://localhost:3000` | public base URL used in reset links — **must** be the real origin in prod |
| `RESET_TTL_MIN` | `60` | reset-link lifetime (single use) |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MIN` | `5` / `10` | login rate limit per IP |
| `OLLAMA_HOST` / `OLLAMA_ENABLED` | `http://10.66.66.4:11434` / `true` | local-model driver |
| `MISTRAL_*`, `GLM_*`, `DEEPSEEK_*`, `ANTHROPIC_*`, `OPENAI_*` | disabled | API drivers: set `*_ENABLED=true` **and** `*_API_KEY` |
| `GLM_BASE_URL` | `https://api.z.ai/api/paas/v4` | Zhipu platform override (mainland China: `https://open.bigmodel.cn/api/paas/v4`) |

## Local development

```bash
bun install
bun run dev              # backend watch mode (restarts on edit), :3000
bun run dev:frontend     # Vite HMR + /api proxy, :5173 (use this for UI work)
bun run dev:all          # both at once
bun run build:frontend   # production build into public/
```

Smoke tests: start the backend on a **free non-3000 port** with a throwaway
`DATA_DIR` (port 3000 is the owner's dev server — do not touch it), then drive
the API with curl/python: login → models → conversations → chat → share →
unshare. See `AGENTS.md`.

## Managing accounts

1. Log in as `admin` with the `APP_PASSWORD` key.
2. Open **Accounts** → *New account* → username (+ display name).
3. Copy the one-time `ka_…` key and hand it to the owner (chat, QR code, …).
4. Users set their display name, avatar (upload a picture in the profile settings —
   hosted on the built-in CDN), theme, accent color and feature flags in the settings.
5. Rotate a compromised key with the regenerate button (old sessions die);
   delete removes the account with all its chats and shares.

## Admin Center (`/admin`) & self-registration

The sidebar **Admin Center** button (admin only) opens the `/admin` page with
four tabs: **Accounts** (same manager as before, incl. the Ollama model
catalog), **Access** (access-request wishlist triage, see below),
**Features** (server-side switches), **Mail** (SMTP credentials viewer +
connectivity tester: `GET /api/admin/mail`, `POST /api/admin/mail/verify`,
`POST /api/admin/mail/test`, admin Bearer only).

- `registration_enabled` (default off): when on, the login page shows a
  working **Register** button — anyone can create an account (key shown once)
  via `POST /api/auth/register`. When off, the button is greyed with the
  tooltip *"Registration currently disabled on this platform"* and the
  endpoint answers 403. Flipped live, no restart. Turning it on retires the
  access-request wishlist automatically.
- `registration_request_enabled` (default on): shows **Request access** on the
  login page (wishlist). Only switchable on while public registration is off —
  the two are mutually exclusive (API answers 409 otherwise).
- `tools_ocr_enabled` (default on): admin kill-switch for the OCR tool.
- Flags live in the `settings` SQLite table, edited via
  `GET/PATCH /api/admin/settings` (admin Bearer only).

## Access-request wishlist (registration approval queue)

When public registration is off, visitors can still reserve a username via
**Request access** on the login page: username + email (required) + a
motivation message (10+ chars). This creates a ticket (`access_requests` +
`access_messages` tables) with a personal page at `/review/<id>` (unguessable
UUID, same pattern as share links).

- Requester: follows the decision, argues their case and replies on the
  `/review` page. Closed tickets (accepted/refused) are read-only.
- Admin: **Access** tab in the Admin Center — filter by status, open a ticket,
  reply (emailed to the requester), and set `pending → reviewing → accepted /
  refused` with a reason. **Accepting creates the account** and returns the
  access key once (also emailed). Terminal tickets can't be reopened.
- Email (needs `SMTP_*`): received-confirmation, reviewing/accepted/refused
  notices, and every admin reply — all HTML, all stating email is
  notification-only and replies belong on the `/review` page.
- Routes: `POST /api/access/request` (public, rate-limited),
  `GET /api/access/ticket/:id` + `POST .../message` (public, ticket bearer),
  `GET /api/admin/access`, `GET/PATCH /api/admin/access/:id`,
  `POST /api/admin/access/:id/message` (admin).
- Live updates ride WebSockets (no polling): `GET /api/access/ws/:id`
  (ticket bearer — pushes `access_message` + `access_status` for that ticket)
  and `GET /api/admin/ws?token=…` (admin Bearer in query string, browsers
  can't set WS headers — pushes `access_message` + `access_status` +
  `access_created` for every ticket, driving the AdminCenter badge and the
  triage list). Clients ping every 25 s (`{"type":"ping"}` → `{"type":"pong"}`)
  and resync over HTTP on every (re)connect.

## Content reports (flagged AI responses)

Every assistant message carries three actions: **Copy**, **Search the web**
(DuckDuckGo, new tab) and **Report**. Reporting opens a modal with a reason
picker (`copyright`, `gore`, `falseinfo`, `bug`) plus optional details, and
creates a row in the `reports` table with a content snapshot (survives later
edits/deletion of the chat), the model, and the reporter.

- Reporter: capped at 20 open (`open` + `reviewing`) reports (429 beyond).
- Admin: **Reports** tab in the Admin Center (badge counts open reports) —
  filter by status, expand for the full snapshot + reporter details, and set
  `open → reviewing → resolved / dismissed` with an internal note.
- Routes: `POST /api/reports` (Bearer), `GET /api/admin/reports`,
  `PATCH /api/admin/reports/:id` (admin).

## Key recovery via email (optional)

Set the `SMTP_*` vars (and the real public `APP_URL`) to enable it; otherwise
the login page hides the "Forgot your access key?" link.

1. Admin sets a recovery email at account creation (or the user sets their own
   in profile settings).
2. User clicks the link on the login page and enters their username. The API
   always answers `{ok:true}` (no account enumeration) and, if the account has
   an email, sends a one-time `/reset/<token>` link (60 min, single use).
3. Opening the link shows a confirm page; confirming **rotates the key
   immediately** — the new `ka_…` key is displayed once, old sessions die.
   (`admin` itself is excluded: its key lives in `.env`.)

## Local file CDN (avatars)
`PUT /cdn/<ns>/<key>` (Bearer) / `GET /cdn/<ns>/<key>.<ext>` (public), e.g.
`/cdn/avatar/<account-id>.png`. Namespaces live in `CDN_NAMESPACES`
(`src/cdn.ts`) — add one to extend (future usage).

- Allowed types **only** `jpg`/`png`/`webp`, verified by **magic bytes**, never
  by extension (client filename is ignored; the stored extension comes from
  detection). Everything else → `415`, unknown namespace/ext → `404`.
- `avatar` rules: 5 MB max (`413` above), **5 uploads max per 2 h per account**
  (`429` + `Retry-After`), ownership enforced (own id, or admin).
- Served with fixed `Content-Type`, `nosniff`, `Cache-Control: public,
  max-age=3600`. No listing, no traversal (strict charsets + SPA fallback).

## Platform tools & attachments

Uploads always go through platform tools (`GET /api/tools` lists them with
availability). Today: **OCR** (`POST /api/tools/ocr`, tesseract).

- Images (jpg/png/webp, 5 MB max, magic-verified, 20 jobs/hour/account) are
  transcribed **on the backend to TXT** — the model never receives image
  bytes. Text files ride the `text` CDN namespace (UTF-8 validated, 500 KB
  max, keys prefixed with the account id).
- The UI (paperclip menu in the composer) explains this and always shows a
  **pre-transcription preview**: the user reviews/edits the text, then
  attaches it. Attachments travel as labeled text blocks inside the message,
  so they persist in history and work with every model.

## NixOS deployment (`chat.kisakay.com`)

Full step-by-step guide: **[NIXOS-HOSTING.md](./NIXOS-HOSTING.md)**.

`flake.nix` exposes `packages.<system>.default` (backend + prebuilt frontend,
frontend compiled offline from `frontend/bun.lock` via a fixed-output
`bun install`) and `nixosModules.default`.

```nix
imports = [ kisassistant.nixosModules.default ];
services.kisassistant = {
  enable = true;
  package = kisassistant.packages.${pkgs.system}.default;  # required
  domain = "chat.kisakay.com";   # legacy switch: implies nginx + ACME
  enableNginx = true;            # explicit; requires domain
  passwordFile = "/run/secrets/kisassistant-password";  # agenix/sops-nix
  ollamaHost = "http://10.66.66.4:11434";
  extraEnv = { MISTRAL_ENABLED = "true"; };              # optional
};
security.acme.acceptTerms = true;  # required for the ACME/TLS vhost
```

The module sets `NODE_ENV=production`, `CDN_DIR=/var/lib/kisassistant/cdn`
and `DRIVER_DEBUG=false` for the systemd service. `enableNginx` is a
tri-state: `true`/`false` force the bundled reverse proxy on/off, `null`
(the default) keeps the legacy behaviour (nginx iff `domain` is set).

Secrets (`passwordFile`, API keys) must come from files (agenix/sops-nix), never
baked into the Nix store. The service stores SQLite under
`/var/lib/kisassistant/data`; nginx terminates TLS and proxies to
`127.0.0.1:3000`.
