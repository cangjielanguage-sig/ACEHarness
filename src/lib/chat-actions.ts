/**
 * Chat Action Block 协议 - 类型定义 + 执行器
 */

import { configApi, agentApi, runsApi, workflowApi } from './api';

// Action 类型枚举
export type ActionType =
  | 'config.list' | 'config.get' | 'config.create' | 'config.update' | 'config.delete'
  | 'agent.list' | 'agent.get' | 'agent.create' | 'agent.update' | 'agent.delete'
  | 'model.list'
  | 'workflow.start' | 'workflow.stop' | 'workflow.status'
  | 'runs.list' | 'runs.detail'
  | 'navigate'
  | 'skill.list'
  | 'prompt.analyze' | 'prompt.optimize'
  | 'wizard.workflow' | 'wizard.agent' | 'wizard.skill'
  // GitCode actions
  | 'gitcode.get_pr' | 'gitcode.get_issue' | 'gitcode.get_pr_commits'
  | 'gitcode.get_pr_changed_files' | 'gitcode.get_pr_comments' | 'gitcode.get_issues_by_pr'
  | 'gitcode.get_prs_by_issue' | 'gitcode.check_pr_mergeable' | 'gitcode.check_repo_public'
  | 'gitcode.list_issue_templates' | 'gitcode.get_issue_template' | 'gitcode.get_pr_template'
  | 'gitcode.get_commit_title' | 'gitcode.parse_issue_template'
  | 'gitcode.create_pr' | 'gitcode.create_issue' | 'gitcode.post_pr_comment'
  | 'gitcode.add_pr_labels' | 'gitcode.remove_pr_labels' | 'gitcode.add_issue_labels'
  | 'gitcode.assign_pr_testers' | 'gitcode.create_label' | 'gitcode.fork_repo'
  | 'gitcode.create_release'
  | 'gitcode.merge_pr';

// 风险等级
export type RiskLevel = 'safe' | 'mutating' | 'destructive';

export const RISK_MAP: Record<ActionType, RiskLevel> = {
  'config.list': 'safe',
  'config.get': 'safe',
  'config.create': 'mutating',
  'config.update': 'mutating',
  'config.delete': 'destructive',
  'agent.list': 'safe',
  'agent.get': 'safe',
  'agent.create': 'mutating',
  'agent.update': 'mutating',
  'agent.delete': 'destructive',
  'model.list': 'safe',
  'workflow.start': 'mutating',
  'workflow.stop': 'mutating',
  'workflow.status': 'safe',
  'runs.list': 'safe',
  'runs.detail': 'safe',
  'navigate': 'safe',
  'skill.list': 'safe',
  'prompt.analyze': 'safe',
  'prompt.optimize': 'safe',
  'wizard.workflow': 'safe',
  'wizard.agent': 'safe',
  'wizard.skill': 'safe',
  // GitCode - safe (read-only)
  'gitcode.get_pr': 'safe',
  'gitcode.get_issue': 'safe',
  'gitcode.get_pr_commits': 'safe',
  'gitcode.get_pr_changed_files': 'safe',
  'gitcode.get_pr_comments': 'safe',
  'gitcode.get_issues_by_pr': 'safe',
  'gitcode.get_prs_by_issue': 'safe',
  'gitcode.check_pr_mergeable': 'safe',
  'gitcode.check_repo_public': 'safe',
  'gitcode.list_issue_templates': 'safe',
  'gitcode.get_issue_template': 'safe',
  'gitcode.get_pr_template': 'safe',
  'gitcode.get_commit_title': 'safe',
  'gitcode.parse_issue_template': 'safe',
  // GitCode - mutating
  'gitcode.create_pr': 'mutating',
  'gitcode.create_issue': 'mutating',
  'gitcode.post_pr_comment': 'mutating',
  'gitcode.add_pr_labels': 'mutating',
  'gitcode.remove_pr_labels': 'mutating',
  'gitcode.add_issue_labels': 'mutating',
  'gitcode.assign_pr_testers': 'mutating',
  'gitcode.create_label': 'mutating',
  'gitcode.fork_repo': 'mutating',
  'gitcode.create_release': 'mutating',
  // GitCode - destructive
  'gitcode.merge_pr': 'destructive',
};

// Action Block 接口
export interface ActionBlock {
  type: ActionType;
  params: Record<string, any>;
  description: string;
}

// Action 执行状态
export type ActionStatus = 'pending' | 'auto_executing' | 'executing' | 'success' | 'error' | 'undone';

export interface ActionState {
  id: string;
  action: ActionBlock;
  status: ActionStatus;
  result?: any;
  error?: string;
  snapshot?: any; // 变更前快照，用于撤销
  timestamp: number;
}

// --- 解析 ---

