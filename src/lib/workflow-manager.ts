/**
 * 工作流管理器
 * 负责工作流的执行和状态管理，支持对抗迭代工作流
 */

import { EventEmitter } from 'events';
import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { processManager } from './process-manager';
import type { ClaudeJsonResult } from './process-manager';
import { createRun, updateRun } from './run-store';
import type { RunRecord } from './run-store';
import {
  saveRunState, saveProcessOutput, saveOutputToWorkspace, saveStreamContent, loadStepOutputs, loadRunState, findRunningRuns, isProcessAlive,
  type PersistedRunState, type PersistedProcessInfo, type PersistedStepLog,
} from './run-state-persistence';
import type { WorkflowConfig, WorkflowPhase, WorkflowStep, RoleConfig, IterationConfig } from './schemas';
import { formatTimestamp } from './utils';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChangeRecord {
  file: string;
  action: 'created' | 'modified' | 'deleted';
  description: string;
}

export interface AgentState {
  name: string;
  team: string;
  model: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  currentTask: string | null;
  completedTasks: number;
  tokenUsage: TokenUsage;
  costUsd: number;
  sessionId: string | null;
  iterationCount: number;
  lastOutput: string;
  summary: string;
  changes: ChangeRecord[];
}

export interface IterationState {
  phaseName: string;
  currentIteration: number;
  maxIterations: number;
  consecutiveCleanRounds: number;
  status: 'running' | 'completed' | 'escalated';
  bugsFoundPerRound: number[];
}

class WorkflowManager extends EventEmitter {
  private currentWorkflow: WorkflowConfig | null = null;
  private logs: any[] = [];
  private status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped' = 'idle';
  private agents: AgentState[] = [];
  private currentPhase: string | null = null;
  private currentStep: string | null = null;
  private shouldStop: boolean = false;
  private iterationStates: Map<string, IterationState> = new Map();
  private currentRunId: string | null = null;
  private currentConfigFile: string | null = null;
  private agentConfigs: RoleConfig[] = [];
  private completedStepNames: string[] = [];
  private failedStepNames: string[] = [];
  private stepLogs: PersistedStepLog[] = [];
  private forceCompleteFlag: boolean = false;
  private runStartTime: string | null = null;
  private runEndTime: string | null = null;
  /** Agent name → session_id for --resume in iterative phases */
  private agentSessionIds: Map<string, string> = new Map();
  private statusReason: string | null = null;
  private pendingCheckpoint: { phase: string; checkpoint: string; message: string; isIterativePhase: boolean } | null = null;
  /** Pre-queued action for the next waitForApproval call (set by resume with action) */
  private queuedApprovalAction: 'approve' | 'iterate' | null = null;

  private async loadAgentConfigs(): Promise<RoleConfig[]> {
    const agentsDir = resolve(process.cwd(), 'configs', 'agents');
    try {
      const files = await readdir(agentsDir);
      const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      const configs: RoleConfig[] = [];
      for (const file of yamlFiles) {
        try {
          const content = await readFile(resolve(agentsDir, file), 'utf-8');
          const agent = parse(content);
          if (agent?.name) configs.push(agent);
        } catch { /* skip malformed */ }
      }
      return configs;
    } catch {
      return [];
    }
  }

  private getActiveProcessPids(): PersistedProcessInfo[] {
    return processManager.getAllProcesses()
      .filter(p => p.status === 'running')
      .map(p => ({
        pid: p.pid || 0,
        id: p.id,
        agent: p.agent,
        step: p.step,
        startTime: p.startTime.toISOString(),
      }));
  }

  private async persistState(): Promise<void> {
    if (!this.currentRunId) return;
    try {
      const state: PersistedRunState = {
        runId: this.currentRunId,
        configFile: this.currentConfigFile || '',
        status: this.status === 'idle' ? 'running' : this.status as PersistedRunState['status'],
        statusReason: this.statusReason || undefined,
        startTime: this.runStartTime || new Date().toISOString(),
        endTime: this.runEndTime || null,
        currentPhase: this.currentPhase,
        currentStep: this.currentStep,
        completedSteps: [...this.completedStepNames],
        failedSteps: [...this.failedStepNames],
        stepLogs: [...this.stepLogs],
        agents: this.agents.map(a => ({
          name: a.name,
          team: a.team,
          model: a.model,
          status: a.status,
          completedTasks: a.completedTasks,
          tokenUsage: { ...a.tokenUsage },
          costUsd: a.costUsd,
          sessionId: a.sessionId,
          iterationCount: a.iterationCount,
          summary: a.summary,
        })),
        iterationStates: Object.fromEntries(this.iterationStates),
        processes: this.getActiveProcessPids(),
        pendingCheckpoint: this.pendingCheckpoint || undefined,
      };
      await saveRunState(state);
    } catch { /* non-critical */ }
  }

  async recoverFromCrash(): Promise<void> {
    try {
      const runningRuns = await findRunningRuns();
      for (const runState of runningRuns) {
        const anyAlive = runState.processes.some(p => isProcessAlive(p.pid));
        if (!anyAlive) {
          runState.status = 'crashed';
          runState.statusReason = `服务重启时检测到运行中断。进程已不存在 (PIDs: ${runState.processes.map(p => p.pid).join(', ') || '无'})。当前阶段: ${runState.currentPhase || '未知'}，当前步骤: ${runState.currentStep || '未知'}，已完成 ${runState.completedSteps?.length || 0} 步。`;
          runState.endTime = new Date().toISOString();
          // Fix agent states: mark any "running" agents as "failed"
          for (const agent of (runState.agents || [])) {
            if (agent.status === 'running') {
              agent.status = 'failed';
            }
          }
          // Mark the interrupted step as failed
          if (runState.currentStep && !runState.completedSteps?.includes(runState.currentStep) && !runState.failedSteps?.includes(runState.currentStep)) {
            runState.failedSteps = [...(runState.failedSteps || []), runState.currentStep];
          }
          // Clear stale process list
          runState.processes = [];
          await saveRunState(runState);
        }
      }
    } catch { /* non-critical on startup */ }
  }

