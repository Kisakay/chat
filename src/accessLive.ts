import type { AccessMessage, AccessRequest } from "./access.ts";

/**
 * Live access-request updates over WebSocket (replaces HTTP polling).
 *
 * Two channels, mirroring the HTTP auth model (no weakening):
 * - ticket socket  `/api/access/ws/:id` — capability auth by unguessable
 *   UUID, exactly like GET /api/access/ticket/:id. Receives this ticket's
 *   messages + status changes.
 * - admin socket   `/api/admin/ws?token=…` — admin Bearer (query param
 *   because browsers can't set WS headers). Receives every access event,
 *   driving the AdminCenter badge + triage list.
 */

export type AccessLiveEvent =
  | { type: "access_message"; request_id: string; message: AccessMessage }
  | { type: "access_status"; request_id: string; request: AccessRequest }
  | { type: "access_created"; request_id: string; request: AccessRequest };

export interface AccessLiveSubscriber {
  /** Ticket to follow, or null for the admin firehose. */
  ticketId: string | null;
  isAdmin: boolean;
  /** Send a pre-serialized frame. Return false when the socket is dead. */
  send: (data: string) => boolean;
}

const subscribers = new Set<AccessLiveSubscriber>();

export function subscribeAccessLive(s: AccessLiveSubscriber): () => void {
  subscribers.add(s);
  return () => {
    subscribers.delete(s);
  };
}

export function broadcastAccessLive(evt: AccessLiveEvent): void {
  if (subscribers.size === 0) return;
  const data = JSON.stringify(evt);
  for (const s of [...subscribers]) {
    if (s.ticketId !== evt.request_id && !(s.isAdmin && s.ticketId === null)) continue;
    try {
      if (!s.send(data)) subscribers.delete(s);
    } catch {
      subscribers.delete(s);
    }
  }
}
