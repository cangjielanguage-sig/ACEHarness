/**
 * 状态机工作流管理器
 * 支持跨阶段回退的动态流程控制
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFile, readdir, stat } from 'fs/promises';
import { resolve } from 'path';
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
  private currentStep: string | null = null;
  private completedSteps: string[] = [];
  private currentProcesses: PersistedProcessInfo[] = [];
  private stepLogs: PersistedStepLog[] = [];
  /** Current engine instance (Kiro CLI, etc.) */
  private currentEngine: Engine | null = null;
  /** Current engine type */
  private engineType: EngineType = 'claude-code';

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
    // Return cached result if same project root
    if (this.workspaceSkillsCache && this.workspaceSkillsCacheProjectRoot === projectRoot) {
      return this.workspaceSkillsCache;
    }

    const absRoot = resolve(process.cwd(), projectRoot);
    const skillsDir = resolve(absRoot, '.claude', 'skills');

    try {
      const skillIndex = resolve(skillsDir, 'SKILL.md');
      const indexContent = await readFile(skillIndex, 'utf-8');

      // Only include the index summary, not detailed sub-skill contents
      const result = indexContent.trim();

      // Cache the result
      this.workspaceSkillsCache = result;
      this.workspaceSkillsCacheProjectRoot = projectRoot;

      return result;
    } catch {
      // No skills directory or index — that's fine
      this.workspaceSkillsCache = '';
      this.workspaceSkillsCacheProjectRoot = projectRoot;
      return '';
    }
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
      this.stepLogs = [];
      this.runStartTime = new Date().toISOString();
      this.currentConfigFile = configFile;
      this.currentRequirements = requirements || '';

      // Load config
      const configPath = resolve(process.cwd(), 'configs', configFile);
      const configContent = await readFile(configPath, 'utf-8');
      const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;

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

      await this.executeStateMachine(workflowConfig, requirements);

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

  forceTransition(targetState: string): void {
    if (this.status !== 'running') {
      throw new Error('工作流未在运行中');
    }
    console.log('[StateMachine] forceTransition called, targetState:', targetState, 'currentState:', this.currentState);
    this.pendingForceTransition = targetState;
    this.emit('force-transition', { targetState, from: this.currentState });
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

    try {
      const completedSteps = this.agents.reduce((sum, a) => sum + a.completedTasks, 0);
      await updateRun(this.currentRunId, {
        endTime: this.runEndTime,
        status,
        currentPhase: this.currentState,
        completedSteps,
      });

      await this.persistState(status);
    } catch { /* non-critical */ }

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
        // Persist human approval checkpoint if waiting
        ...(this.currentState === '__human_approval__' && this.pendingApprovalInfo ? {
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
    } catch { /* non-critical */ }
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

      const output = await this.executeStep(step, state, config, requirements);
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
    requirements?: string
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
    await this.persistState();

    this.emit('step-start', {
      id: stepId,
      state: state.name,
      step: step.name,
      agent: step.agent,
    });

    try {
      // Build context (now async)
      const context = await this.buildStepContext(step, state, config, requirements);

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
    requirements?: string
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

    // Add workspace skills (index summary only)
    if (config.context?.projectRoot) {
      const skills = await this.loadWorkspaceSkills(config.context.projectRoot);
      if (skills) {
        parts.push(`\n# 可用 Skills（来自项目 .claude/skills/）\n\n${skills}`);
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
    }

    // Add recent issues
    if (this.issueTracker.length > 0) {
      parts.push(`\n# 已发现的问题`);
      const recent = this.issueTracker.slice(-10);
      for (const issue of recent) {
        parts.push(`- [${issue.severity}] ${issue.type}: ${issue.description}`);
      }
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

    return parts.join('\n');
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

    let currentProcessId = `sm-${step.agent}-${Date.now()}`;
    let currentPrompt = context;
    let currentSessionId: string | undefined;
    let accumulatedOutput = '';
    let accumulatedStream = '';
    let accumulatedCost = 0;
    let accumulatedDuration = 0;

    // Track process
    this.currentProcesses = [{
      pid: Date.now(),
      id: currentProcessId,
      agent: step.agent,
      step: step.name,
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
          const streamStepName = this.currentState ? `${this.currentState}-${step.name}` : step.name;
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
        // If interrupted with feedback, resume with feedback
        if (this.interruptFlag && this.liveFeedback.length > 0) {
          this.interruptFlag = false;
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
            const streamStepName2 = this.currentState ? `${this.currentState}-${step.name}` : step.name;
            saveStreamContent(this.currentRunId, streamStepName2, accumulatedStream).catch(() => {});
          }
          // If we have a session, resume it; otherwise start fresh with feedback prepended
          currentSessionId = sessionId || undefined;
          currentPrompt = `## 人工实时反馈（紧急打断）\n用户紧急打断了当前执行，请立即处理以下反馈：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
          if (!sessionId) {
            // No session yet — prepend original context so the agent has full info
            currentPrompt = context + '\n\n' + currentPrompt;
          }
          currentProcessId = `sm-${step.agent}-interrupt-${Date.now()}`;
          this.currentProcesses = [{
            pid: Date.now(),
            id: currentProcessId,
            agent: step.agent,
            step: step.name,
            stepId,
            startTime: new Date().toISOString(),
          }];
          this.emit('step-start', {
            state: this.currentState,
            step: step.name,
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
        const streamStepName3 = this.currentState ? `${this.currentState}-${step.name}` : step.name;
        saveStreamContent(this.currentRunId, streamStepName3, accumulatedStream).catch(() => {});
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
          const streamStepName4 = this.currentState ? `${this.currentState}-${step.name}` : step.name;
          saveStreamContent(this.currentRunId, streamStepName4, accumulatedStream).catch(() => {});
        }
        currentSessionId = sessionId;
        currentPrompt = `## 人工实时反馈\n以下是用户在你执行过程中提供的反馈意见，请基于这些反馈继续处理当前任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
        currentProcessId = `sm-${step.agent}-feedback-${Date.now()}`;
        this.currentProcesses = [{
          pid: Date.now(),
          id: currentProcessId,
          agent: step.agent,
          step: step.name,
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

    // No matching transition - escalate to human
    this.emit('escalation', {
      state: result.stateName,
      reason: '没有匹配的状态转移规则',
      result,
    });

    throw new Error('没有匹配的状态转移规则，需要人工介入');
  }

  private matchCondition(
    condition: TransitionCondition,
    result: StateExecutionResult
  ): boolean {
    // Check verdict
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
    await this.executeStateMachine(workflowConfig, runState.requirements);
  }

  // ========== Live feedback functionality ==========
  private liveFeedback: string[] = [];
  private interruptFlag = false;
  private queuedApprovalAction: 'approve' | 'iterate' | null = null;
  private iterationFeedback: string = '';

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
  }

  recallLiveFeedback(message: string): boolean {
    const idx = this.liveFeedback.indexOf(message);
    if (idx === -1) return false;
    this.liveFeedback.splice(idx, 1);
    this.emit('feedback-recalled', { message, timestamp: new Date().toISOString() });
    return true;
  }

  interruptWithFeedback(message: string): boolean {
    if (this.status !== 'running' || !this.currentState) return false;

    // Queue the feedback
    this.liveFeedback.push(message);
    this.interruptFlag = true;

    // Find and kill the running process by stepId (most reliable), then fall back to processId
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
      this.emit('feedback-injected', { message, timestamp: new Date().toISOString() });
      return true;
    }

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

    // Load agent configs and initialize agents
    await this.loadAgentConfigs();
    this.initializeAgents(workflowConfig);

    // Continue execution from this state
    await this.executeStateMachine(workflowConfig, runState.requirements);
  }
}

export const stateMachineWorkflowManager = new StateMachineWorkflowManager();
