import type { RoleConfig } from '@/lib/schemas';

export interface GlobalEngineSelection {
  engine?: string;
  defaultModel?: string;
}

export interface ResolvedAgentSelection {
  configuredEngine: string;
  effectiveEngine: string;
  effectiveModel: string;
  followsSystem: boolean;
}

export function resolveAgentSelection(
  roleConfig: Pick<RoleConfig, 'engineModels' | 'activeEngine'> | null | undefined,
  globalSelection?: GlobalEngineSelection,
  workflowEngine?: string,
): ResolvedAgentSelection {
  const engineModels = roleConfig?.engineModels || {};
  const configuredEngine = roleConfig?.activeEngine ?? '';
  const followsSystem = configuredEngine === '';
  const effectiveEngine = workflowEngine || (followsSystem ? (globalSelection?.engine || '') : configuredEngine);
  const fallbackModel = Object.values(engineModels).find(Boolean) || globalSelection?.defaultModel || '';
  const effectiveModel = followsSystem
    ? (globalSelection?.defaultModel || fallbackModel)
    : (engineModels[configuredEngine] || fallbackModel);

  return {
    configuredEngine,
    effectiveEngine,
    effectiveModel,
    followsSystem,
  };
}
