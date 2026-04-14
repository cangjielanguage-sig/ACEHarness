import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { newFilename, workflowName } = await request.json();
    if (!newFilename || !/^[a-zA-Z0-9_-]+\.yaml$/.test(newFilename)) {
      return NextResponse.json({ error: '无效的文件名' }, { status: 400 });
    }

    const filename = (await params).filename;
    const sourcePath = resolve(process.cwd(), 'configs', filename);
    const destPath = resolve(process.cwd(), 'configs', newFilename);

    if (existsSync(destPath)) {
      return NextResponse.json({ error: '目标文件已存在' }, { status: 409 });
    }

    const content = await readFile(sourcePath, 'utf-8');
    const config = parse(content);
    config.workflow.name = workflowName || (config.workflow.name + ' (副本)');
    await writeFile(destPath, stringify(config), 'utf-8');

    return NextResponse.json({ success: true, filename: newFilename });
  } catch (error: any) {
    return NextResponse.json(
      { error: '复制配置失败', message: error.message },
      { status: 500 }
    );
  }
}
