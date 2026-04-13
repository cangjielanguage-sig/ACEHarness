import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAuth } from '@/lib/auth-middleware';
import { loadSystemSettings, saveSystemSettings } from '@/lib/system-settings';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const settings = await loadSystemSettings();
  return NextResponse.json({
    gitcodeTokenConfigured: Boolean(settings.gitcodeToken),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    await saveSystemSettings({
      gitcodeToken: typeof body.gitcodeToken === 'string' ? body.gitcodeToken.trim() : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '保存系统设置失败' }, { status: 500 });
  }
}
