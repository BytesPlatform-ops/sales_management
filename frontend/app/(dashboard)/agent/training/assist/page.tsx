'use client';

import { PageHeader } from '@/components/training/ui';
import { LiveAssistPanel } from '@/components/training/rep/live-assist-panel';

export default function LiveAssistPage() {
  return (
    <div>
      <PageHeader title="Live Assist" subtitle="Keep this open while you dial. It loads the lead you are on in My Leads — or paste any SAM.gov row. Tip: My Leads has a Live Assist button that opens this as a side panel." />
      <LiveAssistPanel />
    </div>
  );
}
