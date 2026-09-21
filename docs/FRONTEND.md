# Frontend

React 18 + Vite + Tailwind 3 + lucide-react + react-markdown/remark-gfm, Inter
Variable self-hosted (`@fontsource-variable/inter` — no external requests).
Built with `bun run build:frontend` into `public/` (Vite `emptyOutDir`; that
directory is a build artifact, never hand-edit, not committed).

## Routing

No router library — a tiny history wrapper (`lib/route.ts`: `navigate()`,
`useRoute()`, trailing-slash normalization) drives pathname routing:

- `/login` — sign-in card (username + access key + TOTP step). Renders
  instantly, **never shows the boot splash**.
- `/register` — full-page self-registration (`RegisterPage.tsx`; key shown
  once, then hands username+key to `/login` via `sessionStorage`). No splash.
- `/chat` — the platform itself (auth required; boots behind the splash).
- `/` — redirects to `/chat` when logged in, `/login` otherwise (placeholder
  for a future landing page).
- Public routes (unchanged): `/share/:publicId`, `/reset/:token`,
  `/review/:id`, `/admin`.

## State & data flow

- `App.tsx` owns: `user`, `models`/`model`, `convs`, `activeId`, `messages`,
  `streaming`, modal states. All server state is re-fetched (no client cache
  library); conversations themselves live server-side in SQLite.
- `lib/api.ts` — typed `fetch` wrapper: Bearer header from `localStorage`,
  `{ error }` parsing, `ApiError` with status, auto logout+reload on 401
  (except on `/share/*`). `chatStream()` parses SSE `token`/`done`/`error`.
- Boot shows `LoadingScreen` for at least 1.5 s (`MIN_SPLASH_MS` in `App.tsx`)
  so the bloom animation always plays, even when the session restores
  instantly — **only on `/` and `/chat`**. `/login` and `/register` skip it.
- Sending: ensure a server conversation exists (created lazily on first send),
  optimistic user message, stream tokens into `streaming`, then append the full
  assistant message and refresh the list (server auto-titles new chats).

## Components (`components/`)

- `ui.tsx` — design system. `Button` (primary/secondary/ghost/danger),
  `IconButton`, `Input`, `Field`, `Modal`, `ConfirmDialog`, `ContextMenu`,
  `Avatar` (remote URL or gradient initials), `CopyButton`, `Spinner` and
  **`Picker`** — the framework-styled dropdown (pill button + popover, optional
  option groups, lucide `ChevronDown`/`Check`, Escape/outside-click to close).
  **Never use a native `<select>`**; use `Picker` for model and theme choices.
- `Login.tsx` — username + access-key card (`/login`); the Register button
  navigates to `/register`, and a fresh registration prefills the form.
- `RegisterPage.tsx` — full-page registration (`/register`) reusing the login
  card style; shows the new key once with a copy button, then continues to
  `/login`.
- `Sidebar.tsx` — collapsible conversation list with per-item context menu
  (right-click or `···`: Rename / Set topic / Share publicly / Archive /
  Delete), user chip (opens settings), Accounts button (admin), logout.
  Archived chats leave the list (and search); they live in settings.
- `Chat.tsx` — header (title, topic badge, driver-grouped model `Picker`,
  share button), message list (`Markdown` for assistant, emerald bubble for
  user), rounded composer with paperclip attach menu, attachment chips
  (Enter to send, Shift+Enter for newline). With `readOnly` (archived chat)
  the composer and share button are replaced by an unarchive banner.
- `dialogs.tsx` — `ConvEditDialog` (title + topic), `ShareModal` (public link,
  copy, unshare), `SettingsModal` (display name, avatar upload box with
  drag & drop, avatar URL, theme, plus an "Archived chats" category to
  view / unarchive / delete archived conversations).
- `AdminPanel.tsx` — No-KYC account management: create (key shown once),
  regenerate (revokes sessions), edit, delete with confirm, plus server-side
  search / sort (newest, oldest, A–Z, Z–A) / email filter / pagination.
  Renders bare (no modal shell) when embedded in the Admin Center page.
- `AdminCenter.tsx` — `/admin` route (admin gate + locked screen otherwise):
  tabbed hub (Accounts / Features / Mail) reusing `AdminPanel`, server
  feature `Switch`es (`registrationEnabled`, `ocrEnabled` via
  `/api/admin/settings`), SMTP viewer (password blurred by default, eye toggle
  to reveal) + connectivity tester (verify + send test mail). Follows the platform theme.
- `SharePage.tsx` — public read-only view, fetches `/api/share/:id` unauthenticated
  (`{ title, topic, model, authorName, authorAvatarUrl, archived, sharedAt, messages }`);
  user messages render the author's avatar via `Avatar` (URL or initials);
  an "Archived" pill shows when the source conversation is archived.
- `Markdown.tsx` — `react-markdown` + GFM; code blocks get a language label and
  a copy button.

## Theming

Tailwind `darkMode: "class"`. `applyTheme()` in `App.tsx` toggles the `dark`
class from the account theme (`auto` follows `prefers-color-scheme` with a
live media-query listener). Accent: emerald; shapes: `rounded-2xl/3xl`
everywhere; every surface needs a `dark:` variant. UI text is English only.

## Mobile

Below the `md` breakpoint the sidebar becomes a slide-in drawer (backdrop tap
or swipe-left closes it, hamburger in the chat header opens it). Modals render
as bottom sheets with a drag handle — pull down past the threshold to dismiss
(tap backdrop or Escape works too). Composer respects
`env(safe-area-inset-bottom)`. No separate mobile codebase: same components,
responsive Tailwind classes + minimal touch handlers.
