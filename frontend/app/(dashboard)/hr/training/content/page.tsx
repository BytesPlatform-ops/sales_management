'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/training/ui';
import { TrainerPage, Tabs } from '@/components/training/hr/kit';
import { CurriculumTab } from '@/components/training/hr/content/curriculum';
import { ScenariosTab } from '@/components/training/hr/content/scenarios';
import { EntityManager, OBJECTIONS, CLASSIFICATION, BADGES } from '@/components/training/hr/content/entities';
import { RubricTab, GatesTab, PromptsTab } from '@/components/training/hr/content/admin-tabs';

const TABS = [
  { id: 'curriculum', label: 'Curriculum' },
  { id: 'personas', label: 'Roleplay personas' },
  { id: 'objections', label: 'Objections' },
  { id: 'classification', label: 'Classification rows' },
  { id: 'rubric', label: 'Scorecard' },
  { id: 'gates', label: 'Gates' },
  { id: 'prompts', label: 'AI prompts' },
  { id: 'badges', label: 'Badges' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function ContentPage() {
  return <Suspense fallback={<Spinner />}><Content /></Suspense>;
}

function Content() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = (TABS.some((t) => t.id === sp.get('tab')) ? sp.get('tab') : 'curriculum') as TabId;
  return (
    <TrainerPage title="Training content" subtitle="Everything reps learn from is data you can edit here — no deploy needed.">
      <div className="mb-5 overflow-x-auto"><Tabs tabs={[...TABS]} value={tab} onChange={(t) => router.replace(`/hr/training/content?tab=${t}`)} className="w-max flex-nowrap" /></div>
      {tab === 'curriculum' && <CurriculumTab />}
      {tab === 'personas' && <ScenariosTab />}
      {tab === 'objections' && <EntityManager config={OBJECTIONS} />}
      {tab === 'classification' && <EntityManager config={CLASSIFICATION} />}
      {tab === 'rubric' && <RubricTab />}
      {tab === 'gates' && <GatesTab />}
      {tab === 'prompts' && <PromptsTab />}
      {tab === 'badges' && <EntityManager config={BADGES} />}
    </TrainerPage>
  );
}