  async start(configFile: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    this.status = 'running';
    this.statusReason = null;
    this.logs = [];
    this.agents = [];
    this.shouldStop = false;
    this.iterationStates.clear();
    this.currentConfigFile = configFile;
    this.completedStepNames = [];
    this.failedStepNames = [];
    this.stepLogs = [];
    this.runStartTime = new Date().toISOString();
    this.runEndTime = null;
    this.currentRunId = null;
    this.agentSessionIds.clear();
    this.emit('status', { status: 'running', message: '开始执行工作流...' });

    // Reset process manager counters in case previous run left stale state
    processManager.reset();

    try {
      const configPath = resolve(process.cwd(), 'configs', configFile);
      const content = await readFile(configPath, 'utf-8');
      const workflowConfig: WorkflowConfig = parse(content);

      this.currentWorkflow = workflowConfig;

      // Load agent configs from configs/agents/*.yaml
      this.agentConfigs = await this.loadAgentConfigs();

      this.initializeAgents(workflowConfig);

      // Create run record
      const totalSteps = workflowConfig.workflow.phases.reduce(
        (sum, p) => sum + p.steps.length, 0
      );
      const runId = `run-${formatTimestamp()}`;
      this.currentRunId = runId;
      try {
        await createRun({
          id: runId, configFile, startTime: new Date().toISOString(),
          endTime: null, status: 'running', phaseReached: '',
          totalSteps, completedSteps: 0,
        });
      } catch { /* non-critical */ }

      // Notify frontend of the run ID
      this.emit('status', { status: 'running', message: '工作流已启动', runId });

      await this.persistState();

      await this.executeWorkflow(workflowConfig);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', { status: 'completed', message: '工作流执行完成' });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.emit('status', { status: 'failed', message: error.message });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  private async finalizeRun(status: 'completed' | 'failed' | 'stopped') {
    if (!this.currentRunId) return;
    this.runEndTime = new Date().toISOString();
    try {
      const completedSteps = this.agents.reduce((sum, a) => sum + a.completedTasks, 0);
      await updateRun(this.currentRunId, {
        endTime: this.runEndTime,
        status,
        phaseReached: this.currentPhase || '',
        completedSteps,
      });
    } catch { /* non-critical */ }
    await this.persistState();
    // Reset to idle so polling doesn't overwrite frontend with stale memory data
    this.status = 'idle';
  }

  initializeAgents(workflowConfig: WorkflowConfig): void {
    const agentSet = new Set<string>();
    for (const phase of workflowConfig.workflow.phases) {
      for (const step of phase.steps) {
        agentSet.add(step.agent);
      }
    }

    this.agents = Array.from(agentSet).map((agentName) => {
      const roleConfig = this.agentConfigs.find((r) => r.name === agentName)
        || workflowConfig.roles?.find((r) => r.name === agentName);
      return {
        name: agentName,
        team: roleConfig?.team || 'blue',
        model: roleConfig?.model || 'claude-opus-4-6',
        status: 'waiting',
        currentTask: null,
        completedTasks: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        sessionId: null,
        iterationCount: 0,
        lastOutput: '',
        summary: '',
        changes: [],
      };
    });

    this.emit('agents', { agents: this.agents });
  }

  updateAgentStatus(
    agentName: string,
    status: AgentState['status'],
    task: string | null = null
  ): void {
    const agent = this.agents.find((a) => a.name === agentName);
    if (agent) {
      agent.status = status;
      agent.currentTask = task;
      if (status === 'completed') {
        agent.completedTasks++;
      }
      this.emit('agents', { agents: this.agents });
    }
  }

  updateAgentTokenUsage(agentName: string, usage: TokenUsage): void {
    const agent = this.agents.find((a) => a.name === agentName);
    if (agent) {
      agent.tokenUsage.inputTokens += usage.inputTokens;
      agent.tokenUsage.outputTokens += usage.outputTokens;
      this.emit('token-usage', {
        agent: agentName,
        usage: agent.tokenUsage,
        delta: usage,
      });
    }
  }

  parseBugCount(output: string): number {
    const bugMatch = output.match(/(?:bugs?|issues?|problems?|defects?)\s*(?:found|discovered|detected)[:\s]*(\d+)/i);
    if (bugMatch) return parseInt(bugMatch[1], 10);
    const countMatch = output.match(/(\d+)\s*(?:bugs?|issues?|problems?|defects?)/i);
    if (countMatch) return parseInt(countMatch[1], 10);
    const hasBugs = /(?:found|discovered|detected)\s+(?:a\s+)?(?:bug|issue|problem|defect|vulnerability)/i.test(output);
    return hasBugs ? 1 : 0;
  }

  /**
   * Parse structured JSON verdict from attacker/judge output.
   * Expects a ```json block at the end of the output with:
   *   { "verdict": "pass"|"conditional_pass"|"fail", "remaining_issues": N, "summary": "..." }
   * Falls back to parseBugCount if no JSON found.
   */
  parseStepVerdict(output: string): { verdict: 'pass' | 'conditional_pass' | 'fail'; remainingIssues: number; summary: string } {
    const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```\s*$/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          verdict: ['pass', 'conditional_pass', 'fail'].includes(parsed.verdict) ? parsed.verdict : 'fail',
          remainingIssues: typeof parsed.remaining_issues === 'number' ? parsed.remaining_issues : 0,
          summary: parsed.summary || '',
        };
      } catch { /* fall through */ }
    }
    // Fallback: no structured JSON found — be conservative, require human review
    const bugCount = this.parseBugCount(output);
    return {
      verdict: bugCount > 0 ? 'fail' : 'conditional_pass',
      remainingIssues: bugCount,
      summary: '',
    };
  }

  parseChanges(output: string): ChangeRecord[] {
    const changes: ChangeRecord[] = [];
    const filePatterns = output.matchAll(/(?:created|modified|deleted|updated|changed)\s+(?:file\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi);
    for (const match of filePatterns) {
      const action = match[0].toLowerCase().startsWith('created') ? 'created'
        : match[0].toLowerCase().startsWith('deleted') ? 'deleted' : 'modified';
      changes.push({ file: match[1], action, description: match[0] });
    }
    return changes;
  }

  parseSummary(output: string): string {
    const summaryMatch = output.match(/(?:summary|总结|结论)[:\s]*\n?([\s\S]{10,300}?)(?:\n\n|$)/i);
    return summaryMatch ? summaryMatch[1].trim() : output.substring(0, 200).trim();
  }

  async executeWorkflow(workflowConfig: WorkflowConfig): Promise<void> {
    for (const phase of workflowConfig.workflow.phases) {
      if (this.shouldStop) break;

      this.currentPhase = phase.name;
      this.emit('phase', {
        phase: phase.name,
        message: `进入阶段: ${phase.name}`,
        totalSteps: phase.steps.length,
        iteration: phase.iteration,
      });
      await this.persistState();

      if (phase.iteration?.enabled) {
        await this.executeIterativePhase(phase, workflowConfig);
      } else {
        await this.executeLinearPhase(phase, workflowConfig);
      }

      // Checkpoint with iterate support — loop allows re-running iterative phase
      while (phase.checkpoint && !this.shouldStop) {
        this.pendingCheckpoint = {
          phase: phase.name,
          checkpoint: phase.checkpoint.name,
          message: phase.checkpoint.message,
          isIterativePhase: !!phase.iteration?.enabled,
        };
        this.emit('checkpoint', {
          ...this.pendingCheckpoint,
          requiresApproval: true,
        });
        await this.persistState();
        const action = await this.waitForApproval();
        this.pendingCheckpoint = null;
        if (action === 'iterate' && phase.iteration?.enabled) {
          // Re-run the iterative phase for another round
          await this.executeIterativePhase(phase, workflowConfig);
          // Loop back to show checkpoint again
          continue;
        }
        // action === 'approve' → proceed to next phase
        break;
      }
    }
  }

  async executeLinearPhase(phase: WorkflowPhase, workflowConfig: WorkflowConfig): Promise<void> {
    // Group steps into sequential and parallel segments
    const segments = this.groupStepsIntoSegments(phase.steps);
    for (const segment of segments) {
      if (this.shouldStop) break;
      if (segment.parallel) {
        // Run all steps in the parallel group concurrently
        const results = await Promise.allSettled(
          segment.steps.map((step, i) => this.runStep(step, phase, workflowConfig, segment.startIndex + i))
        );
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) {
          throw new Error((failed as PromiseRejectedResult).reason?.message || '并行步骤执行失败');
        }
        // Check if any step in the group failed
        for (const step of segment.steps) {
          if (this.failedStepNames.includes(step.name)) {
            throw new Error(`步骤 "${step.name}" 执行失败，阶段中止`);
          }
        }
      } else {
        // Sequential step
        const step = segment.steps[0];
        await this.runStep(step, phase, workflowConfig, segment.startIndex);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${step.name}" 执行失败，阶段中止`);
        }
      }
    }
  }

  private groupStepsIntoSegments(steps: any[]): Array<{ parallel: boolean; steps: any[]; startIndex: number }> {
    const segments: Array<{ parallel: boolean; steps: any[]; startIndex: number }> = [];
    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      if (step.parallelGroup) {
        const groupId = step.parallelGroup;
        const groupSteps: any[] = [];
        const startIndex = i;
        while (i < steps.length && steps[i].parallelGroup === groupId) {
          groupSteps.push(steps[i]);
          i++;
        }
        segments.push({ parallel: true, steps: groupSteps, startIndex });
      } else {
        segments.push({ parallel: false, steps: [step], startIndex: i });
        i++;
      }
    }
    return segments;
  }

  async executeIterativePhase(phase: WorkflowPhase, workflowConfig: WorkflowConfig, skipCompletedSteps?: Set<string>): Promise<void> {
    const iterConfig = phase.iteration!;
    const defenderSteps = phase.steps.filter((s) => s.role === 'defender');
    const attackerSteps = phase.steps.filter((s) => s.role === 'attacker');
    const judgeSteps = phase.steps.filter((s) => s.role === 'judge');
    // Local mutable copy — cleared after first iteration pass so subsequent iterations run all steps
    let skipSet = skipCompletedSteps;

    // Restore or create iteration state
    let iterState = this.iterationStates.get(phase.name);
    // Detect if this is a subsequent iteration call (from checkpoint "iterate" action)
    // In that case, skipCompletedSteps is undefined and iterState already has currentIteration >= 1
    const isSubsequentIteration = !skipCompletedSteps && iterState && iterState.currentIteration >= 1 && iterState.status === 'running';

    if (!iterState || iterState.status === 'completed') {
      iterState = {
        phaseName: phase.name,
        currentIteration: 0,
        maxIterations: iterConfig.maxIterations,
        consecutiveCleanRounds: 0,
        status: 'running',
        bugsFoundPerRound: [],
      };
      this.iterationStates.set(phase.name, iterState);
    }

    // Helper: create step copy with iteration suffix for iter >= 2
    const iterStep = (step: WorkflowStep, iter: number): WorkflowStep =>
      iter >= 2 ? { ...step, name: `${step.name}-迭代${iter}` } : step;

    console.log(`[iterPhase] "${phase.name}" iterState:`, JSON.stringify(iterState));
    console.log(`[iterPhase] skipSet:`, skipSet ? [...skipSet] : 'none');
    console.log(`[iterPhase] isSubsequentIteration:`, isSubsequentIteration);
    console.log(`[iterPhase] defenders=[${defenderSteps.map(s=>s.name).join(', ')}] attackers=[${attackerSteps.map(s=>s.name).join(', ')}] judges=[${judgeSteps.map(s=>s.name).join(', ')}]`);

    let startIter: number;

    if (isSubsequentIteration) {
      // Called from checkpoint "iterate" — skip initial defenders, jump to next iteration
      startIter = iterState.currentIteration + 1;
      console.log(`[iterPhase] Subsequent iteration: starting at iter=${startIter}`);
    } else {
      // Initial defender run — skip if already completed
      for (const step of defenderSteps) {
        if (this.shouldStop) return;
        if (skipSet?.has(step.name)) {
          console.log(`[iterPhase] SKIPPING defender "${step.name}" (already completed)`);
          this.emit('step', { step: step.name, agent: step.agent, message: `跳过已完成: ${step.name}`, skipped: true });
          continue;
        }
        console.log(`[iterPhase] EXECUTING defender "${step.name}" (NOT in skipSet)`);
        await this.runStep(step, phase, workflowConfig, 0);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${step.name}" 执行失败，迭代阶段中止`);
        }
      }

      // Determine starting iteration (resume from where we left off)
      startIter = Math.max(1, iterState.currentIteration);
    }

    // Iterative attacker → judge → (defender fix) loop
    for (let iter = startIter; iter <= iterConfig.maxIterations; iter++) {
      if (this.shouldStop) break;

      iterState.currentIteration = iter;
      this.emit('iteration', {
        phase: phase.name,
        iteration: iter,
        maxIterations: iterConfig.maxIterations,
        consecutiveClean: iterState.consecutiveCleanRounds,
      });
      await this.persistState();

      // For subsequent iterations (iter >= 2), run defenders first with iteration suffix
      if (iter >= 2) {
        for (const step of defenderSteps) {
          if (this.shouldStop) return;
          const namedStep = iterStep(step, iter);
          if (skipSet?.has(namedStep.name)) {
            this.emit('step', { step: namedStep.name, agent: namedStep.agent, message: `跳过已完成: ${namedStep.name}`, skipped: true });
            continue;
          }
          await this.runStep(namedStep, phase, workflowConfig, 0);
          if (!this.lastStepSucceeded()) {
            throw new Error(`步骤 "${namedStep.name}" 执行失败，迭代阶段中止`);
          }
        }
      }

      // Run attackers — use parseStepVerdict for structured bug count
      let totalBugs = 0;
      for (const step of attackerSteps) {
        if (this.shouldStop) return;
        const namedStep = iterStep(step, iter);
        if (skipSet?.has(namedStep.name)) {
          this.emit('step', { step: namedStep.name, agent: namedStep.agent, message: `跳过已完成: ${namedStep.name}`, skipped: true });
          continue;
        }
        const output = await this.runStep(namedStep, phase, workflowConfig, 0);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${namedStep.name}" 执行失败，迭代阶段中止`);
        }
        const verdict = this.parseStepVerdict(output);
        totalBugs += verdict.remainingIssues;
      }

      // Run judges — use parseStepVerdict for structured verdict
      let judgeVerdict: { verdict: 'pass' | 'conditional_pass' | 'fail'; remainingIssues: number; summary: string } | null = null;
      for (const step of judgeSteps) {
        if (this.shouldStop) return;
        const namedStep = iterStep(step, iter);
        if (skipSet?.has(namedStep.name)) {
          this.emit('step', { step: namedStep.name, agent: namedStep.agent, message: `跳过已完成: ${namedStep.name}`, skipped: true });
          continue;
        }
        const output = await this.runStep(namedStep, phase, workflowConfig, 0);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${namedStep.name}" 执行失败，迭代阶段中止`);
        }
        judgeVerdict = this.parseStepVerdict(output);
      }

      // Clear skip set after first iteration pass — subsequent iterations run all steps
      skipSet = undefined;

      // Use judge verdict if available, otherwise fall back to attacker bug count
      const effectiveBugs = judgeVerdict ? judgeVerdict.remainingIssues : totalBugs;
      iterState.bugsFoundPerRound.push(effectiveBugs);

      if (effectiveBugs === 0) {
        iterState.consecutiveCleanRounds++;
      } else {
        iterState.consecutiveCleanRounds = 0;
      }

      // Emit verdict info for frontend
      this.emit('iteration', {
        phase: phase.name,
        iteration: iter,
        maxIterations: iterConfig.maxIterations,
        consecutiveClean: iterState.consecutiveCleanRounds,
        verdict: judgeVerdict?.verdict || (effectiveBugs === 0 ? 'pass' : 'fail'),
        remainingIssues: effectiveBugs,
        verdictSummary: judgeVerdict?.summary || '',
      });

      // Judge says pass → exit iteration
      if (judgeVerdict?.verdict === 'pass') {
        iterState.status = 'completed';
        this.emit('iteration-complete', {
          phase: phase.name,
          totalIterations: iter,
          reason: 'judge_pass',
          bugsPerRound: iterState.bugsFoundPerRound,
        });
        break;
      }

      // Check exit conditions (legacy: consecutive clean rounds etc.)
      // Only auto-exit if judge explicitly passed; conditional_pass requires human checkpoint
      if (!judgeVerdict || judgeVerdict.verdict !== 'fail') {
        const shouldExit = this.checkExitCondition(iterConfig, iterState);
        if (shouldExit) {
          iterState.status = 'completed';
          this.emit('iteration-complete', {
            phase: phase.name,
            totalIterations: iter,
            reason: iterConfig.exitCondition,
            bugsPerRound: iterState.bugsFoundPerRound,
          });
          break;
        }
      }

      // If issues remain or judge says conditional_pass/fail, continue to next iteration
      // (defenders will run at the start of the next iteration with -迭代N suffix)
      // If no fix needed, the loop exits via judge pass or exit condition above

      // Max iterations reached
      if (iter === iterConfig.maxIterations) {
        if (iterConfig.escalateToHuman) {
          iterState.status = 'escalated';
          this.emit('escalation', {
            phase: phase.name,
            reason: `达到最大迭代次数 ${iterConfig.maxIterations}`,
            bugsPerRound: iterState.bugsFoundPerRound,
          });
        }
        this.emit('iteration-complete', {
          phase: phase.name,
          totalIterations: iter,
          reason: 'max_iterations',
          bugsPerRound: iterState.bugsFoundPerRound,
        });
      }
    }
  }

  checkExitCondition(config: IterationConfig, state: IterationState): boolean {
    switch (config.exitCondition) {
      case 'no_new_bugs_3_rounds':
        return state.consecutiveCleanRounds >= config.consecutiveCleanRounds;
      case 'all_resolved':
        return state.bugsFoundPerRound.length > 0 &&
          state.bugsFoundPerRound[state.bugsFoundPerRound.length - 1] === 0;
      case 'manual':
        return false;
      default:
        return false;
    }
  }

  async runStep(
    step: WorkflowStep,
    phase: WorkflowPhase,
    workflowConfig: WorkflowConfig,
    stepIndex: number
  ): Promise<string> {
    this.currentStep = step.name;
    this.updateAgentStatus(step.agent, 'running', step.task);

    const agent = this.agents.find((a) => a.name === step.agent);
    if (agent) agent.iterationCount++;

    this.emit('step', {
      step: step.name,
      agent: step.agent,
      message: `执行步骤: ${step.name}`,
      stepIndex: stepIndex + 1,
      totalSteps: phase.steps.length,
      role: step.role,
    });
    await this.persistState();

    try {
      const jsonResult = await this.executeStep(step, workflowConfig);
      const resultText = jsonResult.result;

      const tokenUsage: TokenUsage = {
        inputTokens: jsonResult.usage.input_tokens,
        outputTokens: jsonResult.usage.output_tokens,
      };
      this.updateAgentTokenUsage(step.agent, tokenUsage);

      if (jsonResult.session_id) {
        this.agentSessionIds.set(step.agent, jsonResult.session_id);
      }

      if (agent) {
        agent.lastOutput = resultText;
        agent.summary = this.parseSummary(resultText);
        agent.costUsd += jsonResult.cost_usd || 0;
        agent.sessionId = jsonResult.session_id || null;
        const newChanges = this.parseChanges(resultText);
        agent.changes = [...agent.changes, ...newChanges];
      }

      this.updateAgentStatus(step.agent, 'completed');
      this.completedStepNames.push(step.name);

      // Record step log
      this.stepLogs.push({
        stepName: step.name,
        agent: step.agent,
        status: 'completed',
        output: resultText,
        error: '',
        costUsd: jsonResult.cost_usd || 0,
        durationMs: jsonResult.duration_ms || 0,
        timestamp: new Date().toISOString(),
      });

      this.emit('result', {
        step: step.name,
        agent: step.agent,
        output: resultText.substring(0, 500) + (resultText.length > 500 ? '...' : ''),
        fullOutput: resultText,
        role: step.role,
        costUsd: jsonResult.cost_usd,
        sessionId: jsonResult.session_id,
        numTurns: jsonResult.num_turns,
        durationMs: jsonResult.duration_ms,
      });

      if (this.currentRunId) {
        saveProcessOutput(this.currentRunId, step.name, resultText).catch(() => {});
        // Also save to workspace so AI agents can read full documents
        if (workflowConfig.context.projectRoot) {
          saveOutputToWorkspace(workflowConfig.context.projectRoot, this.currentRunId, step.name, resultText).catch(() => {});
        }
      }
      await this.persistState();

      return resultText;
    } catch (error: any) {
      // If workflow was stopped, don't record this as a failure
      if (this.shouldStop) {
        this.currentStep = null;
        return '';
      }

      // If force-complete was triggered, treat as success with stream content
      if (this.forceCompleteFlag) {
        this.forceCompleteFlag = false;
        // Find the process to get its stream content
        const allProcs = processManager.getAllProcesses();
        const proc = allProcs.find((p: any) => p.step === step.name);
        const procInfo = proc ? processManager.getProcess(proc.id) : null;
        const resultText = procInfo?.streamContent || procInfo?.output || '(强制完成，无输出)';

        this.updateAgentStatus(step.agent, 'completed');
        this.completedStepNames.push(step.name);
        this.currentStep = null;

        this.stepLogs.push({
          stepName: step.name,
          agent: step.agent,
          status: 'completed',
          output: resultText,
          error: '',
          costUsd: 0,
          durationMs: 0,
          timestamp: new Date().toISOString(),
        });

        this.emit('result', {
          step: step.name,
          agent: step.agent,
          output: resultText.substring(0, 500) + (resultText.length > 500 ? '...' : ''),
          fullOutput: resultText,
          role: step.role,
          costUsd: 0,
          numTurns: 0,
          durationMs: 0,
          forceCompleted: true,
        });

        if (this.currentRunId) {
          saveProcessOutput(this.currentRunId, step.name, resultText).catch(() => {});
          if (workflowConfig.context.projectRoot) {
            saveOutputToWorkspace(workflowConfig.context.projectRoot, this.currentRunId, step.name, resultText).catch(() => {});
          }
        }
        await this.persistState();
        return resultText;
      }

      const errorMsg = error.message || String(error);

      this.updateAgentStatus(step.agent, 'failed');
      this.failedStepNames.push(step.name);
      this.currentStep = null;

      // Record failed step log
      this.stepLogs.push({
        stepName: step.name,
        agent: step.agent,
        status: 'failed',
        output: '',
        error: errorMsg,
        costUsd: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });

      this.emit('result', {
        step: step.name,
        agent: step.agent,
        output: `执行失败: ${errorMsg}`,
        error: true,
        errorDetail: errorMsg,
        role: step.role,
      });

      if (this.currentRunId) {
        saveProcessOutput(this.currentRunId, step.name, `ERROR: ${errorMsg}`).catch(() => {});
      }

      await this.persistState();
      return '';
    }
  }

  /**
   * Returns true if step succeeded, false if failed.
   * Used by iterative phases to decide whether to continue.
   */
  private lastStepSucceeded(): boolean {
    if (this.failedStepNames.length === 0) return true;
    // Check if the most recent stepLog was a failure
    const last = this.stepLogs[this.stepLogs.length - 1];
    return !last || last.status !== 'failed';
  }

  async executeStep(step: WorkflowStep, workflowConfig: WorkflowConfig): Promise<ClaudeJsonResult> {
    const roleConfig = this.agentConfigs.find((r) => r.name === step.agent)
      || workflowConfig.roles?.find((r) => r.name === step.agent);
    if (!roleConfig) {
      throw new Error(`未找到角色配置: ${step.agent}`);
    }

    // Check if review panel mode is enabled
    const enableReviewPanel = (step as any).enableReviewPanel && roleConfig.reviewPanel?.enabled;

    if (enableReviewPanel && roleConfig.reviewPanel?.subAgents) {
      // Execute review panel mode: run multiple sub-agents in parallel
      return await this.executeReviewPanel(step, workflowConfig, roleConfig);
    }

    // Normal single-agent execution
    return await this.executeSingleAgent(step, workflowConfig, roleConfig);
  }

  private async executeReviewPanel(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig,
    roleConfig: RoleConfig
  ): Promise<ClaudeJsonResult> {
    const subAgents = roleConfig.reviewPanel!.subAgents;
    const subAgentNames = Object.keys(subAgents);

    console.log(`[专家模式] 启动 ${subAgentNames.length} 个专家子 Agent 进行多角度分析...`);

    // Load previous step outputs for context injection
    let previousOutputs: Record<string, string> = {};
    if (this.currentRunId) {
      try {
        const allOutputs = await loadStepOutputs(this.currentRunId);
        const completedSet = new Set(this.completedStepNames);
        for (const [name, content] of Object.entries(allOutputs)) {
          if (completedSet.has(name)) {
            previousOutputs[name] = content;
          }
        }
      } catch { /* non-critical */ }
    }

    // Build agents JSON for claude --agents flag
    const agentsJson: Record<string, any> = {};
    for (const [name, config] of Object.entries(subAgents)) {
      agentsJson[name] = {
        description: config.description,
        prompt: config.prompt,
        tools: config.tools,
        model: config.model,
      };
    }

    // Build main prompt that coordinates sub-agents
    const mainPrompt = this.buildPrompt(step, workflowConfig, roleConfig, previousOutputs);
    const coordinatorPrompt = `${mainPrompt}\n\n# 专家模式说明\n你现在处于专家模式。你有 ${subAgentNames.length} 个专家子 Agent 可以调用：\n\n${subAgentNames.map(name => `- @${name}: ${subAgents[name].description}`).join('\n')}\n\n请使用 @agent-name 语法调用这些专家，收集他们的分析结果，最后汇总形成综合结论。`;

    const processId = `${step.agent}-${step.name}-${Date.now()}`;
    const existingSessionId = this.agentSessionIds.get(step.agent);
    const isIterationStep = step.name.includes('-迭代');
    const systemPromptToUse = isIterationStep && roleConfig.iterationPrompt
      ? roleConfig.iterationPrompt
      : roleConfig.systemPrompt;

    // Set up stream content flushing
    let lastFlush = 0;
    const streamHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== processId) return;
      const now = Date.now();
      if (this.currentRunId && now - lastFlush > 3000) {
        lastFlush = now;
        saveStreamContent(this.currentRunId, step.name, data.total).catch(() => {});
      }
    };
    processManager.on('stream', streamHandler);

    try {
      const result = await processManager.executeClaudeCli(
        processId,
        step.agent,
        step.name,
        coordinatorPrompt,
        systemPromptToUse,
        roleConfig.model,
        {
          workingDirectory: workflowConfig.context.projectRoot,
          allowedTools: roleConfig.allowedTools,
          resumeSessionId: existingSessionId,
          appendSystemPrompt: !!existingSessionId,
          timeoutMs: workflowConfig.context.timeoutMinutes
            ? workflowConfig.context.timeoutMinutes * 60 * 1000
            : undefined,
          runId: this.currentRunId || undefined,
          agents: agentsJson, // Pass sub-agents configuration
        }
      );

      const proc = processManager.getProcess(processId);
      if (this.currentRunId && proc?.streamContent) {
        saveStreamContent(this.currentRunId, step.name, proc.streamContent).catch(() => {});
      }
      return result;
    } finally {
      processManager.off('stream', streamHandler);
    }
  }

  private async executeSingleAgent(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig,
    roleConfig: RoleConfig
  ): Promise<ClaudeJsonResult> {
    // Load previous step outputs for context injection — only completed steps
    let previousOutputs: Record<string, string> = {};
    if (this.currentRunId) {
      try {
        const allOutputs = await loadStepOutputs(this.currentRunId);
        const completedSet = new Set(this.completedStepNames);
        for (const [name, content] of Object.entries(allOutputs)) {
          if (completedSet.has(name)) {
            previousOutputs[name] = content;
          }
        }
      } catch { /* non-critical */ }
    }

    const prompt = this.buildPrompt(step, workflowConfig, roleConfig, previousOutputs);
    const processId = `${step.agent}-${step.name}-${Date.now()}`;

    // Check for existing session to resume (iterative phases)
    const existingSessionId = this.agentSessionIds.get(step.agent);

    // Determine which system prompt to use: iterationPrompt for iteration steps, systemPrompt otherwise
    const isIterationStep = step.name.includes('-迭代');
    const systemPromptToUse = isIterationStep && roleConfig.iterationPrompt
      ? roleConfig.iterationPrompt
      : roleConfig.systemPrompt;

    // Set up stream content flushing to disk (with chunk separators)
    let lastFlush = 0;
    const streamHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== processId) return;
      const now = Date.now();
      // Flush to disk every 3 seconds (streamContent already contains chunk-boundary separators)
      if (this.currentRunId && now - lastFlush > 3000) {
        lastFlush = now;
        saveStreamContent(this.currentRunId, step.name, data.total).catch(() => {});
      }
    };
    processManager.on('stream', streamHandler);

    try {
      const result = await processManager.executeClaudeCli(
        processId,
        step.agent,
        step.name,
        prompt,
        systemPromptToUse,
        roleConfig.model,
        {
          workingDirectory: workflowConfig.context.projectRoot,
          allowedTools: roleConfig.allowedTools,
          resumeSessionId: existingSessionId,
          appendSystemPrompt: !!existingSessionId,
          timeoutMs: workflowConfig.context.timeoutMinutes
            ? workflowConfig.context.timeoutMinutes * 60 * 1000
            : undefined,
          runId: this.currentRunId || undefined,
        }
      );
      // Final flush of stream content (already contains chunk-boundary separators)
      const proc = processManager.getProcess(processId);
      if (this.currentRunId && proc?.streamContent) {
        saveStreamContent(this.currentRunId, step.name, proc.streamContent).catch(() => {});
      }
      return result;
    } finally {
      processManager.off('stream', streamHandler);
    }
  }

  buildPrompt(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig,
    roleConfig: RoleConfig,
    previousOutputs?: Record<string, string>
  ): string {
    let prompt = `# 任务\n${step.task}\n\n`;

    if (workflowConfig.context.requirements) {
      prompt += `## 需求背景\n${workflowConfig.context.requirements}\n\n`;
    }

    if (workflowConfig.context.projectRoot) {
      prompt += `## 项目路径\n${workflowConfig.context.projectRoot}\n\n`;
      if (this.currentRunId) {
        const outputDir = `${workflowConfig.context.projectRoot}/.ace-outputs/${this.currentRunId}`;
        prompt += `## 文档输出要求\n`;
        prompt += `请将你产出的所有文档、报告、分析结果等写入以下目录：\n`;
        prompt += `\`${outputDir}/\`\n\n`;
        prompt += `文件命名建议使用步骤名或有意义的名称，格式为 Markdown (.md)。这样其他 Agent 和人类审阅者都能方便地查看你的产出。\n\n`;
      }
    }

    if (roleConfig.capabilities && roleConfig.capabilities.length > 0) {
      prompt += `## 你的能力\n`;
      roleConfig.capabilities.forEach((cap) => {
        prompt += `- ${cap}\n`;
      });
      prompt += '\n';
    }

    if (step.constraints && step.constraints.length > 0) {
      prompt += `## 约束条件\n`;
      step.constraints.forEach((constraint) => {
        prompt += `- ${constraint}\n`;
      });
      prompt += '\n';
    }

    if (roleConfig.constraints && roleConfig.constraints.length > 0) {
      prompt += `## Agent 约束\n`;
      roleConfig.constraints.forEach((constraint) => {
        prompt += `- ${constraint}\n`;
      });
      prompt += '\n';
    }

    // Inject previous step outputs as context (only completed steps are passed in)
    if (previousOutputs && Object.keys(previousOutputs).length > 0) {
      const projectRoot = workflowConfig.context.projectRoot || '';
      prompt += `## 前序步骤产出\n`;
      prompt += `以下是已完成步骤的产出摘要。如需查看完整内容，请读取对应文件路径。\n\n`;
      for (const [stepName, output] of Object.entries(previousOutputs)) {
        const safeName = stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
        const fullPath = projectRoot
          ? `${projectRoot}/.ace-outputs/${this.currentRunId}/${safeName}.md`
          : '';
        // Extract the tail of the output as summary (AI typically summarizes at the end)
        const summary = output.length > 3000
          ? output.substring(output.length - 3000)
          : output;
        prompt += `### ${stepName}\n`;
        if (fullPath) {
          prompt += `完整文档路径: \`${fullPath}\`\n\n`;
        }
        prompt += `\`\`\`\n${summary}\n\`\`\`\n\n`;
      }
    }

    // Inject structured JSON output requirement for attacker/judge roles
    if (step.role === 'attacker' || step.role === 'judge') {
      prompt += `## 结构化输出要求\n`;
      prompt += `在你的回复最末尾，请务必输出以下 JSON 块（用 \`\`\`json 包裹），用于自动化流程判断：\n\n`;
      prompt += `\`\`\`json\n`;
      prompt += `{\n`;
      prompt += `  "verdict": "pass | conditional_pass | fail",\n`;
      prompt += `  "remaining_issues": 0,\n`;
      prompt += `  "summary": "一句话总结"\n`;
      prompt += `}\n`;
      prompt += `\`\`\`\n\n`;
      prompt += `字段说明：\n`;
      prompt += `- \`verdict\`: \`"pass"\` 表示无问题可通过，\`"conditional_pass"\` 表示有条件通过（存在需修复的问题但方向正确），\`"fail"\` 表示存在严重问题需要重做\n`;
      prompt += `- \`remaining_issues\`: 剩余未解决的问题数量（整数）\n`;
      prompt += `- \`summary\`: 一句话总结你的评估结论\n\n`;
    }

    return prompt;
  }

  async waitForApproval(): Promise<'approve' | 'iterate'> {
    // If there's a pre-queued action (from resume with action), use it immediately
    if (this.queuedApprovalAction) {
      const action = this.queuedApprovalAction;
      this.queuedApprovalAction = null;
      return action;
    }
    return new Promise((resolve) => {
      const cleanup = () => { this.off('approve', onApprove); this.off('iterate', onIterate); this.off('force-stop', onStop); };
      const onApprove = () => { cleanup(); resolve('approve'); };
      const onIterate = () => { cleanup(); resolve('iterate'); };
      const onStop = () => { cleanup(); resolve('approve'); }; // resolve to unblock, shouldStop will prevent further execution
      this.once('approve', onApprove);
      this.once('iterate', onIterate);
      this.once('force-stop', onStop);
    });
  }

  approve(): void {
    this.emit('approve');
  }

  requestIteration(): void {
    this.emit('iterate');
  }

  setQueuedApprovalAction(action: 'approve' | 'iterate'): void {
    this.queuedApprovalAction = action;
  }

  /**
   * Force-complete the currently running step.
   * Kills the process and uses accumulated stream content as the step output.
   */
  async forceCompleteStep(): Promise<{ step: string; output: string } | null> {
    const stepName = this.currentStep;
    if (!stepName || this.status !== 'running') return null;

    // Find the running process for this step
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => p.status === 'running' && p.step === stepName
    );
    if (!running) return null;

    const proc = processManager.getProcess(running.id);
    if (!proc) return null;

    // Capture current stream content as the output
    const output = proc.streamContent || proc.output || '(强制完成，无输出)';

    // Set force-complete flag so the error handler in runStep treats this as success
    this.forceCompleteFlag = true;

    // Kill the process — this will cause executeClaudeCli to reject
    processManager.killProcess(running.id);

    this.emit('log', {
      agent: 'system',
      level: 'warning',
      message: `步骤 "${stepName}" 被强制完成，使用已有输出 (${output.length} 字符)`,
    });

    return { step: stepName, output };
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    this.status = 'stopped';
    // Unblock any pending waitForApproval
    this.emit('force-stop');
    // Mark the current running step as failed so it shows red in the flow diagram
    const stoppedStep = this.currentStep;
    if (stoppedStep && !this.completedStepNames.includes(stoppedStep) && !this.failedStepNames.includes(stoppedStep)) {
      this.failedStepNames.push(stoppedStep);
    }
    this.statusReason = stoppedStep
      ? `用户手动停止。中断步骤: ${stoppedStep}`
      : '用户手动停止';
    this.currentStep = null;
    // Mark any running agents as failed (they were interrupted)
    for (const agent of this.agents) {
      if (agent.status === 'running') {
        agent.status = 'failed';
      }
    }
    // Kill managed processes + orphan system claude processes
    await processManager.killAllSystem();
    // Small delay to let close events fire
    await new Promise(r => setTimeout(r, 500));
    // Ensure status is still stopped (not overwritten by async handlers)
    this.status = 'stopped';
    try {
      await this.finalizeRun('stopped');
    } catch {
      // finalizeRun failed — persist state directly as fallback
    }
    // Always try to persist stopped state, even if finalizeRun already did
    this.status = 'stopped';
    await this.persistState().catch(() => {});
    this.emit('status', { status: 'stopped', message: '工作流已停止' });
    // Reset memory status to idle so polling doesn't overwrite frontend with stale data
    this.status = 'idle';
  }

  async resume(runId: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }
    if (runState.status === 'running') {
      throw new Error('该运行仍在进行中');
    }
    if (runState.status === 'completed') {
      throw new Error('该运行已完成，无需恢复');
    }

    // Load the original workflow config
    const configPath = resolve(process.cwd(), 'configs', runState.configFile);
    const content = await readFile(configPath, 'utf-8');
    const workflowConfig: WorkflowConfig = parse(content);

    // Restore internal state
    this.currentWorkflow = workflowConfig;
    this.currentRunId = runId;
    this.currentConfigFile = runState.configFile;
    this.status = 'running';
    this.shouldStop = false;
    this.logs = [];
    this.completedStepNames = [...(runState.completedSteps || [])];
    this.failedStepNames = []; // Reset failed — we'll retry them
    this.stepLogs = [...(runState.stepLogs || []).filter(l => l.status === 'completed')];
    this.runStartTime = runState.startTime;
    this.runEndTime = null;
    this.statusReason = null;
    this.pendingCheckpoint = runState.pendingCheckpoint || null;
    this.agentSessionIds.clear();

    console.log(`[WorkflowManager.resume] runId=${runId}`);
    console.log(`[WorkflowManager.resume] completedSteps=`, this.completedStepNames);
    console.log(`[WorkflowManager.resume] iterationStates=`, JSON.stringify(runState.iterationStates));

    // Load agent configs
    this.agentConfigs = await this.loadAgentConfigs();
    this.initializeAgents(workflowConfig);

    // Restore agent state from persisted data
    for (const pa of (runState.agents || [])) {
      const agent = this.agents.find(a => a.name === pa.name);
      if (agent) {
        agent.tokenUsage = pa.tokenUsage || { inputTokens: 0, outputTokens: 0 };
        agent.costUsd = pa.costUsd || 0;
        agent.completedTasks = pa.completedTasks || 0;
        agent.iterationCount = pa.iterationCount || 0;
        agent.summary = pa.summary || '';
        // Restore status: completed agents stay completed, failed reset to waiting for retry
        if (pa.status === 'completed') {
          agent.status = 'completed';
        }
        if (pa.sessionId) {
          agent.sessionId = pa.sessionId;
          this.agentSessionIds.set(pa.name, pa.sessionId);
        }
      }
    }

    // Restore iteration states
    this.iterationStates.clear();
    for (const [key, val] of Object.entries(runState.iterationStates || {})) {
      this.iterationStates.set(key, val as IterationState);
    }

    processManager.reset();

    console.log(`[WorkflowManager.resume] FINAL STATE BEFORE EXECUTE:`);
    console.log(`  completedStepNames=`, JSON.stringify(this.completedStepNames));
    console.log(`  failedStepNames=`, JSON.stringify(this.failedStepNames));
    console.log(`  iterationStates=`, JSON.stringify(Object.fromEntries(this.iterationStates)));

    this.emit('status', { status: 'running', message: `恢复运行: ${runId}`, runId });
    this.emit('agents', { agents: this.agents });

    // Update run record status
    runState.status = 'running';
    runState.endTime = null;
    await saveRunState(runState);

    await this.persistState();

    try {
      await this.executeWorkflowResume(workflowConfig);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', { status: 'completed', message: '工作流执行完成' });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.emit('status', { status: 'failed', message: error.message });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  private async executeWorkflowResume(workflowConfig: WorkflowConfig): Promise<void> {
    const completedSet = new Set(this.completedStepNames);
    console.log(`[resume] completedSet:`, [...completedSet]);

    for (const phase of workflowConfig.workflow.phases) {
      if (this.shouldStop) break;

      // Check if entire phase is already completed
      const phaseStepNames = phase.steps.map(s => s.name);
      const allPhaseCompleted = phaseStepNames.every(n => completedSet.has(n));
      // For iterative phases, also check iteration state — steps may be "completed" from round 1
      // but iteration itself may still need more rounds
      const iterState = phase.iteration?.enabled ? this.iterationStates.get(phase.name) : null;
      const iterDone = !iterState || iterState.status === 'completed';
      console.log(`[resume] phase="${phase.name}" steps=[${phaseStepNames.join(', ')}] allCompleted=${allPhaseCompleted} iterative=${!!phase.iteration?.enabled} iterDone=${iterDone}`);
      if (allPhaseCompleted && iterDone) {
        this.emit('phase', {
          phase: phase.name,
          message: `跳过已完成阶段: ${phase.name}`,
          totalSteps: phase.steps.length,
          skipped: true,
        });
        continue;
      }

      this.currentPhase = phase.name;
      this.emit('phase', {
        phase: phase.name,
        message: `恢复阶段: ${phase.name}`,
        totalSteps: phase.steps.length,
      });
      await this.persistState();

      // If we were waiting at a checkpoint for this phase, go straight to checkpoint
      if (this.pendingCheckpoint && this.pendingCheckpoint.phase === phase.name) {
        // Skip re-execution, go directly to checkpoint dialog
      } else if (phase.iteration?.enabled) {
        // For iterative phases, check if we have saved iteration state
        const savedIter = this.iterationStates.get(phase.name);
        console.log(`[resume] iterState for "${phase.name}":`, savedIter ? JSON.stringify(savedIter) : 'none');
        if (savedIter && savedIter.status === 'completed') {
          this.emit('phase', {
            phase: phase.name,
            message: `跳过已完成迭代阶段: ${phase.name}`,
            totalSteps: phase.steps.length,
            skipped: true,
          });
          continue; // Already finished
        }
        // Resume iterative phase, skipping completed defender steps
        await this.executeIterativePhase(phase, workflowConfig, completedSet);
      } else {
        // Linear phase — skip completed steps
        for (let i = 0; i < phase.steps.length; i++) {
          if (this.shouldStop) break;
          const step = phase.steps[i];
          if (completedSet.has(step.name)) {
            this.emit('step', {
              step: step.name,
              agent: step.agent,
              message: `跳过已完成步骤: ${step.name}`,
              skipped: true,
            });
            continue;
          }
          await this.runStep(step, phase, workflowConfig, i);
          if (!this.lastStepSucceeded()) {
            throw new Error(`步骤 "${step.name}" 执行失败，阶段中止`);
          }
        }
      }

      // Skip checkpoint if phase was partially done before
      while (phase.checkpoint && !this.shouldStop) {
        this.pendingCheckpoint = {
          phase: phase.name,
          checkpoint: phase.checkpoint.name,
          message: phase.checkpoint.message,
          isIterativePhase: !!phase.iteration?.enabled,
        };
        this.emit('checkpoint', {
          ...this.pendingCheckpoint,
          requiresApproval: true,
        });
        await this.persistState();
        const action = await this.waitForApproval();
        this.pendingCheckpoint = null;
        if (action === 'iterate' && phase.iteration?.enabled) {
          await this.executeIterativePhase(phase, workflowConfig);
          continue;
        }
        break;
      }
    }
  }

  getStatus(): any {
    return {
      status: this.status,
      statusReason: this.statusReason,
      runId: this.currentRunId,
      logs: this.logs,
      agents: this.agents,
      currentPhase: this.currentPhase,
      currentStep: this.currentStep,
      completedSteps: this.completedStepNames,
      failedSteps: this.failedStepNames,
      stepLogs: this.stepLogs,
      workflow: this.currentWorkflow,
      iterationStates: Object.fromEntries(this.iterationStates),
    };
  }

  getIterationStates(): Map<string, IterationState> {
    return this.iterationStates;
  }
}

// 全局单例 — use globalThis to survive Next.js dev HMR
const globalForWorkflow = globalThis as unknown as { __workflowManager?: WorkflowManager };
export const workflowManager = globalForWorkflow.__workflowManager ??= new WorkflowManager();


