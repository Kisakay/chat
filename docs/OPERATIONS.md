# Operations

## Environment

Copy `.env.example` to `.env`. Full list:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | listen address (keep localhost behind nginx) |
| `APP_PASSWORD` | *(required)* | **admin** access key — generate with `openssl rand -base64 24` |
| `SESSION_TTL_HOURS` | `720` | Bearer session lifetime (30 days) |
| `DATA_DIR` | `./data` | holds `kisassistant.db` (SQLite) |
| `WIKI_URL` | `https://git.kisakay.com/k/chat/wiki` | remote docs wiki — `GET /wiki` redirects (302) there |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MIN` | `5` / `10` | login rate limit per IP |
| `OLLAMA_HOST` / `OLLAMA_ENABLED` | `http://10.66.66.4:11434` / `true` | local-model driver |
| `MISTRAL_*`, `DEEPSEEK_*`, `ANTHROPIC_*`, `OPENAI_*` | disabled | API drivers: set `*_ENABLED=true` **and** `*_API_KEY` |

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
4. Users set their display name, avatar URL (upload e.g. to `catbox.moe`, paste
   the direct link) and theme in the profile settings.
5. Rotate a compromised key with the regenerate button (old sessions die);
   delete removes the account with all its chats and shares.

## NixOS deployment (`chat.kisakay.com`)

`flake.nix` exposes `packages.<system>.default` (backend + prebuilt frontend)
and `nixosModules.default`. The frontend is compiled offline with
`buildNpmPackage` from `frontend/package-lock.json` — commit that file, and on
a hash mismatch paste the hash Nix reports into `npmDepsHash`.

```nix
imports = [ kisassistant.nixosModules.default ];
services.kisassistant = {
  enable = true;
  package = kisassistant.packages.${pkgs.system}.default;
  domain = "chat.kisakay.com";                          # nginx + ACME
  passwordFile = "/run/secrets/kisassistant-password";  # agenix/sops-nix
  ollamaHost = "http://10.66.66.4:11434";
  extraEnv = { MISTRAL_ENABLED = "true"; };             # optional
  # secrets for API drivers: pass via environment files / extraEnv, never the store
};
```

Secrets (`passwordFile`, API keys) must come from files (agenix/sops-nix), never
baked into the Nix store. The service stores SQLite under
`/var/lib/kisassistant/data`; nginx terminates TLS and proxies to
`127.0.0.1:3000`.
