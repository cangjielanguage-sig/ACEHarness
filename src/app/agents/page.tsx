'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { agentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { Globe } from 'lucide-react';
import { EngineIcon } from '@/components/EngineIcon';
import { getConcreteEngines, getEngineMeta } from '@/lib/engine-metadata';
import AgentEditModal from '@/components/AgentEditModal';
import { ClipLoader } from 'react-spinners';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ModelOption } from '@/lib/models';
import { SingleCombobox, type ComboboxOption, type ComboboxGroupDef } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { resolveAgentSelection } from '@/lib/agent-engine-selection';

interface AgentConfig {
  name: string;
  team: 'blue' | 'red' | 'judge';
  category?: string;
  tags?: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
}

const TEAM_COLORS = {
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  judge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

const CATEGORIES = ['测试', '编码', '设计', '压力测试', '审查', '文档', '其他'];

export default function AgentsPage() {
  const router = useRouter();
  const { toast } = useToast();
  useDocumentTitle('Agent 管理');
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isNewAgent, setIsNewAgent] = useState(false);
  const [showBatchReplaceModal, setShowBatchReplaceModal] = useState(false);
  const [fromModel, setFromModel] = useState('');
  const [toModel, setToModel] = useState('');
  const [batchReplacing, setBatchReplacing] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    loadAgents();
    loadModels();
    fetch('/api/engine').then(r => r.json()).then(d => {
      if (d.engine) setGlobalEngine(d.engine);
      setGlobalDefaultModel(d.defaultModel || '');
    }).catch(() => {});
  }, []);

  const loadModels = async () => {
    try {
      const response = await fetch('/api/models');
      const data = await response.json();
      setAvailableModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadAgents = async () => {
    try {
      setLoading(true);
      const data = await agentApi.listAgents();
      setAgents(data.agents || []);
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAgent = () => {
    setEditingAgent({
      name: '',
      team: 'blue',
      engineModels: {},
      activeEngine: '',
      tags: [],
      capabilities: [],
      systemPrompt: '',
    });
    setIsNewAgent(true);
  };

  const handleEditAgent = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setIsNewAgent(false);
  };

  const handleSaveAgent = async (agent: AgentConfig) => {
    try {
      await agentApi.saveAgent(agent.name, agent);
      await loadAgents();
      setEditingAgent(null);
      toast('success', 'Agent 配置已保存');
    } catch (error: any) {
      toast('error', error.message || '保存 Agent 配置失败');
    }
  };

  const handleDeleteAgent = async (name: string) => {
    const confirmed = await confirm({
      title: '确认删除',
      description: `确定要删除 Agent "${name}" 吗？`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      await agentApi.deleteAgent(name);
      await loadAgents();
    } catch (error) {
      console.error('Failed to delete agent:', error);
      setAlertMessage('删除失败: ' + (error as Error).message);
    }
  };

  const handleBatchReplaceModel = async () => {
    if (!fromModel || !toModel) {
      setAlertMessage('请选择源模型和目标模型');
      return;
    }
    // Parse composite "engine::model" values
    const [fromEng, ...fromRest] = fromModel.split('::');
    const fromMod = fromRest.join('::');
    const [toEng, ...toRest] = toModel.split('::');
    const toMod = toRest.join('::');

    if (fromEng === toEng && fromMod === toMod) {
      setAlertMessage('源模型和目标模型不能相同');
      return;
    }
    const confirmed = await confirm({
      title: '确认批量替换',
      description: `确定要将引擎 "${fromEng || '跟随全局'}" 下使用 "${fromMod}" 的 Agent 替换为 "${toEng || '跟随全局'}" 的 "${toMod}" 吗？`,
      confirmLabel: '确认替换',
      cancelLabel: '取消',
      variant: 'default',
    });
    if (!confirmed) return;

    setBatchReplacing(true);
    try {
      const result = await agentApi.batchReplaceModel(fromEng, fromMod, toMod);
      setAlertMessage(result.message);
      await loadAgents();
      setShowBatchReplaceModal(false);
      setFromModel('');
      setToModel('');
    } catch (error: any) {
      setAlertMessage('批量替换失败: ' + error.message);
    } finally {
      setBatchReplacing(false);
    }
  };

  // Get all unique tags
  const allTags = Array.from(new Set(agents.flatMap(a => a.tags || [])));

  // Determine agent group by name prefix or first tag
  const getAgentGroup = (agent: AgentConfig): string => {
    // Check name prefix first (compiler_xxx agents)
    if (agent.name.startsWith('compiler_')) return 'compiler';
    // Check name prefix (oh-cangjie agents)
    if (agent.name.startsWith('oh-cangjie')) return 'openharmony';
    // Check first tag
    const firstTag = agent.tags?.[0] || '';
    if (firstTag === 'OH' || firstTag === '仓颉') return 'openharmony';
    if (firstTag === 'C++' || firstTag === '编译器' || firstTag === 'LLVM') return 'compiler';
    return 'common';
  };

  // Get all unique models (from engineModels values)
  const allModels = Array.from(new Set(agents.flatMap(a => Object.values(a.engineModels || {})).filter(Boolean)));

  const ALL_ENGINES = [
    {
      id: '',
      name: '跟随全局',
      icon: <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />,
    },
    ...getConcreteEngines().map((engine) => ({
      id: engine.id,
      name: engine.name,
      icon: <EngineIcon engineId={engine.id} className="h-4 w-4" />,
    })),
  ];

  // Source: only engine::model combos that actually exist in agents
  const batchSourceGroups: ComboboxGroupDef[] = (() => {
    // Collect all existing engine::model pairs from agents
    const existing = new Map<string, Set<string>>();
    for (const a of agents) {
      for (const [eng, mod] of Object.entries(a.engineModels || {})) {
        if (!mod) continue;
        if (!existing.has(eng)) existing.set(eng, new Set());
        existing.get(eng)!.add(mod);
      }
    }
    return ALL_ENGINES
      .filter(eng => existing.has(eng.id))
      .map(eng => ({
        label: eng.name,
        icon: eng.icon,
        items: Array.from(existing.get(eng.id)!).map(mod => {
          const label = availableModels.find(m => m.value === mod)?.label || mod;
          return { value: `${eng.id}::${mod}`, label, icon: eng.icon };
        }),
      }))
      .filter(g => g.items.length > 0);
  })();

  // Target: filter by effective engine (follow-global uses globalEngine)
  const batchTargetGroups: ComboboxGroupDef[] = (() => {
    if (!fromModel) return [];
    const [srcEng] = fromModel.split('::');
    const effectiveEng = srcEng || globalEngine;
    const eng = ALL_ENGINES.find(e => e.id === srcEng) || ALL_ENGINES[0];
    const engineModels = availableModels.filter(
      m => !m.engines || m.engines.length === 0 || m.engines.includes(effectiveEng),
    );
    if (engineModels.length === 0) return [];
    return [{
      label: eng.name,
      icon: eng.icon,
      items: engineModels.map(m => ({
        value: `${srcEng}::${m.value}`,
        label: m.label,
        icon: eng.icon,
      })),
    }];
  })();

  // Filter agents
  const filteredAgents = agents.filter(agent => {
    if (selectedGroup !== 'all' && getAgentGroup(agent) !== selectedGroup) {
      return false;
    }
    if (searchQuery && !agent.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (selectedTeam !== 'all' && agent.team !== selectedTeam) {
      return false;
    }
    if (selectedCategory !== 'all' && agent.category !== selectedCategory) {
      return false;
    }
    if (selectedTags.length > 0 && !selectedTags.some(tag => agent.tags?.includes(tag))) {
      return false;
    }
    return true;
  });

  // Group agents by team
  const groupedAgents = {
    blue: filteredAgents.filter(a => a.team === 'blue'),
    red: filteredAgents.filter(a => a.team === 'red'),
    judge: filteredAgents.filter(a => a.team === 'judge'),
  };

  // Group agents by first tag (for sidebar counts)
  const groupCounts = {
    all: agents.length,
    common: agents.filter(a => getAgentGroup(a) === 'common').length,
    compiler: agents.filter(a => getAgentGroup(a) === 'compiler').length,
    openharmony: agents.filter(a => getAgentGroup(a) === 'openharmony').length,
  };

  const teamLabels: Record<string, string> = { blue: '蓝队', red: '红队', judge: '裁判' };
  const teamColors: Record<string, string> = {
    blue: 'border-l-blue-500 bg-blue-500/5',
    red: 'border-l-red-500 bg-red-500/5',
    judge: 'border-l-yellow-500 bg-yellow-500/5',
  };
  const groupLabels: Record<string, string> = { all: '全部', common: '通用', compiler: '编译器', openharmony: '仓颉' };
  const groupColors: Record<string, string> = {
    all: 'border-l-primary',
    common: 'border-l-green-500',
    compiler: 'border-l-purple-500',
    openharmony: 'border-l-orange-500',
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="h-14 border-b bg-card flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">Agent 管理</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowBatchReplaceModal(true)} variant="outline">
            <span className="material-symbols-outlined text-sm mr-1">swap_horiz</span>
            批量替换模型
          </Button>
          <Button size="sm" onClick={handleCreateAgent}>
            <span className="material-symbols-outlined text-sm mr-1">add</span>
            新建 Agent
          </Button>
          <ThemeToggle />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Group Selection */}
        <div className="w-48 border-r bg-card flex flex-col">
          <div className="p-3 border-b">
            <h2 className="text-sm font-semibold text-muted-foreground">分组</h2>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {(['all', 'common', 'compiler', 'openharmony'] as const).map(group => (
              <button
                key={group}
                onClick={() => setSelectedGroup(group)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm mb-1 transition-colors ${
                  selectedGroup === group
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <span>{groupLabels[group]}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  selectedGroup === group ? 'bg-primary-foreground/20' : 'bg-muted'
                }`}>
                  {groupCounts[group]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filters */}
          <div className="border-b bg-card p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Input
                placeholder="搜索 Agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64"
              />

              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground">团队:</span>
                <Button
                  size="sm"
                  variant={selectedTeam === 'all' ? 'default' : 'outline'}
                  onClick={() => setSelectedTeam('all')}
                >
                  全部
                </Button>
                <Button
                  size="sm"
                  variant={selectedTeam === 'blue' ? 'default' : 'outline'}
                  onClick={() => setSelectedTeam('blue')}
                  className={selectedTeam === 'blue' ? TEAM_COLORS.blue : ''}
                >
                  蓝队
                </Button>
                <Button
                  size="sm"
                  variant={selectedTeam === 'red' ? 'default' : 'outline'}
                  onClick={() => setSelectedTeam('red')}
                  className={selectedTeam === 'red' ? TEAM_COLORS.red : ''}
                >
                  红队
                </Button>
                <Button
                  size="sm"
                  variant={selectedTeam === 'judge' ? 'default' : 'outline'}
                  onClick={() => setSelectedTeam('judge')}
                  className={selectedTeam === 'judge' ? TEAM_COLORS.judge : ''}
                >
                  裁判
                </Button>
              </div>

              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground">分类:</span>
                <Button
                  size="sm"
                  variant={selectedCategory === 'all' ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory('all')}
                >
                  全部
                </Button>
                {CATEGORIES.map(cat => (
                  <Button
                    key={cat}
                    size="sm"
                    variant={selectedCategory === cat ? 'default' : 'outline'}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            </div>

            {allTags.length > 0 && (
              <div className="flex gap-2 items-center mt-3">
                <span className="text-sm text-muted-foreground">标签:</span>
                <div className="flex flex-wrap gap-1">
                  {allTags.map(tag => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Agent List */}
          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <ClipLoader color="hsl(var(--primary))" size={40} />
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <span className="material-symbols-outlined text-5xl mb-4">smart_toy</span>
                <p>没有找到匹配的 Agent</p>
              </div>
            ) : (
              <div className="space-y-8">
                {(['blue', 'red', 'judge'] as const).map(team => (
                  groupedAgents[team].length > 0 && (
                    <div key={team}>
                      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${
                          team === 'blue' ? 'bg-blue-500' : team === 'red' ? 'bg-red-500' : 'bg-yellow-500'
                        }`}></span>
                        {teamLabels[team]} <span className="text-sm font-normal text-muted-foreground">({groupedAgents[team].length})</span>
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {groupedAgents[team].map(agent => (
                          <div
                            key={agent.name}
                            className={`bg-card border rounded-lg p-4 hover:shadow-lg transition-shadow border-l-4 ${teamColors[team]}`}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <h3 className="font-semibold text-base mb-1">{agent.name}</h3>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleEditAgent(agent)}
                                >
                                  <span className="material-symbols-outlined text-sm">edit</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteAgent(agent.name)}
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </Button>
                              </div>
                            </div>

                            {agent.category && (
                              <div className="mb-2">
                                <Badge variant="secondary">{agent.category}</Badge>
                              </div>
                            )}

                            <div className="text-sm text-muted-foreground mb-2">
                              {(() => {
                                const resolved = resolveAgentSelection(agent as any, {
                                  engine: globalEngine,
                                  defaultModel: globalDefaultModel,
                                });
                                const engineLabel = resolved.effectiveEngine
                                  ? (getEngineMeta(resolved.effectiveEngine)?.name || resolved.effectiveEngine)
                                  : '未配置';
                                return (
                                  <>
                                    <div>引擎: {engineLabel}</div>
                                    <div>模型: {resolved.effectiveModel || '未配置'}</div>
                                  </>
                                );
                              })()}
                              {agent.temperature !== undefined && (
                                <div>Temperature: {agent.temperature}</div>
                              )}
                            </div>

                            {agent.tags && agent.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {agent.tags.slice(0, 3).map(tag => (
                                  <Badge key={tag} variant="outline" className="text-xs">
                                    {tag}
                                  </Badge>
                                ))}
                                {agent.tags.length > 3 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{agent.tags.length - 3}
                                  </Badge>
                                )}
                              </div>
                            )}

                            {agent.capabilities && agent.capabilities.length > 0 && (
                              <div className="text-xs text-muted-foreground">
                                能力: {agent.capabilities.join(', ')}
                              </div>
                            )}

                            {agent.iterationPrompt && (
                              <div className="mt-2 pt-2 border-t">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <span className="material-symbols-outlined text-xs">loop</span>
                                  已配置迭代提示词
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editingAgent && (
        <AgentEditModal
          agent={editingAgent}
          isNew={isNewAgent}
          onSave={handleSaveAgent}
          onClose={() => setEditingAgent(null)}
        />
      )}

      {showBatchReplaceModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowBatchReplaceModal(false)}>
          <div className="bg-card rounded-lg w-[500px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold">批量替换模型</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">源（引擎 + 模型）</label>
                <SingleCombobox
                  value={fromModel}
                  onValueChange={(v) => { setFromModel(v); setToModel(''); }}
                  groups={batchSourceGroups}
                  placeholder="选择当前使用的引擎和模型"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">替换为</label>
                <SingleCombobox
                  value={toModel}
                  onValueChange={setToModel}
                  groups={batchTargetGroups}
                  placeholder={fromModel ? "选择目标模型" : "请先选择源模型"}
                />
              </div>
              {fromModel && toModel && (() => {
                const [fEng] = fromModel.split('::');
                const fMod = fromModel.split('::').slice(1).join('::');
                const tMod = toModel.split('::').slice(1).join('::');
                const fEngName = ALL_ENGINES.find(e => e.id === fEng)?.name || fEng || '跟随全局';
                const affected = agents.filter(a => a.engineModels?.[fEng] === fMod).length;
                return (
                  <div className="text-sm text-muted-foreground">
                    将引擎 "{fEngName}" 下使用 "{fMod}" 的 Agent 模型替换为 "{tMod}"（影响 {affected} 个 Agent）
                  </div>
                );
              })()}
            </div>
            <div className="p-5 border-t flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowBatchReplaceModal(false)} disabled={batchReplacing}>
                取消
              </Button>
              <Button onClick={handleBatchReplaceModel} disabled={batchReplacing}>
                {batchReplacing ? '替换中...' : '确认替换'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}

      {alertMessage && (
        <ConfirmDialog
          open={true}
          title="提示"
          description={alertMessage}
          confirmLabel="确定"
          cancelLabel=""
          variant="default"
          onConfirm={() => setAlertMessage('')}
          onCancel={() => setAlertMessage('')}
        />
      )}
    </div>
  );
}
