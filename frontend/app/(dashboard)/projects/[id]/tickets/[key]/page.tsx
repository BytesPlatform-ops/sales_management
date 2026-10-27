'use client';

import { useParams } from 'next/navigation';
import { TicketView } from '@/components/tickets/TicketView';

export default function TicketPage() {
  const { id, key } = useParams<{ id: string; key: string }>();
  return <TicketView projectId={id} ticketKey={key} />;
}
