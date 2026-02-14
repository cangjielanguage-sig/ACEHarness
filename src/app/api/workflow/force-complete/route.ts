import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const result = await workflowManager.forceCompleteStep();
    if (!result) {
      return NextResponse.json(
        { error: '当前没有正在运行的步骤' },
        { status: 400 }
      );
    }
    return NextResponse.json({
      success: true,
      step: result.step,
      outputLength: result.output.length,
      message: `步骤 "${result.step}" 已强制完成`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '强制完成失败', message: error.message },
      { status: 500 }
    );
  }
}
