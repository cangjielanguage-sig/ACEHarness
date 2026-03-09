/**
 * 状态机工作流管理器
 * 支持跨阶段回退的动态流程控制
 */

import { EventEmitter } from 'events';
import { readFile, readdir, stat } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { processManager } from './process-manager';
import type { ClaudeJsonResult } from './process-manager';
import { createRun, updateRun } from './run-store';
import {
  saveRunState, saveProcessOutput, saveOutputToWorkspace, saveStreamContent,
  loadRunState, type PersistedRunState,
} from './run-state-persistence';
import type {
  StateMachineWorkflowConfig, StateMachineState, StateTransition,
  Issue, WorkflowStep, RoleConfig, TransitionCondition,
} from './schemas';
import { formatTimestamp } from './utils';
import { getConfiguredEngine, type EngineType } from './engines';

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
  private globalContext: string = '';
  private stateContexts: Map<string, string> = new Map();
  private workspaceSkillsCache: string = '';
  private workspaceSkillsCacheProjectRoot: string = '';

  constructor() {
    super();
  }

  async loadAgentConfigs(): Promise<void> {
    const agentsDir = resolve(process.cwd(), 'configs/agents');
    const files = await readFile(agentsDir).catch(() => []);
    // Load agent configs (simplified, reuse existing logic)
    this.agentConfigs = [];
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

      // Also read each sub-skill's SKILL.md for detailed instructions
      const entries = await readdir(skillsDir);
      const details: string[] = [];

      for (const entry of entries) {
        const entryPath = resolve(skillsDir, entry);
        const entryStat = await stat(entryPath).catch(() => null);
        if (!entryStat?.isDirectory()) continue;

        const subSkillMd = resolve(entryPath, 'SKILL.md');
        try {
          const content = await readFile(subSkillMd, 'utf-8');
          details.push(content);
        } catch { /* no SKILL.md in this dir */ }
      }

      let result = indexContent + '\n\n';
      if (details.length > 0) {
        result += `### 详细使用说明\n\n`;
        result += details.join('\n\n---\n\n') + '\n\n';
      }

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
      agents: this.agents,
      stateHistory: this.stateHistory,
      issueTracker: this.issueTracker,
      transitionCount: this.transitionCount,
      globalContext: this.globalContext,
      phaseContexts: Object.fromEntries(this.stateContexts),
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

      // Initialize agents
      this.initializeAgents(workflowConfig);

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
        this.currentState = existingState.currentState || existingState.currentPhase;
        this.runStartTime = existingState.startTime;
      }

      this.emit('status', { status: 'running', message: '状态机工作流已启动', runId });

      // Persist initial state
      await this.persistState();

      await this.executeStateMachine(workflowConfig, requirements);

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

  async stop(): Promise<void> {
    this.shouldStop = true;
    this.status = 'stopped';
    this.emit('status', { status: 'stopped', message: '工作流已停止' });
    await this.finalizeRun('stopped');
  }

  forceTransition(targetState: string): void {
    if (this.status !== 'running') {
      throw new Error('工作流未在运行中');
    }
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
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.pendingForceTransition || this.shouldStop) {
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
        status: finalStatus || (this.status === 'idle' ? 'running' : this.status) as any,
        statusReason: this.statusReason || undefined,
        startTime: this.runStartTime || new Date().toISOString(),
        endTime: finalStatus ? this.runEndTime : null,
        currentPhase: this.currentState,
        currentStep: null,
        completedSteps: [],
        failedSteps: [],
        stepLogs: [],
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
        processes: [],
        mode: 'state-machine',
        currentState: this.currentState,
        transitionCount: this.transitionCount,
        maxTransitions: 50,
        stateHistory: this.stateHistory,
        issueTracker: this.issueTracker,
        requirements: this.currentRequirements,
        globalContext: this.globalContext,
        phaseContexts: Object.fromEntries(this.stateContexts),
      });
    } catch { /* non-critical */ }
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

    for (const step of state.steps) {
      if (this.shouldStop) break;
      // Allow forced transition to interrupt mid-state
      if (this.pendingForceTransition) break;

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

    agent.status = 'running';
    agent.currentTask = step.name;
    this.emit('agents', { agents: this.agents });

    this.emit('step-start', {
      state: state.name,
      step: step.name,
      agent: step.agent,
    });

    try {
      // Build context (now async)
      const context = await this.buildStepContext(step, state, config, requirements);

      // Execute step (reuse existing process manager logic)
      const output = await this.runAgentStep(step, context, config);

      agent.status = 'completed';
      agent.completedTasks++;
      agent.lastOutput = output;
      this.emit('agents', { agents: this.agents });

      this.emit('step-complete', {
        state: state.name,
        step: step.name,
        agent: step.agent,
        output,
      });

      // Save output to file system
      if (this.currentRunId) {
        const stepFileName = `${state.name}-${step.name}`;
        await saveProcessOutput(this.currentRunId, stepFileName, output).catch(() => {});

        // Also save to workspace if projectRoot is configured
        if (config.context?.projectRoot) {
          await saveOutputToWorkspace(
            config.context.projectRoot,
            this.currentRunId,
            stepFileName,
            output
          ).catch(() => {});
        }
      }

      return output;
    } catch (error: any) {
      agent.status = 'failed';
      this.emit('agents', { agents: this.agents });

      // Save error output
      if (this.currentRunId) {
        const stepFileName = `${state.name}-${step.name}`;
        const errorMsg = error.message || String(error);
        await saveProcessOutput(this.currentRunId, stepFileName, `ERROR: ${errorMsg}`).catch(() => {});
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
      parts.push(`\n# 文档输出路径\n请将你产出的所有文档、报告、分析结果等写入以下目录：\n\`${outputPath}\`\n\n文件命名建议使用步骤名或有意义的名称，格式为 Markdown (.md)。`);
    }

    // Add workspace skills
    if (config.context?.projectRoot) {
      const skills = await this.loadWorkspaceSkills(config.context.projectRoot);
      if (skills) {
        parts.push(`\n# 可用 Skills（来自项目 .claude/skills/）\n\n以下是项目工作区中预定义的 Skills，你可以直接按照说明使用：\n\n${skills}`);
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

    return parts.join('\n');
  }

  private async runAgentStep(
    step: WorkflowStep,
    context: string,
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    // Find agent config for system prompt and model
    const roleConfig = this.agentConfigs.find(r => r.name === step.agent)
      || config.roles?.find(r => r.name === step.agent);

    const model = roleConfig?.model || 'claude-opus-4-6';
    const systemPrompt = roleConfig?.systemPrompt || `你是一个 ${step.role || 'assistant'} 角色的 AI 助手。`;
    const workingDirectory = config.context?.projectRoot
      ? resolve(process.cwd(), config.context.projectRoot)
      : process.cwd();

    const processId = `sm-${step.agent}-${Date.now()}`;
    const prompt = context;

    const result: ClaudeJsonResult = await processManager.executeClaudeCli(
      processId,
      step.agent,
      step.name,
      prompt,
      systemPrompt,
      model,
      {
        workingDirectory,
        timeoutMs: (config.context?.timeoutMinutes || 60) * 60 * 1000,
        runId: this.currentRunId || undefined,
      }
    );

    return result.result;
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
            issues.push({
              type: issue.type || 'implementation',
              severity: issue.severity || 'minor',
              description: issue.description || '',
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
    this.runStartTime = runState.startTime || null;
    this.globalContext = runState.globalContext || '';
    this.stateContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.status = 'running';
    this.shouldStop = false;

    this.emit('status', { status: 'running', message: '恢复运行中...' });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configPath = resolve(process.cwd(), 'configs', runState.configFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;

    // Initialize agents
    this.initializeAgents(workflowConfig);

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

    // Find and kill the running process
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => p.status === 'running' && p.step?.includes(this.currentState!)
    );

    if (running) {
      processManager.killProcess(running.id);
      this.emit('feedback-interrupted', { message, timestamp: new Date().toISOString() });
      return true;
    }

    return false;
  }

  // ========== Force complete functionality ==========
  async forceCompleteStep(): Promise<{ step: string; output: string } | null> {
    if (this.status !== 'running' || !this.currentState) {
      return null;
    }

    // Find the running process
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => p.status === 'running' && p.step?.includes(this.currentState!)
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
    this.runStartTime = runState.startTime || null;
    this.globalContext = runState.globalContext || '';
    this.stateContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.status = 'running';
    this.shouldStop = false;

    this.emit('status', { status: 'running', message: `从状态 ${stateName} 重新运行...` });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configPath = resolve(process.cwd(), 'configs', runState.configFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;

    // Initialize agents
    this.initializeAgents(workflowConfig);

    // Continue execution from this state
    await this.executeStateMachine(workflowConfig, runState.requirements);
  }
}

export const stateMachineWorkflowManager = new StateMachineWorkflowManager();
