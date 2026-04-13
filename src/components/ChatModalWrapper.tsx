'use client';

import { usePathname } from 'next/navigation';
import ChatModal from '@/components/ChatModal';

export default function ChatModalWrapper() {
  const pathname = usePathname();
  // Hide the floating chat modal on the dedicated chat page
  if (pathname === '/chat') return null;
  return <ChatModal />;
}
