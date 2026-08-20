'use client';

import { useParams } from 'next/navigation';
import { Chat } from '@/components/chat';

export default function ChatSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <Chat sessionId={sessionId} />;
}
