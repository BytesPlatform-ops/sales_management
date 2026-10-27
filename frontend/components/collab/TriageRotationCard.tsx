'use client';

import { useState } from 'react';
import { SectionCard, useToast } from '@/components/projects/ui';
import { papi, usePapi } from '@/components/projects/lib';

/** Weekly triage rotation among the lead and developers (skips anyone out of office and guests). */
export function TriageRotationCard({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const toast = useToast();
  const { data, mutate } = usePapi<{ triage_rotation: boolean; triage_owner_name: string | null }>(`/api/projects/${projectId}/collab-settings`);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  async function toggle(on: boolean) {
    setBusy(true);
    try { await papi(`/api/projects/${projectId}/collab-settings`, { method: 'PUT', body: { triage_rotation: on } }); mutate(); toast(on ? 'Triage now rotates weekly' : 'Rotation off'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <SectionCard title="Triage">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5" checked={data.triage_rotation} disabled={!canEdit || busy} onChange={(e) => toggle(e.target.checked)} />
        <span>
          <span className="font-medium text-gray-900">Rotate triage weekly</span>
          <span className="block text-gray-500">The lead and developers take turns; anyone out of office and guests are skipped.</span>
        </span>
      </label>
      <p className="mt-3 text-sm text-gray-600">This week: <strong>{data.triage_owner_name || 'the lead developer / HR'}</strong></p>
    </SectionCard>
  );
}
