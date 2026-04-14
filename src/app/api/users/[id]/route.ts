import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-middleware';
import { updateUser, deleteUser, adminResetPassword, getUserById, toPublicUser, loadUsers } from '@/lib/user-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/[id] - Get single user (admin only)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  const user = await getUserById(id);
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }
  return NextResponse.json({ user: toPublicUser(user) });
}

/**
 * PUT /api/users/[id] - Update user (admin only)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  try {
    const body = await request.json();
    const { resetPassword, ...patch } = body;

    // Protect initial admin (no createdBy) from being demoted
    if (patch.role && patch.role !== 'admin') {
      const targetUser = await getUserById(id);
      if (targetUser && targetUser.role === 'admin' && !targetUser.createdBy) {
        return NextResponse.json({ error: '初始管理员不能被设置为普通用户' }, { status: 400 });
      }
    }

    // Handle password reset by admin
    if (resetPassword) {
      if (resetPassword.length < 6) {
        return NextResponse.json({ error: '密码至少6个字符' }, { status: 400 });
      }
      await adminResetPassword(id, resetPassword);
    }

    // Update other fields if any
    const updateFields: any = {};
    if (patch.username !== undefined) updateFields.username = patch.username;
    if (patch.email !== undefined) updateFields.email = patch.email;
    if (patch.role !== undefined) updateFields.role = patch.role;
    if (patch.personalDir !== undefined) updateFields.personalDir = patch.personalDir;
    if (patch.avatar !== undefined) updateFields.avatar = patch.avatar;

    if (Object.keys(updateFields).length > 0) {
      const user = await updateUser(id, updateFields);
      return NextResponse.json({ user });
    }

    if (resetPassword) {
      return NextResponse.json({ success: true, message: '密码已重置' });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '更新用户失败' }, { status: 400 });
  }
}

/**
 * DELETE /api/users/[id] - Delete user (admin only)
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;

  // Prevent deleting self
  if (id === admin.id) {
    return NextResponse.json({ error: '不能删除自己的账号' }, { status: 400 });
  }

  // Prevent deleting initial admin
  const targetUser = await getUserById(id);
  if (targetUser && targetUser.role === 'admin' && !targetUser.createdBy) {
    return NextResponse.json({ error: '不能删除初始管理员' }, { status: 400 });
  }

  try {
    await deleteUser(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '删除用户失败' }, { status: 400 });
  }
}
