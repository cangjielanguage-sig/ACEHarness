import { NextRequest, NextResponse } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { configFile } = body;

    if (!configFile) {
      return NextResponse.json(
        { error: '缺少配置文件参数' },
        { status: 400 }
      );
    }

    // Load config to determine mode
    const configPath = resolve(process.cwd(), 'configs', configFile);
    const configContent = await readFile(configPath, 'utf-8');
    const config = parse(configContent);
    const isStateMachine = config.workflow?.mode === 'state-machine';

    // Select appropriate manager
    const manager = isStateMachine ? stateMachineWorkflowManager : workflowManager;

    // Check if already running before kicking off
    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running') {
      return NextResponse.json(
        { error: '已有工作流正在运行' },
        { status: 409 }
      );
    }

    // Fire-and-forget: kick off the workflow without awaiting completion.
    // Progress and errors are streamed to the client via SSE (/api/workflow/events).
    manager.start(configFile).catch(() => {
      // Errors are already emitted as 'status' events inside start(),
      // so the SSE stream will notify the frontend.
    });

    return NextResponse.json({
      success: true,
      message: '工作流已启动',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '启动工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
