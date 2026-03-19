import { NextRequest, NextResponse } from 'next/server';
import { loadRunState } from '@/lib/run-state-persistence';
import { readdir, stat, readFile, rename, unlink } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';

/** Resolve the .ace-outputs dir and runs/outputs dir for a given runId */
async function resolveOutputDirs(runId: string) {
  const state = await loadRunState(runId);
  if (!state) return null;

  let projectRoot = '';
  try {
    let configPath = resolve(process.cwd(), state.configFile);
    if (!existsSync(configPath)) configPath = resolve(process.cwd(), 'configs', state.configFile);
    const config = parse(await readFile(configPath, 'utf-8'));
    projectRoot = config?.context?.projectRoot || '';
  } catch { /* ignore */ }

  if (!projectRoot) return null;

  const aceDir = resolve(process.cwd(), projectRoot, '.ace-outputs', runId);
  const runsDir = resolve(process.cwd(), 'runs', runId, 'outputs');
  return { state, projectRoot, aceDir, runsDir };
}

function safePath(dir: string, file: string): string | null {
  const safe = file.replace(/\.\./g, '');
  const full = resolve(dir, safe);
  return full.startsWith(dir) ? full : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  const filePath = request.nextUrl.searchParams.get('file');

  try {
    const dirs = await resolveOutputDirs(runId);
    if (!dirs) return NextResponse.json({ error: '未找到运行记录或未配置项目根目录' }, { status: 404 });
    const { state, aceDir } = dirs;

    if (!existsSync(aceDir)) {
      return NextResponse.json({ error: '文档目录不存在', files: [] }, { status: 200 });
    }

    // If requesting a specific file's content
    if (filePath) {
      const safePath = filePath.replace(/\.\./g, '');
      const fullPath = resolve(aceDir, safePath);
      if (!fullPath.startsWith(aceDir)) {
        return NextResponse.json({ error: '非法路径' }, { status: 400 });
      }
      try {
        const content = await readFile(fullPath, 'utf-8');
        return NextResponse.json({ file: filePath, content });
      } catch {
        return NextResponse.json({ error: '文件不存在' }, { status: 404 });
      }
    }

    // List all documents
    const entries = await readdir(aceDir);
    const iterRegex = /^(.+)-迭代(\d+)\.md$/;
    const versionRegex = /^(.+)-v(\d+)\.md$/;

    // Build step→phase/agent lookup from config (once, outside loop)
    const stepMap: Record<string, { agent: string; phaseName: string; role: string }> = {};
    try {
      const configPath = resolve(process.cwd(), state.configFile);
      const configContent = await readFile(configPath, 'utf-8');
      const config = parse(configContent);
      if (config?.workflow?.phases) {
        for (const phase of config.workflow.phases) {
          for (const step of phase.steps || []) {
            const safeStep = step.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
            const info = { agent: step.agent || '', phaseName: phase.name, role: step.role || 'defender' };
            stepMap[step.name] = info;
            stepMap[safeStep] = info;
          }
        }
      }
      // State machine mode: states instead of phases
      if (config?.workflow?.states) {
        for (const state of config.workflow.states) {
          for (const step of state.steps || []) {
            const safeStep = step.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
            const info = { agent: step.agent || '', phaseName: state.name, role: step.role || 'defender' };
            stepMap[step.name] = info;
            stepMap[safeStep] = info;
            // Also map "stateName-stepName" format used in output filenames
            const compositeKey = `${state.name}-${step.name}`;
            const safeComposite = compositeKey.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
            stepMap[compositeKey] = info;
            stepMap[safeComposite] = info;
          }
        }
      }
    } catch { /* ignore */ }

    const files = [];
    for (const entry of entries) {
      if (!entry.endsWith('.md') && !entry.endsWith('.txt')) continue;
      const fullPath = resolve(aceDir, entry);
      const fileStat = await stat(fullPath);

      let baseName = entry.replace(/\.(md|txt)$/, '');
      let iteration: number | null = null;
      let stepName = baseName;

      // Parse iteration from filename
      const iterMatch = entry.match(iterRegex);
      const verMatch = entry.match(versionRegex);
      if (iterMatch) {
        stepName = iterMatch[1];
        iteration = parseInt(iterMatch[2], 10);
      } else if (verMatch) {
        stepName = verMatch[1];
        iteration = parseInt(verMatch[2], 10);
      } else {
        iteration = 1;
      }

      const info = stepMap[stepName] || { agent: '', phaseName: '', role: '' };

      files.push({
        filename: entry,
        stepName,
        baseName,
        iteration,
        agent: info.agent,
        phaseName: info.phaseName,
        role: info.role,
        size: fileStat.size,
        modifiedTime: fileStat.mtime.toISOString(),
      });
    }

    // Sort: by modifiedTime
    files.sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime());

    return NextResponse.json({ files, aceDir });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取文档失败', message: error.message },
      { status: 500 }
    );
  }
}

/** Rename a document */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  try {
    const { file, newName } = await request.json();
    if (!file || !newName) return NextResponse.json({ error: '缺少参数' }, { status: 400 });

    const dirs = await resolveOutputDirs(runId);
    if (!dirs) return NextResponse.json({ error: '未找到运行记录' }, { status: 404 });

    // Ensure newName has extension
    const ext = file.match(/\.(md|txt)$/)?.[0] || '.md';
    const finalName = newName.endsWith(ext) ? newName : newName + ext;

    const oldPath = safePath(dirs.aceDir, file);
    const newPath = safePath(dirs.aceDir, finalName);
    if (!oldPath || !newPath) return NextResponse.json({ error: '非法路径' }, { status: 400 });
    if (!existsSync(oldPath)) return NextResponse.json({ error: '文件不存在' }, { status: 404 });

    await rename(oldPath, newPath);

    // Sync runs/outputs if exists
    const oldRuns = safePath(dirs.runsDir, file);
    const newRuns = safePath(dirs.runsDir, finalName);
    if (oldRuns && newRuns && existsSync(oldRuns)) {
      await rename(oldRuns, newRuns).catch(() => {});
    }

    return NextResponse.json({ ok: true, newFilename: finalName });
  } catch (error: any) {
    return NextResponse.json({ error: '重命名失败', message: error.message }, { status: 500 });
  }
}

/** Delete document(s) */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  try {
    const { files } = await request.json() as { files: string[] };
    if (!files?.length) return NextResponse.json({ error: '缺少参数' }, { status: 400 });

    const dirs = await resolveOutputDirs(runId);
    if (!dirs) return NextResponse.json({ error: '未找到运行记录' }, { status: 404 });

    const deleted: string[] = [];
    for (const file of files) {
      const fullPath = safePath(dirs.aceDir, file);
      if (!fullPath || !existsSync(fullPath)) continue;
      await unlink(fullPath);
      deleted.push(file);
      // Sync runs/outputs
      const runsPath = safePath(dirs.runsDir, file);
      if (runsPath && existsSync(runsPath)) await unlink(runsPath).catch(() => {});
    }

    return NextResponse.json({ ok: true, deleted });
  } catch (error: any) {
    return NextResponse.json({ error: '删除失败', message: error.message }, { status: 500 });
  }
}
