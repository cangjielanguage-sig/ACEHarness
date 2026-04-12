import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { requireAuth } from '@/lib/auth-middleware';

const NOTEBOOK_ROOT_DIRNAME = '.cangjie-notbook';

function getNotebookRoot(personalDir: string) {
  return path.resolve(personalDir, NOTEBOOK_ROOT_DIRNAME);
}

function safePath(root: string, relPath: string): string | null {
  const resolved = path.resolve(root, relPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

async function ensureNotebookRoot(personalDir: string) {
  const notebookRoot = getNotebookRoot(personalDir);
  await fs.mkdir(notebookRoot, { recursive: true });
  return notebookRoot;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    if (!auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    const body = await request.json();
    const { action, ...params } = body;

    if (!action) {
      return NextResponse.json({ error: '缺少 action 参数' }, { status: 400 });
    }

    const notebookRoot = await ensureNotebookRoot(auth.personalDir);
    if (!existsSync(notebookRoot)) {
      return NextResponse.json({ error: 'Notebook 目录不存在' }, { status: 404 });
    }

    switch (action) {
      case 'create-file': {
        const fullPath = safePath(notebookRoot, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, params.content || '', 'utf-8');
        return NextResponse.json({ success: true });
      }
      case 'create-folder': {
        const fullPath = safePath(notebookRoot, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(fullPath, { recursive: true });
        return NextResponse.json({ success: true });
      }
      case 'rename': {
        const oldFull = safePath(notebookRoot, params.oldPath);
        const newFull = safePath(notebookRoot, params.newPath);
        if (!oldFull || !newFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(oldFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(newFull), { recursive: true });
        await fs.rename(oldFull, newFull);
        return NextResponse.json({ success: true });
      }
      case 'delete': {
        const fullPath = safePath(notebookRoot, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(fullPath)) return NextResponse.json({ error: '路径不存在' }, { status: 404 });
        await fs.rm(fullPath, { recursive: true, force: true });
        return NextResponse.json({ success: true });
      }
      case 'copy': {
        const srcFull = safePath(notebookRoot, params.srcPath);
        const destFull = safePath(notebookRoot, params.destPath);
        if (!srcFull || !destFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        await fs.cp(srcFull, destFull, { recursive: true });
        return NextResponse.json({ success: true });
      }
      case 'move': {
        const srcFull = safePath(notebookRoot, params.srcPath);
        const destFull = safePath(notebookRoot, params.destPath);
        if (!srcFull || !destFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        try {
          await fs.rename(srcFull, destFull);
        } catch {
          await fs.cp(srcFull, destFull, { recursive: true });
          await fs.rm(srcFull, { recursive: true, force: true });
        }
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: 'Notebook 操作失败', message: error.message }, { status: 500 });
  }
}
