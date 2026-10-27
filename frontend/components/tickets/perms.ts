'use client';

import { ProjectDetail, sameId } from '@/components/projects/lib';
import { TicketCard } from './lib';

/** What the viewer may do on this project's tickets (the API re-checks everything). */
export function usePerms(d: ProjectDetail, meId: number | string | undefined) {
  const role = d.permissions.role;
  const me = d.members.find((m) => sameId(m.id, meId));
  const dev = role === 'developer' && (me?.member_role === 'developer' || me?.member_role === 'lead_developer');
  const lead = dev && me?.member_role === 'lead_developer';
  return {
    role,
    meId,
    hr: role === 'hr',
    lead,
    /** status, assignees, estimate, ranking, WIP limits */
    work: role === 'hr' || dev,
    create: role === 'hr' || dev || (role === 'agent' && sameId(d.project.created_by, meId)),
    triage: role === 'hr' || lead,
    devs: d.members.filter((m) => m.member_role === 'developer' || m.member_role === 'lead_developer'),
  };
}
export type TicketPerms = ReturnType<typeof usePerms>;

/** Title/priority/dates/epic/labels: developers + HR, or the agent's own ticket until work starts. */
export function canEditCard(p: TicketPerms, t: TicketCard): boolean {
  if (p.work) return true;
  return p.role === 'agent' && sameId(t.created_by, p.meId) && (t.status === 'triage' || t.status === 'open');
}
