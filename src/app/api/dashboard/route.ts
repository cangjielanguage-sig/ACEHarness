import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { listConfigsWithMeta } from '@/lib/config-metadata';

const RUNS_DIR = resolve(process.cwd(), 'runs');
const CONFIGS_DIR = resolve(process.cwd(), 'configs');
const AGENTS_DIR = resolve(CONFIGS_DIR, 'agents');

// ── In-memory cache with background refresh ──
let cachedResult: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10_000; // 10s — background refresh interval
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

async function computeDashboardData(userId = '', role: 'admin' | 'user' = 'admin') {
  const [configResult, agentCount, runsResult] = await Promise.all([
    readConfigsSummary(userId, role),
    readAgentCount(),
    readAllRunsSummary(),
  ]);

  const { configs, configNameMap } = configResult;
  const { runs, agentUsage } = runsResult;

  const totalRuns = runs.length;
  const completed = runs.filter(r => r.status === 'completed').length;
  const successRate = totalRuns > 0 ? Math.round((completed / totalRuns) * 100) : 0;
  const runningRuns = runs.filter(r => r.status === 'running');

  let totalDuration = 0;
  let durationCount = 0;
  for (const r of runs) {
    if (r.endTime) {
      totalDuration += new Date(r.endTime).getTime() - new Date(r.startTime).getTime();
      durationCount++;
    }
  }
  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount / 1000 / 60) : 0;

  for (const r of runs) {
    r.configName = configNameMap[r.configFile] || r.configFile;
  }

  runs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const recentRuns = runs.slice(0, 5);

  // Weekly activity
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const dayCounts: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const r of runs) {
    const t = new Date(r.startTime).getTime();
    if (t >= sevenDaysAgo) {
      const daysAgo = Math.floor((now - t) / (24 * 60 * 60 * 1000));
      if (daysAgo >= 0 && daysAgo < 7) dayCounts[6 - daysAgo]++;
    }
  }
  const activityData = dayCounts.map((count, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { dayOfWeek: d.getDay(), runs: count };
  });

  const topAgents = Object.entries(agentUsage)
    .map(([name, data]) => ({ name, calls: data.calls, cost: Math.round(data.cost * 10000) / 10000 }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  return {
    stats: {
      totalRuns, successRate, avgDuration,
      activeWorkflows: configs.length,
      totalAgents: agentCount,
      runningProcesses: runningRuns.length,
    },
    configs,
    recentRuns,
    runningRuns: runningRuns.map(r => ({
      id: r.id, configFile: r.configFile, configName: r.configName,
      startTime: r.startTime, status: r.status, currentPhase: r.currentPhase,
    })),
    agentUsageData: topAgents,
    activityData,
  };
}

async function refreshCache() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    cachedResult = await computeDashboardData();
    cacheTimestamp = Date.now();
  } catch (e) {
    console.error('[dashboard cache] refresh failed:', e);
  } finally {
    isRefreshing = false;
  }
}

// Start background refresh timer on first import
if (!refreshTimer) {
  refreshTimer = setInterval(() => {
    refreshCache().catch(() => {});
  }, CACHE_TTL);
  // Don't block module load — kick off first refresh async
  refreshCache().catch(() => {});
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const result = await computeDashboardData(auth.id, auth.role);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Dashboard data load failed', message: error.message },
      { status: 500 }
    );
  }
}

// ── Data readers (unchanged logic, parallel I/O) ──

async function readConfigsSummary(userId: string, role: 'admin' | 'user') {
  const configNameMap: Record<string, string> = {};
  const configs: any[] = [];
  const metaMap = await listConfigsWithMeta('workflow');
  try {
    const entries = await readdir(CONFIGS_DIR, { withFileTypes: true });
    const yamlFiles = entries.filter(e => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')));
    const results = await Promise.all(
      yamlFiles.map(async (entry) => {
        const meta = metaMap[entry.name];
        if (meta?.visibility === 'private' && meta.createdBy && meta.createdBy !== userId && role !== 'admin') {
          return null;
        }
        try {
          const content = await readFile(resolve(CONFIGS_DIR, entry.name), 'utf-8');
          const config = parse(content);
          const name = config?.workflow?.name || entry.name;
          configNameMap[entry.name] = name;
          const mode = config?.workflow?.mode || 'phase-based';
          const items = mode === 'state-machine' ? config?.workflow?.states : config?.workflow?.phases;
          return {
            filename: entry.name, name,
            description: config?.workflow?.description || '', mode,
            phaseCount: items?.length || 0,
            stepCount: items?.reduce((s: number, p: any) => s + (p.steps?.length || 0), 0) || 0,
          };
        } catch {
          configNameMap[entry.name] = entry.name;
          return { filename: entry.name, name: entry.name, description: '(解析失败)', mode: 'phase-based', phaseCount: 0, stepCount: 0 };
        }
      })
    );
    configs.push(...results.filter(Boolean));
  } catch {}
  return { configs, configNameMap };
}

async function readAgentCount(): Promise<number> {
  try {
    const files = await readdir(AGENTS_DIR);
    return files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
  } catch { return 0; }
}

interface RunSummary {
  id: string; configFile: string; configName: string;
  startTime: string; endTime: string | null; status: string;
  currentPhase: string | null; totalSteps: number; completedSteps: number;
}

async function readAllRunsSummary() {
  const runs: RunSummary[] = [];
  const agentUsage: Record<string, { calls: number; cost: number }> = {};
  if (!existsSync(RUNS_DIR)) return { runs, agentUsage };

  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

  // Read all state.yaml in parallel
  const results = await Promise.all(
    dirs.map(async (entry) => {
      const stateFile = resolve(RUNS_DIR, entry.name, 'state.yaml');
      if (!existsSync(stateFile)) return null;
      try {
        const content = await readFile(stateFile, 'utf-8');
        return { dirName: entry.name, state: parse(content) };
      } catch { return null; }
    })
  );

  const valid = results.filter(Boolean) as { dirName: string; state: any }[];
  valid.sort((a, b) => new Date(b.state.startTime).getTime() - new Date(a.state.startTime).getTime());

  for (const { state } of valid) {
    runs.push({
      id: state.runId, configFile: state.configFile, configName: state.configFile,
      startTime: state.startTime, endTime: state.endTime, status: state.status,
      currentPhase: state.currentPhase || null,
      totalSteps: (state.completedSteps?.length || 0) + (state.failedSteps?.length || 0),
      completedSteps: state.completedSteps?.length || 0,
    });
  }

  // Agent usage from recent 50
  for (const { state } of valid.slice(0, 50)) {
    if (state.stepLogs) {
      for (const log of state.stepLogs) {
        if (!log.agent) continue;
        if (!agentUsage[log.agent]) agentUsage[log.agent] = { calls: 0, cost: 0 };
        agentUsage[log.agent].calls += 1;
        agentUsage[log.agent].cost += log.costUsd || 0;
      }
    }
    if (state.agents) {
      for (const ag of state.agents) {
        if (!ag.name) continue;
        if (!agentUsage[ag.name]) agentUsage[ag.name] = { calls: 0, cost: 0 };
        if (agentUsage[ag.name].calls === 0) {
          agentUsage[ag.name].calls = ag.completedTasks || 0;
          agentUsage[ag.name].cost = ag.costUsd || 0;
        }
      }
    }
  }

  return { runs, agentUsage };
}
