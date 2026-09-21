import { useEffect, useRef, useState } from "react";
import { Fingerprint, Globe, FileText, ImagePlus, KeyRound, Link2, Mail, Palette, Pencil, ScanText, Search, Settings2, ShieldCheck, Sparkles, Tag, Trash2, Unplug, User as UserIcon, UserPlus, X } from "lucide-react";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { ACCENT_PRESETS, applyAccent, currentAccent, previewAccent, type AccentState } from "../lib/accent.ts";
import { FEATURES, setFeature, useFeatures } from "../lib/features.ts";
import type { Conversation, FilePreview, User } from "../lib/types.ts";
import { Avatar, bumpCdnVersion, Button, CopyButton, Field, Input, Modal, Picker, Spinner, Toggle } from "./ui.tsx";

/* ---------- Rename + topic ---------- */

export function ConvEditDialog({
  conv,
  onClose,
  onSaved,
}: {
  conv: Conversation | null;
  onClose: () => void;
  onSaved: (c: Conversation) => void;
}) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (conv) {
      setTitle(conv.title);
      setTopic(conv.topic);
      setError("");
    }
  }, [conv]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!conv || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.patchConv(conv.id, { title: title.trim(), topic: topic.trim() });
      onSaved(res.conversation);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={conv !== null} onClose={onClose} title="Edit conversation" icon={Pencil}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </Field>
        <Field label="Topic" hint="A short theme tag, e.g. cooking, rust, travel.">
          <div className="relative">
            <Tag size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
            <Input className="pl-10" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="No topic" />
          </div>
        </Field>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Key recovery ---------- */

