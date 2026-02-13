import { NextRequest, NextResponse } from 'next/server';
import { loadRunState } from '@/lib/run-state-persistence';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const state = await loadRunState(params.id);
    if (!state) {
      return NextResponse.json({ error: '运行详情不存在' }, { status: 404 });
    }
    return NextResponse.json(state);
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取运行详情失败', message: error.message },
      { status: 500 }
    );
  }
}
