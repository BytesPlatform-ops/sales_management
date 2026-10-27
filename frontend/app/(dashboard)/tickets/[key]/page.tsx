'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileX2 } from 'lucide-react';
import { Spinner, Empty } from '@/components/training/ui';
import { ProjectsPage } from '@/components/projects/ui';
import { usePapi } from '@/components/projects/lib';

/** /tickets/PRJ-0012-T5 — short link used by ticket references; finds the project and redirects. */
export default function TicketKeyRedirect() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const { data, error } = usePapi<{ id: number; project_id: number; key: string }>(key ? `/api/tickets/by-key/${encodeURIComponent(key)}` : null);

  useEffect(() => {
    if (data) router.replace(`/projects/${data.project_id}/tickets/${data.key}`);
  }, [data, router]);

  return (
    <ProjectsPage>
      {error ? (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <Empty icon={<FileX2 className="h-6 w-6" />} title="Ticket not found" body="It may have been deleted, or you’re not on this project."
            action={<Link href="/projects" className="text-sm font-medium text-primary-600 hover:underline">Go to projects</Link>} />
        </div>
      ) : <Spinner label="Opening ticket…" />}
    </ProjectsPage>
  );
}
