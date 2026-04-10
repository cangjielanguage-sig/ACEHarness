import type { Metadata } from 'next';
import 'material-symbols/outlined.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ACEHarness',
  description: 'ACEHarness - Agent Centric Engineering Harness',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head />
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
