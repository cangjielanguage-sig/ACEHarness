import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const feedback = body.feedback || '';
    
    if (!feedback.trim()) {
      return NextResponse.json(
        { error: '迭代意见不能为空' },
        { status: 400 }
      );
    }

    workflowManager.requestIteration(feedback);

    return NextResponse.json({
      success: true,
      message: '已请求继续迭代',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '请求迭代失败', message: error.message },
      { status: 500 }
    );
  }
}
