'use client';

import ConfigCard from './cards/ConfigCard';
import AgentCard from './cards/AgentCard';
import ModelCard from './cards/ModelCard';
import RunCard from './cards/RunCard';
import WorkflowStatusCard from './cards/WorkflowStatusCard';
import SkillCard from './cards/SkillCard';
import WizardCard from './cards/WizardCard';
import PromptAnalysisCard from './cards/PromptAnalysisCard';
import ConfigDetailCard from './cards/ConfigDetailCard';
import AgentDetailCard from './cards/AgentDetailCard';
import FollowUpSuggestions from './cards/FollowUpSuggestions';

interface ResultRendererProps {
  type: string;
  result: any;
  onAction?: (prompt: string) => void;
}

export default function ResultRenderer({ type, result, onAction }: ResultRendererProps) {
  if (!result) return null;

  // Truncated results from persistence — show a re-fetch prompt
  if (result._truncated) {
    return (
      <div className="mt-2 p-2 rounded border bg-muted/50 text-xs text-muted-foreground flex items-center gap-2">
        <span className="material-symbols-outlined text-sm">history</span>
        <span>结果已截断</span>
        {onAction && (
          <button
            className="text-primary hover:underline ml-1"
            onClick={() => {
              const prompts: Record<string, string> = {
                'config.list': '列出所有工作流配置',
                'agent.list': '列出所有 Agent',
                'model.list': '列出所有可用模型',
                'skill.list': '列出所有可用 Skills',
                'workflow.status': '查看当前工作流运行状态',
                'runs.list': '列出最近的运行记录',
              };
              onAction(prompts[type] || '重新查询');
            }}
          >
            点击重新加载
          </button>
        )}
      </div>
    );
  }

  // config.list
  if (type === 'config.list' && result.configs) {
    return (
      <div className="grid gap-2 mt-2">
        {result.configs.map((c: any) => (
          <ConfigCard key={c.filename} config={c} onAction={onAction} />
        ))}
        {result.configs.length === 0 && <div className="text-xs text-muted-foreground">暂无配置</div>}
        <FollowUpSuggestions
          suggestions={[
            { label: '创建新工作流', prompt: '帮我创建一个新的工作流', icon: 'add' },
            { label: '介绍这些工作流', prompt: '帮我介绍一下当前所有工作流的用途', icon: 'info' },
          ]}
          onAction={onAction}
        />
      </div>
    );
  }

  // agent.list
  if (type === 'agent.list' && result.agents) {
    return (
      <div className="grid gap-2 mt-2">
        {result.agents.map((a: any) => (
          <AgentCard key={a.name} agent={a} onAction={onAction} />
        ))}
        {result.agents.length === 0 && <div className="text-xs text-muted-foreground">暂无 Agent</div>}
        <FollowUpSuggestions
          suggestions={[
            { label: '创建新 Agent', prompt: '帮我创建一个新的 Agent', icon: 'add' },
            { label: '介绍这些 Agent', prompt: '帮我介绍一下当前所有 Agent 的角色和用途', icon: 'info' },
            { label: '批量替换模型', prompt: '帮我批量替换 Agent 使用的模型', icon: 'swap_horiz' },
          ]}
          onAction={onAction}
        />
      </div>
    );
  }

  // model.list
  if (type === 'model.list' && result.models) {
    return (
      <div className="grid gap-2 mt-2">
        {result.models.map((m: any) => (
          <ModelCard key={m.value} model={m} onAction={onAction} />
        ))}
      </div>
    );
  }

  // runs.list
  if (type === 'runs.list' && result.runs) {
    return (
      <div className="grid gap-2 mt-2">
        {result.runs.map((r: any) => (
          <RunCard key={r.id} run={r} onAction={onAction} />
        ))}
        {result.runs.length === 0 && <div className="text-xs text-muted-foreground">暂无运行记录</div>}
        <FollowUpSuggestions
          suggestions={[
            { label: '启动新运行', prompt: '帮我启动一个工作流', icon: 'play_arrow' },
            { label: '查看运行状态', prompt: '查看当前工作流运行状态', icon: 'monitoring' },
          ]}
          onAction={onAction}
        />
      </div>
    );
  }

  // workflow.status
  if (type === 'workflow.status') {
    return <WorkflowStatusCard initialStatus={result} onAction={onAction} />;
  }

  // skill.list
  if (type === 'skill.list' && result.skills) {
    return (
      <div className="grid gap-2 mt-2">
        {result.skills.map((s: any) => (
          <SkillCard key={s.name} skill={s} onAction={onAction} />
        ))}
        {result.skills.length === 0 && <div className="text-xs text-muted-foreground">暂无 Skills</div>}
      </div>
    );
  }

  // prompt.analyze / prompt.optimize
  if ((type === 'prompt.analyze' || type === 'prompt.optimize') && result.analysis) {
    return <PromptAnalysisCard result={result} onAction={onAction} />;
  }

  // wizard.*
  if (type.startsWith('wizard.') && result.wizardType) {
    return <WizardCard result={result} onAction={onAction} />;
  }

  // config.get - rich detail card with visual/source tabs
  if (type === 'config.get' && result.config) {
    return (
      <ConfigDetailCard
        config={result.config}
        raw={typeof result.raw === 'string' ? result.raw : JSON.stringify(result.config, null, 2)}
        agents={result.agents}
        filename={result.config?.workflow?.name}
        onAction={onAction}
      />
    );
  }

  // agent.get - rich detail card with visual/source tabs
  if (type === 'agent.get' && result.agent) {
    return (
      <AgentDetailCard
        agent={result.agent}
        raw={typeof result.raw === 'string' ? result.raw : JSON.stringify(result.agent, null, 2)}
        onAction={onAction}
      />
    );
  }

  // Success message for mutations
  if (result.success !== undefined) {
    return (
      <div className="mt-2">
        <div className="text-xs text-green-600 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">check</span>
          {result.message || '操作成功'}
        </div>
        <FollowUpSuggestions
          suggestions={[
            { label: '查看当前状态', prompt: '查看当前工作流运行状态', icon: 'monitoring' },
            { label: '还能做什么', prompt: '我接下来可以做什么？', icon: 'lightbulb' },
          ]}
          onAction={onAction}
        />
      </div>
    );
  }

  // Default: JSON preview
  return (
    <pre className="mt-2 p-2 rounded border bg-background text-xs overflow-x-auto max-h-60 overflow-y-auto">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}
