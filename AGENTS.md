# AGENTS.md — instructions for coding agents working on KisAssistant

Read this before touching the code. Docs live in `docs/` (English).

## What this is

KisAssistant — private ChatGPT-like assistant. Bun backend (single process,
serves API + static frontend), React 18 + Vite + Tailwind 3 + lucide-react
frontend, SQLite persistence via Bun's native `bun:sqlite` driver.

## Commands (run from repo root unless noted)

- `bun install` — backend deps (almost none; `@types/bun` only)
- `bun run dev` — backend with **watch mode** (auto-restart on edit), http://localhost:3000
- `bun run dev:frontend` — Vite dev server with HMR + `/api` proxy, http://localhost:5173
- `bun run dev:all` — both at once (two terminals also works)
- `bun run build:frontend` / `bun --cwd frontend build` — typecheck + Vite build into `public/` (wipes it first)
- `bun run typecheck` / `bun run typecheck:frontend` — `tsc --noEmit` for each side
- API smoke tests: boot on a **non-3000 port** with throwaway `DATA_DIR`, drive with curl/python (see `docs/OPERATIONS.md`). Port 3000 is the owner's dev server — **never kill it, never bind it in tests**.

## Layout

```
src/index.ts          HTTP routes (Bun.serve). Auth gate: everything under /api/ except /api/auth/login and /api/share/:id
src/config.ts         env parsing (PORT, HOST, APP_PASSWORD=admin key, OLLAMA_HOST, DATA_DIR, rate limits)
src/db.ts             SQLite store: users, sessions, conversations, messages, shares (+ admin row bootstrap)
src/auth.ts           login(username,key), hashed Bearer sessions, sliding-window login rate limit
src/static.ts         static file server + SPA fallback (covers /share/:id)
src/drivers/          LLMDriver interface, OllamaDriver, ApiDriverBase, Mistral/DeepSeek/Anthropic/OpenAI, puppeteer stub, DriverRegistry
frontend/src/         App.tsx (routing+state), lib/api.ts (fetch wrapper), components/
public/               BUILD OUTPUT (Vite). Never hand-edit; rebuild instead. Not committed (see .gitignore)
flake.nix/module.nix NixOS packaging + service module
```

## Auth model (do not weaken)

- No cookies. Bearer tokens in `localStorage`, stored **sha256-hashed** in SQLite.
- `admin` logs in with `APP_PASSWORD` from `.env`. Users log in with admin-issued `ka_…` keys (also hashed). Comparisons are timing-safe.
- Conversations/shares are per-account; always enforce `conv.user_id === user.id`. Admin has no cross-account read.
- Never log, print, or commit secrets. `.env`, `data/`, `*.db` are gitignored.

## Conventions

- Language: TypeScript strict. UI text: English only.
- Frontend styling: Tailwind only, emerald accent, `rounded-2xl/3xl` everywhere, `dark:` variants on every surface. Inter Variable font (self-hosted, no CDN).
- Icons: lucide-react only. **Never use native `<select>`** — use the `Picker` component in `frontend/src/components/ui.tsx` (also `Button`, `Modal`, `ConfirmDialog`, `ContextMenu`, `Avatar`, `CopyButton` live there).
- Backend responses: `json()` helper, `{ error }` shape on failure, correct HTTP codes (400/401/403/404/409/429/502).
- DB: synchronous `bun:sqlite` queries, prepared statements, `PRAGMA journal_mode=WAL`. Schema is created idempotently at boot — keep it that way (no migration framework).
- Drivers: new LLM backends implement `LLMDriver` and register in `DriverRegistry` priority order. The puppeteer scraper stays a stub (ToS risk).
- Docs are in English. Update `docs/` + README when adding routes, tables, or env vars.

## NixOS

`flake.nix` builds the frontend offline via `buildNpmPackage` (needs `frontend/package-lock.json` committed). If `npmDepsHash` mismatches, take the hash from the error. Keep `module.nix` options backward compatible.
