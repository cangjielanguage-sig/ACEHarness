import { NextRequest, NextResponse } from 'next/server';
import { stat, rm } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const RUNS_DIR = resolve(process.cwd(), 'runs');

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const runId = (await params).id;
    const runDir = resolve(RUNS_DIR, runId);

    // Check if run exists
    if (!existsSync(runDir)) {
      return NextResponse.json(
        { error: '运行记录不存在' },
        { status: 404 }
      );
    }

    // Verify it's a directory
    const stats = await stat(runDir);
    if (!stats.isDirectory()) {
      return NextResponse.json(
        { error: '运行记录路径无效' },
        { status: 400 }
      );
    }

    // Delete the entire run directory
    await rm(runDir, { recursive: true, force: true });

    return NextResponse.json({ success: true, message: '运行记录已删除' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '删除失败', message: error.message },
      { status: 500 }
    );
  }
}
