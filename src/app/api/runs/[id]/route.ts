import { NextRequest, NextResponse } from 'next/server';
import { getRun, updateRun } from '@/lib/run-store';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const run = await getRun(params.id);
    if (!run) {
      return NextResponse.json({ error: '运行记录不存在' }, { status: 404 });
    }
    return NextResponse.json(run);
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const patch = await request.json();
    await updateRun(params.id, patch);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: '更新运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}
