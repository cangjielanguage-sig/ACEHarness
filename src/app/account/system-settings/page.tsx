'use client';

import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import SystemSettingsContent from '@/components/settings/SystemSettingsContent';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ArrowLeft } from 'lucide-react';

function SystemSettingsPageContent() {
  useDocumentTitle('系统设置');

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard"><ArrowLeft className="w-4 h-4 mr-2" />返回 Dashboard</Link>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-2xl font-bold">系统设置</h1>
            <p className="text-sm text-muted-foreground mt-1">管理仓颉运行环境、托管 SDK 与系统级配置。</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-6 py-8">
        <SystemSettingsContent />
      </main>
    </div>
  );
}

export default function SystemSettingsPage() {
  return <AuthGuard><SystemSettingsPageContent /></AuthGuard>;
}
