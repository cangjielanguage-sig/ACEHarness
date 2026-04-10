'use client';

import { useState, useEffect, useMemo } from 'react';
import { SingleCombobox, type ComboboxOption } from '@/components/ui/combobox';

interface EngineInfo {
  id: string;
  name: string;
  icon: string;
}

const ALL_ENGINES: EngineInfo[] = [
  { id: 'claude-code', name: 'Claude Code', icon: '🤖' },
  { id: 'kiro-cli', name: 'Kiro CLI', icon: '⚡' },
  { id: 'opencode', name: 'OpenCode', icon: '🌐' },
  { id: 'codex', name: 'Codex', icon: '🔮' },
  { id: 'cursor', name: 'Cursor', icon: '✨' },
  { id: 'cangjie-magic', name: 'CangjieMagic', icon: '🧙' },
];

interface EngineSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Show a "use global" option for per-chat/per-agent overrides */
  allowGlobal?: boolean;
}

export function EngineSelect({ value, onChange, className = '', allowGlobal = false }: EngineSelectProps) {
  const [globalEngine, setGlobalEngine] = useState('claude-code');

  useEffect(() => {
    if (allowGlobal) {
      fetch('/api/engine').then(r => r.json()).then(d => {
        if (d.engine) setGlobalEngine(d.engine);
      }).catch(() => {});
    }
  }, [allowGlobal]);

  const globalLabel = ALL_ENGINES.find(e => e.id === globalEngine)?.name || globalEngine;

  const options: ComboboxOption[] = useMemo(() => {
    const items: ComboboxOption[] = [];
    if (allowGlobal) {
      items.push({ value: '__global__', label: `跟随全局 (${globalLabel})` });
    }
    items.push(...ALL_ENGINES.map(eng => ({ value: eng.id, label: `${eng.icon} ${eng.name}` })));
    return items;
  }, [allowGlobal, globalLabel]);

  return (
    <SingleCombobox
      value={value || '__global__'}
      onValueChange={(v) => onChange(v === '__global__' ? '' : v)}
      options={options}
      placeholder="选择引擎"
      triggerClassName={className}
      searchable={false}
    />
  );
}

/** Hook to get the effective engine (per-chat override or global) */
export function useCurrentEngine(override?: string): string {
  const [globalEngine, setGlobalEngine] = useState('claude-code');

  useEffect(() => {
    fetch('/api/engine').then(r => r.json()).then(d => {
      if (d.engine) setGlobalEngine(d.engine);
    }).catch(() => {});
  }, []);

  return override || globalEngine;
}
