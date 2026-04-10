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

const ALL_ENGINES: EngineInfo[] = [
  { id: '', name: '跟随全局', icon: '🌐' },
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

  // Composite value: "engineId::modelValue"
  const compositeValue = `${engine}::${model}`;

  // Build groups: one per engine, each containing its compatible models
  const groups: ComboboxGroupDef[] = useMemo(() => {
    return ALL_ENGINES.filter(eng => eng.id !== '').map(eng => {
      const engineModels = models.filter(
        m => !m.engines || m.engines.length === 0 || m.engines.includes(eng.id),
      );
      return {
        label: `${eng.icon} ${eng.name}`,
        icon: undefined,
        items: engineModels.map(m => ({
          value: `${eng.id}::${m.value}`,
          label: `${eng.icon} ${m.label}`,
        })),
      };
    }).filter(g => g.items.length > 0);
  }, [models]);

  const engineInfo = ALL_ENGINES.find(e => e.id === effectiveEngine) || ALL_ENGINES[0];
  const modelLabel = models.find(m => m.value === model)?.label || model || '选择模型';

  const handleValueChange = (val: string) => {
    if (!val) return;
    const [engId, ...rest] = val.split('::');
    const modelVal = rest.join('::');
    onEngineChange(engId);
    onModelChange(modelVal);
    const engName = ALL_ENGINES.find(e => e.id === engId)?.name || engId;
    const modLabel = models.find(m => m.value === modelVal)?.label || modelVal;
    toast('info', `已切换: ${engName} / ${modLabel}`);
  };

  return (
    <SingleCombobox
      value={compositeValue}
      onValueChange={handleValueChange}
      groups={groups}
      placeholder={`${engineInfo.icon} ${modelLabel}`}
      triggerClassName={`h-8 text-xs ${className}`}
    />
  );
}
