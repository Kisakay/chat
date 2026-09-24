export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  theme: string;
  email: string;
  createdAt: number;
  isAdmin: boolean;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  topic: string;
  model: string;
  archived_at: number;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Fully-qualified model id that produced this message (assistant only, "" = unknown). */
  model?: string;
}

export interface DriverModel {
  id: string;
  name: string;
  driver: string;
  label: string;
  group?: string;
  /** Served through your own provider key (BYOK) — shown in its own menu section. */
  personal?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  kind: "ocr" | "text";
  text: string;
}

export interface FilePreview {
  name: string;
  kind: "ocr" | "text";
  text: string;
  truncated: boolean;
}

export interface SharedChat {
  title: string;
  topic: string;
  model: string;
  authorName: string;
  authorAvatarUrl: string;
  archived: boolean;
  sharedAt: number;
  messages: ChatMessage[];
}
