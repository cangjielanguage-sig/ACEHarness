import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';

export async function GET(request: NextRequest) {
  try {
    const configsDir = resolve(process.cwd(), 'configs');
    const files = await readdir(configsDir);
    const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    // Count agents from configs/agents/ directory
    let agentCount = 0;
    try {
      const agentsDir = resolve(configsDir, 'agents');
      const agentFiles = await readdir(agentsDir);
      agentCount = agentFiles.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).length;
    } catch { /* agents dir may not exist */ }

    const configs = [];
    for (const file of yamlFiles) {
      try {
        const content = await readFile(resolve(configsDir, file), 'utf-8');
        const config = parse(content);
        configs.push({
          filename: file,
          name: config?.workflow?.name || file,
          description: config?.workflow?.description || '',
          phaseCount: config?.workflow?.phases?.length || 0,
          stepCount: config?.workflow?.phases?.reduce(
            (sum: number, p: any) => sum + (p.steps?.length || 0), 0
          ) || 0,
          agentCount,
        });
      } catch {
        configs.push({
          filename: file,
          name: file,
          description: '(解析失败)',
          phaseCount: 0,
          stepCount: 0,
          agentCount: 0,
        });
      }
    }

    return NextResponse.json({ files: yamlFiles, configs });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取配置列表失败', message: error.message },
      { status: 500 }
    );
  }
}
