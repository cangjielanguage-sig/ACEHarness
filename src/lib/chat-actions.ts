/**
 * Chat Action Block 协议 - 类型定义 + 执行器
 */

import { configApi, agentApi, runsApi, workflowApi, scheduleApi } from './api';

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
  // Schedule actions
  | 'schedule.list' | 'schedule.get' | 'schedule.create' | 'schedule.update'
  | 'schedule.delete' | 'schedule.trigger' | 'schedule.toggle'
  // GitCode actions
  | 'gitcode.get_pr' | 'gitcode.get_issue' | 'gitcode.get_pr_commits'
  | 'gitcode.get_pr_changed_files' | 'gitcode.get_pr_comments' | 'gitcode.get_issues_by_pr'
  | 'gitcode.get_prs_by_issue' | 'gitcode.check_pr_mergeable' | 'gitcode.check_repo_public'
  | 'gitcode.list_issue_templates' | 'gitcode.get_issue_template' | 'gitcode.get_pr_template'
  | 'gitcode.get_commit_title' | 'gitcode.parse_issue_template'
  | 'gitcode.create_pr' | 'gitcode.create_issue' | 'gitcode.post_pr_comment'
  | 'gitcode.add_pr_labels' | 'gitcode.remove_pr_labels' | 'gitcode.add_issue_labels'
  | 'gitcode.assign_pr_testers' | 'gitcode.create_label' | 'gitcode.fork_repo'
  | 'gitcode.create_release' | 'gitcode.post_issue_comment'
  | 'gitcode.update_issue' | 'gitcode.update_pr' | 'gitcode.create_commit'
  | 'gitcode.merge_pr';

// 风险等级
export type RiskLevel = 'safe' | 'mutating' | 'destructive';

// Action 元数据：描述 + 参数说明 + 分组
export interface ActionMeta {
  description: string;
  params: string;
  group: string;
  groupLabel: string;
  risk: RiskLevel;
}

