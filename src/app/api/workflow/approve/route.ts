import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function POST(request: NextRequest) {
  try {
    workflowManager.approve();

    return NextResponse.json({
      success: true,
      message: '检查点已批准',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '批准检查点失败', message: error.message },
      { status: 500 }
    );
  }
}
