import { useEffect, useRef, useState } from "react";
import { Globe, ImagePlus, Link2, Pencil, Settings2, Tag, Unplug } from "lucide-react";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import type { Conversation, User } from "../lib/types.ts";
import { Avatar, Button, CopyButton, Field, Input, Modal, Picker, Spinner } from "./ui.tsx";

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
}: {
  user: User | null;
  onClose: () => void;
  onSaved: (u: User) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [theme, setTheme] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setAvatarUrl(user.avatarUrl);
      setTheme(user.theme);
      setError("");
      setUploadError("");
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
      const res = await api.updateMe({ displayName: displayName.trim(), avatarUrl: avatarUrl.trim(), theme });
      onSaved(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={user !== null} onClose={onClose} title="Profile & appearance" icon={Settings2}>
      <form onSubmit={save} className="space-y-4">
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
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-stone-200 hover:border-emerald-500/60 hover:bg-stone-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60",
            )}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
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
        <Field label="Avatar URL" hint="Host an image on catbox.moe (or anywhere) and paste the direct link here. Empty = initials.">
          <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" inputMode="url" />
        </Field>
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
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={busy}>{busy ? <Spinner size={15} /> : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
