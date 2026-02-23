import { NextRequest, NextResponse } from 'next/server';
import { listRuns, createRun } from '@/lib/run-store';
import type { RunRecord } from '@/lib/run-store';
import { formatTimestamp } from '@/lib/utils';

export async function GET() {
  try {
    const runs = await listRuns();
    return NextResponse.json({ runs });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const record: RunRecord = {
      id: `run-${formatTimestamp()}`,
      configFile: body.configFile,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'running',
      phaseReached: '',
      totalSteps: body.totalSteps || 0,
      completedSteps: 0,
    };
    await createRun(record);
    return NextResponse.json({ success: true, id: record.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: '创建运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}
