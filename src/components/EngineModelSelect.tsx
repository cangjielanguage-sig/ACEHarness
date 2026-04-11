'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ModelOption } from '@/lib/models';
import { SingleCombobox, type ComboboxOption, type ComboboxGroupDef } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';

interface EngineInfo {
  id: string;
  name: string;
  icon: string;
}

const CONCRETE_ENGINES: EngineInfo[] = [
  { id: 'claude-code', name: 'Claude Code', icon: '🤖' },
  { id: 'kiro-cli', name: 'Kiro CLI', icon: '⚡' },
  { id: 'opencode', name: 'OpenCode', icon: '🌐' },
  { id: 'codex', name: 'Codex', icon: '🔮' },
  { id: 'cursor', name: 'Cursor', icon: '✨' },
  { id: 'cangjie-magic', name: 'CangjieMagic', icon: '🧙' },
];

interface Props {
  engine: string;
  model: string;
  onEngineChange: (engine: string) => void;
  onModelChange: (model: string) => void;
  className?: string;
}

export function EngineModelSelect({ engine, model, onEngineChange, onModelChange, className = '' }: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [globalEngine, setGlobalEngine] = useState('claude-code');
  const { toast } = useToast();

  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => setModels(d.models || [])).catch(() => {});
    fetch('/api/engine').then(r => r.json()).then(d => {
      if (d.engine) setGlobalEngine(d.engine);
    }).catch(() => {});
  }, []);

  const effectiveEngine = engine || globalEngine;
  const globalEngineInfo = CONCRETE_ENGINES.find(e => e.id === globalEngine);
  const globalLabel = globalEngineInfo ? `${globalEngineInfo.icon} ${globalEngineInfo.name}` : globalEngine;

  // Composite value: "engineId::modelValue" — empty engineId = follow system
  const compositeValue = `${engine}::${model}`;

  const groups: ComboboxGroupDef[] = useMemo(() => {
    const result: ComboboxGroupDef[] = [];

    // "跟随系统" group — uses the global engine's compatible models
    const sysModels = models.filter(
      m => !m.engines || m.engines.length === 0 || m.engines.includes(globalEngine),
    );
    if (sysModels.length > 0) {
      result.push({
        label: `🔄 跟随系统 (${globalLabel})`,
        icon: undefined,
        items: sysModels.map(m => ({
          value: `::${m.value}`,
          label: `🔄 ${m.label}`,
        })),
      });
    }

    // Concrete engine groups
    for (const eng of CONCRETE_ENGINES) {
      const engineModels = models.filter(
        m => !m.engines || m.engines.length === 0 || m.engines.includes(eng.id),
      );
      if (engineModels.length > 0) {
        result.push({
          label: `${eng.icon} ${eng.name}`,
          icon: undefined,
          items: engineModels.map(m => ({
            value: `${eng.id}::${m.value}`,
            label: `${eng.icon} ${m.label}`,
          })),
        });
      }
    }

    return result;
  }, [models, globalEngine, globalLabel]);

  const engineInfo = CONCRETE_ENGINES.find(e => e.id === effectiveEngine);
  const modelLabel = models.find(m => m.value === model)?.label || model || '选择模型';
  const isFollowSystem = !engine;
  const displayIcon = isFollowSystem ? '🔄' : (engineInfo?.icon || '🤖');

  const handleValueChange = (val: string) => {
    if (!val) return;
    const [engId, ...rest] = val.split('::');
    const modelVal = rest.join('::');
    onEngineChange(engId);
    onModelChange(modelVal);
    const engName = engId
      ? (CONCRETE_ENGINES.find(e => e.id === engId)?.name || engId)
      : `跟随系统 (${globalLabel})`;
    const modLabel = models.find(m => m.value === modelVal)?.label || modelVal;
    toast('info', `已切换: ${engName} / ${modLabel}`);
  };

  return (
    <SingleCombobox
      value={compositeValue}
      onValueChange={handleValueChange}
      groups={groups}
      placeholder={`${displayIcon} ${modelLabel}`}
      triggerClassName={`h-8 text-xs ${className}`}
    />
  );
}
