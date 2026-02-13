import type { Metadata } from 'next';
import './globals.css';
import { ChatProvider } from '@/contexts/ChatContext';
import ChatModal from '@/components/ChatModal';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: 'AceFlow',
  description: 'AceFlow - AI 协同工作调度系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <ChatProvider>
            {children}
            <ChatModal />
          </ChatProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
