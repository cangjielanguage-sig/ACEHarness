import { NextRequest, NextResponse } from 'next/server';
import { deleteRun } from '@/lib/run-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, runIds } = body;

    if (action !== 'delete') {
      return NextResponse.json(
        { error: '不支持的操作' },
        { status: 400 }
      );
    }

    if (!Array.isArray(runIds) || runIds.length === 0) {
      return NextResponse.json(
        { error: '缺少运行记录ID列表' },
        { status: 400 }
      );
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const runId of runIds) {
      try {
        await deleteRun(runId);
        deletedCount++;
      } catch (error: any) {
        errors.push(`${runId}: ${error.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `已删除 ${deletedCount} 条运行记录${errors.length > 0 ? `，${errors.length} 条失败` : ''}`,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '批量删除失败', message: error.message },
      { status: 500 }
    );
  }
}
