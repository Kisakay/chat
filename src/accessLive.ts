import type { AccessMessage, AccessRequest } from "./access.ts";
import type { Report } from "./reports.ts";

/**
 * Live access-request updates over WebSocket (replaces HTTP polling).
 *
 * Two channels, mirroring the HTTP auth model (no weakening):
 * - ticket socket  `/api/access/ws/:id` — capability auth by unguessable
 *   UUID, exactly like GET /api/access/ticket/:id. Receives this ticket's
 *   messages + status changes.
 * - admin socket   `/api/admin/ws?token=…` — admin Bearer (query param
 *   because browsers can't set WS headers). Receives every access event
 *   plus content-report events, driving the AdminCenter badges + lists.
 *
 * Every event carries its full payload: clients apply it straight to state
 * (no HTTP refetch on event — the socket IS the data, not a hint to poll).
 */

export type AccessLiveEvent =
  | { type: "access_message"; request_id: string; message: AccessMessage }
  | { type: "access_status"; request_id: string; request: AccessRequest }
  | { type: "access_created"; request_id: string; request: AccessRequest; message: AccessMessage; message_count: number }
  | { type: "report_created"; report: Report }
  | { type: "report_status"; report: Report };

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
  // Ticket-scoped events route to that ticket's socket; report events and
  // everything else fan out to the admin firehose only.
  const ticketId = "request_id" in evt ? evt.request_id : null;
  for (const s of [...subscribers]) {
    if (s.isAdmin && s.ticketId === null) {
      // Admin firehose: every event.
    } else if (s.ticketId === null || s.ticketId !== ticketId) {
      continue;
    }
    try {
      if (!s.send(data)) subscribers.delete(s);
    } catch {
      subscribers.delete(s);
    }
  }
}
