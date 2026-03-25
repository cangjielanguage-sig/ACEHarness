'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  requestBody?: string;
  response?: string;
}

interface ApiCategory {
  name: string;
  icon: string;
  endpoints: ApiEndpoint[];
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  POST: 'bg-green-500/15 text-green-500 border-green-500/30',
  PATCH: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  PUT: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  DELETE: 'bg-red-500/15 text-red-500 border-red-500/30',
};

const API_DATA: ApiCategory[] = [
  {
    name: 'Workflow', icon: 'play_circle',
    endpoints: [
      { method: 'POST', path: '/api/workflow/start', description: '启动工作流执行', requestBody: '{ configFile: string }', response: '{ success, message }' },
      { method: 'POST', path: '/api/workflow/stop', description: '停止运行中的工作流', response: '{ success, message }' },
      { method: 'GET', path: '/api/workflow/status', description: '获取当前工作流状态', response: '{ status, runId, currentPhase, currentStep, agents, ... }' },
      { method: 'POST', path: '/api/workflow/resume', description: '恢复暂停的工作流', requestBody: '{ runId, action?: "iterate"|"approve", feedback? }', response: '{ success, message }' },
      { method: 'GET', path: '/api/workflow/events', description: 'SSE 事件流，实时推送工作流进度', response: 'text/event-stream: status, phase, step, result, checkpoint ...' },
      { method: 'POST', path: '/api/workflow/force-transition', description: '强制状态机跳转到目标状态', requestBody: '{ targetState: string }', response: '{ success, message }' },
      { method: 'POST', path: '/api/workflow/force-complete', description: '强制完成当前执行中的步骤', response: '{ success, step, outputLength }' },
      { method: 'POST', path: '/api/workflow/inject-feedback', description: '注入实时反馈或中断当前执行', requestBody: '{ message, interrupt?: boolean }', response: '{ success, interrupted? }' },
      { method: 'POST', path: '/api/workflow/recall-feedback', description: '撤回已注入的反馈', requestBody: '{ message }', response: '{ success }' },
      { method: 'POST', path: '/api/workflow/rerun-from-step', description: '从指定步骤重新执行', requestBody: '{ runId, stepName }', response: '{ success }' },
      { method: 'GET', path: '/api/workflow/context', description: '获取工作流上下文（全局和阶段）', response: '{ globalContext, phaseContexts }' },
      { method: 'POST', path: '/api/workflow/context', description: '设置工作流上下文', requestBody: '{ scope: "global"|"phase", phase?, context, runId? }', response: '{ success }' },
      { method: 'POST', path: '/api/workflow/approve', description: '批准检查点，继续执行', response: '{ success }' },
      { method: 'POST', path: '/api/workflow/iterate', description: '请求当前阶段迭代重试', requestBody: '{ feedback }', response: '{ success }' },
    ],
  },
  {
    name: 'Configs', icon: 'settings',
    endpoints: [
      { method: 'GET', path: '/api/configs', description: '列出所有工作流配置文件', response: '{ files, configs: ConfigMetadata[] }' },
      { method: 'POST', path: '/api/configs/create', description: '创建新工作流配置', requestBody: '{ filename, workflowName, description? }', response: '{ success, filename }' },
      { method: 'GET', path: '/api/configs/:filename', description: '读取指定配置文件及关联 Agent', response: '{ config, raw, agents }' },
      { method: 'POST', path: '/api/configs/:filename', description: '保存/更新配置文件', requestBody: '{ config: object }', response: '{ success }' },
      { method: 'DELETE', path: '/api/configs/:filename', description: '删除配置文件', response: '{ success }' },
      { method: 'POST', path: '/api/configs/:filename/copy', description: '复制配置文件', requestBody: '{ newFilename, workflowName? }', response: '{ success, filename }' },
    ],
  },
  {
    name: 'Runs', icon: 'history',
    endpoints: [
      { method: 'GET', path: '/api/runs', description: '列出所有运行记录', response: '{ runs: RunRecord[] }' },
      { method: 'POST', path: '/api/runs', description: '创建运行记录', requestBody: '{ configFile, configName?, totalSteps? }', response: '{ success, id }' },
      { method: 'GET', path: '/api/runs/:id', description: '获取运行记录', response: '{ RunRecord }' },
      { method: 'PATCH', path: '/api/runs/:id', description: '更新运行记录', requestBody: '{ [key]: any }', response: '{ success }' },
      { method: 'GET', path: '/api/runs/:id/detail', description: '获取运行详情（含步骤日志、上下文）', response: '{ RunState }' },
      { method: 'GET', path: '/api/runs/:id/stream?step=name', description: '获取步骤流式内容', response: '{ step, content }' },
      { method: 'GET', path: '/api/runs/:id/outputs', description: '列出运行产出文件', response: '{ files: OutputFile[] }' },
      { method: 'GET', path: '/api/runs/:id/documents', description: '列出运行文档', response: '{ files: DocumentFile[], aceDir }' },
      { method: 'PATCH', path: '/api/runs/:id/documents', description: '重命名文档', requestBody: '{ file, newName }', response: '{ ok, newFilename }' },
      { method: 'DELETE', path: '/api/runs/:id/documents', description: '删除文档', requestBody: '{ files: string[] }', response: '{ ok, deleted }' },
      { method: 'DELETE', path: '/api/runs/:id/delete', description: '删除整个运行目录', response: '{ success }' },
      { method: 'GET', path: '/api/runs/by-config/:config', description: '按配置文件列出运行记录', response: '{ runs }' },
      { method: 'POST', path: '/api/runs/batch', description: '批量删除运行', requestBody: '{ action: "delete", runIds }', response: '{ success, deletedCount }' },
    ],
  },
  {
    name: 'Agents', icon: 'smart_toy',
    endpoints: [
      { method: 'GET', path: '/api/agents', description: '列出所有 Agent 配置', response: '{ agents: Agent[] }' },
      { method: 'GET', path: '/api/agents/:name', description: '读取指定 Agent 配置', response: '{ agent, raw }' },
      { method: 'POST', path: '/api/agents/:name', description: '保存/更新 Agent 配置', requestBody: '{ agent: object }', response: '{ success }' },
      { method: 'DELETE', path: '/api/agents/:name', description: '删除 Agent 配置', response: '{ success }' },
      { method: 'POST', path: '/api/agents/batch', description: '批量替换 Agent 模型', requestBody: '{ action: "replace-model", fromModel, toModel }', response: '{ success, updatedCount }' },
    ],
  },
  {
    name: 'Processes', icon: 'terminal',
    endpoints: [
      { method: 'GET', path: '/api/processes', description: '列出所有运行中进程', response: '{ processes, stats }' },
      { method: 'DELETE', path: '/api/processes', description: '终止所有进程', response: '{ success, killedSystemPids }' },
      { method: 'GET', path: '/api/processes/:id', description: '获取指定进程信息', response: '{ Process }' },
      { method: 'DELETE', path: '/api/processes/:id', description: '终止指定进程', response: '{ success }' },
    ],
  },
  {
    name: 'Models', icon: 'psychology',
    endpoints: [
      { method: 'GET', path: '/api/models', description: '获取可用模型列表', response: '{ models: ModelOption[] }' },
      { method: 'POST', path: '/api/models', description: '保存模型配置', requestBody: '{ models: ModelOption[] }', response: '{ success }' },
    ],
  },
  {
    name: 'Engine', icon: 'memory',
    endpoints: [
      { method: 'GET', path: '/api/engine', description: '获取当前执行引擎', response: '{ engine }' },
      { method: 'POST', path: '/api/engine', description: '设置执行引擎', requestBody: '{ engine: string }', response: '{ success, engine }' },
      { method: 'GET', path: '/api/engine/availability?engine=type', description: '检查引擎是否可用', response: '{ engine, available }' },
    ],
  },
  {
    name: 'Skills', icon: 'extension',
    endpoints: [
      { method: 'GET', path: '/api/skills', description: '列出所有可用 Skills', response: '{ skills: Skill[], isCloned }' },
      { method: 'POST', path: '/api/skills', description: '拉取/更新 Skills 仓库', response: '{ success }' },
      { method: 'PUT', path: '/api/skills', description: '从官方仓库更新 Skills', response: '{ success, updated }' },
    ],
  },
  {
    name: 'Schedules', icon: 'schedule',
    endpoints: [
      { method: 'GET', path: '/api/schedules', description: '列出所有定时任务', response: '{ jobs: ScheduleJob[] }' },
      { method: 'POST', path: '/api/schedules', description: '创建定时任务', requestBody: '{ name, configFile, mode, interval?, cronExpression?, ... }', response: '{ job }' },
      { method: 'GET', path: '/api/schedules/:id', description: '获取指定定时任务', response: '{ job }' },
      { method: 'PATCH', path: '/api/schedules/:id', description: '更新定时任务', requestBody: '{ [key]: any }', response: '{ job }' },
      { method: 'DELETE', path: '/api/schedules/:id', description: '删除定时任务', response: '{ success }' },
      { method: 'POST', path: '/api/schedules/:id/toggle', description: '切换定时任务启用/禁用', response: '{ job }' },
      { method: 'POST', path: '/api/schedules/:id/trigger', description: '手动触发定时任务', response: '{ success }' },
    ],
  },
  {
    name: 'Chat', icon: 'chat',
    endpoints: [
      { method: 'POST', path: '/api/chat', description: '发送消息并获取回复（阻塞）', requestBody: '{ message, model?, sessionId?, mode? }', response: '{ result, sessionId, costUsd?, isError }' },
      { method: 'POST', path: '/api/chat/stream', description: '启动流式对话', requestBody: '{ message, model?, sessionId? }', response: '{ chatId }' },
      { method: 'GET', path: '/api/chat/stream?id=chatId', description: 'SSE 流式对话响应', response: 'text/event-stream: delta, done, error' },
      { method: 'DELETE', path: '/api/chat/stream?id=chatId', description: '终止流式对话', response: '{ killed }' },
      { method: 'GET', path: '/api/chat/sessions', description: '列出所有对话会话', response: '{ sessions }' },
      { method: 'POST', path: '/api/chat/sessions', description: '创建对话会话', requestBody: '{ id?, title?, model? }', response: '{ session }' },
      { method: 'GET', path: '/api/chat/sessions/:id', description: '获取指定会话', response: '{ session }' },
      { method: 'PUT', path: '/api/chat/sessions/:id', description: '更新会话', requestBody: '{ [key]: any }', response: '{ ok }' },
      { method: 'DELETE', path: '/api/chat/sessions/:id', description: '删除会话', response: '{ ok }' },
      { method: 'GET', path: '/api/chat/settings', description: '获取对话设置', response: '{ skills, discoveredSkills }' },
      { method: 'PUT', path: '/api/chat/settings', description: '更新对话设置', requestBody: '{ skills: Record<string, boolean> }', response: '{ success }' },
    ],
  },
  {
    name: 'GitCode', icon: 'code',
    endpoints: [
      // Read-only
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_pr — 获取 PR 详情', requestBody: '{ command: "get_pr", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_issue — 获取 Issue 详情', requestBody: '{ command: "get_issue", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_pr_commits — 获取 PR 提交列表', requestBody: '{ command: "get_pr_commits", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_pr_changed_files — 获取 PR 变更文件', requestBody: '{ command: "get_pr_changed_files", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_pr_comments — 获取 PR 评论', requestBody: '{ command: "get_pr_comments", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_issues_by_pr — 获取 PR 关联的 Issues', requestBody: '{ command: "get_issues_by_pr", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_prs_by_issue — 获取 Issue 关联的 PRs', requestBody: '{ command: "get_prs_by_issue", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.check_pr_mergeable — 检查 PR 可合并性', requestBody: '{ command: "check_pr_mergeable", args: { owner, repo, number } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.check_repo_public — 检查仓库是否公开', requestBody: '{ command: "check_repo_public", args: { owner, repo } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.list_issue_templates — 列出 Issue 模板', requestBody: '{ command: "list_issue_templates", args: { owner, repo } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_issue_template — 获取 Issue 模板内容', requestBody: '{ command: "get_issue_template", args: { owner, repo } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_pr_template — 获取 PR 模板内容', requestBody: '{ command: "get_pr_template", args: { owner, repo } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.get_commit_title — 获取提交标题', requestBody: '{ command: "get_commit_title", args: { owner, repo, sha? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.parse_issue_template — 解析 Issue 模板', requestBody: '{ command: "parse_issue_template", args: { owner, repo, "template-path": "路径" } }', response: '{ success, data }' },
      // Mutating
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.create_pr — 创建 PR', requestBody: '{ command: "create_pr", args: { owner, repo, title, head, base, body? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.create_issue — 创建 Issue', requestBody: '{ command: "create_issue", args: { owner, repo, title, body?, labels? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.post_pr_comment — 发表 PR 评论', requestBody: '{ command: "post_pr_comment", args: { owner, repo, number, body, path?, position? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.add_pr_labels — 给 PR 添加标签', requestBody: '{ command: "add_pr_labels", args: { owner, repo, number, labels: ["标签"] } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.remove_pr_labels — 移除 PR 标签', requestBody: '{ command: "remove_pr_labels", args: { owner, repo, number, label: "标签名" } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.add_issue_labels — 给 Issue 添加标签', requestBody: '{ command: "add_issue_labels", args: { owner, repo, number, labels: ["标签"] } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.post_issue_comment — 发表 Issue 评论', requestBody: '{ command: "post_issue_comment", args: { owner, repo, number, body } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.update_issue — 更新 Issue（标题/内容/状态/标签）', requestBody: '{ command: "update_issue", args: { owner, repo, number, title?, body?, state?, labels? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.update_pr — 更新 PR（标题/内容/状态/标签/草稿）', requestBody: '{ command: "update_pr", args: { owner, repo, number, title?, body?, state?, labels?, draft? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.assign_pr_testers — 指派 PR 测试人员', requestBody: '{ command: "assign_pr_testers", args: { owner, repo, number, testers: ["用户名"] } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.create_label — 创建标签', requestBody: '{ command: "create_label", args: { owner, repo, name, color?, description? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.fork_repo — Fork 仓库', requestBody: '{ command: "fork_repo", args: { owner, repo, fork_name? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.create_release — 创建 Release', requestBody: '{ command: "create_release", args: { owner, repo, tag_name, name?, body? } }', response: '{ success, data }' },
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.create_commit — 创建提交（需英文 commitlint 格式）', requestBody: '{ command: "create_commit", args: { owner, repo, branch, message, files: [{path, content}], base_branch? } }', response: '{ success, data }' },
      // Destructive
      { method: 'POST', path: '/api/gitcode', description: 'gitcode.merge_pr — 合并 PR', requestBody: '{ command: "merge_pr", args: { owner, repo, number, method? } }', response: '{ success, data }' },
    ],
  },
  {
    name: 'Other', icon: 'more_horiz',
    endpoints: [
      { method: 'POST', path: '/api/prompt-analysis', description: '分析单个 Prompt 效果', requestBody: '{ prompt, output?, context?, agentName? }', response: '{ success, analysis }' },
      { method: 'GET', path: '/api/prompt-analysis?runId=id', description: '分析运行中所有 Prompt', response: '{ steps, summary: { totalSteps, avgScore } }' },
    ],
  },
];

// PLACEHOLDER_COMPONENT
export default function ApiDocsPage() {
  const [search, setSearch] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(API_DATA[0]?.name || null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const { t } = useTranslations();

  const filteredData = search.trim()
    ? API_DATA.map(cat => ({
        ...cat,
        endpoints: cat.endpoints.filter(ep =>
          ep.path.toLowerCase().includes(search.toLowerCase()) ||
          ep.description.toLowerCase().includes(search.toLowerCase()) ||
          ep.method.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(cat => cat.endpoints.length > 0)
    : API_DATA;

  const totalEndpoints = API_DATA.reduce((sum, cat) => sum + cat.endpoints.length, 0);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(text);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="p-2 rounded-lg hover:bg-muted transition-colors">
                <span className="material-symbols-outlined text-xl">arrow_back</span>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">API Documentation</h1>
                <p className="text-xs text-muted-foreground">{totalEndpoints} endpoints across {API_DATA.length} categories</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-6">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">search</span>
            <Input
              placeholder="Search endpoints..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Category list */}
        <div className="space-y-4">
          {filteredData.map(category => {
            const isExpanded = expandedCategory === category.name || search.trim().length > 0;
            return (
              <div key={category.name} className="border border-border/50 rounded-xl overflow-hidden bg-card/50 backdrop-blur-sm">
                {/* Category header */}
                <button
                  onClick={() => setExpandedCategory(isExpanded && !search.trim() ? null : category.name)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary">{category.icon}</span>
                    <span className="text-lg font-semibold">{category.name}</span>
                    <Badge variant="secondary" className="text-xs">{category.endpoints.length}</Badge>
                  </div>
                  <span className={`material-symbols-outlined text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </button>

                {/* Endpoints */}
                {isExpanded && (
                  <div className="border-t border-border/30">
                    <div className="divide-y divide-border/20">
                      {category.endpoints.map((ep, i) => (
                        <div key={i} className="px-6 py-4 hover:bg-muted/30 transition-colors">
                          <div className="flex items-start gap-3">
                            {/* Method badge */}
                            <Badge variant="outline" className={`${METHOD_COLORS[ep.method]} font-mono text-xs shrink-0 min-w-[60px] justify-center`}>
                              {ep.method}
                            </Badge>

                            <div className="flex-1 min-w-0 space-y-2">
                              {/* Path */}
                              <div className="flex items-center gap-2">
                                <code
                                  className="text-sm font-mono cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => copyToClipboard(ep.path)}
                                  title="Click to copy"
                                >
                                  {ep.path}
                                </code>
                                {copiedPath === ep.path && (
                                  <span className="text-xs text-green-500">Copied!</span>
                                )}
                              </div>

                              {/* Description */}
                              <p className="text-sm text-muted-foreground">{ep.description}</p>

                              {/* Request / Response */}
                              <div className="flex flex-wrap gap-4 text-xs">
                                {ep.requestBody && (
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground font-medium">Request Body:</span>
                                    <code className="block bg-muted/50 rounded px-2 py-1 font-mono text-foreground/80">{ep.requestBody}</code>
                                  </div>
                                )}
                                {ep.response && (
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground font-medium">Response:</span>
                                    <code className="block bg-muted/50 rounded px-2 py-1 font-mono text-foreground/80">{ep.response}</code>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredData.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              No endpoints match &quot;{search}&quot;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
