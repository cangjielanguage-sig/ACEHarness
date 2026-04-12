import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth-middleware';

const MAX_FILE_SIZE = 200 * 1024;
const NOTEBOOK_ROOT_DIRNAME = '.cangjie-notbook';

function getNotebookRoot(personalDir: string) {
  return path.resolve(personalDir, NOTEBOOK_ROOT_DIRNAME);
}

function isPathSafe(root: string, resolvedPath: string) {
  return resolvedPath.startsWith(root + path.sep) || resolvedPath === root;
}

async function ensureNotebookRoot(personalDir: string) {
  const notebookRoot = getNotebookRoot(personalDir);
  await fs.mkdir(notebookRoot, { recursive: true });
  return notebookRoot;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    if (!auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');
    const mode = searchParams.get('mode');

    if (!file) {
      return NextResponse.json({ error: '缺少 file 参数' }, { status: 400 });
    }

    const notebookRoot = await ensureNotebookRoot(auth.personalDir);
    const fullPath = path.join(notebookRoot, file);
    const realPath = await fs.realpath(fullPath);

    if (!isPathSafe(notebookRoot, realPath)) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }

    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: '不是文件' }, { status: 400 });
    }

    if (mode === 'blob') {
      const buffer = await fs.readFile(realPath);
      const ext = path.extname(file).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
      };
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': mimeMap[ext] || 'application/octet-stream',
          'Content-Length': String(stat.size),
        },
      });
    }

    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '文件超过 200KB 限制', size: stat.size, path: file }, { status: 413 });
    }

    const content = await fs.readFile(realPath, 'utf-8');
    return NextResponse.json({ content, size: stat.size, path: file });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
    return NextResponse.json({ error: '读取 Notebook 文件失败', message: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    if (!auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    const body = await request.json();
    const { file, content } = body;

    if (!file || content === undefined) {
      return NextResponse.json({ error: '缺少 file 或 content 参数' }, { status: 400 });
    }

    if (new TextEncoder().encode(content).length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '内容超过 200KB 限制' }, { status: 413 });
    }

    const notebookRoot = await ensureNotebookRoot(auth.personalDir);
    const fullPath = path.join(notebookRoot, file);
    const dir = path.dirname(fullPath);
    const resolvedDir = path.resolve(dir);

    if (!isPathSafe(notebookRoot, resolvedDir)) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }

    await fs.mkdir(dir, { recursive: true });
    const realDir = await fs.realpath(dir);
    if (!isPathSafe(notebookRoot, realDir)) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }

    await fs.writeFile(fullPath, content, 'utf-8');
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: '保存 Notebook 文件失败', message: error.message }, { status: 500 });
  }
}
