import { NextRequest, NextResponse } from 'next/server';
import { loadRunState } from '@/lib/run-state-persistence';
import { readdir, stat, readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const runId = (await params).id;
  const filePath = request.nextUrl.searchParams.get('file');

  try {
    // Load run state to get projectRoot from config
    const state = await loadRunState(runId);
    if (!state) {
      return NextResponse.json({ error: '未找到运行记录' }, { status: 404 });
    }

    // Read config to get projectRoot
    let projectRoot = '';
    try {
      // Try direct path first, then with configs/ prefix
      let configPath = resolve(process.cwd(), state.configFile);
      if (!existsSync(configPath)) {
        configPath = resolve(process.cwd(), 'configs', state.configFile);
      }
      const configContent = await readFile(configPath, 'utf-8');
      const config = parse(configContent);
      projectRoot = config?.context?.projectRoot || '';
    } catch { /* ignore */ }

    if (!projectRoot) {
      return NextResponse.json({ error: '未配置项目根目录' }, { status: 400 });
    }

    const aceOutputDir = resolve(process.cwd(), projectRoot, '.ace-outputs', runId);
    if (!existsSync(aceOutputDir)) {
      return NextResponse.json({ error: '文档目录不存在', files: [] }, { status: 200 });
    }

    // If requesting a specific file's content
    if (filePath) {
      const safePath = filePath.replace(/\.\./g, '');
      const fullPath = resolve(aceOutputDir, safePath);
      if (!fullPath.startsWith(aceOutputDir)) {
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
    const entries = await readdir(aceOutputDir);
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
    } catch { /* ignore */ }

    const files = [];
    for (const entry of entries) {
      if (!entry.endsWith('.md') && !entry.endsWith('.txt')) continue;
      const fullPath = resolve(aceOutputDir, entry);
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

    return NextResponse.json({ files, aceOutputDir });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取文档失败', message: error.message },
      { status: 500 }
    );
  }
}
