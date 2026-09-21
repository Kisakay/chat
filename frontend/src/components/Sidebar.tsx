import { useRef, useState } from "react";
import {
  MessageSquarePlus,
  MoreVertical,
  PanelLeftClose,
  Pencil,
  Settings,
  Share2,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Conversation, User } from "../lib/types.ts";
import { Avatar, Button, ContextMenu, IconButton } from "./ui.tsx";
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
  onDelete: (conv: Conversation) => void;
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const touchX = useRef<number | null>(null);

  function openMenu(e: React.MouseEvent, conv: Conversation) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, conv });
  }

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
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onNew}>
            <MessageSquarePlus size={16} />
            New chat
          </Button>
          <IconButton title="Collapse sidebar" onClick={onToggle} className="hidden md:inline-flex">
            <PanelLeftClose size={18} />
          </IconButton>
          <IconButton title="Close chats" onClick={onCloseMobile} className="md:hidden">
            <X size={18} />
          </IconButton>
        </div>

      <div className="flex-1 space-y-1 overflow-y-auto py-1">
        {convs.length === 0 && (
          <p className="px-3 py-6 text-center text-sm opacity-50">No conversations yet.<br />Start a new chat above.</p>
        )}
        {convs.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(c.id)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}
            onContextMenu={(e) => openMenu(e, c)}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2.5 text-sm transition",
              c.id === activeId
                ? "bg-emerald-600/10 font-medium text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100"
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
              aria-label="Conversation options"
              onClick={(e) => openMenu(e, c)}
              className="rounded-full p-1 opacity-0 transition group-hover:opacity-60 hover:!opacity-100 hover:bg-stone-300/50 dark:hover:bg-zinc-700"
            >
              <MoreVertical size={15} />
            </button>
          </div>
        ))}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { icon: Pencil, label: "Rename", onClick: () => onRename(menu.conv) },
            { icon: Tag, label: "Set topic", onClick: () => onTopic(menu.conv) },
            { icon: Share2, label: "Share publicly", onClick: () => onShare(menu.conv) },
            { icon: Trash2, label: "Delete", danger: true, onClick: () => onDelete(menu.conv) },
          ]}
        />
      )}

      <div className="space-y-2 rounded-2xl border border-stone-200/70 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <button onClick={onOpenSettings} className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition hover:bg-stone-100 dark:hover:bg-zinc-800">
          <Avatar name={user.displayName} url={user.avatarUrl} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.displayName}</span>
            <span className="block truncate text-xs opacity-60">@{user.username}{user.isAdmin ? " · admin" : ""}</span>
          </span>
          <Settings size={16} className="opacity-50" />
        </button>
        <div className="flex gap-1.5">
          {user.isAdmin && (
            <Button variant="secondary" size="sm" className="flex-1" onClick={onOpenAdmin} title="Manage accounts">
              <Users size={15} />
              Accounts
            </Button>
          )}
          <Button variant="ghost" size="sm" className={user.isAdmin ? "" : "flex-1"} onClick={onLogout}>
            Log out
          </Button>
        </div>
      </div>
      </aside>
    </>
  );
}
