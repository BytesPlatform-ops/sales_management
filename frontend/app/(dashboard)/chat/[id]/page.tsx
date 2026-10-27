'use client';

import { ChatApp } from '@/components/sales-chat/ChatApp';

export default function ChatConversationPage({ params }: { params: { id: string } }) {
  return <ChatApp conversationId={params.id} />;
}
