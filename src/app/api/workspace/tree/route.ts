import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

async function buildTree(dirPath: string, rootPath: string, depth: number, maxDepth: number, visited?: Set<string>): Promise<TreeNode[]> {
  // Track visited real paths to avoid symlink cycles
  const seen = visited || new Set<string>();
  let realDir: string;
  try {
    realDir = await fs.realpath(dirPath);
  } catch {
    return [];
  }
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  const filtered = entries.filter(e => !e.name.startsWith('.'));

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of filtered) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          // Only recurse if within depth limit
          const children = depth < maxDepth
            ? await buildTree(fullPath, rootPath, depth + 1, maxDepth, seen)
            : undefined;
          dirs.push({
            name: entry.name,
            path: relativePath,
            type: 'directory',
            children,
          });
        } else if (stat.isFile()) {
          files.push({ name: entry.name, path: relativePath, type: 'file' });
        }
      } catch { /* broken symlink or permission error */ }
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

    const maxDepth = Math.min(parseInt(searchParams.get('depth') || '2', 10), 10);
    // Support loading a subtree from a subpath
    const subPath = searchParams.get('sub') || '';

    const resolvedPath = path.resolve(workspacePath);
    const realPath = await fs.realpath(resolvedPath);
    const stat = await fs.stat(realPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: '路径不是目录' }, { status: 400 });
    }

    const targetPath = subPath ? path.join(realPath, subPath) : realPath;
    const tree = await buildTree(targetPath, realPath, 0, maxDepth);
    return NextResponse.json({ tree });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: '目录不存在' }, { status: 404 });
    }
    return NextResponse.json({ error: '读取目录失败', message: error.message }, { status: 500 });
  }
}
