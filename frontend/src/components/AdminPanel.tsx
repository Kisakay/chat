import { useEffect, useState, type FC, type ReactNode } from "react";
import { ArrowUpDown, Bot, ChevronLeft, ChevronRight, Download, Filter, HardDrive, KeyRound, Pencil, RefreshCw, Search, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api.ts";
import type { DriverModel, User } from "../lib/types.ts";
import { useT, type StringKey } from "../lib/i18n.ts";
import { Avatar, Button, ConfirmDialog, CopyButton, Field, IconButton, Input, Modal, Picker, Spinner } from "./ui.tsx";

/** Curated Ollama library catalog (admin downloads only). Descriptions resolve via i18n (`ollama.cat.*`). */
const OLLAMA_CATALOG: { name: string; catKey: StringKey; sizes: string[] }[] = [
  { name: "llama3.2", catKey: "ollama.cat.llama3_2", sizes: ["1b", "3b"] },
  { name: "llama3.1", catKey: "ollama.cat.llama3_1", sizes: ["8b", "70b"] },
  { name: "qwen2.5", catKey: "ollama.cat.qwen2_5", sizes: ["0.5b", "1.5b", "7b", "14b", "32b"] },
  { name: "gemma2", catKey: "ollama.cat.gemma2", sizes: ["2b", "9b", "27b"] },
  { name: "mistral", catKey: "ollama.cat.mistral", sizes: ["7b"] },
  { name: "phi3", catKey: "ollama.cat.phi3", sizes: ["3.8b", "14b"] },
  { name: "deepseek-r1", catKey: "ollama.cat.deepseek_r1", sizes: ["1.5b", "7b", "8b", "14b", "32b"] },
  { name: "codellama", catKey: "ollama.cat.codellama", sizes: ["7b", "13b", "34b"] },
  { name: "llava", catKey: "ollama.cat.llava", sizes: ["7b", "13b", "34b"] },
  { name: "nomic-embed-text", catKey: "ollama.cat.nomic_embed_text", sizes: [] },
];

/* ---------- Ollama model catalog (admin) ---------- */

export function OllamaModelsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const [installed, setInstalled] = useState<DriverModel[]>([]);
  const [pullName, setPullName] = useState("");
  const [pullStatus, setPullStatus] = useState("");
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState("");
  const [deleteModel, setDeleteModel] = useState<string | null>(null);
  const [sizeOverrides, setSizeOverrides] = useState<Record<string, string>>({});

  async function refreshInstalled() {
    try {
      // Admin view: force a fresh upstream fetch, bypassing the 60s user cache.
      const res = await api.models({ refresh: true });
      setInstalled(res.models.filter((m) => m.driver === "ollama"));
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (open) {
      setError("");
      setPullStatus("");
      setPullPct(null);
      setPulling(false);
      refreshInstalled();
    }
  }, [open]);

  async function pull(fullName: string) {
    if (pulling || !fullName.trim()) return;
    setPulling(true);
    setError("");
    setPullStatus(t("ollama.contacting"));
    setPullPct(null);
    try {
      await api.ollamaPull(fullName.trim(), (p) => {
        if (p.error) { setError(p.error); return; }
        setPullStatus(p.status || t("ollama.pullingSt"));
        if (p.total && p.completed) setPullPct(Math.min(100, Math.round((p.completed / p.total) * 100)));
        else setPullPct(null);
      });
      setPullStatus(t("ollama.doneSt"));
      setPullPct(100);
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ollama.pullFailed"));
    } finally {
      setPulling(false);
    }
  }

  async function removeModel(name: string) {
    try {
      await api.ollamaDelete(name);
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.deleteFailed"));
    }
  }

  return (
    <>
      <Modal open={open} onClose={pulling ? () => {} : onClose} title={t("ollama.models")} icon={Bot}>
        <p className="mb-4 text-sm opacity-70">
          {t("ollama.desc")}
        </p>
        {error && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400" role="alert">{error}</p>}

        {pulling && (
          <div className="mb-4 rounded-2xl border border-accent-500/40 bg-accent-50 p-4 dark:bg-accent-950/30">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Download size={15} className="animate-bounce" />
              {t("ollama.pulling", { name: pullName })}
            </p>
            <p className="mb-2 truncate text-xs opacity-70">{pullStatus}</p>
            {pullPct !== null && (
              <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-zinc-800">
                <div className="h-full rounded-full bg-accent-600 transition-all dark:bg-accent-500" style={{ width: `${pullPct}%` }} />
              </div>
            )}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-stone-200 p-3 dark:border-zinc-700">
          <div className="min-w-52 flex-1">
            <Field label={t("ollama.customTag")} hint={t("ollama.customHint")}>
              <Input
                value={pullName}
                onChange={(e) => setPullName(e.target.value)}
                placeholder="llama3.2:3b"
                disabled={pulling}
                onKeyDown={(e) => e.key === "Enter" && pull(pullName)}
              />
            </Field>
          </div>
          <Button size="sm" onClick={() => pull(pullName)} disabled={pulling || !pullName.trim()}>
            {pulling ? <Spinner size={15} /> : <Download size={15} />} {t("ollama.pull")}
          </Button>
        </div>

        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><HardDrive size={14} /> {t("ollama.installed", { n: installed.length })}</p>
        <ul className="mb-5 space-y-1.5">
          {installed.length === 0 && <li className="text-sm opacity-50">{t("ollama.noneYet")}</li>}
          {installed.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-stone-200/70 px-3.5 py-2 dark:border-zinc-800">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.label || m.id}</span>
              <button
                title={t("ollama.delTip", { name: m.label || m.id })}
                onClick={() => setDeleteModel(m.label || m.id)}
                className="rounded-full p-2 text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>

        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Download size={14} /> {t("ollama.catalog")}</p>
        <ul className="space-y-1.5">
          {OLLAMA_CATALOG.map((m) => {
            const size = sizeOverrides[m.name] ?? (m.sizes.length > 0 ? m.sizes[0]! : "");
            const tag = size ? `${m.name}:${size}` : m.name;
            return (
              <li key={m.name} className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200/70 px-3.5 py-2 dark:border-zinc-800">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block text-xs opacity-50">{t(m.catKey)}</span>
                </span>
                {m.sizes.length > 0 && (
                  <span className="w-24 shrink-0">
                    <Picker
                      ariaLabel={t("ollama.sizeAria", { name: m.name })}
                      value={size}
                      onChange={(v) => setSizeOverrides((prev) => ({ ...prev, [m.name]: v }))}
                      align="right"
                      options={m.sizes.map((s) => ({ value: s, label: s }))}
                    />
                  </span>
                )}
                <Button size="sm" variant="secondary" onClick={() => { setPullName(tag); pull(tag); }} disabled={pulling}>
                  <Download size={14} /> {t("ollama.pull")}
                </Button>
              </li>
            );
          })}
        </ul>
      </Modal>

      <ConfirmDialog
        open={deleteModel !== null}
        onClose={() => setDeleteModel(null)}
        title={t("ollama.delTitle", { name: deleteModel ?? "" })}
        message={t("ollama.delMsg")}
        onConfirm={() => deleteModel && removeModel(deleteModel)}
      />
    </>
  );
}

export function AdminPanel({ open, onClose, bare }: { open: boolean; onClose: () => void; bare?: boolean }) {
  const { t } = useT();
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [freshKey, setFreshKey] = useState<{ username: string; key: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  // Listing: search + sort + filter + pagination (server-side).
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState("newest");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const PER_PAGE = 8;

  // create form
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const res = await api.adminList({ q: debouncedQ || undefined, sort, filter, page, per: PER_PAGE });
      setUsers(res.users);
      setTotal(res.total);
      setPages(res.pages);
      if (res.page !== page) setPage(res.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (open || bare) {
      refresh();
      setShowCreate(false);
      setFreshKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bare ]);

  // Debounced search (resets to first page); sort/filter reload too.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q ]);

  useEffect(() => {
    if (open || bare) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, sort, filter, page ]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await api.adminCreate({ username: username.trim().toLowerCase(), displayName: displayName.trim() || undefined, email: email.trim() || undefined });
      setFreshKey({ username: res.user.username, key: res.key });
      setUsername("");
      setDisplayName("");
      setEmail("");
      setShowCreate(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.createFailed"));
    }
  }

  async function regenerate(u: User) {
    setError("");
    try {
      const res = await api.adminRegenerate(u.id);
      setFreshKey({ username: u.username, key: res.key });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.regenFailed"));
    }
  }

  async function remove(u: User) {
    try {
      await api.adminDelete(u.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.deleteFailed"));
    }
  }

  // Bare mode embeds the same manager in the /admin Center page instead
  // of a modal — no logic duplicated.
  const Shell: FC<{ children: ReactNode }> = bare
    ? ({ children }) => <div className="min-w-0 flex-1 space-y-1">{children}</div>
    : ({ children }) => <Modal open={open} onClose={onClose} title={t("admin.title")} icon={Users} wide>{children}</Modal>;

  return (
    <>
      <Shell>
        <p className="mb-4 text-sm opacity-70">
          {t("admin.intro")}
        </p>
        {error && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

        {freshKey && (
          <div className="mb-4 rounded-2xl border border-accent-500/40 bg-accent-50 p-4 dark:bg-accent-950/30">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><KeyRound size={15} /> {t("admin.keyOnce", { user: freshKey.username })}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 text-sm dark:bg-zinc-900">{freshKey.key}</code>
              <CopyButton text={freshKey.key} />
            </div>
          </div>
        )}

        {!showCreate ? (
          <div className="mb-5 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
              <UserPlus size={15} /> {t("admin.newAccount")}
            </Button>
          </div>
        ) : (
          <form onSubmit={create} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-stone-200 p-3 dark:border-zinc-700">
            <div className="min-w-40 flex-1">
              <Field label={t("common.username")}><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="alice" required /></Field>
            </div>
            <div className="min-w-40 flex-1">
              <Field label={t("common.displayName")}><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alice" /></Field>
            </div>
            <div className="min-w-40 flex-1">
              <Field label={t("admin.email")}><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@example.com" inputMode="email" /></Field>
            </div>
            <Button size="sm" type="submit">{t("common.create")}</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
          </form>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-40" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.searchPh")} aria-label={t("admin.searchAria")} className="pl-10" />
          </div>
          <Picker
            ariaLabel={t("admin.sortAria")}
            icon={ArrowUpDown}
            value={sort}
            onChange={(v) => { setSort(v); setPage(1); }}
            align="right"
            options={[
              { value: "newest", label: t("admin.sortNewest") },
              { value: "oldest", label: t("admin.sortOldest") },
              { value: "az", label: t("admin.sortAz") },
              { value: "za", label: t("admin.sortZa") },
            ]}
          />
          <Picker
            ariaLabel={t("admin.filterAria")}
            icon={Filter}
            value={filter}
            onChange={(v) => { setFilter(v); setPage(1); }}
            align="right"
            options={[
              { value: "all", label: t("admin.filterAll") },
              { value: "with-email", label: t("admin.filterWith") },
              { value: "no-email", label: t("admin.filterNo") },
            ]}
          />
        </div>

        {busy ? (
          <p className="flex items-center gap-2 text-sm opacity-60"><Spinner size={15} /> {t("common.loading")}</p>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-2xl border border-stone-200/70 px-3.5 py-2.5 dark:border-zinc-800">
                <Avatar name={u.displayName} url={u.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.displayName} <span className="font-normal opacity-50">@{u.username}</span></p>
                  <p className="truncate text-xs opacity-50">{u.email || t("admin.noEmail")} · {new Date(u.createdAt).toLocaleDateString()}</p>
                </div>
                {!u.isAdmin && (
                  <div className="flex shrink-0 gap-1">
                    <button title={t("admin.editProfile")} onClick={() => setEditTarget(u)} className="rounded-full p-2 transition hover:bg-stone-100 dark:hover:bg-zinc-800"><Pencil size={15} /></button>
                    <button title={t("admin.regenKey")} onClick={() => regenerate(u)} className="rounded-full p-2 transition hover:bg-stone-100 dark:hover:bg-zinc-800"><RefreshCw size={15} /></button>
                    <button title={t("admin.deleteAccount")} onClick={() => setDeleteTarget(u)} className="rounded-full p-2 text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"><Trash2 size={15} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-between gap-2 pt-1 text-sm">
          <span className="opacity-60">{total === 1 ? t("admin.countOne", { total, page, pages }) : t("admin.countMany", { total, page, pages })}</span>
          {pages > 1 && (
            <div className="flex gap-2.5">
              <IconButton
                title={t("admin.prevPage")}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} />
              </IconButton>
              <IconButton
                title={t("admin.nextPage")}
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={16} />
              </IconButton>
            </div>
          )}
        </div>
      </Shell>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("admin.deleteTitle", { user: deleteTarget?.username ?? "" })}
        message={t("admin.deleteMsg")}
        onConfirm={() => deleteTarget && remove(deleteTarget)}
      />

      <EditUserDialog user={editTarget} onClose={() => setEditTarget(null)} onSaved={refresh} />
    </>
  );
}

function EditUserDialog({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [email, setEmail] = useState("");
  const [theme, setTheme] = useState("auto");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setDisplayName(user.displayName);
      setAvatarUrl(user.avatarUrl);
      setEmail(user.email);
      setTheme(user.theme);
      setError("");
    }
  }, [user]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    try {
      await api.adminPatch(user.id, { username: username.trim().toLowerCase(), displayName: displayName.trim(), avatarUrl: avatarUrl.trim(), email: email.trim(), theme });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    }
  }

  return (
    <Modal open={user !== null} onClose={onClose} title={t("admin.editUserTitle", { user: user?.username ?? "" })} icon={Pencil}>
      <form onSubmit={save} className="space-y-4">
        <Field label={t("settings.username")} hint={t("settings.usernameHint")}>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} required autoComplete="username" disabled={user?.username === "admin"} />
        </Field>
        <Field label={t("common.displayName")}><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} required /></Field>
        <Field label={t("admin.avatarUrl")}><Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label={t("admin.email")}><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@example.com" inputMode="email" /></Field>
        <Field label={t("common.theme")}>
          <Picker
            ariaLabel={t("common.theme")}
            value={theme}
            onChange={setTheme}
            align="left"
            options={[
              { value: "auto", label: t("common.themeAuto") },
              { value: "sunset", label: t("common.themeSunset") },
              { value: "light", label: t("common.light") },
              { value: "dark", label: t("common.dark") },
            ]}
          />
        </Field>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" type="submit">{t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
