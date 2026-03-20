/**
 * 状态机工作流管理器
 * 支持跨阶段回退的动态流程控制
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFile, readdir, stat, mkdir, cp, rm } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';
import { processManager } from './process-manager';
import type { ClaudeJsonResult } from './process-manager';
import { createRun, updateRun } from './run-store';
import {
  saveRunState, saveProcessOutput, saveOutputToWorkspace, saveStreamContent,
  loadRunState, loadStepOutputs, type PersistedRunState, type PersistedProcessInfo, type PersistedStepLog,
} from './run-state-persistence';
import type {
  StateMachineWorkflowConfig, StateMachineState, StateTransition,
  Issue, WorkflowStep, RoleConfig, TransitionCondition,
} from './schemas';
import { formatTimestamp } from './utils';
import { createEngine, getConfiguredEngine, type Engine, type EngineType } from './engines';
import type { EngineStreamEvent } from './engines/engine-interface';
import {
  parseNeedInfo,
  isPlanDone,
  routeInfoRequest,
  type AgentSummary,
  type InfoRequest,
  type RouteDecision,
} from './supervisor-router';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
  lastOutput: string;
  summary: string;
}

export interface StateExecutionResult {
  stateName: string;
  verdict: 'pass' | 'conditional_pass' | 'fail';
  issues: Issue[];
  stepOutputs: string[];
  summary: string;
}

export interface StateTransitionRecord {
  from: string;
  to: string;
  reason: string;
  issues: Issue[];
  timestamp: string;
}

export class StateMachineWorkflowManager extends EventEmitter {
  private status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped' = 'idle';
  private statusReason: string | null = null;
  private shouldStop = false;
  private currentState: string | null = null;
  private currentRunId: string | null = null;
  private currentConfigFile: string = '';
  private currentRequirements: string = '';
  private agents: AgentState[] = [];
  private agentConfigs: RoleConfig[] = [];
  private stateHistory: StateTransitionRecord[] = [];
  private issueTracker: Issue[] = [];
  private transitionCount = 0;
  private runStartTime: string | null = null;
  private runEndTime: string | null = null;
  private pendingForceTransition: string | null = null;
  private pendingForceInstruction: string | null = null;
  /** Tracks human approval context for crash recovery */
  private pendingApprovalInfo: {
    suggestedNextState: string;
    availableStates: string[];
    result: any;
  } | null = null;
  private globalContext: string = '';
  private stateContexts: Map<string, string> = new Map();
  private workspaceSkillsCache: string = '';
  private workspaceSkillsCacheProjectRoot: string = '';
  private workspaceSkillNames: Set<string> = new Set();
  /** Skills copied to workspace that need cleanup on finish */
  private copiedSkills: { dir: string; indexCopied: boolean } | null = null;
  private currentStep: string | null = null;
  private completedSteps: string[] = [];
  private currentProcesses: PersistedProcessInfo[] = [];
  private supervisorFlow: { type: string; from: string; to: string; question?: string; method?: string; round: number; timestamp: string; stateName?: string }[] = [];
  /** Agent 工作流：追踪 Agent 之间的信息传递 */
  private agentFlow: {
    id: string;
    type: 'stream' | 'request' | 'response' | 'supervisor';
    fromAgent: string;
    toAgent: string;
    message?: string;
    stateName: string;
    stepName: string;
    round: number;
    timestamp: string;
  }[] = [];
  private stepLogs: PersistedStepLog[] = [];
  /** Current engine instance (Kiro CLI, etc.) */
  private currentEngine: Engine | null = null;
  /** Current engine type */
  private engineType: EngineType = 'claude-code';
  /** Lightweight router model, configurable from workflow context.routerModel */
  private lightweightRouterModel: string = 'claude-sonnet-4-6';

  // ========== Supervisor-Lite Plan 循环相关 ==========
  /** 待解答的用户问题 Promise 解析器 */
  private pendingUserQuestionResolver: ((answer: string) => void) | null = null;
  /** 当前等待解答的问题 */
  private pendingUserQuestion: { question: string; fromAgent: string; round: number } | null = null;

  constructor() {
    super();
  }

  async loadAgentConfigs(): Promise<void> {
    const agentsDir = resolve(process.cwd(), 'configs/agents');
    this.agentConfigs = [];
    try {
      const files = await readdir(agentsDir);
      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
        try {
          const content = await readFile(resolve(agentsDir, file), 'utf-8');
          const config = parse(content) as RoleConfig;
          if (config?.name) {
            this.agentConfigs.push(config);
          }
        } catch (e) {
          console.warn(`[StateMachineWorkflowManager] 加载 agent 配置失败: ${file}`, e);
        }
      }
      console.log(`[StateMachineWorkflowManager] 加载了 ${this.agentConfigs.length} 个 agent 配置`);
    } catch {
      console.warn('[StateMachineWorkflowManager] configs/agents 目录不存在');
    }
  }

  /**
   * Load and cache workspace skills from .claude/skills/
   */
  private async loadWorkspaceSkills(projectRoot: string): Promise<string> {
    if (this.workspaceSkillsCache && this.workspaceSkillsCacheProjectRoot === projectRoot) {
      return this.workspaceSkillsCache;
    }

    // Try project-level first, then server-level skills directory
    const candidates = [
      resolve(process.cwd(), projectRoot, '.claude', 'skills'),
      resolve(process.cwd(), 'skills', '.claude', 'skills'),
    ];

    for (const skillsDir of candidates) {
      try {
        const skillIndex = resolve(skillsDir, 'SKILL.md');
        const indexContent = await readFile(skillIndex, 'utf-8');

        this.workspaceSkillNames.clear();
        try {
          const entries = await readdir(skillsDir);
          for (const entry of entries) {
            const entryPath = resolve(skillsDir, entry);
            const entryStat = await stat(entryPath).catch(() => null);
            if (entryStat?.isDirectory()) {
              this.workspaceSkillNames.add(entry);
            }
          }
        } catch { /* ignore */ }

        const result = indexContent.trim();
        this.workspaceSkillsCache = result;
        this.workspaceSkillsCacheProjectRoot = projectRoot;
        return result;
      } catch { /* try next candidate */ }
    }

    this.workspaceSkillsCache = '';
    this.workspaceSkillsCacheProjectRoot = projectRoot;
    this.workspaceSkillNames.clear();
    return '';
  }

  /**
   * Load a single skill's content from project or system skills directory
   */
  private async loadSkillContent(skillName: string, projectRoot: string): Promise<string | null> {
    const projectSkillPath = resolve(process.cwd(), projectRoot, '.claude', 'skills', skillName, 'SKILL.md');
    try {
      return await readFile(projectSkillPath, 'utf-8');
    } catch { /* not found in project */ }

    const systemSkillPath = resolve(process.cwd(), 'skills', '.claude', 'skills', skillName, 'SKILL.md');
    try {
      return await readFile(systemSkillPath, 'utf-8');
    } catch { /* not found in system */ }

    return null;
  }

  /**
   * Load step-level and workflow-level skills, returning formatted prompt content
   */
  private async loadAdditionalSkills(skillNames: string[], projectRoot: string): Promise<string> {
    const unique = [...new Set(skillNames)].filter(n => !this.workspaceSkillNames.has(n));
    if (unique.length === 0) return '';

    const loaded: { name: string; content: string }[] = [];
    for (const name of unique) {
      const content = await this.loadSkillContent(name, projectRoot);
      if (content) loaded.push({ name, content });
    }
    if (loaded.length === 0) return '';

    let result = `### 步骤/工作流指定 Skills\n\n`;
    for (const skill of loaded) {
      result += `#### ${skill.name}\n\n${skill.content}\n\n---\n\n`;
    }
    return result;
  }

  /**
   * Copy skills from server skills/ directory to workspace .claude/skills/
   * so that AI agents can discover and read them naturally.
   */
  private async syncSkillsToWorkspace(config: StateMachineWorkflowConfig): Promise<void> {
    const projectRoot = config.context?.projectRoot;
    if (!projectRoot) return;

    const serverSkillsDir = resolve(process.cwd(), 'skills', '.claude', 'skills');
    const workspaceSkillsDir = resolve(process.cwd(), projectRoot, '.claude', 'skills');

    if (!existsSync(serverSkillsDir)) return;

    // Collect all skill names needed: context.skills + all step.skills
    const needed = new Set<string>();
    if (config.context?.skills) config.context.skills.forEach(s => needed.add(s));
    for (const state of config.workflow.states) {
      for (const step of state.steps) {
        if (step.skills) step.skills.forEach(s => needed.add(s));
      }
    }
    if (needed.size === 0) return;

    // Track what we copy for cleanup
    const copiedNames: string[] = [];
    const dirExistedBefore = existsSync(workspaceSkillsDir);

    // Ensure target dir exists
    await mkdir(workspaceSkillsDir, { recursive: true });

    // Copy SKILL.md index if not exists
    const serverIndex = resolve(serverSkillsDir, 'SKILL.md');
    const targetIndex = resolve(workspaceSkillsDir, 'SKILL.md');
    let indexCopied = false;
    if (existsSync(serverIndex) && !existsSync(targetIndex)) {
      try { await cp(serverIndex, targetIndex); indexCopied = true; } catch { /* ignore */ }
    }

    // Copy each needed skill directory
    for (const skillName of needed) {
      const src = resolve(serverSkillsDir, skillName);
      const dst = resolve(workspaceSkillsDir, skillName);
      if (!existsSync(src)) continue;
      try {
        await cp(src, dst, { recursive: true, force: true });
        copiedNames.push(skillName);
        console.log(`[SM-Skills] 已复制 skill "${skillName}" → ${dst}`);
      } catch (e) {
        console.warn(`[SM-Skills] 复制 skill "${skillName}" 失败:`, e);
      }
    }

    if (copiedNames.length > 0 || indexCopied) {
      this.copiedSkills = { dir: workspaceSkillsDir, indexCopied };
      // Store copied names on the object for cleanup
      (this.copiedSkills as any).names = copiedNames;
      (this.copiedSkills as any).dirExistedBefore = dirExistedBefore;
    }
  }

  /**
   * Remove skills that were copied to workspace during syncSkillsToWorkspace
   */
  private async cleanupWorkspaceSkills(): Promise<void> {
    if (!this.copiedSkills) return;
    const { dir, indexCopied } = this.copiedSkills;
    const names: string[] = (this.copiedSkills as any).names || [];
    const dirExistedBefore: boolean = (this.copiedSkills as any).dirExistedBefore ?? true;

    for (const name of names) {
      const dst = resolve(dir, name);
      try {
        await rm(dst, { recursive: true, force: true });
        console.log(`[SM-Skills] 已清理 skill "${name}"`);
      } catch { /* ignore */ }
    }

    if (indexCopied) {
      try { await rm(resolve(dir, 'SKILL.md'), { force: true }); } catch { /* ignore */ }
    }

    // If we created the .claude/skills/ dir and it's now empty, remove it
    if (!dirExistedBefore) {
      try {
        const remaining = await readdir(dir);
        if (remaining.length === 0) {
          await rm(dir, { recursive: true, force: true });
          // Also try removing .claude/ if empty
          const claudeDir = resolve(dir, '..');
          const claudeRemaining = await readdir(claudeDir);
          if (claudeRemaining.length === 0) {
            await rm(claudeDir, { recursive: true, force: true });
          }
        }
      } catch { /* ignore */ }
    }

    this.copiedSkills = null;
  }

  getStatus() {
    return {
      status: this.status,
      statusReason: this.statusReason,
      runId: this.currentRunId,
      currentState: this.currentState,
      currentPhase: this.currentState, // alias for frontend compatibility
      currentStep: this.currentStep,
      completedSteps: this.completedSteps,
      currentConfigFile: this.currentConfigFile,
      agents: this.agents,
      stateHistory: this.stateHistory,
      issueTracker: this.issueTracker,
      transitionCount: this.transitionCount,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      globalContext: this.globalContext,
      phaseContexts: Object.fromEntries(this.stateContexts),
      supervisorFlow: this.supervisorFlow,
      agentFlow: this.agentFlow,
      stepLogs: this.stepLogs,
    };
  }

  async start(configFile: string, requirements?: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('工作流已在运行中');
    }

    try {
      this.status = 'running';
      this.shouldStop = false;
      this.stateHistory = [];
      this.issueTracker = [];
      this.transitionCount = 0;
      this.completedSteps = [];
      this.supervisorFlow = [];
      this.agentFlow = [];
      this.stepLogs = [];
      this.runStartTime = new Date().toISOString();
      this.currentConfigFile = configFile;
      // Load config
      const configPath = resolve(process.cwd(), 'configs', configFile);
      const configContent = await readFile(configPath, 'utf-8');
      const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
      this.lightweightRouterModel = workflowConfig.context?.routerModel?.trim() || 'claude-sonnet-4-6';

      // Use passed requirements, fallback to config context.requirements
      this.currentRequirements = requirements || workflowConfig.context?.requirements || '';

      // Validate mode
      if (workflowConfig.workflow.mode !== 'state-machine') {
        throw new Error('配置文件不是状态机模式');
      }

      // Load agent configs from configs/agents/
      await this.loadAgentConfigs();

      // Initialize agents
      this.initializeAgents(workflowConfig);

      // Initialize engine based on .engine.json
      await this.initializeEngine();

      // Sync skills to workspace before execution
      await this.syncSkillsToWorkspace(workflowConfig);

      // Create run record
      const totalSteps = workflowConfig.workflow.states.reduce(
        (sum, s) => sum + s.steps.length, 0
      );
      const runId = `run-${formatTimestamp()}`;
      this.currentRunId = runId;

      await createRun({
        id: runId,
        configFile,
        configName: workflowConfig.workflow.name,
        startTime: this.runStartTime,
        endTime: null,
        status: 'running',
        currentPhase: null,
        totalSteps,
        completedSteps: 0,
      });

      // Try to load existing state (for continuing previous runs)
      const existingState = await loadRunState(runId);
      if (existingState) {
        this.stateHistory = (existingState.stateHistory || []) as StateTransitionRecord[];
        this.issueTracker = (existingState.issueTracker || []) as Issue[];
        this.transitionCount = existingState.transitionCount || 0;
        this.completedSteps = existingState.completedSteps || [];
        this.currentState = existingState.currentState || existingState.currentPhase;
        this.runStartTime = existingState.startTime;
      }

      this.emit('status', {
        status: 'running',
        message: '状态机工作流已启动',
        runId,
        startTime: this.runStartTime,
        endTime: this.runEndTime,
        currentConfigFile: this.currentConfigFile
      });

      // Persist initial state
      await this.persistState();

      await this.executeStateMachine(workflowConfig, this.currentRequirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.emit('status', {
          status: 'failed',
          message: error.message,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    this.status = 'stopped';
    this.emit('status', {
      status: 'stopped',
      message: '工作流已停止',
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Kill any running child processes immediately
    const currentProcId = this.currentProcesses?.[0]?.id;
    if (currentProcId) {
      const proc = processManager.getProcessRaw(currentProcId);
      if (proc?.childProcess) {
        try { proc.childProcess.kill('SIGTERM'); } catch { /* already dead */ }
        proc.status = 'killed';
        proc.endTime = new Date();
      }
    }

    await this.finalizeRun('stopped');
  }

  forceTransition(targetState: string, instruction?: string): void {
    if (this.status !== 'running') {
      throw new Error('工作流未在运行中');
    }
    console.log('[StateMachine] forceTransition called, targetState:', targetState, 'instruction:', instruction, 'currentState:', this.currentState);
    this.pendingForceTransition = targetState;
    if (instruction) {
      this.pendingForceInstruction = instruction;
    }
    this.emit('force-transition', { targetState, from: this.currentState, instruction });

    // Kill the running process so the main loop can pick up the forced transition immediately
    const currentProcId = this.currentProcesses?.[0]?.id;
    const currentStepId = this.currentProcesses?.[0]?.stepId;
    if (currentProcId || currentStepId) {
      const allProcs = processManager.getAllProcesses();
      const running = allProcs.find(
        (p: any) => (p.status === 'running' || p.status === 'queued') && (
          (currentStepId && p.stepId === currentStepId) ||
          (currentProcId && p.id === currentProcId)
        )
      );
      if (running) {
        console.log(`[StateMachine] forceTransition: killing process ${running.id}`);
        processManager.killProcess(running.id);
      }
    }
  }

  setContext(scope: 'global' | 'phase', context: string, stateName?: string): void {
    if (scope === 'global') {
      this.globalContext = context;
    } else if (scope === 'phase' && stateName) {
      // For state machine, 'phase' refers to 'state'
      this.stateContexts.set(stateName, context);
    }
  }

  getContexts(): { global: string; phases: Record<string, string> } {
    return {
      global: this.globalContext,
      phases: Object.fromEntries(this.stateContexts),
    };
  }

  private async waitForHumanApproval(): Promise<void> {
    // Wait for human to call forceTransition
    console.log('[StateMachine] Entering waitForHumanApproval, pendingForceTransition:', this.pendingForceTransition);
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.pendingForceTransition || this.shouldStop) {
          console.log('[StateMachine] waitForHumanApproval resolved, pendingForceTransition:', this.pendingForceTransition, 'shouldStop:', this.shouldStop);
          clearInterval(checkInterval);
          resolve();
        }
      }, 500); // Check every 500ms
    });
  }

  private async finalizeRun(status: 'completed' | 'failed' | 'stopped') {
    if (!this.currentRunId) return;
    this.runEndTime = new Date().toISOString();

    // Cleanup copied skills from workspace
    await this.cleanupWorkspaceSkills();

    try {
      const completedSteps = this.agents.reduce((sum, a) => sum + a.completedTasks, 0);
      await updateRun(this.currentRunId, {
        endTime: this.runEndTime,
        status,
        currentPhase: this.currentState,
        completedSteps,
      });

      await this.persistState(status);
    } catch (err) {
      console.error('[StateMachine] finalizeRun persistState failed:', err);
    }

    this.status = 'idle';
  }

  private async persistState(finalStatus?: 'completed' | 'failed' | 'stopped'): Promise<void> {
    if (!this.currentRunId) return;
    try {
      await saveRunState({
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        status: finalStatus || (this.shouldStop ? 'stopped' : this.status === 'idle' ? 'running' : this.status) as any,
        statusReason: this.statusReason || undefined,
        startTime: this.runStartTime || new Date().toISOString(),
        endTime: finalStatus ? this.runEndTime : null,
        currentPhase: this.currentState,
        currentStep: this.currentStep,
        completedSteps: this.completedSteps,
        failedSteps: [],
        stepLogs: [...this.stepLogs],
        agents: this.agents.map(a => ({
          name: a.name,
          team: a.team,
          model: a.model,
          status: a.status,
          completedTasks: a.completedTasks,
          tokenUsage: a.tokenUsage,
          costUsd: a.costUsd,
          sessionId: a.sessionId,
          iterationCount: 0,
          summary: a.summary,
        })),
        iterationStates: {},
        processes: this.currentProcesses,
        mode: 'state-machine',
        currentState: this.currentState,
        transitionCount: this.transitionCount,
        maxTransitions: 50,
        stateHistory: this.stateHistory,
        issueTracker: this.issueTracker,
        requirements: this.currentRequirements,
        globalContext: this.globalContext,
        phaseContexts: Object.fromEntries(this.stateContexts),
        supervisorFlow: this.supervisorFlow,
        agentFlow: this.agentFlow as any,
        // 只在真正等待人工审批时才写入 pendingCheckpoint；已完成/失败/停止时清除
        ...(!finalStatus && this.currentState === '__human_approval__' && this.pendingApprovalInfo ? {
          pendingCheckpoint: {
            phase: '__human_approval__',
            checkpoint: 'human-approval',
            message: `等待人工审查，建议下一状态: ${this.pendingApprovalInfo.suggestedNextState}`,
            isIterativePhase: false,
            suggestedNextState: this.pendingApprovalInfo.suggestedNextState,
            availableStates: this.pendingApprovalInfo.availableStates,
          },
        } : {}),
      });
    } catch (err) {
      console.error('[StateMachine] persistState failed:', err);
    }
  }

  /**
   * Initialize the AI engine based on .engine.json configuration
   */
  private async initializeEngine(): Promise<void> {
    try {
      this.engineType = await getConfiguredEngine();
      console.log(`[StateMachineWorkflowManager] 使用引擎: ${this.engineType} (from ${resolve(process.cwd(), '.engine.json')})`);
      this.emit('log', `使用引擎: ${this.engineType}`);

      if (this.engineType !== 'claude-code') {
        this.currentEngine = await createEngine(this.engineType);
        if (!this.currentEngine) {
          console.log(`[StateMachineWorkflowManager] 引擎 ${this.engineType} 不可用，回退到 Claude Code`);
          this.engineType = 'claude-code';
        } else {
          console.log(`[StateMachineWorkflowManager] 引擎 ${this.engineType} 初始化成功`);
        }
      }
    } catch (error) {
      console.log(`[StateMachineWorkflowManager] 引擎初始化失败: ${error}, 使用 Claude Code`);
      this.engineType = 'claude-code';
      this.currentEngine = null;
    }
  }

  /**
   * Execute a task using the configured engine (Kiro CLI, Claude Code, etc.)
   */
  private async executeWithEngine(
    processId: string,
    agent: string,
    step: string,
    prompt: string,
    systemPrompt: string,
    model: string,
    options: any
  ): Promise<ClaudeJsonResult> {
    if (this.engineType === 'claude-code' || !this.currentEngine) {
      return await processManager.executeClaudeCli(
        processId, agent, step, prompt, systemPrompt, model, options
      );
    }

    // Use alternative engine (Kiro CLI, etc.)
    console.log(`[StateMachineWorkflowManager] 使用 ${this.engineType} 引擎执行: ${step}`);

    // Register process in processManager so it's visible to the frontend
    const proc = processManager.registerExternalProcess(processId, agent, step, options.runId, options.stepId);

    const streamHandler = (event: EngineStreamEvent) => {
      // Accumulate stream content on the registered process
      const rawProc = processManager.getProcessRaw(processId);
      if (rawProc) {
        rawProc.streamContent += event.content;
      }
      processManager.emit('stream', {
        id: processId,
        step,
        delta: event.content,
        total: rawProc?.streamContent || event.content,
      });
      // Persist stream content periodically
      if (this.currentRunId && rawProc?.streamContent) {
        const smStepName = this.currentState ? `${this.currentState}-${step}` : step;
        saveStreamContent(this.currentRunId, smStepName, rawProc.streamContent).catch(() => {});
      }
    };

    this.currentEngine.on('stream', streamHandler);

    try {
      const result = await this.currentEngine.execute({
        agent, step, prompt, systemPrompt, model,
        workingDirectory: options.workingDirectory,
        allowedTools: options.allowedTools,
        timeoutMs: options.timeoutMs,
        sessionId: options.resumeSessionId,
        appendSystemPrompt: options.appendSystemPrompt,
        runId: options.runId,
      });

      // Mark process as completed
      const rawProc = processManager.getProcessRaw(processId);
      if (rawProc) {
        rawProc.status = 'completed';
        rawProc.endTime = new Date();
        rawProc.output = result.output || rawProc.streamContent;
        rawProc.sessionId = result.sessionId;
      }

      // If engine reports failure, throw so the step is marked as failed
      if (!result.success) {
        const errorMsg = result.error || '引擎执行失败（无输出）';
        console.error(`[StateMachineWorkflowManager] ${this.engineType} 引擎执行失败: ${errorMsg}`);
        if (rawProc) { rawProc.status = 'failed'; rawProc.error = errorMsg; }
        throw new Error(`${this.engineType} 引擎执行失败: ${errorMsg}`);
      }

      return {
        result: result.output,
        session_id: result.sessionId || '',
        is_error: false,
        cost_usd: 0,
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
    } finally {
      this.currentEngine.off('stream', streamHandler);
    }
  }

  private initializeAgents(workflowConfig: StateMachineWorkflowConfig): void {
    const agentSet = new Set<string>();
    for (const state of workflowConfig.workflow.states) {
      for (const step of state.steps) {
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
        lastOutput: '',
        summary: '',
      };
    });

    this.emit('agents', { agents: this.agents });
  }

  private async executeStateMachine(
    config: StateMachineWorkflowConfig,
    requirements?: string
  ): Promise<void> {
    const maxTransitions = config.workflow.maxTransitions || 50;

    // If resuming, use existing currentState; otherwise find initial state
    if (!this.currentState) {
      const initialState = config.workflow.states.find(s => s.isInitial)
        || config.workflow.states[0];
      this.currentState = initialState.name;
    }

    this.emit('state-change', {
      state: this.currentState,
      message: `进入状态: ${this.currentState}`,
    });

    while (this.currentState && !this.shouldStop) {
      // Check max transitions
      if (this.transitionCount >= maxTransitions) {
        throw new Error(`达到最大状态转移次数 (${maxTransitions})，可能存在死循环`);
      }

      // Find current state config
      const stateConfig = config.workflow.states.find(s => s.name === this.currentState);
      if (!stateConfig) {
        throw new Error(`找不到状态配置: ${this.currentState}`);
      }

      // Check if final state
      if (stateConfig.isFinal) {
        // Execute final state steps (e.g. regression tests) before completing
        if (stateConfig.steps.length > 0) {
          await this.executeState(stateConfig, config, requirements);
        }
        this.emit('state-change', {
          state: this.currentState,
          message: `到达终止状态: ${this.currentState}`,
        });
        break;
      }

      // Execute current state
      const result = await this.executeState(stateConfig, config, requirements);

      // Evaluate transitions
      const nextState = await this.evaluateTransitions(
        stateConfig.transitions,
        result,
        config
      );

      // Check if human approval is required
      // Skip human approval if transitioning to self (iteration)
      const requiresApproval = stateConfig.requireHumanApproval && nextState !== this.currentState;

      if (requiresApproval) {
        const fromStateName = this.currentState;

        // First transition: current state -> __human_approval__
        this.stateHistory.push({
          from: this.currentState,
          to: '__human_approval__',
          reason: `需要人工审查: ${this.getTransitionReason(result)}`,
          issues: result.issues,
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: this.currentState,
          to: '__human_approval__',
          transitionCount: this.transitionCount,
          issues: result.issues,
        });

        this.currentState = '__human_approval__';

        // Save approval context for crash recovery
        this.pendingApprovalInfo = {
          suggestedNextState: nextState,
          availableStates: config.workflow.states.map(s => s.name),
          result,
        };

        // Persist state so crash recovery can restore to human approval
        await this.persistState();

        // Emit state change to human approval
        this.emit('state-change', {
          state: '__human_approval__',
          message: '等待人工审查决策',
        });

        // Emit human approval required event and wait
        this.emit('human-approval-required', {
          currentState: '__human_approval__',
          suggestedNextState: nextState,
          result,
          availableStates: config.workflow.states.map(s => s.name),
        });

        // Wait for human decision via forceTransition
        await this.waitForHumanApproval();

        // After human approval, pendingForceTransition will be set
        const humanSelectedState: string = this.pendingForceTransition || nextState;
        this.pendingForceTransition = null;
        this.pendingApprovalInfo = null;

        // Second transition: __human_approval__ -> selected state
        const instruction = this.pendingForceInstruction || '';
        this.pendingForceInstruction = null;
        this.stateHistory.push({
          from: '__human_approval__',
          to: humanSelectedState,
          reason: instruction
            ? `人工决策: 选择进入 ${humanSelectedState}，附加指令: ${instruction}`
            : `人工决策: 选择进入 ${humanSelectedState}`,
          issues: [],
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: '__human_approval__',
          to: humanSelectedState,
          transitionCount: this.transitionCount,
          issues: [],
        });

        // 人工审批后仍然是状态流转，需要补充 Agent 级绿色流转线
        const fromState = fromStateName
          ? config.workflow.states.find(s => s.name === fromStateName)
          : undefined;
        const toState = config.workflow.states.find(s => s.name === humanSelectedState);
        if (fromState && toState && fromState.steps.length > 0 && toState.steps.length > 0) {
          const fromAgent = fromState.steps[fromState.steps.length - 1].agent;
          const toAgent = toState.steps[0].agent;
          if (fromAgent !== toAgent) {
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'stream',
              fromAgent,
              toAgent,
              message: `状态流转: ${fromState.name} -> ${toState.name} (人工审查后)`,
              stateName: fromState.name,
              stepName: fromState.steps[fromState.steps.length - 1].name,
              round: 0,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
          }
        }

        this.currentState = humanSelectedState;
      } else {
        // No human approval needed, proceed automatically
        // Record transition
        this.stateHistory.push({
          from: this.currentState,
          to: nextState,
          reason: this.getTransitionReason(result),
          issues: result.issues,
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: this.currentState,
          to: nextState,
          transitionCount: this.transitionCount,
          issues: result.issues,
        });

        // 添加状态切换的流转线
        const fromState = config.workflow.states.find(s => s.name === this.currentState);
        const toState = config.workflow.states.find(s => s.name === nextState);
        if (fromState && toState && fromState.steps.length > 0 && toState.steps.length > 0) {
          const fromAgent = fromState.steps[fromState.steps.length - 1].agent;
          const toAgent = toState.steps[0].agent;
          if (fromAgent !== toAgent) {
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'stream',
              fromAgent: fromAgent,
              toAgent: toAgent,
              message: `状态流转: ${fromState.name} -> ${toState.name}`,
              stateName: fromState.name,
              stepName: fromState.steps[fromState.steps.length - 1].name,
              round: 0,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
          }
        }

        this.currentState = nextState;
      }
    }
  }

  private async executeState(
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string
  ): Promise<StateExecutionResult> {
    this.emit('state-executing', {
      state: state.name,
      stepCount: state.steps.length,
    });

    const stepOutputs: string[] = [];
    const issues: Issue[] = [];
    let verdict: 'pass' | 'conditional_pass' | 'fail' = 'pass';

    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      if (this.shouldStop) break;
      // Allow forced transition to interrupt mid-state
      if (this.pendingForceTransition) break;

      // Delay between steps when using non-claude engines to avoid throttling
      if (i > 0 && this.engineType !== 'claude-code') {
        console.log(`[StateMachineWorkflowManager] 步骤间延时 30s (防限流)`);
        await new Promise(r => setTimeout(r, 30000));
      }

      try {
        // ========== Supervisor-Lite: 判断是否启用 Plan 循环 ==========
        let output: string;
        if (step.enablePlanLoop) {
          output = await this.executeStepWithInfoGathering(step, state, config, requirements);
        } else {
          output = await this.executeStep(step, state, config, requirements);
        }
        stepOutputs.push(output);

        // Parse issues from output
        const stepIssues = this.parseIssuesFromOutput(output, step, state.name);
        issues.push(...stepIssues);

        // Update verdict based on step role
        if (step.role === 'judge') {
          const stepVerdict = this.parseVerdict(output);
          if (stepVerdict === 'fail') verdict = 'fail';
          else if (stepVerdict === 'conditional_pass' && verdict === 'pass') {
            verdict = 'conditional_pass';
          }
        }
      } catch (stepError: any) {
        const errorMsg = stepError.message || String(stepError);
        console.error(`[StateMachineWorkflowManager] Step "${step.name}" in state "${state.name}" failed: ${errorMsg}`);
        stepOutputs.push(`ERROR: ${errorMsg}`);
        verdict = 'fail';
        // Continue to next step instead of aborting the entire state
      }
    }

    // Add issues to tracker
    this.issueTracker.push(...issues);

    return {
      stateName: state.name,
      verdict,
      issues,
      stepOutputs,
      summary: this.generateStateSummary(state, issues),
    };
  }

  private async executeStep(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string
  ): Promise<string> {
    const agent = this.agents.find(a => a.name === step.agent);
    if (!agent) {
      throw new Error(`找不到 agent: ${step.agent}`);
    }

    const stepId = randomUUID();
    const stepKey = `${state.name}-${step.name}`;

    agent.status = 'running';
    agent.currentTask = step.name;
    this.currentStep = stepKey;
    this.emit('agents', { agents: this.agents });
    
    this.agentFlow.push({
      id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'stream',
      fromAgent: step.agent,
      toAgent: step.agent,
      message: `开始执行步骤: ${step.name}`,
      stateName: state.name,
      stepName: step.name,
      round: 0,
      timestamp: new Date().toISOString(),
    });
    this.emit('agent-flow', { agentFlow: this.agentFlow });
    await this.persistState();

    this.emit('step-start', {
      id: stepId,
      state: state.name,
      step: step.name,
      agent: step.agent,
    });

    try {
      // 在执行 Agent 之前，先执行可选的预命令（例如编译 / 测试命令）
      this.lastPreCommandOutput = null;
      if (Array.isArray((step as any).preCommands) && (step as any).preCommands.length > 0) {
        try {
          const preOutput = await this.runPreCommands(
            (step as any).preCommands as string[],
            config
          );
          this.lastPreCommandOutput = preOutput || null;
        } catch (e) {
          // 预命令执行本身不应中断整个步骤，将错误文本注入上下文由 Agent 决策
          const msg = e instanceof Error ? e.message : String(e);
          this.lastPreCommandOutput = `预执行命令执行异常（不会中断步骤，请你据此判断是否 fail）：\n${msg}`;
        }
      }

      // Build context (now async)
      const context = await this.buildStepContext(step, state, config, requirements, extraContext);

      // Execute step (reuse existing process manager logic)
      const stepResult = await this.runAgentStep(step, context, config, stepId);
      const output = stepResult.output;

      agent.status = 'completed';
      agent.completedTasks++;
      agent.lastOutput = output;
      this.currentStep = null;
      this.completedSteps.push(stepKey);
      this.currentProcesses = [];

      // Record step log for persistence
      this.stepLogs.push({
        id: stepId,
        stepName: stepKey,
        agent: step.agent,
        status: 'completed',
        output,
        error: '',
        costUsd: stepResult.costUsd,
        durationMs: stepResult.durationMs,
        timestamp: new Date().toISOString(),
      });

      this.emit('agents', { agents: this.agents });
      await this.persistState();

      this.emit('step-complete', {
        id: stepId,
        state: state.name,
        step: step.name,
        agent: step.agent,
        output,
        costUsd: stepResult.costUsd,
        durationMs: stepResult.durationMs,
      });

      // 记录步骤完成的流转线
      const currentStepIndex = state.steps.findIndex(s => s.name === step.name);
      if (currentStepIndex >= 0 && currentStepIndex < state.steps.length - 1) {
        const nextStep = state.steps[currentStepIndex + 1];
        if (nextStep && nextStep.agent !== step.agent) {
          this.agentFlow.push({
            id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'stream',
            fromAgent: step.agent,
            toAgent: nextStep.agent,
            message: `步骤流转: ${step.name} -> ${nextStep.name}`,
            stateName: state.name,
            stepName: step.name,
            round: 0,
            timestamp: new Date().toISOString(),
          });
          this.emit('agent-flow', { agentFlow: this.agentFlow });
        }
      }

      // Save output to file system
      if (this.currentRunId) {
        const stepFileName = stepKey;
        await saveProcessOutput(this.currentRunId, stepFileName, output).catch(() => {});

        // Save conclusion to workspace with timestamp to avoid overwriting
        // the detailed report the agent wrote, and to handle re-execution on iteration/state-loop
        if (config.context?.projectRoot) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const conclusionFileName = `${ts}-${stepKey}-结论`;
          await saveOutputToWorkspace(
            config.context.projectRoot,
            this.currentRunId,
            conclusionFileName,
            output
          ).catch(() => {});
        }
      }

      return output;
    } catch (error: any) {
      agent.status = 'failed';
      this.currentStep = null;
      this.currentProcesses = [];

      // Record failed step log
      const errorMsg = error.message || String(error);
      this.stepLogs.push({
        id: stepId,
        stepName: stepKey,
        agent: step.agent,
        status: 'failed',
        output: '',
        error: errorMsg,
        costUsd: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });

      this.emit('agents', { agents: this.agents });
      await this.persistState();

      // Save error output
      if (this.currentRunId) {
        await saveProcessOutput(this.currentRunId, stepKey, `ERROR: ${errorMsg}`).catch(() => {});
      }

      throw error;
    }
  }

  private async buildStepContext(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string
  ): Promise<string> {
    const parts: string[] = [];

    parts.push(`# 当前状态: ${state.name}`);
    if (state.description) {
      parts.push(`状态描述: ${state.description}`);
    }

    parts.push(`\n# 当前任务: ${step.name}`);
    parts.push(`任务描述: ${step.task}`);

    if (requirements) {
      parts.push(`\n# 需求说明\n${requirements}`);
    }

    // Add global context
    if (this.globalContext) {
      parts.push(`\n# 全局上下文\n${this.globalContext}`);
    }

    // Add state-specific context
    const stateContext = this.stateContexts.get(state.name);
    if (stateContext) {
      parts.push(`\n# 状态上下文\n${stateContext}`);
    }

    // Add project path
    if (config.context?.projectRoot) {
      parts.push(`\n# 项目路径\n${config.context.projectRoot}`);
    }

    // Add document output path
    if (this.currentRunId && config.context?.projectRoot) {
      const outputPath = `${config.context.projectRoot}/.ace-outputs/${this.currentRunId}/`;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeName = `${state.name}-${step.name}`.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
      const fullPath = `${outputPath}${ts}-${safeName}.md`;
      parts.push(`\n# 文档输出要求\n请将你产出的所有文档、报告、分析结果等写入以下目录：\n\`${outputPath}\`\n\n本步骤的文档路径: \`${fullPath}\`\n\n**重要**: 文件名必须以时间戳开头（格式 \`YYYY-MM-DDTHH-MM-SS-\`），这样便于按时间排序。如果你需要写多个文件，都放在上述目录下，每个文件名都以时间戳开头。`);
    }

    // Add structured JSON output requirement for attacker/judge roles
    if (step.role === 'attacker' || step.role === 'judge') {
      parts.push(`\n# 结构化输出要求\n在你的回复最末尾，请务必输出以下 JSON 块（用 \`\`\`json 包裹），用于自动化流程判断：\n\n\`\`\`json\n{\n  "verdict": "pass | conditional_pass | fail",\n  "remaining_issues": 0,\n  "summary": "一句话总结"\n}\n\`\`\`\n\n字段说明：\n- \`verdict\`: \`"pass"\` 表示无问题可通过，\`"conditional_pass"\` 表示有条件通过（存在需修复的问题但方向正确），\`"fail"\` 表示存在严重问题需要重做\n- \`remaining_issues\`: 剩余未解决的问题数量（整数）\n- \`summary\`: 一句话总结你的评估结论`);
    }

    // Add workspace skills (index summary + absolute path for AI to read details)
    if (config.context?.projectRoot) {
      const skills = await this.loadWorkspaceSkills(config.context.projectRoot);
      if (skills) {
        const skillsAbsPath = resolve(process.cwd(), 'skills', '.claude', 'skills');
        parts.push(`\n# 可用 Skills\n\nSkills 目录绝对路径: \`${skillsAbsPath}/\`\n\n如需使用某个 Skill，请先用 Read 工具读取对应的 SKILL.md 文件获取详细说明。例如：\`${skillsAbsPath}/build-cangjie/SKILL.md\`\n\n${skills}`);
      }
    }

    // Add workflow-level and step-level skills
    const allSkillNames: string[] = [];
    if (config.context?.skills) allSkillNames.push(...config.context.skills);
    if (step.skills) allSkillNames.push(...step.skills);
    if (allSkillNames.length > 0 && config.context?.projectRoot) {
      const additionalSkills = await this.loadAdditionalSkills(allSkillNames, config.context.projectRoot);
      if (additionalSkills) {
        parts.push(`\n# 必须使用的 Skills\n\n⚠️ **重要提醒：以下 Skills 是本步骤/项目的核心工具，你必须严格遵循以下原则：**\n\n1. **优先阅读 Skills**：在执行任何任务前，请务必仔细阅读下方所有 Skills 的说明文档\n2. **使用 Skills 中的命令**：直接使用 Skills 中提供的命令格式和参数，**严禁**自行猜测命令或随意修改参数\n3. **Skills 包含最佳实践**：每个 Skill 都经过验证，代表了该领域的最佳实践\n4. **遇到问题先查 Skills**：如果遇到构建、测试、部署等问题，请首先检查是否有对应的 Skill 可用\n\n${additionalSkills}`);
      }
    }

    // Add live feedback
    if (this.liveFeedback.length > 0) {
      parts.push(`\n# 实时反馈`);
      for (const feedback of this.liveFeedback) {
        parts.push(`- ${feedback}`);
      }
    }

    // Add state history
    if (this.stateHistory.length > 0) {
      parts.push(`\n# 状态转移历史`);
      const recent = this.stateHistory.slice(-5);
      for (const record of recent) {
        parts.push(`- ${record.from} → ${record.to}: ${record.reason}`);
      }

      // Extract human instruction from the most recent transition (if any)
      const lastTransition = this.stateHistory[this.stateHistory.length - 1];
      if (lastTransition?.reason?.includes('附加指令:')) {
        const instructionMatch = lastTransition.reason.match(/附加指令:\s*(.+)$/);
        if (instructionMatch) {
          parts.push(`\n# ⚠️ 人工指令（必须遵守）\n${instructionMatch[1]}`);
        }
      }
    }

    // Add recent issues
    if (this.issueTracker.length > 0) {
      parts.push(`\n# 已发现的问题`);
      const recent = this.issueTracker.slice(-10);
      for (const issue of recent) {
        parts.push(`- [${issue.severity}] ${issue.type}: ${issue.description}`);
      }
    }

    // Add preCommands output (if any)
    if (this.lastPreCommandOutput) {
      const raw = this.lastPreCommandOutput;
      const maxLen = 4000;
      const display = raw.length > maxLen
        ? '...(截断，保留结尾)...\n' + raw.slice(-maxLen)
        : raw;
      parts.push(`\n# 预执行命令结果（系统自动执行，必须据此做出裁决）\n${display}`);
    }

    // Add previous steps' conclusions from the last 2 completed states
    if (this.currentRunId && this.stateHistory.length > 0) {
      try {
        const outputs = await loadStepOutputs(this.currentRunId);
        // Find the last 2 states before current
        const previousStates: string[] = [];
        for (let i = this.stateHistory.length - 1; i >= 0 && previousStates.length < 2; i--) {
          const from = this.stateHistory[i].from;
          if (from !== '__origin__' && from !== '__human_approval__' && !previousStates.includes(from)) {
            previousStates.push(from);
          }
        }

        const conclusions: string[] = [];
        for (const prevState of previousStates) {
          // Find outputs matching this state (format: "stateName-stepName")
          const stateOutputs = Object.entries(outputs)
            .filter(([key]) => key.startsWith(`${prevState}-`));
          for (const [stepKey, content] of stateOutputs) {
            // Truncate to last 2000 chars to avoid prompt bloat
            const truncated = content.length > 2000
              ? '...(截断)\n' + content.slice(-2000)
              : content;
            conclusions.push(`## ${stepKey}\n${truncated}`);
          }
        }

        if (conclusions.length > 0) {
          parts.push(`\n# 前置步骤结论\n以下是之前步骤的产出，请参考：\n`);
          parts.push(conclusions.join('\n\n'));
        }
      } catch { /* non-critical */ }
    }

    // ========== Supervisor-Lite: 注入可选的下一状态 ==========
    if (state.transitions && state.transitions.length > 0) {
      parts.push(`\n# 可选的下一状态`);
      for (const t of state.transitions) {
        const targetState = config.workflow.states.find(s => s.name === t.to);
        parts.push(`- ${t.to}: ${targetState?.description || '无描述'}`);
      }
    }

    // ========== Supervisor-Lite: 注入信息请求协议 ==========
    if (step.enablePlanLoop) {
      parts.push(`\n# 信息请求协议`);
      parts.push(`在执行任务前，请先评估你是否有足够的信息。`);
      parts.push(`如果信息不足，先进行信息收集而不直接执行任务，请使用以下格式声明你需要的信息：`);
      parts.push(`- 需要技术/专业信息补充信息时：[NEED_INFO] 问题描述`);
      parts.push(`- 需要用户/人工补充信息时：[NEED_INFO:human] 问题描述`);
      parts.push(`- 如果有多个问题需要确认，也只需要列出一个[NEED_INFO]/[NEED_INFO:human]，并在问题描述中列出所有需要确认的问题`);
      parts.push(`- 如果有问题需要确认，则不执行任务，直接将问题以上述格式进行输出，结束本轮执行，不需要等待回复，supervisor会给你路由到对应的专家，信息收集可能存在多轮`);
      parts.push(`- 如果信息已充分可以执行：输出[PLAN_DONE]，并执行具体任务`);
      parts.push(`\n注意：你不需要指定由谁来回答技术问题，系统会自动路由到合适的专家。`);
    }

    // ========== Supervisor-Lite: 注入额外上下文（信息收集循环） ==========
    if (extraContext) {
      parts.push(`\n# 补充信息\n${extraContext}`);
    }

    // Replace template variables
    let result = parts.join('\n');
    if (this.currentRunId) {
      result = result.replace(/\{runId\}/g, this.currentRunId);
    }
    return result;
  }

  /**
   * 在后端直接执行 preCommands（如 build.sh / 测试命令），并收集 stdout/stderr。
   * 命令串行执行，即使命令失败也不会抛出异常，而是把失败信息写入返回文本中。
   */
  private async runPreCommands(
    commands: string[],
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    const { exec } = await import('child_process');
    const cwd = config.context?.projectRoot
      ? resolve(process.cwd(), config.context.projectRoot)
      : process.cwd();

    const results: string[] = [];

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      results.push(`\n[${i + 1}] $ ${cmd}\n工作目录: ${cwd}\n`);
      // eslint-disable-next-line no-await-in-loop
      const { stdout, stderr, exitCode, errorText } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
        errorText: string | null;
      }>((resolveInner) => {
        const child = exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, so, se) => {
          const code = (error as any)?.code ?? 0;
          resolveInner({
            stdout: so ?? '',
            stderr: se ?? '',
            exitCode: Number.isInteger(code) ? (code as number) : 0,
            errorText: error ? String(error) : null,
          });
        });
        // 避免悬挂：如果 exec 抛出同步异常
        child.on('error', (err) => {
          resolveInner({
            stdout: '',
            stderr: '',
            exitCode: null,
            errorText: String(err),
          });
        });
      });

      const truncate = (text: string, max: number) => {
        if (!text) return '';
        return text.length > max ? text.slice(0, max) + '\n...(截断)...' : text;
      };

      results.push(`exitCode: ${exitCode ?? 'unknown'}\n`);
      if (errorText) {
        results.push(`exec error: ${truncate(errorText, 1000)}\n`);
      }
      if (stdout) {
        results.push(`--- stdout ---\n${truncate(stdout, 4000)}\n`);
      }
      if (stderr) {
        results.push(`--- stderr ---\n${truncate(stderr, 4000)}\n`);
      }
    }

    return results.join('\n');
  }

  private async runAgentStep(
    step: WorkflowStep,
    context: string,
    config: StateMachineWorkflowConfig,
    stepId?: string
  ): Promise<{ output: string; costUsd: number; durationMs: number }> {
    // Find agent config for system prompt and model
    const roleConfig = this.agentConfigs.find(r => r.name === step.agent)
      || config.roles?.find(r => r.name === step.agent);

    const model = roleConfig?.model || 'claude-opus-4-6';
    const systemPrompt = roleConfig?.systemPrompt || `你是一个 ${step.role || 'assistant'} 角色的 AI 助手。`;
    const workingDirectory = config.context?.projectRoot
      ? resolve(process.cwd(), config.context.projectRoot)
      : process.cwd();

    let currentProcessId = stepId || randomUUID();
    let currentPrompt = context;
    let currentSessionId: string | undefined;
    let accumulatedOutput = '';
    let accumulatedStream = '';
    let accumulatedCost = 0;
    let accumulatedDuration = 0;

    // Use state-prefixed step name so frontend stream polling matches persisted stream files
    const streamStepName = this.currentState ? `${this.currentState}-${step.name}` : step.name;

    // Track process
    this.currentProcesses = [{
      pid: Date.now(),
      id: currentProcessId,
      agent: step.agent,
      step: streamStepName,
      stepId,
      startTime: new Date().toISOString(),
    }];
    await this.persistState();

    // Set up periodic stream content flushing to disk (so frontend can read it)
    let lastFlush = 0;
    const streamFlushHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== currentProcessId) return;
      const now = Date.now();
      if (this.currentRunId && now - lastFlush > 2000) {
        lastFlush = now;
        const proc = processManager.getProcess(currentProcessId);
        const content = proc?.streamContent || data.total;
        if (content) {
          const fullStream = accumulatedStream
            ? accumulatedStream + '\n\n<!-- chunk-boundary -->\n\n' + content
            : content;
          saveStreamContent(this.currentRunId, streamStepName, fullStream).catch(() => {});
        }
      }
    };
    processManager.on('stream', streamFlushHandler);

    // Feedback loop: run agent, handle interrupts and pending feedback
    try {
    while (true) {
      // Check if workflow was stopped
      if (this.shouldStop) {
        throw new Error('工作流已停止');
      }
      let result: ClaudeJsonResult;
      try {
        result = await this.executeWithEngine(
          currentProcessId,
          step.agent,
          step.name,
          currentPrompt,
          systemPrompt,
          model,
          {
            workingDirectory,
            timeoutMs: (config.context?.timeoutMinutes || 60) * 60 * 1000,
            runId: this.currentRunId || undefined,
            stepId,
            resumeSessionId: currentSessionId,
            appendSystemPrompt: !!currentSessionId,
          }
        );
      } catch (err) {
        // If force transition killed the process, return partial output and let main loop handle it
        if (this.pendingForceTransition) {
          console.log(`[SM-ForceTransition] 进程被强制跳转终止，目标: ${this.pendingForceTransition}`);
          const proc = processManager.getProcess(currentProcessId);
          if (proc?.streamContent) {
            accumulatedStream += (accumulatedStream ? '\n\n<!-- chunk-boundary -->\n\n' : '') + proc.streamContent;
          }
          if (this.currentRunId) {
            saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
          }
          return { output: accumulatedOutput || '(强制跳转，步骤未完成)', costUsd: accumulatedCost, durationMs: accumulatedDuration };
        }
        // If interrupted with feedback, resume with feedback
        console.log(`[SM-Feedback] catch 块: interruptFlag=${this.interruptFlag}, feedbackCount=${this.liveFeedback.length}, err=${(err as Error).message?.substring(0, 100)}`);
        if (this.interruptFlag && this.liveFeedback.length > 0) {
          const isFeedbackOnly = this.feedbackInterrupt;
          this.interruptFlag = false;
          this.feedbackInterrupt = false;
          const proc = processManager.getProcess(currentProcessId);
          if (proc?.streamContent) {
            accumulatedStream += (accumulatedStream ? '\n\n<!-- chunk-boundary -->\n\n' : '') + proc.streamContent;
          }
          const sessionId = proc?.sessionId;

          const feedbackPrompt = this.liveFeedback.map((fb, i) => `${i + 1}. ${fb}`).join('\n');
          this.liveFeedback = [];
          const feedbackTimestamp = new Date().toISOString();
          accumulatedStream += `\n\n<!-- chunk-boundary -->\n\n<!-- human-feedback: ${feedbackTimestamp} -->\n${feedbackPrompt}`;
          if (this.currentRunId) {
            saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
          }
          // If we have a session, resume it; otherwise start fresh with feedback prepended
          currentSessionId = sessionId || undefined;
          currentPrompt = isFeedbackOnly
            ? `## 人工实时反馈\n用户在你执行过程中提供了补充反馈，请参考以下内容继续完成任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`
            : `## 人工实时反馈（紧急打断）\n用户紧急打断了当前执行，请立即处理以下反馈：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
          if (!sessionId) {
            // No session yet — prepend original context so the agent has full info
            currentPrompt = context + '\n\n' + currentPrompt;
          }
          currentProcessId = stepId || currentProcessId;
          this.currentProcesses = [{
            pid: Date.now(),
            id: currentProcessId,
            agent: step.agent,
            step: streamStepName,
            stepId,
            startTime: new Date().toISOString(),
          }];
          this.emit('step-start', {
            state: this.currentState,
            step: streamStepName,
            agent: step.agent,
          });
          this.emit('feedback-injected', {
            message: feedbackPrompt,
            timestamp: feedbackTimestamp,
          });
          continue;
        }
        throw err;
      }

      // Accumulate stream content
      const proc = processManager.getProcess(currentProcessId);
      if (proc?.streamContent) {
        accumulatedStream += (accumulatedStream ? '\n\n<!-- chunk-boundary -->\n\n' : '') + proc.streamContent;
      }
      if (this.currentRunId) {
        saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
      }

      accumulatedOutput += (accumulatedOutput ? '\n\n---\n\n' : '') + (result.result || '');
      accumulatedCost += result.cost_usd || 0;
      accumulatedDuration += result.duration_ms || 0;

      // Check for pending live feedback after completion
      if (this.liveFeedback.length > 0 && !this.shouldStop) {
        const feedbackPrompt = this.liveFeedback.map((fb, i) => `${i + 1}. ${fb}`).join('\n');
        this.liveFeedback = [];
        const sessionId = result.session_id;
        if (!sessionId) break;

        const feedbackTimestamp = new Date().toISOString();
        accumulatedStream += `\n\n<!-- chunk-boundary -->\n\n<!-- human-feedback: ${feedbackTimestamp} -->\n${feedbackPrompt}`;
        if (this.currentRunId) {
          saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
        }
        currentSessionId = sessionId;
        currentPrompt = `## 人工实时反馈\n以下是用户在你执行过程中提供的反馈意见，请基于这些反馈继续处理当前任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
        currentProcessId = stepId || currentProcessId;
        this.currentProcesses = [{
          pid: Date.now(),
          id: currentProcessId,
          agent: step.agent,
          step: streamStepName,
          stepId,
          startTime: new Date().toISOString(),
        }];
        this.emit('feedback-injected', {
          message: feedbackPrompt,
          timestamp: feedbackTimestamp,
        });
        continue;
      }

      break;
    }
    } finally {
      processManager.off('stream', streamFlushHandler);
    }
    return { output: accumulatedOutput, costUsd: accumulatedCost, durationMs: accumulatedDuration };
  }

  private async evaluateTransitions(
    transitions: StateTransition[],
    result: StateExecutionResult,
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    // Check for pending forced transition (human override)
    if (this.pendingForceTransition) {
      const target = this.pendingForceTransition;
      this.pendingForceTransition = null;
      this.emit('transition-forced', { from: result.stateName, to: target });
      return target;
    }

    // Check if judge suggested a next_state in JSON output
    const aiSuggestedState = this.parseNextStateFromOutputs(result.stepOutputs, config);
    if (aiSuggestedState) {
      return aiSuggestedState;
    }

    // Sort by priority (lower number = higher priority)
    const sorted = [...transitions].sort((a, b) => a.priority - b.priority);

    for (const transition of sorted) {
      if (this.matchCondition(transition.condition, result)) {
        return transition.to;
      }
    }

    // conditional_pass without explicit rule → self-transition (continue iterating)
    if (result.verdict === 'conditional_pass') {
      this.emit('escalation', {
        state: result.stateName,
        reason: `有条件通过 (conditional_pass)，继续迭代当前状态`,
        result,
      });
      return result.stateName;
    }

    // No matching transition - wait for human decision instead of crashing
    this.emit('escalation', {
      state: result.stateName,
      reason: `没有匹配的状态转移规则 (verdict: ${result.verdict})，等待人工决策`,
      result,
    });

    // Enter human approval mode so user can force-transition
    this.pendingApprovalInfo = {
      suggestedNextState: transitions[0]?.to || result.stateName,
      availableStates: config.workflow.states.map(s => s.name),
      result,
    };

    this.emit('human-approval-required', {
      currentState: result.stateName,
      suggestedNextState: transitions[0]?.to || result.stateName,
      result,
      availableStates: config.workflow.states.map(s => s.name),
      reason: `verdict "${result.verdict}" 没有匹配的转移规则`,
    });

    // Wait for human to force-transition
    await this.waitForHumanApproval();

    const humanSelectedState = this.pendingForceTransition || transitions[0]?.to || result.stateName;
    this.pendingForceTransition = null;
    this.pendingApprovalInfo = null;
    return humanSelectedState;
  }

  private matchCondition(
    condition: TransitionCondition,
    result: StateExecutionResult
  ): boolean {
    // Check verdict match (strict — no fallback for conditional_pass)
    if (condition.verdict && result.verdict !== condition.verdict) {
      return false;
    }

    // Check issue types
    if (condition.issueTypes && condition.issueTypes.length > 0) {
      const hasMatchingType = result.issues.some(
        issue => condition.issueTypes!.includes(issue.type)
      );
      if (!hasMatchingType) return false;
    }

    // Check severities
    if (condition.severities && condition.severities.length > 0) {
      const hasMatchingSeverity = result.issues.some(
        issue => condition.severities!.includes(issue.severity)
      );
      if (!hasMatchingSeverity) return false;
    }

    // Check issue count
    if (condition.minIssueCount !== undefined) {
      if (result.issues.length < condition.minIssueCount) return false;
    }
    if (condition.maxIssueCount !== undefined) {
      if (result.issues.length > condition.maxIssueCount) return false;
    }

    return true;
  }

  private parseNextStateFromOutputs(
    stepOutputs: string[],
    config: StateMachineWorkflowConfig
  ): string | null {
    const validStates = new Set(config.workflow.states.map(s => s.name));
    // Check outputs in reverse order (last judge output takes precedence)
    for (const output of [...stepOutputs].reverse()) {
      const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.next_state && validStates.has(parsed.next_state)) {
            return parsed.next_state;
          }
        } catch { /* ignore */ }
      }
    }
    return null;
  }

  private parseIssuesFromOutput(
    output: string,
    step: WorkflowStep,
    stateName: string
  ): Issue[] {
    const issues: Issue[] = [];

    // Try to parse JSON block
    const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.issues && Array.isArray(parsed.issues)) {
          for (const issue of parsed.issues) {
            // Skip issues without a meaningful description
            if (!issue.description?.trim()) continue;
            issues.push({
              type: issue.type || 'implementation',
              severity: issue.severity || 'minor',
              description: issue.description.trim(),
              foundInState: stateName,
              foundByAgent: step.agent,
            });
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return issues;
  }

  private parseVerdict(output: string): 'pass' | 'conditional_pass' | 'fail' {
    const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (['pass', 'conditional_pass', 'fail'].includes(parsed.verdict)) {
          return parsed.verdict;
        }
      } catch { /* ignore */ }
    }

    // Fallback: check for keywords
    if (/\b(pass|通过|成功)\b/i.test(output)) return 'pass';
    if (/\b(fail|失败|不通过)\b/i.test(output)) return 'fail';
    return 'conditional_pass';
  }

  private getTransitionReason(result: StateExecutionResult): string {
    if (result.verdict === 'pass') {
      return '所有检查通过';
    } else if (result.issues.length > 0) {
      const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
      const majorCount = result.issues.filter(i => i.severity === 'major').length;
      return `发现 ${criticalCount} 个严重问题, ${majorCount} 个主要问题`;
    }
    return '条件性通过';
  }

  private generateStateSummary(state: StateMachineState, issues: Issue[]): string {
    const parts: string[] = [];
    parts.push(`状态 ${state.name} 执行完成`);
    parts.push(`执行了 ${state.steps.length} 个步骤`);
    if (issues.length > 0) {
      parts.push(`发现 ${issues.length} 个问题`);
    }
    return parts.join(', ');
  }

  // ========== Resume functionality ==========
  async recoverFromCrash(): Promise<void> {
    // Find any crashed runs and attempt to recover
    const runningRuns = await loadRunState(this.currentRunId || '').catch(() => null);
    if (!runningRuns) return;

    if (runningRuns.status === 'running' && runningRuns.mode === 'state-machine') {
      console.log(`[StateMachineWorkflowManager] Detected crashed run: ${runningRuns.runId}`);
      try {
        await this.resume(runningRuns.runId);
      } catch (error) {
        console.error('[StateMachineWorkflowManager] Failed to recover from crash:', error);
      }
    }
  }

  async resume(runId: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }

    if (runState.mode !== 'state-machine') {
      throw new Error('该运行记录不是状态机工作流');
    }

    // Restore state
    this.currentRunId = runId;
    this.currentConfigFile = runState.configFile;
    this.currentRequirements = runState.requirements || '';
    this.currentState = runState.currentState || null;
    this.stateHistory = runState.stateHistory || [];
    this.issueTracker = (runState.issueTracker || []) as Issue[];
    this.transitionCount = runState.transitionCount || 0;
    this.completedSteps = runState.completedSteps || [];
    this.stepLogs = runState.stepLogs || [];
    this.runStartTime = runState.startTime || null;
    this.globalContext = runState.globalContext || '';
    this.stateContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.status = 'running';
    this.shouldStop = false;

    this.emit('status', {
      status: 'running',
      message: '恢复运行中...',
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configPath = resolve(process.cwd(), 'configs', runState.configFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    this.lightweightRouterModel = workflowConfig.context?.routerModel?.trim() || 'claude-sonnet-4-6';

    // Load agent configs and initialize agents
    await this.loadAgentConfigs();
    this.initializeAgents(workflowConfig);

    // Initialize engine
    await this.initializeEngine();

    // If resuming from __human_approval__, restore the approval wait flow
    if (this.currentState === '__human_approval__') {
      console.log('[StateMachine] Resuming from __human_approval__');
      const availableStates = workflowConfig.workflow.states.map(s => s.name);
      // Infer suggested next state from the last transition's "to" before __human_approval__
      const lastTransition = this.stateHistory.filter(h => h.to === '__human_approval__').pop();
      const previousState = lastTransition?.from;
      // Find the state config that triggered approval, use its first transition target as suggestion
      const prevStateConfig = previousState
        ? workflowConfig.workflow.states.find(s => s.name === previousState)
        : null;
      const suggestedNextState = prevStateConfig?.transitions?.[0]?.to || availableStates[0] || '';

      this.pendingApprovalInfo = {
        suggestedNextState,
        availableStates,
        result: { issues: [] },
      };

      this.emit('state-change', {
        state: '__human_approval__',
        message: '等待人工审查决策',
      });

      this.emit('human-approval-required', {
        currentState: '__human_approval__',
        suggestedNextState,
        result: { issues: [] },
        availableStates,
      });

      // Wait for human decision
      await this.waitForHumanApproval();

      const humanSelectedState: string = this.pendingForceTransition || suggestedNextState;
      this.pendingForceTransition = null;
      this.pendingApprovalInfo = null;

      // Record transition from __human_approval__ to selected state
      this.stateHistory.push({
        from: '__human_approval__',
        to: humanSelectedState,
        reason: `人工决策: 选择进入 ${humanSelectedState}`,
        issues: [],
        timestamp: new Date().toISOString(),
      });

      this.transitionCount++;
      this.emit('transition', {
        from: '__human_approval__',
        to: humanSelectedState,
        transitionCount: this.transitionCount,
        issues: [],
      });

      this.currentState = humanSelectedState;
    }

    // Continue execution from current state
    try {
      await this.executeStateMachine(workflowConfig, runState.requirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.emit('status', {
          status: 'failed',
          message: error.message,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  // ========== Live feedback functionality ==========
  private liveFeedback: string[] = [];
  private interruptFlag = false;
  private feedbackInterrupt = false; // true = non-urgent feedback interrupt (softer prompt tone)
  private queuedApprovalAction: 'approve' | 'iterate' | null = null;
  private iterationFeedback: string = '';
  /** 最近一次预执行命令（preCommands）的输出，会注入到对应步骤上下文中 */
  private lastPreCommandOutput: string | null = null;

  setQueuedApprovalAction(action: 'approve' | 'iterate'): void {
    this.queuedApprovalAction = action;
  }

  setIterationFeedback(feedback: string): void {
    this.iterationFeedback = feedback;
  }

  approve(): void {
    this.queuedApprovalAction = 'approve';
    this.emit('approve');
  }

  requestIteration(feedback: string): void {
    this.iterationFeedback = feedback;
    this.queuedApprovalAction = 'iterate';
    this.emit('iterate');
  }

  getInternalStatus(): string {
    return this.status;
  }

  injectLiveFeedback(message: string): void {
    const entry = { message, timestamp: new Date().toISOString() };
    this.liveFeedback.push(message);
    this.emit('feedback-injected', entry);

    // Interrupt the running process so feedback is delivered immediately via resume
    if (this.status === 'running' && this.currentState) {
      this.interruptFlag = true;
      this.feedbackInterrupt = true; // non-urgent flag, different prompt tone

      const currentProcId = this.currentProcesses?.[0]?.id;
      const currentStepId = this.currentProcesses?.[0]?.stepId;
      const allProcs = processManager.getAllProcesses();
      const running = allProcs.find(
        (p: any) => (p.status === 'running' || p.status === 'queued') && (
          (currentStepId && p.stepId === currentStepId) ||
          (currentProcId && p.id === currentProcId)
        )
      );
      if (running) {
        processManager.killProcess(running.id);
      }
    }
  }

  recallLiveFeedback(message: string): boolean {
    const idx = this.liveFeedback.indexOf(message);
    if (idx === -1) return false;
    this.liveFeedback.splice(idx, 1);
    this.emit('feedback-recalled', { message, timestamp: new Date().toISOString() });
    return true;
  }

  interruptWithFeedback(message: string): boolean {
    if (this.status !== 'running' || !this.currentState) {
      console.log(`[SM-Feedback] interruptWithFeedback 失败: status=${this.status}, currentState=${this.currentState}`);
      return false;
    }

    // Queue the feedback
    this.liveFeedback.push(message);
    this.interruptFlag = true;

    // Find and kill the running process by stepId (most reliable), then fall back to processId
    const currentProcId = this.currentProcesses?.[0]?.id;
    const currentStepId = this.currentProcesses?.[0]?.stepId;
    const allProcs = processManager.getAllProcesses();
    console.log(`[SM-Feedback] 查找进程: procId=${currentProcId}, stepId=${currentStepId}, allProcs=${allProcs.length}, running=${allProcs.filter((p: any) => p.status === 'running').length}`);
    const running = allProcs.find(
      (p: any) => (p.status === 'running' || p.status === 'queued') && (
        (currentStepId && p.stepId === currentStepId) ||
        (currentProcId && p.id === currentProcId)
      )
    );

    if (running) {
      console.log(`[SM-Feedback] 找到进程 ${running.id} (status=${running.status}), 正在 kill...`);
      const killed = processManager.killProcess(running.id);
      console.log(`[SM-Feedback] kill 结果: ${killed}`);
      this.emit('feedback-injected', { message, timestamp: new Date().toISOString() });
      return true;
    }

    console.log(`[SM-Feedback] 未找到匹配的运行中进程`);
    return false;
  }

  // ========== Force complete functionality ==========
  async forceCompleteStep(): Promise<{ step: string; output: string } | null> {
    if (this.status !== 'running' || !this.currentState) {
      return null;
    }

    // Find the running process by stepId (most reliable), then fall back to processId
    const currentProcId = this.currentProcesses?.[0]?.id;
    const currentStepId = this.currentProcesses?.[0]?.stepId;
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => (p.status === 'running' || p.status === 'queued') && (
        (currentStepId && p.stepId === currentStepId) ||
        (currentProcId && p.id === currentProcId)
      )
    );

    if (!running) return null;

    // Kill the process
    processManager.killProcess(running.id);

    // Get accumulated output
    const output = running.streamContent || '';

    this.emit('step-force-completed', {
      step: this.currentState,
      output,
      timestamp: new Date().toISOString(),
    });

    return {
      step: this.currentState,
      output,
    };
  }

  // ========== Rerun from step functionality ==========
  async rerunFromStep(runId: string, stateName: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }

    if (runState.mode !== 'state-machine') {
      throw new Error('该运行记录不是状态机工作流');
    }

    // Find the state in history
    const stateIndex = this.stateHistory.findIndex(h => h.to === stateName);
    if (stateIndex === -1) {
      throw new Error(`找不到状态: ${stateName}`);
    }

    // Restore state up to that point
    this.currentRunId = runId;
    this.currentConfigFile = runState.configFile;
    this.currentRequirements = runState.requirements || '';
    this.currentState = stateName;
    this.stateHistory = runState.stateHistory?.slice(0, stateIndex + 1) || [];
    this.issueTracker = (runState.issueTracker || []) as Issue[];
    this.transitionCount = stateIndex + 1;
    this.completedSteps = runState.completedSteps || [];
    this.stepLogs = runState.stepLogs || [];
    this.runStartTime = runState.startTime || null;
    this.globalContext = runState.globalContext || '';
    this.stateContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.status = 'running';
    this.shouldStop = false;

    this.emit('status', {
      status: 'running',
      message: `从状态 ${stateName} 重新运行...`,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configPath = resolve(process.cwd(), 'configs', runState.configFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    this.lightweightRouterModel = workflowConfig.context?.routerModel?.trim() || 'claude-sonnet-4-6';

    // Load agent configs and initialize agents
    await this.loadAgentConfigs();
    this.initializeAgents(workflowConfig);

    // Continue execution from this state
    try {
      await this.executeStateMachine(workflowConfig, runState.requirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.emit('status', {
          status: 'failed',
          message: error.message,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  // ========== Supervisor-Lite Plan 循环实现 ==========

  private async executeStepWithInfoGathering(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string
  ): Promise<string> {
    const maxRounds = step.maxPlanRounds || 3;
    let round = 0;
    let extraContext = '';

    while (round < maxRounds) {
      const output = await this.executeStep(step, state, config, requirements, extraContext);

      console.log(`[StateMachineWorkflowManager] Step ${step.name} 原始输出:`, output.slice(0, 500));
      const infoRequests = parseNeedInfo(step,output);
      console.log(`[StateMachineWorkflowManager] Step ${step.name} 解析到 ${infoRequests.length} 个信息请求:`, infoRequests);
      
      if (infoRequests.length === 0) {
        console.log(`[StateMachineWorkflowManager] Step ${step.name} 没有信息请求，结束`);
        return output;
      }

      if (isPlanDone(output)) {
        console.log(`[StateMachineWorkflowManager] Step ${step.name} 已 PLAN_DONE，继续执行任务`);
        return output;
      }

      for (const req of infoRequests) {
        if (req.isHuman) {
          this.emit('plan-question', { question: req.question, fromAgent: step.agent, round });
          this.supervisorFlow.push({
            type: 'question',
            from: step.agent,
            to: 'user',
            question: req.question,
            round,
            timestamp: new Date().toISOString(),
            stateName: state.name,
          });
          // 添加两条线：请求线（蓝色）+ 路由线（橙色）
          // Agent -> Supervisor（请求）
          this.agentFlow.push({
            id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'request',
            fromAgent: step.agent,
            toAgent: 'supervisor',
            message: req.question,
            stateName: state.name,
            stepName: step.name,
            round,
            timestamp: new Date().toISOString(),
          });
          // Supervisor -> 用户（路由）
          this.agentFlow.push({
            id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'supervisor',
            fromAgent: 'supervisor',
            toAgent: 'user',
            message: req.question,
            stateName: state.name,
            stepName: step.name,
            round,
            timestamp: new Date().toISOString(),
          });
          this.emit('agent-flow', { agentFlow: this.agentFlow });
          const answer = await this.waitForUserAnswer(req.question, step.agent, round);
          extraContext += `\n\n[用户回答] ${req.question}\n${answer}`;
          console.log(`[StateMachineWorkflowManager] 用户回答: ${answer}`);
        } else {
          const agentSummaries = this.buildAgentSummaries();
          const decision = await routeInfoRequest(
            req,
            agentSummaries,
            step.name,
            this.callLightweightLLM.bind(this)
          );

          if (!decision) {
            console.log(`[StateMachineWorkflowManager] 无法路由，fallback 到用户回答`);
            this.emit('plan-question', { question: req.question, fromAgent: step.agent, round });
            this.supervisorFlow.push({
              type: 'question',
              from: step.agent,
              to: 'user',
              question: req.question,
              round,
              timestamp: new Date().toISOString(),
              stateName: state.name,
            });
            // 添加两条线：请求线（蓝色）+ 路由线（橙色）
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'request',
              fromAgent: step.agent,
              toAgent: 'supervisor',
              message: req.question,
              stateName: state.name,
              stepName: step.name,
              round,
              timestamp: new Date().toISOString(),
            });
            // Supervisor -> 用户（路由）
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'supervisor',
              fromAgent: 'supervisor',
              toAgent: 'user',
              message: req.question,
              stateName: state.name,
              stepName: step.name,
              round,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
            const answer = await this.waitForUserAnswer(req.question, step.agent, round);
            console.log(`[StateMachineWorkflowManager] 用户回答: ${answer}`);
            extraContext += `\n\n[用户回答] ${req.question}\n${answer}`;
          } else {
            this.emit('route-decision', { ...decision, round, fromAgent: step.agent });
            this.supervisorFlow.push({
              type: 'decision',
              from: step.agent,
              to: decision.route_to,
              question: decision.question,
              method: decision.method,
              round,
              timestamp: new Date().toISOString(),
              stateName: state.name,
            });
            
            // 添加两条线：请求线（蓝色）+ 路由线（橙色）
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'request',
              fromAgent: step.agent,
              toAgent: 'supervisor',
              message: `Supervisor路由: ${decision.question}`,
              stateName: state.name,
              stepName: step.name,
              round,
              timestamp: new Date().toISOString(),
            });
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'supervisor',
              fromAgent: 'supervisor',
              toAgent: decision.route_to,
              message: `Supervisor路由: ${decision.question}`,
              stateName: state.name,
              stepName: step.name,
              round,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
            
            const answer = await this.queryAgent(decision.route_to, decision.question, config);
            console.log(`[StateMachineWorkflowManager] ${decision.route_to} 回答: ${answer}`);
            extraContext += `\n\n[${decision.route_to} 回答] ${decision.question}\n${answer}`;
            
            this.addAgentResponseFlow(decision.route_to, step.agent, answer, state.name, step.name, round);
          }
        }
      }

      this.emit('plan-round', { step: step.name, round: round + 1, maxRounds, infoRequests });
      round++;
    }

    extraContext += '\n\n[系统] 信息收集完成，请基于现有信息执行任务。';
    return this.executeStep(step, state, config, requirements, extraContext);
  }

  private buildAgentSummaries(): AgentSummary[] {
    return this.agentConfigs
      .filter(c => c.name)
      .map(c => ({
        name: c.name,
        description: c.description || '',
        keywords: c.keywords || [],
      }));
  }

  private async queryAgent(
    agentName: string,
    question: string,
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    const roleConfig = this.agentConfigs.find(r => r.name === agentName)
      || config.roles?.find(r => r.name === agentName);

    if (!roleConfig) {
      return `[错误] 找不到 Agent 配置: ${agentName}`;
    }

    const prompt = `# 问题\n${question}\n\n请直接回答这个问题，不需要执行其他任务。`;
    const model = roleConfig.model || 'claude-opus-4-6';
    const systemPrompt = roleConfig.systemPrompt || `你是一个 AI 助手。`;

    const processId = `query-${agentName}-${Date.now()}`;

    try {
      const result = await this.executeWithEngine(
        processId,
        agentName,
        'query',
        prompt,
        systemPrompt,
        model,
        {
          workingDirectory: config.context?.projectRoot
            ? resolve(process.cwd(), config.context.projectRoot)
            : process.cwd(),
          timeoutMs: 60000,
        }
      );
      const answer = result.result || '[无输出]';
      
      this.agentFlow.push({
        id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'response',
        fromAgent: agentName,
        toAgent: 'supervisor',
        message: answer,
        stateName: this.currentState || '',
        stepName: '',
        round: 0,
        timestamp: new Date().toISOString(),
      });
      this.emit('agent-flow', { agentFlow: this.agentFlow });
      
      return answer;
    } catch (error) {
      return `[错误] 查询 Agent 失败: ${error}`;
    }
  }

  private addAgentResponseFlow(fromAgent: string, toAgent: string, message: string, stateName: string, stepName: string, round: number): void {
    // 记录响应
    this.agentFlow.push({
      id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'response',
      fromAgent,
      toAgent,
      message,
      stateName,
      stepName,
      round,
      timestamp: new Date().toISOString(),
    });

    this.emit('agent-flow', { agentFlow: this.agentFlow });
  }

  private async callLightweightLLM(prompt: string): Promise<string> {
    const processId = `router-llm-${Date.now()}`;

    try {
      const result = await this.executeWithEngine(
        processId,
        'router',
        'route',
        prompt,
        '你是一个路由器，根据问题选择最合适的 Agent。',
        this.lightweightRouterModel,
        {
          workingDirectory: process.cwd(),
          timeoutMs: 120000, // 增加超时时间到 2 分钟
        }
      );
      return result.result || '';
    } catch (error) {
      console.error('[SupervisorRouter] LLM 调用失败:', error);
      return '';
    }
  }

  private async waitForUserAnswer(question: string, fromAgent: string, round: number): Promise<string> {
    this.pendingUserQuestion = { question, fromAgent, round };

    return new Promise((resolve) => {
      this.pendingUserQuestionResolver = resolve;

      const checkInterval = setInterval(() => {
        if (!this.pendingUserQuestionResolver) {
          clearInterval(checkInterval);
        }
      }, 500);

      setTimeout(() => {
        if (this.pendingUserQuestionResolver) {
          this.pendingUserQuestionResolver('[超时] 用户未回答');
          this.pendingUserQuestionResolver = null;
          this.pendingUserQuestion = null;
          clearInterval(checkInterval);
        }
      }, 300000);
    });
  }

  submitUserAnswer(answer: string): void {
    if (this.pendingUserQuestionResolver) {
      this.pendingUserQuestionResolver(answer);
      this.pendingUserQuestionResolver = null;
      this.pendingUserQuestion = null;
    }
  }

  getPendingUserQuestion(): { question: string; fromAgent: string; round: number } | null {
    return this.pendingUserQuestion;
  }
}

export const stateMachineWorkflowManager = new StateMachineWorkflowManager();
