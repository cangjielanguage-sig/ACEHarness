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
  saveRunState, saveProcessOutput, saveStreamContent, loadStepOutputs, loadRunState, findRunningRuns, isProcessAlive,
  type PersistedRunState, type PersistedProcessInfo, type PersistedStepLog,
} from './run-state-persistence';
import type { WorkflowConfig, WorkflowPhase, WorkflowStep, RoleConfig, IterationConfig } from './schemas';

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
  private runStartTime: string | null = null;
  private runEndTime: string | null = null;
  /** Agent name → session_id for --resume in iterative phases */
  private agentSessionIds: Map<string, string> = new Map();
  private statusReason: string | null = null;

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
      const runId = `run-${Date.now()}`;
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

      if (phase.checkpoint && !this.shouldStop) {
        this.emit('checkpoint', {
          phase: phase.name,
          checkpoint: phase.checkpoint.name,
          message: phase.checkpoint.message,
          requiresApproval: true,
        });
        await this.persistState();
        await this.waitForApproval();
      }
    }
  }

  async executeLinearPhase(phase: WorkflowPhase, workflowConfig: WorkflowConfig): Promise<void> {
    for (let i = 0; i < phase.steps.length; i++) {
      if (this.shouldStop) break;
      const step = phase.steps[i];
      await this.runStep(step, phase, workflowConfig, i);
      if (!this.lastStepSucceeded()) {
        throw new Error(`步骤 "${step.name}" 执行失败，阶段中止`);
      }
    }
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

    // Initial defender run — skip if already completed
    console.log(`[iterPhase] "${phase.name}" iterState:`, JSON.stringify(iterState));
    console.log(`[iterPhase] skipSet:`, skipSet ? [...skipSet] : 'none');
    console.log(`[iterPhase] defenders=[${defenderSteps.map(s=>s.name).join(', ')}] attackers=[${attackerSteps.map(s=>s.name).join(', ')}] judges=[${judgeSteps.map(s=>s.name).join(', ')}]`);
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
    const startIter = Math.max(1, iterState.currentIteration);

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

      // Run attackers
      let totalBugs = 0;
      for (const step of attackerSteps) {
        if (this.shouldStop) return;
        if (skipSet?.has(step.name)) {
          this.emit('step', { step: step.name, agent: step.agent, message: `跳过已完成: ${step.name}`, skipped: true });
          continue;
        }
        const output = await this.runStep(step, phase, workflowConfig, 0);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${step.name}" 执行失败，迭代阶段中止`);
        }
        totalBugs += this.parseBugCount(output);
      }

      // Run judges
      for (const step of judgeSteps) {
        if (this.shouldStop) return;
        if (skipSet?.has(step.name)) {
          this.emit('step', { step: step.name, agent: step.agent, message: `跳过已完成: ${step.name}`, skipped: true });
          continue;
        }
        await this.runStep(step, phase, workflowConfig, 0);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${step.name}" 执行失败，迭代阶段中止`);
        }
      }

      // Clear skip set after first iteration pass — subsequent iterations run all steps
      skipSet = undefined;

      iterState.bugsFoundPerRound.push(totalBugs);

      if (totalBugs === 0) {
        iterState.consecutiveCleanRounds++;
      } else {
        iterState.consecutiveCleanRounds = 0;
      }

      // Check exit conditions
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

      // If bugs found, run defenders to fix
      if (totalBugs > 0) {
        for (const step of defenderSteps) {
          if (this.shouldStop) return;
          await this.runStep(step, phase, workflowConfig, 0);
          if (!this.lastStepSucceeded()) {
            throw new Error(`步骤 "${step.name}" 执行失败，迭代阶段中止`);
          }
        }
      }

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
      }
      await this.persistState();

      return resultText;
    } catch (error: any) {
      // If workflow was stopped, don't record this as a failure
      if (this.shouldStop) {
        this.currentStep = null;
        return '';
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

    // Set up stream content flushing to disk
    let lastFlush = 0;
    const streamHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== processId) return;
      const now = Date.now();
      // Flush to disk every 3 seconds
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
        roleConfig.systemPrompt,
        roleConfig.model,
        {
          workingDirectory: workflowConfig.context.projectRoot,
          allowedTools: roleConfig.allowedTools,
          resumeSessionId: existingSessionId,
          appendSystemPrompt: !!existingSessionId,
          timeoutMs: workflowConfig.context.timeoutMinutes
            ? workflowConfig.context.timeoutMinutes * 60 * 1000
            : undefined,
        }
      );
      // Final flush of stream content
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
      prompt += `## 前序步骤产出\n`;
      prompt += `以下是本次运行中已完成步骤的产出，供你参考：\n\n`;
      for (const [stepName, output] of Object.entries(previousOutputs)) {
        const truncated = output.length > 4000
          ? output.substring(0, 4000) + '\n...(已截断，完整内容见项目 runs 目录)'
          : output;
        prompt += `### ${stepName}\n\`\`\`\n${truncated}\n\`\`\`\n\n`;
      }
    }

    return prompt;
  }

  async waitForApproval(): Promise<void> {
    return new Promise((resolve) => {
      this.once('approve', resolve);
    });
  }

  approve(): void {
    this.emit('approve');
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    this.status = 'stopped';
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
      console.log(`[resume] phase="${phase.name}" steps=[${phaseStepNames.join(', ')}] allCompleted=${allPhaseCompleted} iterative=${!!phase.iteration?.enabled}`);
      if (allPhaseCompleted) {
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

      if (phase.iteration?.enabled) {
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
      if (phase.checkpoint && !this.shouldStop) {
        this.emit('checkpoint', {
          phase: phase.name,
          checkpoint: phase.checkpoint.name,
          message: phase.checkpoint.message,
          requiresApproval: true,
        });
        await this.persistState();
        await this.waitForApproval();
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


