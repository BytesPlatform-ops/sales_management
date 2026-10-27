import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';
import { actorFor } from '@/lib/tickets/core';
import { projectSettings, REMINDER_DEFAULTS, ReminderSettings } from '@/lib/reminders/auto';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

const LIMITS: Record<string, [number, number]> = {
  client_content_days: [1, 60], clarification_hours: [1, 720], meeting_notes_hours: [1, 168], cycle_renewal_days: [1, 60],
};

/** HR (incl. CEO in Admin mode), the lead developer, or the client's agent. */
async function canEdit(request: NextRequest, projectId: number) {
  const v = await getViewer(request);
  const p = await loadProject(projectId, v);
  const a = await actorFor(v, p);
  return { p, ok: v.role === 'hr' || a.memberRole === 'lead_developer' || (v.role === 'agent' && Number(p.created_by) === v.userId) };
}

/** GET /api/projects/{id}/reminder-settings — automatic reminder toggles and thresholds (defaults filled in). */
export const GET = handler(async (request: NextRequest, { params }: Ctx) => {
  const { p, ok: editable } = await canEdit(request, Number(params.id));
  return ok({ ...(await projectSettings(p.id)), can_edit: editable });
});

/** PUT /api/projects/{id}/reminder-settings { client_content_enabled?, client_content_days?, … } */
export const PUT = handler(async (request: NextRequest, { params }: Ctx) => {
  const { p, ok: editable } = await canEdit(request, Number(params.id));
  if (!editable) throw new HttpError(403, 'Only HR, the lead developer or the client’s agent can change reminder settings');
  const b = await readJson(request);
  const next: ReminderSettings = { ...(await projectSettings(p.id)) };
  for (const k of Object.keys(REMINDER_DEFAULTS) as (keyof ReminderSettings)[]) {
    if (b[k] === undefined) continue;
    if (typeof REMINDER_DEFAULTS[k] === 'boolean') (next as any)[k] = !!b[k];
    else {
      const n = Math.round(Number(b[k]));
      const [lo, hi] = LIMITS[k];
      if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}`);
      (next as any)[k] = n;
    }
  }
  const cols = Object.keys(REMINDER_DEFAULTS);
  const v = await getViewer(request);
  await query(
    `INSERT INTO project_reminder_settings (project_id, ${cols.join(', ')}, updated_by, updated_at)
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}, NOW())
     ON CONFLICT (project_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [p.id, ...cols.map((c) => (next as any)[c]), v.userId]
  );
  return ok({ ...next, can_edit: true });
});
