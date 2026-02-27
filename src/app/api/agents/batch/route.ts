import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, fromModel, toModel } = body;

    if (action !== 'replace-model') {
      return NextResponse.json(
        { error: '不支持的操作' },
        { status: 400 }
      );
    }

    if (!fromModel || !toModel) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const agentsDir = resolve(process.cwd(), 'configs', 'agents');
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    let updatedCount = 0;

    for (const file of yamlFiles) {
      try {
        const filepath = resolve(agentsDir, file);
        const content = await readFile(filepath, 'utf-8');
        const agent = parse(content);

        if (agent.model === fromModel) {
          agent.model = toModel;
          const yamlContent = stringify(agent);
          await writeFile(filepath, yamlContent, 'utf-8');
          updatedCount++;
        }
      } catch (error) {
        console.error(`Failed to update ${file}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `已更新 ${updatedCount} 个 Agent 的模型配置`,
      updatedCount,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '批量操作失败', message: error.message },
      { status: 500 }
    );
  }
}
