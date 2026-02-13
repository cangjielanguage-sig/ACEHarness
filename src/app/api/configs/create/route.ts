import { NextRequest, NextResponse } from 'next/server';
import { writeFile, access } from 'fs/promises';
import { resolve } from 'path';
import { stringify } from 'yaml';
import { newConfigFormSchema } from '@/lib/schemas';

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

    const { filename, workflowName, description } = validationResult.data;

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

    // 创建默认配置模板
    const defaultConfig = {
      workflow: {
        name: workflowName,
        description: description || '',
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

    const yamlContent = stringify(defaultConfig);
    await writeFile(filepath, yamlContent, 'utf-8');

    return NextResponse.json({
      success: true,
      message: '配置文件已创建',
      filename,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '创建配置失败', message: error.message },
      { status: 500 }
    );
  }
}
