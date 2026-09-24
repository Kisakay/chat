import type { AccessMessage, AccessRequest, Report } from "./api.ts";

/**
 * Shared WebSocket pool for live access-request updates.
 *
 * One underlying socket per URL (refcounted across components, e.g. the
 * AdminCenter badge and the triage list share the admin firehose).
 * Auto-reconnects with backoff; every (re)connect triggers onSync so
 * components resync over HTTP and never miss an event sent while offline.
 * A 25s client ping keeps idle connections alive through proxies, and a
 * pong watchdog reconnects half-dead sockets (ping answered by nobody)
 * that would otherwise silently stop notifying.
 *
 * Events carry their full payload — handlers apply them straight to state.
 * HTTP resync (onSync) is only the offline-gap fallback, never the
 * per-event path.
 */

export type AccessLiveEvent =
  | { type: "access_message"; request_id: string; message: AccessMessage }
  | { type: "access_status"; request_id: string; request: AccessRequest }
  | { type: "access_created"; request_id: string; request: AccessRequest; message: AccessMessage; message_count: number }
  | { type: "report_created"; report: Report }
  | { type: "report_status"; report: Report }
  | { type: "pong" };

export interface AccessLiveListener {
  onEvent: (e: AccessLiveEvent) => void;
  /** Fired on every (re)connect — resync state over HTTP here. */
  onSync?: () => void;
}

interface Pool {
  ws: WebSocket | null;
  listeners: Set<AccessLiveListener>;
  backoff: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  /** Last time the server proved liveness (open or pong). 0 = unknown. */
  lastLive: number;
}

let globalHooksInstalled = false;

const pools = new Map<string, Pool>();

/** Ping period; the watchdog tolerates one missed pong plus slack. */
const PING_MS = 25_000;
const WATCHDOG_MS = PING_MS + 10_000;

export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

/** Reconnect every pooled socket now (tab visible again / back online). */
function reconnectAll(): void {
  for (const [url, pool] of pools) {
    if (pool.listeners.size === 0) continue;
    if (pool.retryTimer) {
      clearTimeout(pool.retryTimer);
      pool.retryTimer = null;
    }
    try {
      pool.ws?.close();
    } catch {
      // already gone — connect() below redials
    }
    pool.ws = null;
    pool.backoff = 0;
    connect(url, pool);
  }
}

function installGlobalHooks(): void {
  if (globalHooksInstalled || typeof document === "undefined") return;
  globalHooksInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconnectAll();
  });
  window.addEventListener("online", () => reconnectAll());
}

function connect(url: string, pool: Pool): void {
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleRetry(url, pool);
    return;
  }
  pool.ws = ws;

  ws.onopen = () => {
    pool.backoff = 0;
    pool.lastLive = Date.now();
    pool.pingTimer = setInterval(() => {
      // Half-dead socket: OPEN but the server hasn't proved liveness for
      // over a ping period + grace (proxy killed it, server restarted…).
      // Close it so onclose schedules a fresh dial.
      if (ws.readyState === WebSocket.OPEN) {
        if (Date.now() - pool.lastLive > WATCHDOG_MS) {
          try {
            ws.close();
          } catch {
            // close handler reconnects
          }
          return;
        }
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          // send failed — the close handler will schedule a retry
        }
      }
    }, PING_MS);
    for (const l of [...pool.listeners]) {
      try {
        l.onSync?.();
      } catch {
        // listener bug must not break the pool
      }
    }
  };

  ws.onmessage = (ev) => {
    let parsed: AccessLiveEvent | null = null;
    try {
      parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "") as AccessLiveEvent;
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== "string") return;
    // Any frame (event or pong) proves the socket is alive.
    if (pool.ws === ws) pool.lastLive = Date.now();
    for (const l of [...pool.listeners]) {
      try {
        l.onEvent(parsed);
      } catch {
        // listener bug must not break the pool
      }
    }
  };

  const onDead = () => {
    if (pool.ws === ws) pool.ws = null;
    if (pool.pingTimer) {
      clearInterval(pool.pingTimer);
      pool.pingTimer = null;
    }
    scheduleRetry(url, pool);
  };
  ws.onclose = onDead;
  ws.onerror = () => {
    // onerror is followed by onclose — retry is scheduled there
  };
}

function scheduleRetry(url: string, pool: Pool): void {
  if (!pools.has(url) || pool.listeners.size === 0 || pool.retryTimer) return;
  const delay = Math.min(1000 * 2 ** pool.backoff, 15_000);
  pool.backoff += 1;
  pool.retryTimer = setTimeout(() => {
    pool.retryTimer = null;
    if (!pools.has(url) || pool.listeners.size === 0) return;
    connect(url, pool);
  }, delay);
}

export function subscribeAccessLive(url: string, listener: AccessLiveListener): () => void {
  let pool: Pool | undefined = pools.get(url);
  if (!pool) {
    const fresh: Pool = { ws: null, listeners: new Set(), backoff: 0, retryTimer: null, pingTimer: null, lastLive: 0 };
    pools.set(url, fresh);
    pool = fresh;
    installGlobalHooks();
    connect(url, pool);
  }
  pool.listeners.add(listener);
  if (pool.ws && pool.ws.readyState === WebSocket.OPEN) {
    try {
      listener.onSync?.();
    } catch {
      // ignore
    }
  }
  return () => {
    const p = pools.get(url);
    if (!p) return;
    p.listeners.delete(listener);
    if (p.listeners.size > 0) return;
    pools.delete(url);
    if (p.retryTimer) clearTimeout(p.retryTimer);
    if (p.pingTimer) clearInterval(p.pingTimer);
    try {
      p.ws?.close();
    } catch {
      // already gone — fine
    }
    p.ws = null;
  };
}
