import { useEffect, useState } from "react";

/** Tiny pathname router (no dependency): /login, /register, /chat, /. */

export function normalizePath(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p || "/";
}

export function getPath(): string {
  return normalizePath(window.location.pathname);
}

/** /chat itself or one conversation page (/chat/<id>). */
export function isChatPath(pathname: string): boolean {
  const p = normalizePath(pathname);
  return p === "/chat" || p.startsWith("/chat/");
}

/** Conversation id from /chat/<id>, or null on /chat itself. */
export function chatIdFromPath(pathname: string): string | null {
  const m = normalizePath(pathname).match(/^\/chat\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Admin section from /admin itself (null) or /admin/<tab>. */
export function adminTabFromPath(pathname: string): string | null {
  const p = normalizePath(pathname);
  if (p === "/admin") return null;
  const m = p.match(/^\/admin\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Client-side navigation without reload (same-origin path only). */
export function navigate(to: string, replace = false): void {
  const dest = normalizePath(to);
  if (getPath() === dest) return;
  if (replace) window.history.replaceState(null, "", dest);
  else window.history.pushState(null, "", dest);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): string {
  const [route, setRoute] = useState(getPath);
  useEffect(() => {
    const h = () => setRoute(getPath());
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  return route;
}
