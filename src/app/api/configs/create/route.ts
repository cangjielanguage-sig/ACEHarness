import { NextRequest, NextResponse } from 'next/server';
import { writeFile, access } from 'fs/promises';
import { resolve } from 'path';
import { stringify } from 'yaml';
import { newConfigFormSchema } from '@/lib/schemas';

function createPhaseBasedConfig(workflowName: string, description?: string) {
  return {
    workflow: {
      name: workflowName,
      description: description || '',
      type: 'phase-based',
      phases: [
        {
          name: '阶段 1',
          steps: [
            {
              name: '步骤 1',
              agent: 'agent-1',
              task: '请描述任务内容',
            },
          ],
        },
      ],
    },
    context: {
      projectRoot: '',
      requirements: '',
    },
  };
}

function createStateMachineConfig(workflowName: string, description?: string) {
  return {
    workflow: {
      name: workflowName,
      description: description || '',
      type: 'state-machine',
      initialState: '设计',
      states: {
        '设计': {
          maxSelfTransitions: 3,
          onEnter: '执行设计任务',
          transitions: [
            { event: '完成', target: '实施' },
            { event: '有问题', target: '设计' },
          ],
        },
        '实施': {
          maxSelfTransitions: 3,
          onEnter: '执行实施任务',
          transitions: [
            { event: '完成', target: '测试' },
            { event: '失败', target: '设计' },
          ],
        },
        '测试': {
          maxSelfTransitions: 3,
          onEnter: '执行测试任务',
          transitions: [
            { event: '通过', target: '完成' },
            { event: '失败', target: '实施' },
          ],
        },
        '完成': {
          type: 'final',
        },
      },
    },
    context: {
      projectRoot: '',
      requirements: '',
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 验证表单
    const validationResult = newConfigFormSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: '表单验证失败',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { filename, workflowName, description, mode, requirements } = validationResult.data;
    const workflowMode = mode || 'phase-based';

    // 检查文件是否已存在
    const filepath = resolve(process.cwd(), 'configs', filename);
    try {
      await access(filepath);
      return NextResponse.json(
        { error: '文件已存在', message: `${filename} 已存在` },
        { status: 409 }
      );
    } catch {
      // 文件不存在，继续创建
    }

    let defaultConfig: any;

    // AI 引导模式：调用 AI 生成接口
    if (workflowMode === 'ai-guided') {
      const port = process.env.PORT || '3000';
      try {
        const response = await fetch(`http://localhost:${port}/api/configs/ai-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirements, workflowName, filename }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          return NextResponse.json(
            { error: 'AI 生成失败', message: result.message || result.error },
            { status: 500 }
          );
        }
        defaultConfig = result.config;
      } catch (e) {
        // 如果 AI 生成失败，使用默认模板
        defaultConfig = createPhaseBasedConfig(workflowName, description);
      }
    } else if (workflowMode === 'state-machine') {
      defaultConfig = createStateMachineConfig(workflowName, description);
    } else {
      defaultConfig = createPhaseBasedConfig(workflowName, description);
    }

    const yamlContent = stringify(defaultConfig);
    await writeFile(filepath, yamlContent, 'utf-8');

    return NextResponse.json({
      success: true,
      message: workflowMode === 'ai-guided' ? 'AI 引导创建成功！' : '配置文件已创建',
      filename,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '创建配置失败', message: error.message },
      { status: 500 }
    );
  }
}