/** 从 AI 回复 markdown 中提取 action blocks 和 card blocks */
export function parseActions(markdown: string): { text: string; actions: ActionBlock[]; cards: any[] } {
  const actions: ActionBlock[] = [];
  const cards: any[] = [];

  // Match ```action ... ``` blocks
  let text = markdown.replace(/```action\s*\n([\s\S]*?)```/g, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim());
      if (parsed.type && parsed.description) {
        actions.push({
          type: parsed.type,
          params: parsed.params || {},
          description: parsed.description,
        });
      }
    } catch {
      return _match;
    }
    return '';
  });

  // Match ```card ... ``` blocks
  text = text.replace(/```card\s*\n([\s\S]*?)```/g, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim());
      if (parsed.blocks || parsed.header) {
        cards.push(parsed);
      }
    } catch {
      return _match;
    }
    return '';
  });

  return { text: text.trim(), actions, cards };
}

/** 判断 action 是否安全（自动执行） */
export function isSafeAction(action: ActionBlock): boolean {
  return RISK_MAP[action.type] === 'safe';
}

// --- 快照 ---

async function takeSnapshot(action: ActionBlock): Promise<any> {
  const { type, params } = action;
  try {
    if (type === 'config.update' || type === 'config.delete') {
      const data = await configApi.getConfig(params.filename);
      return { type: 'config', filename: params.filename, config: data.config, raw: data.raw };
    }
    if (type === 'agent.update' || type === 'agent.delete') {
      const data = await agentApi.getAgent(params.name);
      return { type: 'agent', name: params.name, agent: data.agent, raw: data.raw };
    }
  } catch {
    return null;
  }
  return null;
}

// --- 执行 ---

export async function executeAction(action: ActionBlock): Promise<{ result: any; snapshot?: any }> {
  const { type, params } = action;
  let snapshot: any = null;

  // Take snapshot before mutating actions
  if (RISK_MAP[type] === 'mutating' || RISK_MAP[type] === 'destructive') {
    snapshot = await takeSnapshot(action);
  }

  const result = await executeActionInner(type, params);
  return { result, snapshot };
}

async function executeActionInner(type: ActionType, params: Record<string, any>): Promise<any> {
  switch (type) {
    // Config
    case 'config.list':
      return configApi.listConfigs();
    case 'config.get':
      return configApi.getConfig(params.filename);
    case 'config.create':
      return configApi.saveConfig(params.filename, params.config);
    case 'config.update':
      return configApi.saveConfig(params.filename, params.config);
    case 'config.delete':
      return configApi.deleteConfig(params.filename);

    // Agent
    case 'agent.list':
      return agentApi.listAgents();
    case 'agent.get':
      return agentApi.getAgent(params.name);
    case 'agent.create':
      return agentApi.saveAgent(params.name, params.agent);
    case 'agent.update':
      return agentApi.saveAgent(params.name, params.agent);
    case 'agent.delete':
      return agentApi.deleteAgent(params.name);

    // Model
    case 'model.list': {
      const res = await fetch('/api/models');
      return res.json();
    }

    // Workflow
    case 'workflow.start':
      return workflowApi.start(params.configFile);
    case 'workflow.stop':
      return workflowApi.stop();
    case 'workflow.status':
      return workflowApi.getStatus();

    // Runs
    case 'runs.list':
      return runsApi.listByConfig(params.configFile);
    case 'runs.detail':
      return runsApi.getRunDetail(params.runId);

    // Navigate
    case 'navigate':
      return { url: params.url };

    // Skills
    case 'skill.list': {
      const res = await fetch('/api/skills');
      return res.json();
    }

    // Prompt analysis
    case 'prompt.analyze':
    case 'prompt.optimize': {
      const res = await fetch('/api/prompt-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: params.prompt, output: params.output || '' }),
      });
      return res.json();
    }

    // Wizards - return structured step data for UI rendering
    case 'wizard.workflow':
      return { wizardType: 'workflow', step: params.step || 1, totalSteps: params.totalSteps || 6, data: params };
    case 'wizard.agent':
      return { wizardType: 'agent', step: params.step || 1, totalSteps: 3, data: params };
    case 'wizard.skill':
      return { wizardType: 'skill', step: params.step || 1, totalSteps: 3, data: params };

    default: {
      // GitCode actions - route to /api/gitcode
      if (type.startsWith('gitcode.')) {
        const command = type.replace('gitcode.', '');
        const res = await fetch('/api/gitcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, args: params }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '执行 GitCode 命令失败');
        }
        return data.data;
      }
      throw new Error(`Unknown action type: ${type}`);
    }
  }
}

// --- 撤销 ---

export async function undoAction(actionState: ActionState): Promise<any> {
  const { snapshot } = actionState;
  if (!snapshot) throw new Error('No snapshot available for undo');

  if (snapshot.type === 'config') {
    return configApi.saveConfig(snapshot.filename, snapshot.config);
  }
  if (snapshot.type === 'agent') {
    return agentApi.saveAgent(snapshot.name, snapshot.agent);
  }
  throw new Error('Cannot undo this action type');
}
