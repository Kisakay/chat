import { useEffect, useRef, useState } from "react";
import {
  Archive,
  LayoutDashboard,
  MessageSquarePlus,
  MoreVertical,
  PanelLeftClose,
  Pencil,
  Search,
  Settings,
  Share2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { Conversation, User } from "../lib/types.ts";
import { api } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { Avatar, Button, ContextMenu, FlowerMark, IconButton } from "./ui.tsx";
import { cn } from "../lib/cn.ts";

interface MenuState {
  x: number;
  y: number;
  conv: Conversation;
}

export function Sidebar({
  user,
  convs,
  activeId,
  collapsed,
  onToggle,
  onNew,
  onSelect,
  onRename,
  onTopic,
  onShare,
  onArchive,
  onDelete,
  onOpenSettings,
  onOpenAdmin,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: {
  user: User;
  convs: Conversation[];
  activeId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (conv: Conversation) => void;
  onTopic: (conv: Conversation) => void;
  onShare: (conv: Conversation) => void;
  onArchive: (conv: Conversation) => void;
  onDelete: (conv: Conversation) => void;
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { t } = useT();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(Conversation & { snippet: string | null; snippetRole: string | null })[] | null>(null);
  const [searching, setSearching] = useState(false);
  const touchX = useRef<number | null>(null);
  // Long-press (mobile right-click): open the context menu, suppress the tap.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressPos = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  function openMenuAt(x: number, y: number, conv: Conversation) {
    setMenu({ x, y, conv });
  }

  function openMenu(e: React.MouseEvent, conv: Conversation) {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, conv);
  }

  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressPos.current = null;
  }

  // Debounced search over titles, topics and old prompts/replies.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchConvs(q)
        .then((res) => setResults(res.conversations))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (collapsed && !mobileOpen) return null;

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <aside
        onTouchStart={(e) => { touchX.current = e.touches[0]!.clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0]!.clientX - touchX.current;
          touchX.current = null;
          if (dx < -60) onCloseMobile(); // swipe left closes the drawer
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-72 shrink-0 flex-col gap-2 border-r border-stone-200 bg-white p-3 shadow-2xl transition-transform duration-200",
          "md:static md:z-auto md:shadow-none dark:border-zinc-800 dark:bg-zinc-900 md:dark:bg-zinc-900/70 md:bg-white/70 md:backdrop-blur",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
          collapsed && "md:hidden",
        )}
      >
        <div className="flex items-center gap-2 px-2 pb-1 pt-0.5">
          <FlowerMark size={36} dynamic={false} />
          <span className="font-serif text-xl font-bold tracking-tight">KisAssistant</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onNew}>
            <MessageSquarePlus size={16} />
            {t("sidebar.newChat")}
          </Button>
          <IconButton title={t("sidebar.collapse")} onClick={onToggle} className="hidden md:inline-flex">
            <PanelLeftClose size={18} />
          </IconButton>
          <IconButton title={t("sidebar.closeDrawer")} onClick={onCloseMobile} className="md:hidden">
            <X size={18} />
          </IconButton>
        </div>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sidebar.searchPh")}
            aria-label={t("sidebar.searchAria")}
            className="w-full rounded-2xl border border-stone-200/70 bg-stone-100 py-2 pl-9 pr-8 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent-500/60 focus:bg-white dark:border-zinc-800 dark:bg-zinc-800/60 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900"
          />
          {query && (
            <button
              aria-label={t("sidebar.clearSearch")}
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
            >
              <X size={14} />
            </button>
          )}
        </div>

      <div className="flex-1 space-y-1 overflow-y-auto py-1">
        {results !== null ? (
          <>
            {searching && <p className="px-3 py-4 text-center text-sm opacity-50">{t("sidebar.searching")}</p>}
            {!searching && results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm opacity-50">{t("sidebar.noMatch", { q: query.trim() })}</p>
            )}
            {results.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => { setQuery(""); onSelect(c.id); }}
                onKeyDown={(e) => { if (e.key === "Enter") { setQuery(""); onSelect(c.id); } }}
                className={cn(
                  "group cursor-pointer select-none rounded-2xl px-3 py-2.5 text-sm transition",
                  c.id === activeId
                    ? "bg-accent-600/10 font-medium text-accent-900 dark:bg-accent-500/10 dark:text-accent-100"
                    : "hover:bg-stone-200/50 dark:hover:bg-zinc-800/70",
                )}
              >
                <span className="block truncate">{c.title}</span>
                {c.snippet && (
                  <span className="mt-0.5 block truncate text-xs opacity-60">
                    {c.snippetRole === "user" ? t("sidebar.youPrefix") : ""}{c.snippet}
                  </span>
                )}
              </div>
            ))}
          </>
        ) : (
        <>
        {convs.length === 0 && (
          <p className="px-3 py-6 text-center text-sm opacity-50">{t("sidebar.emptyA")}<br />{t("sidebar.emptyB")}</p>
        )}
        {convs.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              onSelect(c.id);
            }}
            onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}
            onContextMenu={(e) => openMenu(e, c)}
            onTouchStart={(e) => {
              const t = e.touches[0]!;
              pressPos.current = { x: t.clientX, y: t.clientY };
              pressTimer.current = setTimeout(() => {
                suppressClick.current = true;
                openMenuAt(t.clientX, t.clientY, c);
              }, 550);
            }}
            onTouchMove={(e) => {
              const p = pressPos.current;
              const t = e.touches[0]!;
              if (p && Math.hypot(t.clientX - p.x, t.clientY - p.y) > 10) cancelPress();
            }}
            onTouchEnd={cancelPress}
            className={cn(
              "group flex cursor-pointer select-none items-center gap-2 rounded-2xl px-3 py-2.5 text-sm transition [-webkit-touch-callout:none]",
              c.id === activeId
                ? "bg-accent-600/10 font-medium text-accent-900 dark:bg-accent-500/10 dark:text-accent-100"
                : "hover:bg-stone-200/50 dark:hover:bg-zinc-800/70",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{c.title}</span>
              {c.topic && (
                <span className="mt-0.5 flex items-center gap-1 text-xs opacity-60">
                  <Tag size={11} />
                  <span className="truncate">{c.topic}</span>
                </span>
              )}
            </span>
            <button
              aria-label={t("sidebar.convOptions")}
              onClick={(e) => openMenu(e, c)}
              className="rounded-full p-1 opacity-0 transition group-hover:opacity-60 hover:!opacity-100 hover:bg-stone-300/50 dark:hover:bg-zinc-700"
            >
              <MoreVertical size={15} />
            </button>
          </div>
        ))}
        </>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { icon: Pencil, label: t("sidebar.rename"), onClick: () => onRename(menu.conv) },
            { icon: Tag, label: t("sidebar.topic"), onClick: () => onTopic(menu.conv) },
            { icon: Share2, label: t("sidebar.share"), onClick: () => onShare(menu.conv) },
            { icon: Archive, label: t("sidebar.archive"), onClick: () => onArchive(menu.conv) },
            { icon: Trash2, label: t("sidebar.delete"), danger: true, onClick: () => onDelete(menu.conv) },
          ]}
        />
      )}

      <div className="space-y-2 rounded-2xl border border-stone-200/70 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <button onClick={onOpenSettings} className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition hover:bg-accent-600/10" title={t("sidebar.settingsTip")}>
          <Avatar name={user.displayName} url={user.avatarUrl} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.displayName}</span>
            <span className="block truncate text-xs opacity-60">@{user.username}{user.isAdmin ? ` · ${t("sidebar.admin")}` : ""}</span>
          </span>
          <Settings size={16} className="mr-2 shrink-0 opacity-50" />
        </button>
        <div className="flex gap-1.5">
          {user.isAdmin && (
            <Button variant="secondary" size="sm" className="flex-1" onClick={onOpenAdmin} title={t("sidebar.adminCenterTip")}>
              <LayoutDashboard size={15} />
              {t("sidebar.adminCenter")}
            </Button>
          )}
          <Button variant="ghost" size="sm" className={user.isAdmin ? "" : "flex-1"} onClick={onLogout}>
            {t("sidebar.logout")}
          </Button>
        </div>
      </div>
      </aside>
    </>
  );
}
