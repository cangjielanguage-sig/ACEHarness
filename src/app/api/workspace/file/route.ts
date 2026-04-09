import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const MAX_FILE_SIZE = 100 * 1024; // 100KB

function isPathSafe(workspace: string, filePath: string, resolvedPath: string): boolean {
  const expectedBase = path.resolve(workspace);
  return resolvedPath.startsWith(expectedBase + path.sep) || resolvedPath === expectedBase;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace');
    const file = searchParams.get('file');

    if (!workspace || !file) {
      return NextResponse.json({ error: '缺少 workspace 或 file 参数' }, { status: 400 });
    }

    const resolvedWorkspace = path.resolve(workspace);
    const fullPath = path.join(resolvedWorkspace, file);
    const realPath = await fs.realpath(fullPath);

    if (!isPathSafe(resolvedWorkspace, file, realPath)) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }

    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: '不是文件' }, { status: 400 });
    }

    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '文件超过 100KB 限制', size: stat.size, path: file },
        { status: 413 }
      );
    }

    const content = await fs.readFile(realPath, 'utf-8');
    return NextResponse.json({ content, size: stat.size, path: file });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
    return NextResponse.json({ error: '读取文件失败', message: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspace, file, content } = body;

    if (!workspace || !file || content === undefined) {
      return NextResponse.json({ error: '缺少 workspace、file 或 content 参数' }, { status: 400 });
    }

    if (new TextEncoder().encode(content).length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '内容超过 100KB 限制' }, { status: 413 });
    }

    const resolvedWorkspace = path.resolve(workspace);
    const fullPath = path.join(resolvedWorkspace, file);
    const dir = path.dirname(fullPath);

    // Ensure parent directory exists before realpath check
    await fs.access(dir);
    const realDir = await fs.realpath(dir);
    if (!realDir.startsWith(resolvedWorkspace)) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }

    await fs.writeFile(fullPath, content, 'utf-8');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: '保存文件失败', message: error.message }, { status: 500 });
  }
}
