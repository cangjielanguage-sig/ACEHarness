'use client';

import { usePathname } from 'next/navigation';
import ChatModal from '@/components/ChatModal';

export default function ChatModalWrapper() {
  const pathname = usePathname();
  // Hide the floating chat modal on the chat home page
  if (pathname === '/' || pathname === '/chat') return null;
  return <ChatModal />;
}
