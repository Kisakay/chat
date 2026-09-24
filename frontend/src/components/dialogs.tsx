import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Eye, Fingerprint, Globe, FileText, ImagePlus, KeyRound, Link2, Mail, Mic, Palette, Pencil, Play, Plug, ScanText, Search, Settings2, ShieldCheck, Sparkles, Square, Tag, Trash2, Unplug, User as UserIcon, Volume2, X } from "lucide-react";
import { api, type UserProvider, type VoicePreview } from "../lib/api.ts";
import { pushToast } from "../lib/toasts.ts";
import { cn } from "../lib/cn.ts";
import { ACCENT_PRESETS, applyAccent, currentAccent, previewAccent, type AccentState } from "../lib/accent.ts";
import { detectLang, getVoicePrefs, listTtsVoices, pickVoice, setVoicePrefs, speakPreview, stopSpeak, ttsSupported, type VoicePrefs } from "../lib/voice.ts";
import { FEATURES, setFeature, useFeatures } from "../lib/features.ts";
import type { Conversation, FilePreview, User } from "../lib/types.ts";
import { useT, type StringKey } from "../lib/i18n.ts";
import { Avatar, bumpCdnVersion, Button, ConfirmDialog, CopyButton, Field, Input, LangPicker, Modal, Picker, Spinner, Toggle } from "./ui.tsx";

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
  const { t } = useT();
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
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={conv !== null} onClose={onClose} title={t("dlg.editConv")} icon={Pencil}>
      <form onSubmit={save} className="space-y-4">
        <Field label={t("dlg.fTitle")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </Field>
        <Field label={t("dlg.fTopic")} hint={t("dlg.topicHint")}>
          <div className="relative">
            <Tag size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
            <Input className="pl-10" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder={t("dlg.noTopic")} />
          </div>
        </Field>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Key recovery ---------- */

export function RecoverDialog({ open, onClose, from }: { open: boolean; onClose: () => void; from?: string }) {
  const { t } = useT();
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
      setError(err instanceof Error ? err.message : t("dlg.reqFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("dlg.recoverTitle")} icon={Mail} wide>
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm opacity-80">
            {t("dlg.recoverSent", {
              user: username.trim().toLowerCase() || "…",
              fromPart: from ? t("dlg.recoverSentFrom", { from }) : "",
            })}
          </p>
          <p className="rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm opacity-90 dark:bg-amber-500/10">
            {t("dlg.spamNote")}
          </p>
          <p className="text-sm opacity-70">
            {t("dlg.noMailNote")}
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>{t("common.done")}</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm opacity-70">
            {t("dlg.recoverIntro")}
          </p>
          <Field label={t("common.username")}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="alice" required />
          </Field>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose}>{t("common.cancel")}</Button>
            <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : t("dlg.sendLink")}</Button>
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
  const { t } = useT();
  const [text, setText] = useState("");

  useEffect(() => {
    if (preview) setText(preview.text);
  }, [preview]);

  const isOcr = preview?.kind === "ocr";

  return (
    <Modal
      open={preview !== null}
      onClose={onClose}
      title={isOcr ? t("dlg.reviewOcr") : t("dlg.reviewText")}
      icon={isOcr ? ScanText : FileText}
      wide
    >
      {busy ? (
        <p className="flex items-center gap-2 py-8 text-sm opacity-70">
          <Spinner size={16} />
          {isOcr ? t("dlg.transcribing") : t("dlg.uploadingTools")}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="rounded-2xl bg-accent-600/10 px-4 py-2.5 text-sm opacity-90">
            {isOcr ? t("dlg.ocrExpl") : t("dlg.textExpl")}
          </p>
          {preview?.truncated && (
            <p className="rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm">{t("dlg.truncWarn")}</p>
          )}
          <textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full resize-y rounded-2xl border border-stone-200 bg-stone-50 p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-accent-500 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs opacity-60">{preview?.name} · {t("dlg.chars", { n: text.length.toLocaleString() })}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => onAttach(text)} disabled={!text.trim()}>{t("dlg.attachBtn")}</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Share ---------- */

export function ShareModal({ conv, onClose }: { conv: Conversation | null; onClose: () => void }) {
  const { t } = useT();
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
      .catch((err) => setError(err instanceof Error ? err.message : t("dlg.reqFailed")))
      .finally(() => setBusy(false));
  }, [conv]);

  async function unshare() {
    if (!conv) return;
    await api.unshare(conv.id);
    pushToast(t("toast.unshared"), { icon: "unshare" });
    onClose();
  }

  return (
    <Modal open={conv !== null} onClose={onClose} title={t("dlg.shareTitle")} icon={Globe}>
      {busy && <p className="flex items-center gap-2 text-sm opacity-70"><Spinner size={15} /> {t("dlg.shareCreating")}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {url && (
        <div className="space-y-4">
          <p className="text-sm opacity-70">{t("dlg.shareIntro", { title: conv?.title ?? "" })}</p>
          <div className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <Link2 size={15} className="shrink-0 opacity-50" />
            <span className="min-w-0 flex-1 truncate">{url}</span>
            <CopyButton text={url} />
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={unshare}><Unplug size={15} /> {t("dlg.unshare")}</Button>
            <Button size="sm" onClick={onClose}>{t("common.done")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Settings (profile) ---------- */

export function SettingsModal({
  user,
  usernameChangeEnabled = true,
  onClose,
  onSaved,
  onKeyRotated,
  onViewArchived,
  onArchivedChanged,
  onProvidersChanged,
}: {
  user: User | null;
  usernameChangeEnabled?: boolean;
  onClose: () => void;
  onSaved: (u: User) => void;
  onKeyRotated?: () => void;
  onViewArchived: (c: Conversation) => void;
  onArchivedChanged: (deletedId?: string) => void;
  onProvidersChanged?: () => void;
}) {
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [email, setEmail] = useState("");
  const [theme, setTheme] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedUrl, setStagedUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Object URLs must be revoked or they leak; the ref mirrors the latest
  // staged URL so unmount/close cleanup always revokes the right one.
  const stagedUrlRef = useRef<string | null>(null);

  function discardStaged() {
    if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
    stagedUrlRef.current = null;
    setStagedUrl(null);
    setStagedFile(null);
  }

  // Two-column settings: categories on the left, content on the right.
  // Searching filters the category list and jumps to the first match.
  const CATS = [
    { id: "profile", title: t("settings.profile"), icon: UserIcon, keywords: ["profile", "avatar", "picture", "photo", "name", "username", "login", "display", "email", "account"] },
    { id: "appearance", title: t("settings.appearance"), icon: Palette, keywords: ["appearance", "theme", "dark", "light", "color", "colour", "accent", "palette", "language", "langue", "idioma", "lingua", "язык"] },
    { id: "features", title: t("settings.features"), icon: Sparkles, keywords: ["features", "thinking", "attachments", "search", "deep", "upload", "ocr", "capabilities", "enable", "disable"] },
    { id: "voice", title: t("voice.title"), icon: Mic, keywords: ["voice", "voix", "voz", "speech", "tts", "audio", "speak", "listen", "language", "langue", "accent", "parler"] },
    { id: "security", title: t("settings.security"), icon: ShieldCheck, keywords: ["security", "key", "rotate", "password", "totp", "2fa", "two", "factor", "authenticator", "passkey", "webauthn"] },
    { id: "providers", title: t("settings.providers"), icon: Plug, keywords: ["providers", "provider", "api", "keys", "openai", "anthropic", "deepseek", "gemini", "byok", "model", "fournisseur", "proveedor", "провайдер"] },
    { id: "archived", title: t("archived.title"), icon: Archive, keywords: ["archived", "archive", "old", "hidden", "read-only", "readonly", "archiv"] },
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
      setUsername(user.username);
      setDisplayName(user.displayName);
      setAvatarUrl(user.avatarUrl);
      setEmail(user.email);
      setTheme(user.theme);
      setError("");
      setUploadError("");
      setSearch("");
      discardStaged();
    } else {
      // Modal closed (Save, Cancel, Escape, backdrop): drop the staged file
      // so the next open previews the saved avatar again.
      discardStaged();
    }
  }, [user]);

  // Safety net: revoke the object URL if the component unmounts mid-stage.
  useEffect(() => () => {
    if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
  }, []);

  // Staging is preview-only: no bytes leave the browser until Save.
  // (The CDN path is fixed per account, so PUTing early would publish the
  // picture immediately and Cancel could never undo it.)
  function stageFile(f: File) {
    if (!user) return;
    if (f.size > 5 * 1024 * 1024) {
      setUploadError(t("sec.avatarTooBig"));
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setUploadError(t("sec.avatarType"));
      return;
    }
    setUploadError("");
    if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
    const url = URL.createObjectURL(f);
    stagedUrlRef.current = url;
    setStagedFile(f);
    setStagedUrl(url);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    setError("");
    try {
      // Save is the only point that touches the network for the avatar:
      // push the staged bytes first, then persist the resulting URL.
      let url = avatarUrl.trim();
      if (stagedFile) {
        try {
          const up = await api.uploadAvatar(user.id, stagedFile);
          url = up.url;
          // Same CDN path every upload -> bump the version so every <Avatar>
          // (sidebar, chat bubbles) re-fetches the new bytes immediately.
          bumpCdnVersion();
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : t("attach.uploadFailed"));
          setBusy(false);
          return;
        }
        discardStaged();
      }
      const normalizedUsername = username.trim().toLowerCase();
      // Only send fields that actually changed: this isolates a
      // username error (e.g. admin rename guard) from the rest of the
      // profile so one rejected field can't block the whole save.
      const patch: { username?: string; displayName?: string; avatarUrl?: string; email?: string; theme?: string } = {};
      if (normalizedUsername !== (user.username ?? "").toLowerCase()) patch.username = normalizedUsername;
      if (displayName.trim() !== (user.displayName ?? "")) patch.displayName = displayName.trim();
      if (url !== (user.avatarUrl ?? "")) patch.avatarUrl = url;
      if (email.trim() !== (user.email ?? "")) patch.email = email.trim();
      if (theme !== (user.theme ?? "auto")) patch.theme = theme;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      const res = await api.updateMe(patch);
      onSaved(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={user !== null} onClose={onClose} title={t("settings.title")} icon={Settings2} wide>
      <div className="space-y-4">
        {/* Filter UI lives OUTSIDE the data <form> on purpose: when the
            Providers pane mounts its password fields, browsers and
            password-manager extensions must not mistake this filter for
            the login username field (autofilling e.g. "admin" into it and
            popping their search menu over the modal). */}
        <div className="relative" role="search">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder={t("settings.searchPh")}
            aria-label={t("settings.searchAria")}
            name="ka-settings-search"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-2xl border border-stone-200/70 bg-stone-100 py-2 pl-9 pr-8 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent-500/60 focus:bg-white dark:border-zinc-800 dark:bg-zinc-800/60 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900"
          />
          {search && (
            <button
              type="button"
              aria-label={t("settings.clearSearch")}
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <form onSubmit={save} className="space-y-4">
        {search.trim() && visibleCats.length === 0 ? (
          <div className="space-y-2 px-2 py-4 text-center">
            <p className="text-sm opacity-50">{t("settings.noMatch", { q: search.trim() })}</p>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-sm transition hover:bg-stone-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {t("settings.clearSearch")}
            </button>
          </div>
        ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <nav aria-label="Settings categories" className="flex shrink-0 gap-1.5 overflow-x-auto sm:w-44 sm:flex-col">
            {visibleCats.map((c) => (
              <button
                key={c.id}
                type="button"
                // Picking a category exits search mode: keeping the query
                // would leave the nav filtered (often down to this single
                // button, or empty) and trap the user in the search view.
                onClick={() => { setCat(c.id); setSearch(""); }}
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
              <Avatar name={displayName || "?"} url={stagedUrl ?? avatarUrl ?? undefined} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName || "…"}</p>
                <p className="truncate text-xs opacity-60">@{user?.username}</p>
              </div>
              {stagedUrl && (
                <button
                  type="button"
                  onClick={discardStaged}
                  aria-label={t("common.cancel")}
                  title={t("common.cancel")}
                  className="rounded-full p-1.5 transition hover:bg-stone-200/60 dark:hover:bg-zinc-800"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium opacity-80">{t("settings.avatarUpload")}</span>
              <div
                role="button"
                tabIndex={0}
                aria-label={t("settings.avatarUpload")}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) stageFile(f);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-3xl border-2 border-dashed px-4 py-3.5 transition",
                  dragOver
                    ? "border-accent-500 bg-accent-500/10"
                    : "border-stone-200 hover:border-accent-500/60 hover:bg-stone-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60",
                )}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
                  <ImagePlus size={17} />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium">{dragOver ? t("settings.dropActive") : t("settings.dropIdle")}</span>
                  <span className="block text-xs opacity-60">{t("settings.avatarHint")}</span>
                </span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) stageFile(f);
                  e.target.value = "";
                }}
              />
              {uploadError && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
            </div>
            <Field label={t("settings.username")} hint={usernameChangeEnabled ? t("settings.usernameHint") : t("settings.usernameDisabled")}>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} required autoComplete="username" disabled={user?.username === "admin" || !usernameChangeEnabled} />
            </Field>
            <Field label={t("common.displayName")}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} required autoComplete="nickname" />
            </Field>
            <Field label={t("settings.email")} hint={t("settings.emailHint")}>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoComplete="email" />
            </Field>
              </SettingsPane>
            )}

            {activeCat === "appearance" && (
              <SettingsPane>
            <Field label={t("common.theme")}>
              <Picker
                ariaLabel={t("common.theme")}
                value={theme}
                onChange={setTheme}
                align="left"
                options={[
                  { value: "auto", label: t("common.themeAutoFull") },
                  { value: "sunset", label: t("common.themeSunsetFull") },
                  { value: "light", label: t("common.light") },
                  { value: "dark", label: t("common.dark") },
                ]}
              />
            </Field>
            <Field label={t("settings.language")} hint={t("settings.languageHint")}>
              <LangPicker align="left" />
            </Field>
            <AccentSection />
              </SettingsPane>
            )}

            {activeCat === "features" && (
              <SettingsPane>
            <p className="-mb-2 text-xs opacity-60">{t("settings.featHint")}</p>
            <FeaturesSection />
              </SettingsPane>
            )}

            {activeCat === "voice" && (
              <SettingsPane>
                <VoiceSection />
              </SettingsPane>
            )}

            {activeCat === "security" && (
              <SettingsPane>
                <SecuritySection onKeyRotated={onKeyRotated} />
              </SettingsPane>
            )}

            {activeCat === "providers" && (
              <SettingsPane>
                <ProvidersSection onChanged={onProvidersChanged} />
              </SettingsPane>
            )}

            {activeCat === "archived" && (
              <SettingsPane>
                <ArchivedSection onView={onViewArchived} onChanged={onArchivedChanged} />
              </SettingsPane>
            )}
          </div>
        </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : t("common.save")}</Button>
        </div>
        </form>
      </div>
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

/* ---------- Archived chats (settings): view, unarchive, delete ---------- */

function ArchivedSection({ onView, onChanged }: { onView: (c: Conversation) => void; onChanged: (deletedId?: string) => void }) {
  const { t } = useT();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  async function refresh() {
    try {
      const res = await api.archivedConvs();
      setList(res.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadFailed"));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unarchive(c: Conversation) {
    setBusyId(c.id);
    setError("");
    try {
      await api.unarchiveConv(c.id);
      await refresh();
      onChanged();
      pushToast(t("toast.chatUnarchived", { title: c.title }), { icon: "unarchive" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: Conversation) {
    setBusyId(c.id);
    setError("");
    try {
      await api.deleteConv(c.id);
      setDeleteTarget(null);
      await refresh();
      onChanged(c.id);
      pushToast(t("toast.chatDeleted", { title: c.title }), { icon: "trash" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.deleteFailed"));
    } finally {
      setBusyId(null);
    }
  }

  if (list === null && !error) {
    return <p className="flex items-center gap-2 py-4 text-sm opacity-60"><Spinner size={15} /> {t("common.loading")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed opacity-60">{t("archived.readonly")}</p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {(list ?? []).length === 0 ? (
        <p className="py-4 text-center text-sm opacity-50">{t("archived.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {(list ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-2xl border border-stone-200/70 px-3.5 py-2.5 dark:border-zinc-800">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-600/10 text-accent-600 dark:text-accent-400">
                <Archive size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="truncate text-xs opacity-50">{new Date(c.updated_at).toLocaleDateString()}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  title={t("archived.view")}
                  aria-label={`${t("archived.view")}: ${c.title}`}
                  onClick={() => onView(c)}
                  className="rounded-full p-2 transition hover:bg-stone-100 dark:hover:bg-zinc-800"
                >
                  <Eye size={15} />
                </button>
                <button
                  type="button"
                  title={t("archived.unarchive")}
                  aria-label={`${t("archived.unarchive")}: ${c.title}`}
                  disabled={busyId === c.id}
                  onClick={() => unarchive(c)}
                  className="rounded-full p-2 transition hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                >
                  <ArchiveRestore size={15} />
                </button>
                <button
                  type="button"
                  title={t("common.delete")}
                  aria-label={`${t("common.delete")}: ${c.title}`}
                  disabled={busyId === c.id}
                  onClick={() => setDeleteTarget(c)}
                  className="rounded-full p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("archived.deleteTitle")}
        message={t("archived.deleteMsg")}
        confirmLabel={t("common.delete")}
        onConfirm={() => deleteTarget && remove(deleteTarget)}
      />
    </div>
  );
}

/* ---------- Accent color (settings) ---------- */

function AccentSection() {
  const { t } = useT();
  const [state, setState] = useState<AccentState>(() => currentAccent());

  function pick(presetId: string) {
    const next = { ...state, presetId };
    setState(next);
    applyAccent(next);
    pushToast(t("toast.accentChanged"), { icon: "accent", tag: "accent" });
  }

  function pickCustom(hex: string) {
    const next = { presetId: "custom", customHex: hex };
    setState(next);
    previewAccent(hex);
    pushToast(t("toast.accentChanged"), { icon: "accent", tag: "accent" });
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium opacity-80">{t("settings.accent")}</span>
      <p className="mb-2 text-xs opacity-60">{t("settings.accentHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={t(`accent.preset.${p.id}` as StringKey)}
            aria-label={t("settings.accentAria", { label: t(`accent.preset.${p.id}` as StringKey) })}
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
          title={t("settings.customColor")}
        >
          <Sparkles size={14} className={cn("text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]", state.presetId === "custom" && "opacity-0")} />
          <input
            type="color"
            aria-label={t("settings.customAria")}
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
  const { t } = useT();
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
              label={t(`feat.${f.key}.label` as StringKey)}
              onChange={(v) => setFeature(f.key, v)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {t(`feat.${f.key}.label` as StringKey)}
                {!f.ready && <span className="ml-1.5 text-xs opacity-60">{t("feat.soon")}</span>}
              </span>
              <span className="block text-xs opacity-60">{t(`feat.${f.key}.hint` as StringKey)}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ---------- Voice (settings): playback voice, language, previews ---------- */

const VOICE_LANGS = ["auto", "fr", "en", "es", "de", "it", "pt", "ru"];

function VoiceSection() {
  const { t } = useT();
  const [prefs, setPrefs] = useState<VoicePrefs>(() => getVoicePrefs());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [previews, setPreviews] = useState<VoicePreview[]>([]);
  const [playing, setPlaying] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    listTtsVoices().then((v) => { if (alive) setVoices(v); });
    api.tools().then((r) => { if (alive) setPreviews(r.voicePreviews); }).catch(() => {});
    return () => { alive = false; stopSpeak(); };
  }, []);

  function update(p: Partial<VoicePrefs>) {
    const next = { ...prefs, ...p };
    setPrefs(next);
    setVoicePrefs(next);
  }

  function preview(i: number, line: VoicePreview) {
    if (playing === i) {
      stopSpeak();
      setPlaying(null);
      return;
    }
    // Each line plays with ITS OWN character (timbre/rate/pitch/lang) —
    // never the global playback prefs.
    const pick = speakPreview(line.text, line, voices, {
      onend: () => setPlaying(null),
      onerror: () => setPlaying(null),
    });
    if (pick || ttsSupported()) setPlaying(i);
  }

  /** Adopt a preview's character as the global playback voice. */
  function adoptVoice(line: VoicePreview) {
    const lang = line.lang === "auto" ? detectLang(line.text) : line.lang;
    const pick = pickVoice(voices, { lang, timbre: line.timbre });
    const next: VoicePrefs = {
      voiceURI: pick?.voiceURI ?? prefs.voiceURI,
      rate: line.rate,
      pitch: line.pitch,
      lang,
    };
    setPrefs(next);
    setVoicePrefs(next);
    pushToast(t("voice.adopted"), { icon: "check" });
  }

  const supported = ttsSupported();
  const groups = (() => {
    const byLang = new Map<string, SpeechSynthesisVoice[]>();
    for (const v of voices) {
      const lang = (v.lang || "?").split("-")[0]!.toLowerCase();
      const list = byLang.get(lang) ?? [];
      list.push(v);
      byLang.set(lang, list);
    }
    return [...byLang.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, options]) => ({
      group,
      options: options.map((v) => ({ value: v.voiceURI, label: v.name + (v.default ? " ★" : "") })),
    }));
  })();

  return (
    <div className="space-y-4">
      <p className="-mb-2 text-xs opacity-60">{t("voice.desc")}</p>
      {!supported && (
        <p className="rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400" role="alert">
          {t("voice.noVoices")}
        </p>
      )}
      <Field label={t("voice.language")}>
        <Picker
          ariaLabel={t("voice.language")}
          icon={Globe}
          value={prefs.lang}
          onChange={(v) => update({ lang: v, voiceURI: null })}
          align="left"
          options={VOICE_LANGS.map((l) => ({ value: l, label: l === "auto" ? t("voice.auto") : l }))}
        />
      </Field>
      <Field label={t("voice.voice")}>
        <Picker
          ariaLabel={t("voice.voice")}
          icon={Volume2}
          value={prefs.voiceURI ?? ""}
          onChange={(v) => update({ voiceURI: v || null })}
          align="left"
          groups={[{ group: "—", options: [{ value: "", label: t("voice.defaultVoice") }] }, ...groups]}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`${t("voice.rate")} · ${prefs.rate.toFixed(2)}×`}>
          <input
            type="range" min={0.5} max={1.5} step={0.05} value={prefs.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
            className="w-full accent-[rgb(var(--ka-accent-600))]"
            aria-label={t("voice.rate")}
          />
        </Field>
        <Field label={`${t("voice.pitch")} · ${prefs.pitch.toFixed(2)}×`}>
          <input
            type="range" min={0.5} max={1.5} step={0.05} value={prefs.pitch}
            onChange={(e) => update({ pitch: Number(e.target.value) })}
            className="w-full accent-[rgb(var(--ka-accent-600))]"
            aria-label={t("voice.pitch")}
          />
        </Field>
      </div>
      {previews.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider opacity-50">{t("voice.previews")}</p>
          <ul className="space-y-1.5">
            {previews.map((line, i) => (
              <li key={i} className="flex items-center gap-2 rounded-2xl border border-stone-200/70 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => preview(i, line)}
                  disabled={!supported}
                  aria-label={`${t("voice.preview")} ${i + 1}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-600 text-white transition hover:bg-accent-500 disabled:opacity-40 dark:bg-accent-500 dark:text-zinc-950"
                >
                  {playing === i ? <Square size={13} /> : <Play size={13} className="translate-x-[1px]" />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{line.text}</span>
                  <span className="block text-xs opacity-50">
                    {t(`voice.timbre.${line.timbre}` as StringKey)} · {(line.lang === "auto" ? detectLang(line.text) : line.lang).toUpperCase()} · {line.rate.toFixed(2)}× / {line.pitch.toFixed(2)}×
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => adoptVoice(line)}
                  disabled={!supported}
                  title={t("voice.adopt")}
                  aria-label={`${t("voice.adopt")} ${i + 1}`}
                  className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-accent-700 transition hover:bg-accent-600/10 disabled:opacity-40 dark:text-accent-400"
                >
                  {t("voice.adopt")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- Security (settings): key rotation, TOTP, passkeys ---------- */

function SecuritySection({ onKeyRotated }: { onKeyRotated?: () => void }) {
  const { t } = useT();
  const [totpOn, setTotpOn] = useState<boolean | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [armingRotate, setArmingRotate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      setError(err instanceof Error ? err.message : t("sec.rotationFailed"));
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
      setError(err instanceof Error ? err.message : t("sec.setupFailed"));
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
      setError(err instanceof Error ? err.message : t("login.totpInvalid"));
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
      setError(err instanceof Error ? err.message : t("login.totpInvalid"));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    setBusy(true);
    setError("");
    try {
      await api.deleteMe();
      setConfirmDelete(false);
      onKeyRotated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sec.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium"><KeyRound size={14} className="opacity-60" /> {t("sec.accessKey")}</p>
        <p className="mb-2 text-xs opacity-60">{t("sec.accessKeyHint")}</p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={rotate}>
          {armingRotate ? t("sec.rotateConfirm") : t("sec.rotate")}
        </Button>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium"><ShieldCheck size={14} className="opacity-60" /> {t("sec.totp")}</p>
        {totpOn === null && <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={14} /> {t("sec.totpChecking")}</p>}
        {totpOn === false && !secret && (
          <>
            <p className="mb-2 text-xs opacity-60">{t("sec.totpAddHint")}</p>
            <Button size="sm" variant="secondary" disabled={busy} onClick={startTotp}>{t("sec.totpEnable")}</Button>
          </>
        )}
        {secret && (
          <div className="space-y-2 rounded-2xl border border-stone-200 p-3 dark:border-zinc-700">
            <p className="text-xs opacity-70">{t("sec.totpSecretHint")}</p>
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
                aria-label={t("login.totpAria")}
                inputMode="numeric"
                className="text-center tracking-[0.4em]"
              />
              <Button size="sm" disabled={busy || code.length !== 6} onClick={confirmTotp}>{t("sec.totpConfirm")}</Button>
            </div>
          </div>
        )}
        {totpOn === true && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-36 flex-1">
              <Field label={t("sec.totpDisableLabel")}>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  aria-label={t("login.totpAria")}
                  inputMode="numeric"
                  className="text-center tracking-[0.4em]"
                />
              </Field>
            </div>
            <Button size="sm" variant="secondary" disabled={busy || code.length !== 6} onClick={disableTotp} className="!text-red-600 dark:!text-red-400">
              {t("sec.totpDisable")}
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-2xl px-1 py-1 opacity-50">
        <Fingerprint size={16} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t("sec.passkeys")} <span className="ml-1 text-xs opacity-60">{t("feat.soon")}</span></span>
          <span className="block text-xs opacity-60">{t("sec.passkeysHint")}</span>
        </span>
      </div>

      <div className="rounded-2xl border border-red-500/30 p-3">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
          <Trash2 size={14} /> {t("sec.danger")}
        </p>
        <p className="mb-2 text-xs opacity-60">{t("sec.dangerHint")}</p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmDelete(true)} className="!text-red-600 dark:!text-red-400">
          {t("sec.deleteMe")}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={rotatedKey !== null} onClose={() => {}} title={t("sec.newKeyTitle")} icon={KeyRound}>
        <div className="space-y-4">
          <p className="text-sm opacity-80">{t("sec.newKeyHint")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-2xl bg-stone-100 px-3 py-2.5 font-mono text-sm dark:bg-zinc-800">{rotatedKey}</code>
            {rotatedKey && <CopyButton text={rotatedKey} />}
          </div>
          <Button size="sm" className="w-full" onClick={() => onKeyRotated?.()}>{t("sec.newKeyDone")}</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={removeAccount}
        title={t("sec.deleteTitle")}
        message={t("sec.deleteMsg")}
        confirmLabel={t("sec.deleteForever")}
      />
    </div>
  );
}

/* ---------- Providers (settings): personal API keys (BYOK) ---------- */

const PROVIDER_META: { id: string; label: string; docs: string }[] = [
  { id: "openai", label: "OpenAI", docs: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", docs: "https://console.anthropic.com/settings/keys" },
  { id: "deepseek", label: "DeepSeek", docs: "https://platform.deepseek.com/api_keys" },
  { id: "gemini", label: "Gemini", docs: "https://aistudio.google.com/apikey" },
];

function ProvidersSection({ onChanged }: { onChanged?: () => void }) {
  const { t } = useT();
  const [list, setList] = useState<UserProvider[] | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  // Connected providers show a greyed-out (disabled) key field; "Replace"
  // unlocks it for rotation.
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    try {
      const res = await api.providers();
      setList(res.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("providers.loadFailed"));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(id: string) {
    const v = (keys[id] ?? "").trim();
    if (v.length < 8 || v.length > 256 || /\s/.test(v)) {
      setError(t("providers.invalidKey"));
      return;
    }
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const res = await api.setProvider(id, v);
      setList(res.providers);
      setKeys((k) => ({ ...k, [id]: "" }));
      setEditing((e) => ({ ...e, [id]: false }));
      setNotice(t("providers.keySaved"));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const res = await api.deleteProvider(id);
      setList(res.providers);
      setEditing((e) => ({ ...e, [id]: false }));
      setNotice(t("providers.keyRemoved"));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.deleteFailed"));
    } finally {
      setBusyId(null);
    }
  }

  if (list === null && !error) {
    return <p className="flex items-center gap-2 py-4 text-sm opacity-60"><Spinner size={15} /> {t("common.loading")}</p>;
  }

  const byId = new Map((list ?? []).map((p) => [p.provider, p]));

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed opacity-60">{t("providers.intro")}</p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="rounded-2xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      <ul className="space-y-2">
        {PROVIDER_META.map((m) => {
          const st = byId.get(m.id);
          const connected = !!st?.hasKey;
          const busy = busyId === m.id;
          // A stored key locks the field (greyed out) until "Replace".
          const locked = connected && !editing[m.id];
          return (
            <li key={m.id} className="space-y-2.5 rounded-2xl border border-stone-200/70 p-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    connected ? "bg-emerald-500" : "bg-stone-300 dark:bg-zinc-600",
                  )}
                />
                <span className="text-sm font-medium">{m.label}</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  connected
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-stone-200/70 opacity-60 dark:bg-zinc-800",
                )}>
                  {connected ? t("providers.connected") : t("providers.notConnected")}
                </span>
                {connected && st?.last4 && (
                  <code className="rounded-lg bg-stone-100 px-2 py-0.5 font-mono text-xs opacity-70 dark:bg-zinc-800">
                    ••••{st.last4}
                  </code>
                )}
                {connected ? (
                  <span className="ml-auto shrink-0 cursor-not-allowed text-xs opacity-40">
                    {t("providers.getKey")}
                  </span>
                ) : (
                  <a
                    href={m.docs}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto shrink-0 text-xs text-accent-700 underline-offset-2 hover:underline dark:text-accent-400"
                  >
                    {t("providers.getKey")}
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  // API keys are not login credentials: tell browsers and
                  // password-manager extensions to leave these fields alone
                  // (no username fill, no inline search menu, no save prompt).
                  // Note: plain "off" is deliberately ignored by browsers on
                  // password fields — "new-password" is the token they honor.
                  autoComplete="new-password"
                  name={`ka-provider-key-${m.id}`}
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  spellCheck={false}
                  value={locked ? "" : (keys[m.id] ?? "")}
                  onChange={(e) => setKeys((k) => ({ ...k, [m.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !locked) {
                      e.preventDefault();
                      save(m.id);
                    }
                  }}
                  placeholder={locked && st?.last4 ? `••••${st.last4}` : t("providers.keyPh")}
                  aria-label={`${m.label} API key`}
                  disabled={busy || locked}
                  className="disabled:cursor-not-allowed disabled:bg-stone-100 disabled:opacity-60 dark:disabled:bg-zinc-800"
                />
                {!locked && (
                  <Button
                    size="sm"
                    disabled={busy || !(keys[m.id] ?? "").trim()}
                    onClick={() => save(m.id)}
                    className="shrink-0"
                  >
                    {busy ? <Spinner size={15} /> : t("providers.saveKey")}
                  </Button>
                )}
              </div>
              {connected && (
                <div className="flex justify-end gap-1">
                  {locked ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setEditing((e) => ({ ...e, [m.id]: true }))}
                    >
                      <Pencil size={14} /> {t("providers.replaceKey")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditing((e) => ({ ...e, [m.id]: false }));
                        setKeys((k) => ({ ...k, [m.id]: "" }));
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => remove(m.id)}
                    className="!text-red-600 dark:!text-red-400"
                  >
                    <Trash2 size={14} /> {t("providers.removeKey")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-relaxed opacity-60">{t("providers.hint")}</p>
    </div>
  );
}
