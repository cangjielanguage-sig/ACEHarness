import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir, writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { workflowConfigSchema } from '@/lib/schemas';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const filename = (await params).filename;
    const filepath = resolve(process.cwd(), 'configs', filename);
    const content = await readFile(filepath, 'utf-8');
    const config = parse(content);

    // Load agents from configs/agents/*.yaml
    const agents: any[] = [];
    try {
      const agentsDir = resolve(process.cwd(), 'configs', 'agents');
      const files = await readdir(agentsDir);
      for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
        try {
          const agentContent = await readFile(resolve(agentsDir, file), 'utf-8');
          const agent = parse(agentContent);
          if (agent?.name) agents.push(agent);
        } catch { /* skip */ }
      }
    } catch { /* agents dir may not exist */ }

    return NextResponse.json({ config, raw: content, agents });
  } catch (error: any) {
    return NextResponse.json(
      { error: '读取配置失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const filename = (await params).filename;
    const body = await request.json();
    const { config } = body;

    // Strip roles before saving — agents are managed separately
    const { roles, ...configWithoutRoles } = config;

    // Validate config (roles is optional now)
    const validationResult = workflowConfigSchema.safeParse(configWithoutRoles);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: '配置验证失败',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const filepath = resolve(process.cwd(), 'configs', filename);
    const yamlContent = stringify(configWithoutRoles);
    await writeFile(filepath, yamlContent, 'utf-8');

    return NextResponse.json({ success: true, message: '配置已保存' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '保存配置失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const filename = (await params).filename;
    if (filename.includes('..') || filename.includes('/')) {
      return NextResponse.json({ error: '无效文件名' }, { status: 400 });
    }
    const filepath = resolve(process.cwd(), 'configs', filename);
    await unlink(filepath);
    return NextResponse.json({ success: true, message: '配置已删除' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '删除配置失败', message: error.message },
      { status: 500 }
    );
  }
}
