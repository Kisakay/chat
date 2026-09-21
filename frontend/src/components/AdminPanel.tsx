import { useEffect, useState } from "react";
import { KeyRound, Pencil, RefreshCw, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import type { User } from "../lib/types.ts";
import { Avatar, Button, ConfirmDialog, CopyButton, Field, Input, Modal, Picker, Spinner } from "./ui.tsx";

export function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [freshKey, setFreshKey] = useState<{ username: string; key: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);

  // create form
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const res = await api.adminList();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (open) {
      refresh();
      setShowCreate(false);
      setFreshKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await api.adminCreate({ username: username.trim().toLowerCase(), displayName: displayName.trim() || undefined });
      setFreshKey({ username: res.user.username, key: res.key });
      setUsername("");
      setDisplayName("");
      setShowCreate(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  async function regenerate(u: User) {
    setError("");
    try {
      const res = await api.adminRegenerate(u.id);
      setFreshKey({ username: u.username, key: res.key });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regenerate failed");
    }
  }

  async function remove(u: User) {
    try {
      await api.adminDelete(u.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Accounts" icon={Users} wide>
        <p className="mb-4 text-sm opacity-70">
          No-KYC accounts: you create a username, hand the access key to its owner once. Keys are stored hashed — regenerate to rotate.
        </p>
        {error && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

        {freshKey && (
          <div className="mb-4 rounded-2xl border border-emerald-500/40 bg-emerald-50 p-4 dark:bg-emerald-950/30">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><KeyRound size={15} /> Key for @{freshKey.username} — shown once, copy it now:</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 text-sm dark:bg-zinc-900">{freshKey.key}</code>
              <CopyButton text={freshKey.key} />
            </div>
          </div>
        )}

        {!showCreate ? (
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)} className="mb-3">
            <UserPlus size={15} /> New account
          </Button>
        ) : (
          <form onSubmit={create} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-stone-200 p-3 dark:border-zinc-700">
            <div className="min-w-40 flex-1">
              <Field label="Username"><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="alice" required /></Field>
            </div>
            <div className="min-w-40 flex-1">
              <Field label="Display name"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alice" /></Field>
            </div>
            <Button size="sm" type="submit">Create</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
          </form>
        )}

        {busy ? (
          <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={15} /> Loading…</p>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-2xl border border-stone-200/70 px-3.5 py-2.5 dark:border-zinc-800">
                <Avatar name={u.displayName} url={u.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.displayName} <span className="font-normal opacity-50">@{u.username}</span></p>
                  <p className="text-xs opacity-50">theme: {u.theme} · since {new Date(u.createdAt).toLocaleDateString()}</p>
                </div>
                {!u.isAdmin && (
                  <div className="flex shrink-0 gap-1">
                    <button title="Edit profile" onClick={() => setEditTarget(u)} className="rounded-full p-2 transition hover:bg-stone-100 dark:hover:bg-zinc-800"><Pencil size={15} /></button>
                    <button title="Regenerate key (revokes old sessions)" onClick={() => regenerate(u)} className="rounded-full p-2 transition hover:bg-stone-100 dark:hover:bg-zinc-800"><RefreshCw size={15} /></button>
                    <button title="Delete account" onClick={() => setDeleteTarget(u)} className="rounded-full p-2 text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"><Trash2 size={15} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Delete @${deleteTarget?.username}?`}
        message="This permanently removes the account, all its conversations and its shares."
        onConfirm={() => deleteTarget && remove(deleteTarget)}
      />

      <EditUserDialog user={editTarget} onClose={() => setEditTarget(null)} onSaved={refresh} />
    </>
  );
}

function EditUserDialog({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [theme, setTheme] = useState("auto");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setAvatarUrl(user.avatarUrl);
      setTheme(user.theme);
      setError("");
    }
  }, [user]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    try {
      await api.adminPatch(user.id, { displayName: displayName.trim(), avatarUrl: avatarUrl.trim(), theme });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Modal open={user !== null} onClose={onClose} title={`Edit @${user?.username}`} icon={Pencil}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Display name"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} required /></Field>
        <Field label="Avatar URL"><Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Theme">
          <Picker
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            align="left"
            options={[
              { value: "auto", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Field>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  );
}