export function RecoverDialog({ open, onClose, from }: { open: boolean; onClose: () => void; from?: string }) {
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setUsername("");
      setSent(false);
      setError("");
    }
  }, [open ]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.recover(username.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Recover access key" icon={Mail} wide>
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm opacity-80">
            If <strong>@{username.trim().toLowerCase() || "…"}</strong> exists and has a recovery
            email, a reset link is on its way{from ? <> from <strong>{from}</strong></> : ""} (valid 60 minutes, single use).
          </p>
          <p className="rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm opacity-90 dark:bg-amber-500/10">
            Check your inbox — and your spam folder, the message may have landed there.
          </p>
          <p className="text-sm opacity-70">
            Nothing arrives? Then no recovery email is set on your account and the
            reset is not possible — please contact the site administrator.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm opacity-70">
            Enter your username. You'll receive a link that issues a fresh key
            (the old one stops working).
          </p>
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="alice" required />
          </Field>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : "Send reset link"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ---------- File preview (pre-transcription review) ---------- */

export function FilePreviewModal({
  preview,
  busy,
  onClose,
  onAttach,
}: {
  preview: FilePreview | null;
  busy: boolean;
  onClose: () => void;
  onAttach: (text: string) => void;
}) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (preview) setText(preview.text);
  }, [preview]);

  const isOcr = preview?.kind === "ocr";

  return (
    <Modal
      open={preview !== null}
      onClose={onClose}
      title={isOcr ? "Review transcription" : "Review text attachment"}
      icon={isOcr ? ScanText : FileText}
      wide
    >
      {busy ? (
        <p className="flex items-center gap-2 py-8 text-sm opacity-70">
          <Spinner size={16} />
          {isOcr ? "Transcribing the image on the server (OCR)…" : "Uploading through platform tools…"}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="rounded-2xl bg-accent-600/10 px-4 py-2.5 text-sm opacity-90">
            {isOcr
              ? <>The image was transcribed to text on the server — <strong>the model receives this text, never the image</strong>. Fix any reading mistakes below, then attach.</>
              : <>The file was uploaded through platform tools. <strong>Its text content is attached to your message.</strong> Edit below if needed, then attach.</>}
          </p>
          {preview?.truncated && (
            <p className="rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm">Transcription truncated to the server limit — the end is missing.</p>
          )}
          <textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full resize-y rounded-2xl border border-stone-200 bg-stone-50 p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-accent-500 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs opacity-60">{preview?.name} · {text.length.toLocaleString()} chars</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={() => onAttach(text)} disabled={!text.trim()}>Attach to message</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Self-registration ---------- */

export function RegisterDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (username: string, key: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setUsername("");
      setDisplayName("");
      setEmail("");
      setKey(null);
      setError("");
    }
  }, [open ]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.register({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || undefined,
        email: email.trim() || undefined,
      });
      setKey(res.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create an account" icon={UserPlus}>
      {key ? (
        <div className="space-y-4">
          <p className="text-sm opacity-80">
            Welcome, <strong>@{username.trim().toLowerCase()}</strong>! Your access key — copy it now, it won't be shown again:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-2xl bg-stone-100 px-3 py-2.5 text-sm dark:bg-zinc-800">{key}</code>
            <CopyButton text={key} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { onDone(username.trim().toLowerCase(), key); onClose(); }}>Copy & continue to login</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="alice" maxLength={32} required />
          </Field>
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alice" maxLength={60} />
          </Field>
          <Field label="Email (optional, for key recovery)">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@example.com" inputMode="email" />
          </Field>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : "Register"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ---------- Share ---------- */

export function ShareModal({ conv, onClose }: { conv: Conversation | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!conv) {
      setUrl(null);
      return;
    }
    setBusy(true);
    setError("");
    api.share(conv.id)
      .then((r) => setUrl(window.location.origin + r.url))
      .catch((err) => setError(err instanceof Error ? err.message : "Share failed"))
      .finally(() => setBusy(false));
  }, [conv]);

  async function unshare() {
    if (!conv) return;
    await api.unshare(conv.id);
    onClose();
  }

  return (
    <Modal open={conv !== null} onClose={onClose} title="Share publicly" icon={Globe}>
      {busy && <p className="flex items-center gap-2 text-sm opacity-70"><Spinner size={15} /> Creating public link…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {url && (
        <div className="space-y-4">
          <p className="text-sm opacity-70">Anyone with this link can read <strong>{conv?.title}</strong>. No login required.</p>
          <div className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <Link2 size={15} className="shrink-0 opacity-50" />
            <span className="min-w-0 flex-1 truncate">{url}</span>
            <CopyButton text={url} />
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={unshare}><Unplug size={15} /> Unshare</Button>
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Settings (profile) ---------- */

export function SettingsModal({
  user,
  onClose,
  onSaved,
  onKeyRotated,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: (u: User) => void;
  onKeyRotated?: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [email, setEmail] = useState("");
  const [theme, setTheme] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Two-column settings: categories on the left, content on the right.
  // Searching filters the category list and jumps to the first match.
  const CATS = [
    { id: "profile", title: "Profile", icon: UserIcon, keywords: ["profile", "avatar", "picture", "photo", "name", "display", "email", "account"] },
    { id: "appearance", title: "Appearance", icon: Palette, keywords: ["appearance", "theme", "dark", "light", "color", "colour", "accent", "palette"] },
    { id: "features", title: "Features", icon: Sparkles, keywords: ["features", "thinking", "attachments", "search", "deep", "upload", "ocr", "capabilities", "enable", "disable"] },
    { id: "security", title: "Security", icon: ShieldCheck, keywords: ["security", "key", "rotate", "password", "totp", "2fa", "two", "factor", "authenticator", "passkey", "webauthn"] },
  ] as const;
  type CatId = (typeof CATS)[number]["id"];
  const [cat, setCat] = useState<CatId>("profile");

  const visibleCats = CATS.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.title.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q));
  });
  const activeCat = visibleCats.some((c) => c.id === cat) ? cat : (visibleCats[0]?.id ?? "profile");

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setAvatarUrl(user.avatarUrl);
      setEmail(user.email);
      setTheme(user.theme);
      setError("");
      setUploadError("");
      setSearch("");
    }
  }, [user]);

  async function uploadFile(f: File) {
    if (!user) return;
    if (f.size > 5 * 1024 * 1024) {
      setUploadError("File too large (max 5MB).");
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setUploadError("Only jpg, png or webp images are accepted.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const res = await api.uploadAvatar(user.id, f);
      setAvatarUrl(res.url); // applied when you press Save
      // Same URL path every upload -> bump the CDN version so every <Avatar>
      // preview (this modal, sidebar, chat bubbles) re-fetches immediately.
      bumpCdnVersion();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.updateMe({ displayName: displayName.trim(), avatarUrl: avatarUrl.trim(), email: email.trim(), theme });
      onSaved(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={user !== null} onClose={onClose} title="Settings" icon={Settings2} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="w-full rounded-2xl border border-stone-200/70 bg-stone-100 py-2 pl-9 pr-8 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent-500/60 focus:bg-white dark:border-zinc-800 dark:bg-zinc-800/60 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear settings search"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <nav aria-label="Settings categories" className="flex shrink-0 gap-1.5 overflow-x-auto sm:w-44 sm:flex-col">
            {visibleCats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                aria-current={activeCat === c.id}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm transition",
                  activeCat === c.id
                    ? "bg-accent-600/10 font-medium text-accent-900 dark:bg-accent-500/10 dark:text-accent-100"
                    : "hover:bg-stone-200/50 dark:hover:bg-zinc-800/70",
                )}
              >
                <c.icon size={16} className="opacity-70" />
                {c.title}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 space-y-4">
            {activeCat === "profile" && (
              <SettingsPane>
                <div className="flex items-center gap-3">
              <Avatar name={displayName || "?"} url={avatarUrl || undefined} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName || "…"}</p>
                <p className="truncate text-xs opacity-60">@{user?.username}</p>
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium opacity-80">Avatar upload</span>
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload avatar"
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) uploadFile(f);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-3xl border-2 border-dashed px-4 py-3.5 transition",
                  dragOver
                    ? "border-accent-500 bg-accent-500/10"
                    : "border-stone-200 hover:border-accent-500/60 hover:bg-stone-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60",
                )}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
                  {uploading ? <Spinner size={17} /> : <ImagePlus size={17} />}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium">{uploading ? "Uploading…" : dragOver ? "Drop it!" : "Drop an image or click to upload"}</span>
                  <span className="block text-xs opacity-60">jpg · png · webp — max 5MB — 5 changes per 2h</span>
                </span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                  e.target.value = "";
                }}
              />
              {uploadError && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
            </div>
            <Field label="Display name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} required />
            </Field>
            <Field label="Recovery email" hint="Optional. Used only to send you a fresh access key if you lose it.">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" />
            </Field>
              </SettingsPane>
            )}

            {activeCat === "appearance" && (
              <SettingsPane>
            <Field label="Theme">
              <Picker
                ariaLabel="Theme"
                value={theme}
                onChange={setTheme}
                align="left"
                options={[
                  { value: "auto", label: "Auto (follows system)" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </Field>
            <AccentSection />
              </SettingsPane>
            )}

            {activeCat === "features" && (
              <SettingsPane>
            <p className="-mb-2 text-xs opacity-60">Turn composer capabilities on or off. Applied instantly, saved on this device.</p>
            <FeaturesSection />
              </SettingsPane>
            )}

            {activeCat === "security" && (
              <SettingsPane>
                <SecuritySection onKeyRotated={onKeyRotated} />
              </SettingsPane>
            )}
          </div>
        </div>

        {search.trim() && visibleCats.length === 0 && (
          <p className="px-2 py-4 text-center text-sm opacity-50">No settings match “{search.trim()}”.</p>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Settings pane (unified glass card for every category) ---------- */

function SettingsPane({ children }: { children: React.ReactNode }) {
  // Single unified surface for every settings section: flat matte card with
  // one soft shadow — identical gloss on profile, appearance and features.
  return (
    <section className="space-y-4 rounded-3xl border border-stone-200/70 bg-stone-50 p-4 shadow-sm shadow-stone-900/5 dark:border-zinc-800 dark:bg-zinc-800/60 dark:shadow-black/20">
      {children}
    </section>
  );
}

/* ---------- Accent color (settings) ---------- */

function AccentSection() {
  const [state, setState] = useState<AccentState>(() => currentAccent());

  function pick(presetId: string) {
    const next = { ...state, presetId };
    setState(next);
    applyAccent(next);
  }

  function pickCustom(hex: string) {
    const next = { presetId: "custom", customHex: hex };
    setState(next);
    previewAccent(hex);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            aria-label={`Accent: ${p.label}`}
            onClick={() => pick(p.id)}
            className={cn(
              "h-8 w-8 rounded-full border-2 transition active:scale-90",
              state.presetId === p.id
                ? "border-stone-900 dark:border-white"
                : "border-transparent hover:scale-110",
            )}
            style={{ backgroundColor: p.base }}
          />
        ))}
        <label
          className={cn(
            "relative grid h-8 w-8 cursor-pointer place-items-center overflow-hidden rounded-full border-2 transition active:scale-90",
            state.presetId === "custom"
              ? "border-stone-900 dark:border-white"
              : "border-transparent hover:scale-110",
          )}
          style={{ background: state.presetId === "custom" ? state.customHex : undefined }}
          title="Custom color"
        >
          <Sparkles size={14} className={cn("text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]", state.presetId === "custom" && "opacity-0")} />
          <input
            type="color"
            aria-label="Custom accent color"
            value={state.presetId === "custom" ? state.customHex : "#10b981"}
            onChange={(e) => pickCustom(e.target.value)}
            onBlur={() => applyAccent(state)} // persist the last previewed value
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

/* ---------- Features (settings) ---------- */

function FeaturesSection() {
  const flags = useFeatures();
  return (
    <div>
      <div className="space-y-1">
        {FEATURES.map((f) => (
          <label
            key={f.key}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-3 py-2 transition",
              f.ready ? "cursor-pointer hover:bg-stone-100 dark:hover:bg-zinc-800" : "opacity-50",
            )}
          >
            <Toggle
              checked={!!flags[f.key]}
              disabled={!f.ready}
              label={f.label}
              onChange={(v) => setFeature(f.key, v)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {f.label}
                {!f.ready && <span className="ml-1.5 text-xs opacity-60">(soon)</span>}
              </span>
              <span className="block text-xs opacity-60">{f.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ---------- Security (settings): key rotation, TOTP, passkeys ---------- */

function SecuritySection({ onKeyRotated }: { onKeyRotated?: () => void }) {
  const [totpOn, setTotpOn] = useState<boolean | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [armingRotate, setArmingRotate] = useState(false);
  const [armingDelete, setArmingDelete] = useState(false);

  useEffect(() => {
    api.totpStatus().then((r) => setTotpOn(r.enabled)).catch(() => setTotpOn(false));
  }, []);

  async function rotate() {
    if (!armingRotate) {
      setArmingRotate(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.rotateKey();
      setRotatedKey(res.key);
      setArmingRotate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
    } finally {
      setBusy(false);
    }
  }

  async function startTotp() {
    setBusy(true);
    setError("");
    try {
      const res = await api.totpSetup();
      setSecret(res.secret);
      setOtpauthUrl(res.otpauthUrl);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmTotp() {
    if (!secret || code.replace(/\D/g, "").length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await api.totpVerify(secret, code.replace(/\D/g, ""));
      setTotpOn(true);
      setSecret(null);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function disableTotp() {
    if (code.replace(/\D/g, "").length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await api.totpDisable(code.replace(/\D/g, ""));
      setTotpOn(false);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (!armingDelete) {
      setArmingDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.deleteMe();
      onKeyRotated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium"><KeyRound size={14} className="opacity-60" /> Access key</p>
        {rotatedKey ? (
          <div className="rounded-2xl border border-accent-500/40 bg-accent-50 p-3 dark:bg-accent-950/30">
            <p className="mb-2 text-sm font-medium">New key — copy it now, it won't be shown again:</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 text-sm dark:bg-zinc-900">{rotatedKey}</code>
              <CopyButton text={rotatedKey} />
            </div>
            <p className="mt-2 text-xs opacity-70">Your old sessions are revoked. Log back in with the new key.</p>
            <Button size="sm" className="mt-2 w-full" onClick={() => onKeyRotated?.()}>Done — log me out</Button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs opacity-60">Rotate your access key. Old sessions are revoked immediately — you'll log back in with the new key.</p>
            <Button size="sm" variant="secondary" disabled={busy} onClick={rotate}>
              {armingRotate ? "Click again to confirm rotation" : "Rotate my access key"}
            </Button>
          </>
        )}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium"><ShieldCheck size={14} className="opacity-60" /> Two-factor (TOTP)</p>
        {totpOn === null && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> Checking…</p>}
        {totpOn === false && !secret && (
          <>
            <p className="mb-2 text-xs opacity-60">Add a 6-digit code from your authenticator app on top of your access key.</p>
            <Button size="sm" variant="secondary" disabled={busy} onClick={startTotp}>Enable two-factor</Button>
          </>
        )}
        {secret && (
          <div className="space-y-2 rounded-2xl border border-stone-200 p-3 dark:border-zinc-700">
            <p className="text-xs opacity-70">Add this secret to your authenticator app (or open the otpauth link), then enter a code to confirm:</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-xl bg-stone-100 px-3 py-2 font-mono text-sm dark:bg-zinc-800">{secret}</code>
              <CopyButton text={secret} />
            </div>
            <a href={otpauthUrl} className="block truncate text-xs text-accent-700 underline-offset-2 hover:underline dark:text-accent-400">{otpauthUrl}</a>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                aria-label="Authenticator code"
                inputMode="numeric"
                className="text-center tracking-[0.4em]"
              />
              <Button size="sm" disabled={busy || code.length !== 6} onClick={confirmTotp}>Confirm</Button>
            </div>
          </div>
        )}
        {totpOn === true && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-36 flex-1">
              <Field label="Disable with a current code">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  aria-label="Current authenticator code"
                  inputMode="numeric"
                  className="text-center tracking-[0.4em]"
                />
              </Field>
            </div>
            <Button size="sm" variant="secondary" disabled={busy || code.length !== 6} onClick={disableTotp} className="!text-red-600 dark:!text-red-400">
              Disable 2FA
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-2xl px-1 py-1 opacity-50">
        <Fingerprint size={16} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Passkeys <span className="ml-1 text-xs opacity-60">(soon)</span></span>
          <span className="block text-xs opacity-60">WebAuthn / platform authenticators — needs a server RP setup.</span>
        </span>
      </div>

      <div className="rounded-2xl border border-red-500/30 p-3">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
          <Trash2 size={14} /> Danger zone
        </p>
        <p className="mb-2 text-xs opacity-60">Permanently delete your account with all chats, shares and sessions. Cannot be undone.</p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={removeAccount} className="!text-red-600 dark:!text-red-400">
          {armingDelete ? "Click again to permanently delete" : "Delete my account"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