/** Action 元数据注册表，用于动态生成提示词中的 action 列表 */
export const ACTION_REGISTRY: Record<ActionType, ActionMeta> = {
  // 配置管理
  'config.list':   { group: 'config', groupLabel: '配置管理（操作 configs/ 目录下的 YAML 文件）', risk: 'safe',        description: '列出所有工作流配置文件', params: '{}' },
  'config.get':    { group: 'config', groupLabel: '', risk: 'safe',        description: '读取某个配置文件的内容', params: '{ "filename": "xxx.yaml" }' },
  'config.create': { group: 'config', groupLabel: '', risk: 'mutating',    description: '创建新的配置文件', params: '{ "filename": "xxx.yaml", "config": {完整配置对象} }' },
  'config.update': { group: 'config', groupLabel: '', risk: 'mutating',    description: '更新已有配置文件', params: '{ "filename": "xxx.yaml", "config": {完整配置对象} }' },
  'config.delete': { group: 'config', groupLabel: '', risk: 'destructive', description: '删除配置文件', params: '{ "filename": "xxx.yaml" }' },

  // Agent 管理
  'agent.list':   { group: 'agent', groupLabel: 'Agent 管理（操作 configs/agents/ 目录下的 YAML 文件）', risk: 'safe',        description: '列出所有 Agent 配置文件', params: '{}' },
  'agent.get':    { group: 'agent', groupLabel: '', risk: 'safe',        description: '读取某个 Agent 的配置', params: '{ "name": "agent-name" }' },
  'agent.create': { group: 'agent', groupLabel: '', risk: 'mutating',    description: '创建新的 Agent 配置文件', params: '{ "name": "agent-name", "agent": {完整Agent配置} }' },
  'agent.update': { group: 'agent', groupLabel: '', risk: 'mutating',    description: '更新已有 Agent 配置文件', params: '{ "name": "agent-name", "agent": {完整Agent配置} }' },
  'agent.delete': { group: 'agent', groupLabel: '', risk: 'destructive', description: '删除 Agent 配置文件', params: '{ "name": "agent-name" }' },

  // 模型
  'model.list': { group: 'model', groupLabel: '模型（读取 configs/models/models.yaml）', risk: 'safe', description: '列出可用模型', params: '{}' },

  // 工作流控制
  'workflow.start':  { group: 'workflow', groupLabel: '工作流控制（启动/停止基于配置文件的工作流运行）', risk: 'mutating', description: '启动工作流', params: '{ "configFile": "xxx.yaml" }' },
  'workflow.stop':   { group: 'workflow', groupLabel: '', risk: 'mutating', description: '停止当前工作流', params: '{}' },
  'workflow.status': { group: 'workflow', groupLabel: '', risk: 'safe',     description: '查看工作流运行状态', params: '{}' },

  // 运行记录
  'runs.list':   { group: 'runs', groupLabel: '运行记录（读取 runs/ 目录下的运行数据）', risk: 'safe', description: '查看运行记录', params: '{ "configFile": "xxx.yaml" }（可选，不传则列出所有配置的运行记录）' },
  'runs.detail': { group: 'runs', groupLabel: '', risk: 'safe', description: '查看运行详情', params: '{ "runId": "xxx" }' },

  // 导航
  'navigate': { group: 'navigate', groupLabel: '导航', risk: 'safe', description: '跳转页面', params: '{ "url": "/path" }\n  可用路径: /, /dashboard, /agents, /models, /workflows, /workbench/{configFile}, /schedules' },

  // 定时任务管理
  'schedule.list':    { group: 'schedule', groupLabel: '定时任务管理', risk: 'safe',        description: '列出所有定时任务', params: '{}' },
  'schedule.get':     { group: 'schedule', groupLabel: '', risk: 'safe',        description: '获取定时任务详情', params: '{ "id": "任务ID" }' },
  'schedule.create':  { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '创建定时任务', params: '{ "name": "任务名称", "configFile": "xxx.yaml", "enabled": true, "mode": "simple|cron", "interval": {"value": 2, "unit": "hour|day|week"}, "fixedTime": {"hour": 0, "minute": 0, "weekday": 1}, "cronExpression": "0 */2 * * *" }' },
  'schedule.update':  { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '更新定时任务', params: '{ "id": "任务ID", ...要更新的字段 }' },
  'schedule.delete':  { group: 'schedule', groupLabel: '', risk: 'destructive', description: '删除定时任务', params: '{ "id": "任务ID" }' },
  'schedule.trigger': { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '立即触发一次定时任务', params: '{ "id": "任务ID" }' },
  'schedule.toggle':  { group: 'schedule', groupLabel: '', risk: 'mutating',    description: '启用/禁用定时任务', params: '{ "id": "任务ID" }' },

  // Skills 管理
  'skill.list': { group: 'skill', groupLabel: 'Skills 管理', risk: 'safe', description: '列出可用 Skills', params: '{}' },

  // 提示词优化
  'prompt.analyze':  { group: 'prompt', groupLabel: '提示词优化', risk: 'safe', description: '分析提示词效果', params: '{ "prompt": "提示词内容", "output": "输出内容(可选)" }' },
  'prompt.optimize': { group: 'prompt', groupLabel: '', risk: 'safe', description: '优化提示词', params: '{ "prompt": "原始提示词" }' },

  // 引导式创建向导
  'wizard.workflow': { group: 'wizard', groupLabel: '引导式创建向导', risk: 'safe', description: '工作流创建向导步骤', params: '{ "step": 步骤号, "title": "当前步骤标题", "hints": ["提示1","提示2"], "data": {已收集的数据} }' },
  'wizard.agent':    { group: 'wizard', groupLabel: '', risk: 'safe', description: 'Agent 创建向导步骤', params: '{ "step": 步骤号, "title": "当前步骤标题", "hints": ["提示1","提示2"], "data": {已收集的数据} }' },
  'wizard.skill':    { group: 'wizard', groupLabel: '', risk: 'safe', description: 'Skill 创建向导步骤', params: '{ "step": 步骤号, "title": "当前步骤标题", "hints": ["提示1","提示2"], "data": {已收集的数据} }' },

  // GitCode - safe (read-only)
  'gitcode.get_pr':              { group: 'gitcode', groupLabel: 'GitCode（代码托管平台集成）', risk: 'safe', description: '获取 PR 详情', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号 }' },
  'gitcode.get_issue':           { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 Issue 详情', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": Issue编号 }' },
  'gitcode.get_pr_commits':      { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 PR 的提交列表', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号 }' },
  'gitcode.get_pr_changed_files':{ group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 PR 变更文件列表', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号 }' },
  'gitcode.get_pr_comments':     { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 PR 评论', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号 }' },
  'gitcode.get_issues_by_pr':    { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 PR 关联的 Issues', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号 }' },
  'gitcode.get_prs_by_issue':    { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 Issue 关联的 PRs', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": Issue编号 }' },
  'gitcode.check_pr_mergeable':  { group: 'gitcode', groupLabel: '', risk: 'safe', description: '检查 PR 是否可合并', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号 }' },
  'gitcode.check_repo_public':   { group: 'gitcode', groupLabel: '', risk: 'safe', description: '检查仓库是否公开', params: '{ "owner": "仓库所有者", "repo": "仓库名" }' },
  'gitcode.list_issue_templates':{ group: 'gitcode', groupLabel: '', risk: 'safe', description: '列出 Issue 模板', params: '{ "owner": "仓库所有者", "repo": "仓库名" }' },
  'gitcode.get_issue_template':  { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 Issue 模板内容', params: '{ "owner": "仓库所有者", "repo": "仓库名", "name": "模板名" }' },
  'gitcode.get_pr_template':     { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取 PR 模板内容', params: '{ "owner": "仓库所有者", "repo": "仓库名" }' },
  'gitcode.get_commit_title':    { group: 'gitcode', groupLabel: '', risk: 'safe', description: '获取提交标题', params: '{ "owner": "仓库所有者", "repo": "仓库名", "sha": "提交SHA" }' },
  'gitcode.parse_issue_template':{ group: 'gitcode', groupLabel: '', risk: 'safe', description: '解析 Issue 模板', params: '{ "owner": "仓库所有者", "repo": "仓库名", "name": "模板名" }' },
  // GitCode - mutating
  'gitcode.create_pr':           { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '创建 PR', params: '{ "owner": "仓库所有者", "repo": "仓库名", "title": "标题", "body": "描述", "head": "源分支", "base": "目标分支" }' },
  'gitcode.create_issue':        { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '创建 Issue', params: '{ "owner": "仓库所有者", "repo": "仓库名", "title": "标题", "body": "描述" }' },
  'gitcode.post_pr_comment':     { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '发表 PR 评论', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号, "body": "评论内容" }' },
  'gitcode.add_pr_labels':       { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '为 PR 添加标签', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号, "labels": ["标签1"] }' },
  'gitcode.remove_pr_labels':    { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '移除 PR 标签', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号, "labels": ["标签1"] }' },
  'gitcode.add_issue_labels':    { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '为 Issue 添加标签', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": Issue编号, "labels": ["标签1"] }' },
  'gitcode.assign_pr_testers':   { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '指派 PR 测试人员', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号, "testers": ["用户名"] }' },
  'gitcode.create_label':        { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '创建标签', params: '{ "owner": "仓库所有者", "repo": "仓库名", "name": "标签名", "color": "颜色" }' },
  'gitcode.fork_repo':           { group: 'gitcode', groupLabel: '', risk: 'mutating', description: 'Fork 仓库', params: '{ "owner": "仓库所有者", "repo": "仓库名" }' },
  'gitcode.create_release':      { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '创建 Release', params: '{ "owner": "仓库所有者", "repo": "仓库名", "tag_name": "标签", "name": "名称", "body": "描述" }' },
  'gitcode.post_issue_comment':  { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '发表 Issue 评论', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": Issue编号, "body": "评论内容" }' },
  'gitcode.update_issue':      { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '更新 Issue（标题/内容/状态/标签/负责人）', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": Issue编号, "title": "标题", "body": "内容", "state": "reopen|close", "labels": ["标签"] }' },
  'gitcode.update_pr':         { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '更新 PR（标题/内容/状态/标签/里程碑/草稿）', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号, "title": "标题", "body": "内容", "state": "open|closed", "labels": ["标签"], "draft": true }' },
  'gitcode.create_commit':     { group: 'gitcode', groupLabel: '', risk: 'mutating', description: '创建提交（必须英文 commitlint 格式）', params: '{ "owner": "仓库所有者", "repo": "仓库名", "branch": "目标分支", "message": "提交信息（英文，type(scope): subject）", "files": [{"path": "文件路径", "content": "文件内容（base64）"}] }' },
  // GitCode - destructive
  'gitcode.merge_pr':            { group: 'gitcode', groupLabel: '', risk: 'destructive', description: '合并 PR', params: '{ "owner": "仓库所有者", "repo": "仓库名", "number": PR编号 }' },
};

// 从 ACTION_REGISTRY 派生 RISK_MAP，避免重复维护
export const RISK_MAP: Record<ActionType, RiskLevel> = Object.fromEntries(
  Object.entries(ACTION_REGISTRY).map(([type, meta]) => [type, meta.risk])
) as Record<ActionType, RiskLevel>;

/** 从 ACTION_REGISTRY 动态生成精简的 action 类型列表（无 params 详情） */
export function generateActionTypesDocs(): string {
  const groups: Record<string, string[]> = {};
  const groupLabels: Record<string, string> = {
    config: '配置管理',
    agent: 'Agent 管理',
    model: '模型',
    workflow: '工作流控制',
    runs: '运行记录',
    navigate: '导航',
    schedule: '定时任务',
    skill: 'Skills 管理',
    prompt: '提示词优化',
    wizard: '创建向导',
    gitcode: 'GitCode（详见 power-gitcode SKILL.md）',
  };

  for (const [type, meta] of Object.entries(ACTION_REGISTRY)) {
    if (!groups[meta.group]) groups[meta.group] = [];
    groups[meta.group].push(`\`${type}\``);
  }

  const lines: string[] = [];
  for (const [group, actions] of Object.entries(groups)) {
    const label = groupLabels[group] || group;
    lines.push(`**${label}**: ${actions.join(' | ')}`);
  }
  return lines.join('\n');
}

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

/** Check if a parsed JSON object looks like a card */
function isCardLike(obj: any): boolean {
  return obj && typeof obj === 'object' && (
    (obj.header && typeof obj.header === 'object') ||
    (Array.isArray(obj.blocks) && obj.blocks.length > 0)
  );
}

/** Valid Material Symbol icon names used in this app (whitelist) */
const VALID_ICONS = new Set([
  // Git/代码相关
  'merge_type', 'fork_right', 'branch', 'commit', 'tag', 'source', 'link', 'content_copy',
  'diff', 'analytics', 'rule', 'fact_check', 'review', 'approval', 'merge', 'playlist_add_check', 'done_all',
  // 文件相关
  'description', 'insert_drive_file', 'note', 'article', 'folder', 'file_copy', 'receipt',
  // 代码/编译
  'code', 'terminal', 'console', 'memory', 'cpu', 'developer_mode', 'engineering',
  'precision_manufacturing', 'bug_report', 'error', 'warning', 'outbound', 'plain',
  'dns', 'router', 'cloud', 'storage', 'backup', 'restore', 'sync',
  // 状态/进度
  'running_errors', 'pending', 'hourglass_empty', 'schedule', 'timelapse', 'progress_activity',
  'visibility', 'check_circle', 'cancel', 'stop', 'play_arrow', 'pause', 'refresh',
  'next_plan', 'assistant', 'psychology', 'recommend',
  // 操作相关
  'search', 'filter_list', 'sort', 'download', 'upload', 'settings', 'launch',
  'arrow_forward', 'arrow_back', 'close', 'add', 'remove', 'edit', 'delete',
  // 信息相关
  'info', 'help', 'smart_toy', 'rocket_launch', 'bolt', 'flash_on', 'energy', 'power',
  'battery_charging_full', 'device_thermostat', 'speed', 'neural_pulse',
  // 导航/界面
  'chat', 'mail', 'phone', 'flag', 'bookmark', 'star', 'favorite', 'thumb_up',
  'thumb_down', 'share', 'flag_star',
]);

const FALLBACK_ICON = 'help';

function validateIconName(name: string): string {
  if (!name || typeof name !== 'string') return FALLBACK_ICON;
  const clean = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return VALID_ICONS.has(clean) ? clean : FALLBACK_ICON;
}

function validateCard(card: any): any {
  if (!card) return card;
  try {
    const validated = JSON.parse(JSON.stringify(card));
    if (validated.header?.icon) {
      validated.header.icon = validateIconName(validated.header.icon);
    }
    const validateBlocks = (blocks: any[]) => {
      if (!Array.isArray(blocks)) return;
      for (const block of blocks) {
        if (block.type === 'info' && Array.isArray(block.rows)) {
          for (const row of block.rows) {
            if (row.icon) row.icon = validateIconName(row.icon);
          }
        }
        if (block.type === 'list' && Array.isArray(block.items)) {
          for (const item of block.items) {
            if (item.icon) item.icon = validateIconName(item.icon);
          }
        }
        if (block.type === 'tabs' && Array.isArray(block.tabs)) {
          for (const tab of block.tabs) {
            validateBlocks(tab.blocks);
          }
        }
        if (block.type === 'collapse' && Array.isArray(block.blocks)) {
          validateBlocks(block.blocks);
        }
        if (block.type === 'actions' && Array.isArray(block.items)) {
          for (const item of block.items) {
            if (item.icon) item.icon = validateIconName(item.icon);
          }
        }
      }
    };
    if (validated.blocks) validateBlocks(validated.blocks);
    if (validated.actions?.items) {
      for (const item of validated.actions.items) {
        if (item.icon) item.icon = validateIconName(item.icon);
      }
    }
    return validated;
  } catch {
    return card;
  }
}

/**
 * Extract a balanced JSON object starting at position `start` in `str`.
 * Returns the JSON substring or null if not found.
 */
function extractBalancedJson(str: string, start: number): string | null {
  const openIdx = str.indexOf('{', start);
  if (openIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return str.substring(openIdx, i + 1); }
  }
  return null;
}

/** 从 AI 回复 markdown 中提取 action blocks 和 card blocks */
export function parseActions(markdown: string): { text: string; actions: ActionBlock[]; cards: any[] } {
  const actions: ActionBlock[] = [];
  const cards: any[] = [];
  const removals: [number, number][] = [];

  // Find all code blocks: ```lang\n...\n```
  // Only match relevant languages (action, card, json, or unmarked)
  const codeBlockRegex = /```(action|card|json|)\s*\n/g;
  let match;
  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const lang = match[1];
    const contentStart = match.index + match[0].length;

    // Use balanced brace matching to extract JSON
    const jsonStr = extractBalancedJson(markdown, contentStart);
    if (!jsonStr) continue;

    // The JSON starts at some offset from contentStart
    const jsonStartInContent = markdown.indexOf('{', contentStart);
    const jsonEnd = jsonStartInContent + jsonStr.length;

    // Find the closing ``` — must be on its own line after the JSON
    // Search from jsonEnd, skip whitespace/newlines
    let searchPos = jsonEnd;
    while (searchPos < markdown.length && (markdown[searchPos] === ' ' || markdown[searchPos] === '\n' || markdown[searchPos] === '\r')) {
      searchPos++;
    }
    // The closing ``` should be right here (or very close)
    const closingIdx = markdown.indexOf('```', searchPos);
    // Only accept if closing is within a reasonable distance (not a different code block)
    const blockEnd = (closingIdx !== -1 && closingIdx - jsonEnd < 10) ? closingIdx + 3 : jsonEnd;

    try {
      const parsed = JSON.parse(jsonStr);

      if (lang === 'action' && parsed.type && parsed.description) {
        actions.push({ type: parsed.type, params: parsed.params || {}, description: parsed.description });
        removals.push([match.index, blockEnd]);
        // Advance regex past this block to avoid re-matching nested ```
        codeBlockRegex.lastIndex = blockEnd;
        continue;
      }

      if (isCardLike(parsed)) {
        cards.push(validateCard(parsed));
        removals.push([match.index, blockEnd]);
        codeBlockRegex.lastIndex = blockEnd;
        continue;
      }
    } catch {
      // not valid JSON, leave as-is
    }
  }

  // Remove matched blocks from text (in reverse order to preserve indices)
  let text = markdown;
  for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) {
    text = text.substring(0, start) + text.substring(end);
  }

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
      return params.configFile ? runsApi.listByConfig(params.configFile) : runsApi.listAll();
    case 'runs.detail':
      return runsApi.getRunDetail(params.runId);

    // Navigate
    case 'navigate':
      return { url: params.url };

    // Skills
    case 'skill.list': {
      const res = await fetch('/api/skills');
      const data = await res.json();
      // Filter by enabled skills if provided
      if (params.enabledSkills && Array.isArray(params.enabledSkills) && data.skills) {
        data.skills = data.skills.filter((s: any) => params.enabledSkills.includes(s.name));
      }
      return data;
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

    // Schedule actions
    case 'schedule.list':
      return scheduleApi.list();
    case 'schedule.get':
      return scheduleApi.get(params.id);
    case 'schedule.create':
      return scheduleApi.create(params);
    case 'schedule.update':
      return scheduleApi.update(params.id, params);
    case 'schedule.delete':
      await scheduleApi.delete(params.id);
      return { success: true };
    case 'schedule.trigger':
      return scheduleApi.trigger(params.id);
    case 'schedule.toggle':
      return scheduleApi.toggle(params.id);

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
