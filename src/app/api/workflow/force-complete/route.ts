import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function POST(request: NextRequest) {
  try {
    console.log('[force-complete] status:', workflowManager.getInternalStatus(), 'currentStep:', workflowManager.getCurrentStep());
    const result = await workflowManager.forceCompleteStep();
    if (!result) {
      console.log('[force-complete] returned null — no running step found');
      return NextResponse.json(
        { error: '当前没有正在运行的步骤' },
        { status: 400 }
      );
    }
    console.log('[force-complete] success:', result.step, 'output length:', result.output.length);
    return NextResponse.json({
      success: true,
      step: result.step,
      outputLength: result.output.length,
      message: `步骤 "${result.step}" 已强制完成`,
    });
  } catch (error: any) {
    console.error('[force-complete] error:', error);
    return NextResponse.json(
      { error: '强制完成失败', message: error.message },
      { status: 500 }
    );
  }
}
