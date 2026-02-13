import { readdir, readFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';

const RUNS_DIR = resolve(process.cwd(), 'runs');

export interface RunRecord {
  id: string;
  configFile: string;
  startTime: string;
  endTime: string | null;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'crashed';
  phaseReached: string;
  totalSteps: number;
  completedSteps: number;
}

async function ensureRunsDir() {
  if (!existsSync(RUNS_DIR)) {
    await mkdir(RUNS_DIR, { recursive: true });
  }
}

/**
 * createRun — 只创建目录，state.yaml 由 persistState 写入
 */
export async function createRun(record: RunRecord): Promise<void> {
  await ensureRunsDir();
  const runDir = resolve(RUNS_DIR, record.id);
  if (!existsSync(runDir)) {
    await mkdir(runDir, { recursive: true });
  }
}

/**
 * updateRun — 不再需要，状态全部由 state.yaml 管理
 * 保留空实现以兼容调用方
 */
export async function updateRun(_id: string, _patch: Partial<RunRecord>): Promise<void> {
  // No-op: all state is persisted via state.yaml by workflow-manager.persistState()
}

export async function getRun(id: string): Promise<RunRecord | null> {
  try {
    const stateFile = resolve(RUNS_DIR, id, 'state.yaml');
    const content = await readFile(stateFile, 'utf-8');
    const state = parse(content);
    return {
      id: state.runId,
      configFile: state.configFile,
      startTime: state.startTime,
      endTime: state.endTime,
      status: state.status,
      phaseReached: state.currentPhase || '',
      totalSteps: (state.completedSteps?.length || 0) + (state.failedSteps?.length || 0),
      completedSteps: state.completedSteps?.length || 0,
    };
  } catch {
    return null;
  }
}

export async function listRuns(): Promise<RunRecord[]> {
  await ensureRunsDir();
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const runs: RunRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const stateFile = resolve(RUNS_DIR, entry.name, 'state.yaml');
      if (!existsSync(stateFile)) continue;
      const content = await readFile(stateFile, 'utf-8');
      const state = parse(content);
      runs.push({
        id: state.runId,
        configFile: state.configFile,
        startTime: state.startTime,
        endTime: state.endTime,
        status: state.status,
        phaseReached: state.currentPhase || '',
        totalSteps: (state.completedSteps?.length || 0) + (state.failedSteps?.length || 0),
        completedSteps: state.completedSteps?.length || 0,
      });
    } catch { /* skip corrupted */ }
  }

  runs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return runs;
}

export async function listRunsByConfig(configFile: string): Promise<RunRecord[]> {
  const all = await listRuns();
  return all.filter((r) => r.configFile === configFile);
}
