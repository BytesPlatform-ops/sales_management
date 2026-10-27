/**
 * Brief timeline rules with no database access.
 *
 *   add / attach   HR, and the agent whose client it is (project creator)
 *   view           anyone who can see the project
 *   mark           HR and the project's developers: "Seen" / "Need clarification"
 *   edit / delete  the entry's author or HR. Within 24h an edit replaces the text
 *                  (previous text kept in history); after 24h it becomes a new version.
 *   restore        HR
 */
export const BRIEF_TYPES = ['requirement', 'content', 'change', 'feedback', 'clarification'] as const;
export type BriefType = (typeof BRIEF_TYPES)[number];
export const BRIEF_TYPE_LABELS: Record<BriefType, string> = {
  requirement: 'Requirement', content: 'Content / assets', change: 'Change', feedback: 'Feedback', clarification: 'Clarification',
};
export const isBriefType = (v: unknown): v is BriefType => typeof v === 'string' && (BRIEF_TYPES as readonly string[]).includes(v);

export const BRIEF_TAGS = ['waiting_on_client'] as const;
export const BRIEF_TAG_LABELS: Record<string, string> = { waiting_on_client: 'Waiting on client' };

export const IN_PLACE_EDIT_MS = 24 * 3600_000;

export interface BriefActor { role: 'hr' | 'agent' | 'developer'; userId: number; memberRole: string | null; projectCreatedBy: number }

export const canAddBrief = (a: BriefActor) => a.role === 'hr' || (a.role === 'agent' && a.projectCreatedBy === a.userId);

export const canMarkBrief = (a: BriefActor) =>
  a.role === 'hr' || (a.role === 'developer' && (a.memberRole === 'developer' || a.memberRole === 'lead_developer'));

export const canEditBrief = (a: BriefActor, entry: { created_by: number }) =>
  a.role === 'hr' || (Number(entry.created_by) === a.userId && canAddBrief(a));

/** 'in_place' within 24h of creation, otherwise 'new_version'. */
export function briefEditMode(createdAt: Date | string, now = Date.now()): 'in_place' | 'new_version' {
  return now - new Date(createdAt).getTime() <= IN_PLACE_EDIT_MS ? 'in_place' : 'new_version';
}

export function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map(String).filter((t) => (BRIEF_TAGS as readonly string[]).includes(t))));
}
