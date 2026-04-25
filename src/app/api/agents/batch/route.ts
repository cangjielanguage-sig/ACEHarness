import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getRuntimeAgentsDirPath } from '@/lib/runtime-configs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, engine, fromModel, toModel } = body;

    if (action !== 'replace-model') {
      return NextResponse.json(
        { error: '不支持的操作' },
        { status: 400 }
      );
    }

    if (fromModel === undefined || !toModel) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const agentsDir = await getRuntimeAgentsDirPath();
    const files = await readdir(agentsDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    let updatedCount = 0;
    // engine key: "" means follow-global, undefined means match all engines
    const targetEngine = engine ?? undefined;

    for (const file of yamlFiles) {
      try {
        const filepath = resolve(agentsDir, file);
        const content = await readFile(filepath, 'utf-8');
        const agent = parse(content);

        if (agent.engineModels && typeof agent.engineModels === 'object') {
          let changed = false;
          const engines = targetEngine !== undefined
            ? [targetEngine]
            : Object.keys(agent.engineModels);

          for (const eng of engines) {
            if (agent.engineModels[eng] === fromModel) {
              agent.engineModels[eng] = toModel;
              changed = true;
            }
          }
          if (changed) {
            await writeFile(filepath, stringify(agent), 'utf-8');
            updatedCount++;
          }
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
