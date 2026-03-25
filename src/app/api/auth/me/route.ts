import { NextRequest, NextResponse } from 'next/server';
import { logout, isValidToken, getAdminInfo } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me - Get current authenticated user
 */
export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!token || !isValidToken(token)) {
    return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });
  }

  const admin = await getAdminInfo();
  if (!admin) {
    return NextResponse.json({ error: '用户不存在' }, { status: 401 });
  }

  return NextResponse.json({ user: admin });
}

/**
 * DELETE /api/auth/logout - Logout
 */
export async function DELETE(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    await logout(token);
  }
  return NextResponse.json({ success: true });
}
