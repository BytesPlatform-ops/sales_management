'use client';

/**
 * Browser-side types and helpers for tickets and file uploads. Labels and the
 * permission rules come from lib/tickets/rules so the UI and API never disagree.
 */
export {
  STATUS_LABELS as TICKET_STATUS_LABELS, TYPE_LABELS, PRIORITY_LABELS as TICKET_PRIORITY_LABELS,
  WORK_STATUSES, TICKET_TYPES, PRIORITIES, branchName, TICKET_KEY_RE,
} from '@/lib/tickets/rules';
export type { TicketStatus, TicketType, Priority } from '@/lib/tickets/rules';
import type { Priority, TicketStatus, TicketType } from '@/lib/tickets/rules';

export interface PersonRef { id: number | string; name: string }
export interface LabelRef { id: number; name: string; color: string; global?: boolean }

/** One ticket as shown on the board and in lists. */
export interface TicketCard {
  id: number; project_id: number; key: string; number: number; type: TicketType; title: string; priority: Priority;
  status: TicketStatus; triage_state: 'need_info' | 'snoozed' | null; triage_due_at: string | null; snoozed_until: string | null;
  epic_id: number | null; parent_id: number | null; estimate_hours: string | null; start_date: string | null; due_date: string | null;
  rank: string; cr_status: 'pending' | 'approved' | 'rejected' | null; created_by: number | string; created_at: string; updated_at: string;
  done_at: string | null; created_by_name: string | null; epic_title: string | null; epic_color: string | null;
  assignees: PersonRef[]; labels: LabelRef[]; checklist_total: number; checklist_done: number;
  subtask_total: number; subtask_done: number; comment_count: number; blocked: boolean;
  // My Tasks only
  project_ticket_no?: string; project_title?: string; client_name?: string;
}

export interface Epic {
  id: number; title: string; description: string; color: string; owner_id: number | null; owner_name: string | null;
  target_date: string | null; status: 'open' | 'done' | 'archived'; sort_order: number; total: number; done: number;
}

export interface ChecklistItem { id: number; body: string; done: boolean; done_at: string | null; sort_order: number }
export interface Relation { id: number; kind: 'blocks' | 'relates_to' | 'duplicate_of'; direction: 'in' | 'out'; ticket_id: number; key: string; title: string; status: TicketStatus }

export interface TicketDetail {
  ticket: TicketCard & {
    description: string; decline_reason: string | null; duplicate_of: number | null; accepted_at: string | null;
    cr_decided_at: string | null; cr_new_deadline: string | null; created_via: string; branch: string;
    created_by_name: string | null; accepted_by_name: string | null; cr_decided_by_name: string | null;
  };
  project: { id: number; ticket_no: string; title: string; client_name: string };
  assignees: PersonRef[]; watchers: (PersonRef & { reason: string })[]; labels: LabelRef[]; checklist: ChecklistItem[];
  subtasks: TicketCard[]; relations: Relation[]; blockers: { id: number; key: string; title: string; status: TicketStatus }[];
  parent: { id: number; key: string; title: string; status: TicketStatus } | null;
  epic: { id: number; title: string; color: string } | null;
  project_developers: (PersonRef & { member_role: string })[];
  watching: boolean;
  can: { edit: boolean; work: boolean; triage: boolean; decide_cr: boolean; delete: boolean; comment: boolean };
  viewer_role: 'hr' | 'agent' | 'developer';
}

export interface Comment {
  id: number; user_id: number | string; user_name: string | null; user_role: string | null; body: string;
  edited_at: string | null; deleted_at: string | null; created_at: string;
}

export interface MediaFile {
  id: string; project_id: number; entity_type: string; entity_id: string; file_name: string; mime_type: string;
  size_bytes: number | string; description: string | null; kind: 'image' | 'video' | 'audio' | 'pdf' | 'file' | 'voice';
  uploaded_by: number | string; uploaded_by_name: string | null; created_at: string; deleted_at: string | null; ticket_key: string | null;
}

export const ticketHref = (projectId: number | string, key: string) => `/projects/${projectId}/tickets/${key}`;

export function fmtSize(bytes: number | string): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "3h left" / "2d overdue" for a triage SLA deadline. */
export function slaLabel(dueIso: string | null, now = Date.now()): { text: string; late: boolean } | null {
  if (!dueIso) return null;
  const ms = new Date(dueIso).getTime() - now;
  const abs = Math.abs(ms);
  const span = abs < 3600_000 ? `${Math.max(1, Math.round(abs / 60_000))}m` : abs < 86_400_000 ? `${Math.round(abs / 3600_000)}h` : `${Math.round(abs / 86_400_000)}d`;
  return ms >= 0 ? { text: `${span} left`, late: false } : { text: `${span} overdue`, late: true };
}

// ------------------------------------------------------------------ uploads

function token() {
  return typeof window === 'undefined' ? null : localStorage.getItem('token');
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const t = token();
  const res = await fetch(path, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || j?.status === 'error') throw new Error(j?.message || `Request failed (${res.status})`);
  return j.data as T;
}

/**
 * Upload one file straight to storage (never through our server in production),
 * reporting progress 0–1, then confirm it. Returns the media id.
 */
export async function uploadFile(
  target: { entity_type: string; entity_id: number | string },
  file: File,
  description: string,
  onProgress?: (p: number) => void,
): Promise<string> {
  const { id, upload } = await jsonPost<{ id: string; upload: { url: string; method: 'PUT'; form: boolean; headers: Record<string, string> } }>(
    '/api/media/upload-url',
    { ...target, file_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, description },
  );
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
    if (upload.form) {
      const fd = new FormData();
      fd.append('cacheControl', '3600');
      fd.append('', file);
      xhr.send(fd);
    } else {
      if (file.type) xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);
    }
  });
  await jsonPost(`/api/media/${id}/complete`, {});
  onProgress?.(1);
  return id;
}

/** A short-lived URL for viewing (or downloading) a file. */
export async function mediaUrl(id: string, download = false): Promise<{ url: string; inline: boolean }> {
  const t = token();
  const res = await fetch(`/api/media/${id}/url${download ? '?download=1' : ''}`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' });
  const j = await res.json().catch(() => null);
  if (!res.ok || j?.status === 'error') throw new Error(j?.message || 'Could not open file');
  return j.data;
}
