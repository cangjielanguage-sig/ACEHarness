import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

async function buildTree(dirPath: string, rootPath: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  const filtered = entries.filter(e => !e.name.startsWith('.'));

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of filtered) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, rootPath);
      dirs.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      files.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
      });
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return [...dirs, ...files];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspacePath = searchParams.get('path');

    if (!workspacePath) {
      return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
    }

    const resolvedPath = path.resolve(workspacePath);
    const realPath = await fs.realpath(resolvedPath);
    const stat = await fs.stat(realPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: '路径不是目录' }, { status: 400 });
    }

    const tree = await buildTree(realPath, realPath);
    return NextResponse.json({ tree });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: '目录不存在' }, { status: 404 });
    }
    return NextResponse.json({ error: '读取目录失败', message: error.message }, { status: 500 });
  }
}
