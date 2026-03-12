'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import FollowUpSuggestions from './FollowUpSuggestions';

const TEAM_COLORS: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  red: 'bg-red-500/10 text-red-500 border-red-500/30',
  judge: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
};

const TEAM_LABELS: Record<string, string> = {
  blue: '蓝队 (防御)',
  red: '红队 (攻击)',
  judge: '裁判',
};

interface AgentDetailCardProps {
  agent: any;
  raw: string;
  onAction?: (prompt: string) => void;
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="material-symbols-outlined text-xs text-muted-foreground mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="text-xs">{value}</div>
      </div>
    </div>
  );
}

/** Collapsible prompt section with optimize button */
function PromptSection({ label, icon, content, agentName, promptKey, onAction }: {
  label: string; icon: string; content: string; agentName: string; promptKey: string; onAction?: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.slice(0, 120);
  const isLong = content.length > 120;

  return (
    <div className="rounded-lg border bg-muted/20 overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="material-symbols-outlined text-xs text-muted-foreground">{icon}</span>
        <span className="text-xs font-medium flex-1">{label}</span>
        <span className="text-[10px] text-muted-foreground">{content.length} 字</span>
        <span className="material-symbols-outlined text-xs text-muted-foreground">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2">
              <div className="p-2.5 rounded border bg-background text-xs text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {content}
              </div>
              {onAction && (
                <div className="flex gap-1.5 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 gap-1 hover:bg-primary/5 hover:border-primary/40"
                    onClick={(e) => { e.stopPropagation(); onAction(`优化 Agent ${agentName} 的${label}`); }}
                  >
                    <span className="material-symbols-outlined text-xs">auto_fix_high</span>
                    优化此提示词
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 gap-1"
                    onClick={(e) => { e.stopPropagation(); onAction(`分析 Agent ${agentName} 的${label}的优缺点`); }}
                  >
                    <span className="material-symbols-outlined text-xs">analytics</span>
                    分析
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!expanded && (
        <div className="px-3 pb-2 text-[10px] text-muted-foreground truncate">
          {preview}{isLong ? '...' : ''}
        </div>
      )}
    </div>
  );
}

export default function AgentDetailCard({ agent, raw, onAction }: AgentDetailCardProps) {
  const [copied, setCopied] = useState(false);
  const name = agent?.name || '未命名 Agent';
  const role = agent?.role || '';
  const team = agent?.team || '';
  const model = agent?.model || 'default';
  const category = agent?.category || '';
  const systemPrompt = agent?.system_prompt || agent?.systemPrompt || '';
  const iterationPrompt = agent?.iterationPrompt || agent?.iteration_prompt || '';
  const teamClass = TEAM_COLORS[team] || 'bg-muted text-muted-foreground';

  // Collect all sub-agent prompts from reviewPanel
  const subAgents: { name: string; description: string; prompt: string }[] = [];
  if (agent?.reviewPanel?.subAgents) {
    for (const [saName, sa] of Object.entries(agent.reviewPanel.subAgents as Record<string, any>)) {
      if (sa?.prompt) {
        subAgents.push({ name: saName, description: sa.description || saName, prompt: sa.prompt });
      }
    }
  }

  const promptCount = (systemPrompt ? 1 : 0) + (iterationPrompt ? 1 : 0) + subAgents.length;

  const handleCopy = () => {
    navigator.clipboard.writeText(raw || JSON.stringify(agent, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const suggestions = [
    { label: '分析角色设计', prompt: `帮我分析 Agent ${name} 的角色设计是否合理`, icon: 'analytics' },
    { label: '查看相关工作流', prompt: `哪些工作流使用了 Agent ${name}`, icon: 'search' },
    { label: '编辑配置', prompt: `帮我修改 Agent ${name} 的配置`, icon: 'edit' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 rounded-lg border bg-background overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500/5 to-pink-500/5 border-b">
        <span className="material-symbols-outlined text-purple-500">smart_toy</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{name}</div>
          {role && <div className="text-xs text-muted-foreground truncate">{role}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {team && <Badge variant="outline" className={`text-[10px] ${teamClass}`}>{TEAM_LABELS[team] || team}</Badge>}
          <Badge variant="secondary" className="text-[10px]">{model}</Badge>
          {category && <Badge variant="outline" className="text-[10px]">{category}</Badge>}
          {promptCount > 0 && <Badge variant="outline" className="text-[10px]">{promptCount} 提示词</Badge>}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="visual" className="w-full">
        <div className="px-4 pt-2">
          <TabsList className="h-8">
            <TabsTrigger value="visual" className="text-xs h-6 gap-1 px-3">
              <span className="material-symbols-outlined text-xs">person</span>
              可视化
            </TabsTrigger>
            <TabsTrigger value="prompts" className="text-xs h-6 gap-1 px-3">
              <span className="material-symbols-outlined text-xs">chat</span>
              提示词 ({promptCount})
            </TabsTrigger>
            <TabsTrigger value="source" className="text-xs h-6 gap-1 px-3">
              <span className="material-symbols-outlined text-xs">code</span>
              源码
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="visual" className="px-4 pb-3 mt-0">
          <div className="max-h-80 overflow-y-auto space-y-1">
            <InfoRow label="名称" value={name} icon="badge" />
            {role && <InfoRow label="角色" value={role} icon="work" />}
            {team && <InfoRow label="团队" value={TEAM_LABELS[team] || team} icon="groups" />}
            <InfoRow label="模型" value={model} icon="model_training" />
            {category && <InfoRow label="分类" value={category} icon="category" />}

            {/* Capabilities */}
            {agent?.capabilities && agent.capabilities.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] text-muted-foreground mb-1">能力:</div>
                <div className="flex flex-wrap gap-1">
                  {agent.capabilities.map((c: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Constraints */}
            {agent?.constraints && agent.constraints.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] text-muted-foreground mb-1">约束条件:</div>
                <div className="flex flex-wrap gap-1">
                  {agent.constraints.map((c: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Tools */}
            {agent?.allowedTools && agent.allowedTools.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] text-muted-foreground mb-1">可用工具:</div>
                <div className="flex flex-wrap gap-1">
                  {agent.allowedTools.map((t: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[10px] bg-green-500/5 text-green-600 border-green-500/30">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Review panel info */}
            {agent?.reviewPanel?.enabled && (
              <div className="mt-2 p-2 rounded border bg-amber-500/5 border-amber-500/20">
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <span className="material-symbols-outlined text-xs">groups</span>
                  多维度会审面板
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{agent.reviewPanel.description}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{subAgents.length} 个子审查专家</div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="prompts" className="px-4 pb-3 mt-0">
          <div className="max-h-96 overflow-y-auto space-y-2">
            {systemPrompt && (
              <PromptSection
                label="系统提示词"
                icon="psychology"
                content={systemPrompt}
                agentName={name}
                promptKey="systemPrompt"
                onAction={onAction}
              />
            )}
            {iterationPrompt && (
              <PromptSection
                label="迭代提示词"
                icon="loop"
                content={iterationPrompt}
                agentName={name}
                promptKey="iterationPrompt"
                onAction={onAction}
              />
            )}
            {subAgents.map((sa) => (
              <PromptSection
                key={sa.name}
                label={`子专家: ${sa.description}`}
                icon="person_search"
                content={sa.prompt}
                agentName={`${name} 的子专家 ${sa.name}`}
                promptKey={`reviewPanel.subAgents.${sa.name}.prompt`}
                onAction={onAction}
              />
            ))}
            {promptCount === 0 && (
              <div className="text-xs text-muted-foreground py-4 text-center">暂无提示词配置</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="source" className="px-4 pb-3 mt-0">
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1 right-1 h-6 text-[10px] gap-1 z-10"
              onClick={handleCopy}
            >
              <span className="material-symbols-outlined text-xs">{copied ? 'check' : 'content_copy'}</span>
              {copied ? '已复制' : '复制'}
            </Button>
            <pre className="p-3 rounded border bg-muted/30 text-xs overflow-x-auto max-h-80 overflow-y-auto">
              {raw || JSON.stringify(agent, null, 2)}
            </pre>
          </div>
        </TabsContent>
      </Tabs>

      {/* Follow-up suggestions */}
      <div className="px-4 pb-3">
        <FollowUpSuggestions suggestions={suggestions} onAction={onAction} />
      </div>
    </motion.div>
  );
}
