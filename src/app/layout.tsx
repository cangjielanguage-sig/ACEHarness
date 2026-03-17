import type { Metadata } from 'next';
import './globals.css';
import { ChatProvider } from '@/contexts/ChatContext';
import ChatModalWrapper from '@/components/ChatModalWrapper';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/ui/toast';

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
          <div className="sci-fi-grid" aria-hidden="true" />
          <div className="siri-glow" aria-hidden="true">
            <div className="orb orb-1" />
            <div className="orb orb-2" />
            <div className="orb orb-3" />
            <div className="orb orb-4" />
          </div>
          <ChatProvider>
            <ToastProvider>
              {children}
              <ChatModalWrapper />
            </ToastProvider>
          </ChatProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
