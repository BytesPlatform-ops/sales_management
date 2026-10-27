'use client';

/**
 * Shapes shared by every chat stream (project thread now; team channels/DMs later).
 * A stream plugs into <ChatThread> through a ChatAdapter.
 */
export type ChatKind = 'message' | 'media' | 'voice' | 'system';

export interface ChatFile {
  id: string; file_name: string; mime_type: string; size_bytes: number | string;
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'file' | 'voice'; description: string | null;
}

export interface ChatMessage {
  id: number; user_id: number | string | null; kind: ChatKind; body: string;
  reply_to: number | null; reply_body: string | null; reply_author: string | null; reply_kind?: ChatKind | null;
  edited_at: string | null; deleted_at: string | null; pinned_at: string | null; pinned_by_name?: string | null;
  forwarded_from: { ticket_no?: string; author?: string | null } | null;
  meta: { duration?: number; peaks?: number[] } | null;
  created_at: string; updated_at: string; author: string | null; author_role: string | null;
  media: ChatFile[];
}

export interface ChatRead { user_id: number | string; name: string; last_read: number }

export interface ChatPoll {
  messages: ChatMessage[]; changed: ChatMessage[]; reads: ChatRead[]; participants: (number | string)[];
  last_read: number; now: string;
}

export interface ChatAction {
  label: string;
  /** Shown only when this returns true for the message. */
  show: (m: ChatMessage) => boolean;
  run: (m: ChatMessage) => void | Promise<void>;
}

export interface ChatAdapter {
  /** Stable key (used for drafts in sessionStorage, element ids). */
  key: string;
  poll(after: number, since: string | null): Promise<ChatPoll>;
  send(body: string, replyTo: number | null): Promise<ChatMessage>;
  createDraft(input: { kind: 'media' | 'voice'; body: string; replyTo: number | null; meta?: unknown }): Promise<{ id: number }>;
  /** Where the draft's files are uploaded (media_files target). */
  attachTarget(draftId: number): { entity_type: string; entity_id: number };
  publish(draftId: number): Promise<ChatMessage>;
  discard(draftId: number): Promise<void>;
  edit(id: number, body: string): Promise<ChatMessage>;
  remove(id: number): Promise<void>;
  pin(id: number, pinned: boolean): Promise<ChatMessage>;
  pinned(): Promise<ChatMessage[]>;
  /** media list URL for the Media tab (GET /api/media?...). */
  mediaUrl: string;
  /** Extra stream-specific actions (forward, add to brief, create ticket…). */
  actions?: ChatAction[];
}
