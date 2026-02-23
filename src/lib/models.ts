// 统一的模型配置
export interface ModelOption {
  value: string;
  label: string;
  costMultiplier: number; // 费用倍率
}

export const MODEL_OPTIONS: ModelOption[] = [
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', costMultiplier: 0.06 },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', costMultiplier: 0.3 },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', costMultiplier: 0.18 },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', costMultiplier: 0.105 },
  { value: 'z-ai/glm5', label: 'GLM-5', costMultiplier: 0.02 },
];

// 获取模型显示名称
export function getModelLabel(value: string): string {
  return MODEL_OPTIONS.find(m => m.value === value)?.label || value;
}

// 获取模型费用倍率
export function getModelCostMultiplier(value: string): number {
  return MODEL_OPTIONS.find(m => m.value === value)?.costMultiplier || 1;
}
