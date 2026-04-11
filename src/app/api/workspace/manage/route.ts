import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

function isPathSafe(workspace: string, targetPath: string): boolean {
  const resolved = path.resolve(workspace, targetPath);
  const base = path.resolve(workspace);
  return resolved.startsWith(base + path.sep) || resolved === base;
}

function safePath(workspace: string, relPath: string): string | null {
  const resolved = path.resolve(workspace, relPath);
  const base = path.resolve(workspace);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspace, action, ...params } = body;

    if (!workspace || !action) {
      return NextResponse.json({ error: '缺少 workspace 或 action 参数' }, { status: 400 });
    }

    const resolvedWorkspace = path.resolve(workspace);
    if (!existsSync(resolvedWorkspace)) {
      return NextResponse.json({ error: '工作目录不存在' }, { status: 404 });
    }

    switch (action) {
      case 'create-file': {
        const fullPath = safePath(resolvedWorkspace, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, params.content || '', 'utf-8');
        return NextResponse.json({ success: true });
      }

      case 'create-folder': {
        const fullPath = safePath(resolvedWorkspace, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(fullPath, { recursive: true });
        return NextResponse.json({ success: true });
      }

      case 'rename': {
        const oldFull = safePath(resolvedWorkspace, params.oldPath);
        const newFull = safePath(resolvedWorkspace, params.newPath);
        if (!oldFull || !newFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(oldFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(newFull), { recursive: true });
        await fs.rename(oldFull, newFull);
        return NextResponse.json({ success: true });
      }

      case 'delete': {
        const fullPath = safePath(resolvedWorkspace, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(fullPath)) return NextResponse.json({ error: '路径不存在' }, { status: 404 });
        await fs.rm(fullPath, { recursive: true, force: true });
        return NextResponse.json({ success: true });
      }

      case 'copy': {
        const srcFull = safePath(resolvedWorkspace, params.srcPath);
        const destFull = safePath(resolvedWorkspace, params.destPath);
        if (!srcFull || !destFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        await fs.cp(srcFull, destFull, { recursive: true });
        return NextResponse.json({ success: true });
      }

      case 'move': {
        const srcFull = safePath(resolvedWorkspace, params.srcPath);
        const destFull = safePath(resolvedWorkspace, params.destPath);
        if (!srcFull || !destFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        try {
          await fs.rename(srcFull, destFull);
        } catch {
          // Cross-device: fallback to copy + delete
          await fs.cp(srcFull, destFull, { recursive: true });
          await fs.rm(srcFull, { recursive: true, force: true });
        }
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: '操作失败', message: error.message }, { status: 500 });
  }
}