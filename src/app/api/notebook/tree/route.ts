import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth-middleware';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

const NOTEBOOK_ROOT_DIRNAME = '.cangjie-notbook';

function getNotebookRoot(personalDir: string) {
  return path.resolve(personalDir, NOTEBOOK_ROOT_DIRNAME);
}

function safeSubPath(root: string, subPath: string): string | null {
  const resolved = path.resolve(root, subPath || '.');
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

async function ensureNotebookRoot(personalDir: string) {
  const notebookRoot = getNotebookRoot(personalDir);
  await fs.mkdir(notebookRoot, { recursive: true });
  return notebookRoot;
}

async function buildTree(dirPath: string, rootPath: string, depth: number, maxDepth: number, visited?: Set<string>): Promise<TreeNode[]> {
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
  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
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
      } catch {}
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
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    if (!auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    const maxDepth = Math.min(parseInt(new URL(request.url).searchParams.get('depth') || '2', 10), 10);
    const subPath = new URL(request.url).searchParams.get('sub') || '';
    const notebookRoot = await ensureNotebookRoot(auth.personalDir);
    const targetPath = safeSubPath(notebookRoot, subPath);

    if (!targetPath) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }

    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: '路径不是目录' }, { status: 400 });
    }

    const tree = await buildTree(targetPath, notebookRoot, 0, maxDepth);
    return NextResponse.json({ tree, rootPath: notebookRoot });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: '目录不存在' }, { status: 404 });
    }
    return NextResponse.json({ error: '读取 Notebook 目录失败', message: error.message }, { status: 500 });
  }
}
