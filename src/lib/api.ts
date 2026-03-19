/**
 * API 客户端 - 与后端服务器通信
 */

const API_BASE = '/api';

interface ConfigListResponse {
  files: string[];
  configs: {
    filename: string;
    name: string;
    description: string;
    phaseCount: number;
    stepCount: number;
    agentCount: number;
  }[];
}

interface ConfigResponse {
  config: any;
  raw: string;
  agents: any[];
}

interface ApiResponse {
  success: boolean;
  message: string;
  interrupted?: boolean;
}

interface WorkflowStatusResponse {
  status: string;
  runId: string | null;
  currentConfigFile: string | null;
  logs: any[];
  agents: any[];
  currentPhase: string | null;
  currentStep: string | null;
  completedSteps: string[];
  failedSteps: string[];
  stepLogs?: { stepName: string; agent: string; status: string; output: string; error: string; costUsd: number; durationMs: number; timestamp: string }[];
  iterationStates: Record<string, any>;
  globalContext?: string;
  phaseContexts?: Record<string, string>;
  // State machine specific fields
  stateHistory?: any[];
  issueTracker?: any[];
  transitionCount?: number;
  startTime?: string | null;
  endTime?: string | null;
}

interface RunRecord {
  id: string;
  configFile: string;
  configName: string;
  startTime: string;
  endTime: string | null;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'crashed';
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
}

export const configApi = {
  async listConfigs(): Promise<ConfigListResponse> {
    const response = await fetch(`${API_BASE}/configs`);
    if (!response.ok) throw new Error('获取配置列表失败');
    return response.json();
  },

  async getConfig(filename: string): Promise<ConfigResponse> {
    const response = await fetch(`${API_BASE}/configs/${filename}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const available = data?.availableConfigs;
      let msg = data?.message || `读取配置失败: ${filename} 不存在或无法读取`;
      if (available?.length) {
        msg += `。可用的配置文件: ${available.join(', ')}`;
      }
      throw new Error(msg);
    }
    return response.json();
  },

  async saveConfig(filename: string, config: any): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/configs/${filename}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const details = data?.details?.map((d: any) => `${d.path?.join('.')}: ${d.message}`).join('; ');
      throw new Error(data?.error ? `${data.error}${details ? ` (${details})` : ''}` : '保存配置失败');
    }
    return response.json();
  },

  async copyConfig(filename: string, newFilename: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/configs/${filename}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newFilename }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '复制配置失败');
    }
    return response.json();
  },

  async deleteConfig(filename: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/configs/${filename}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('删除配置失败');
    return response.json();
  },
};

export const agentApi = {
  async listAgents(): Promise<{ agents: any[] }> {
    const response = await fetch(`${API_BASE}/agents`);
    if (!response.ok) throw new Error('获取 Agent 列表失败');
    return response.json();
  },

  async getAgent(name: string): Promise<{ agent: any; raw: string }> {
    const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('读取 Agent 配置失败');
    return response.json();
  },

  async saveAgent(name: string, agent: any): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    if (!response.ok) throw new Error('保存 Agent 配置失败');
    return response.json();
  },

  async deleteAgent(name: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('删除 Agent 配置失败');
    return response.json();
  },

  async batchReplaceModel(fromModel: string, toModel: string): Promise<ApiResponse & { updatedCount: number }> {
    const response = await fetch(`${API_BASE}/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'replace-model', fromModel, toModel }),
    });
    if (!response.ok) throw new Error('批量替换模型失败');
    return response.json();
  },
};

export const runsApi = {
  async listByConfig(configFile: string): Promise<{ runs: RunRecord[] }> {
    const response = await fetch(`${API_BASE}/runs/by-config/${encodeURIComponent(configFile)}`);
    if (!response.ok) throw new Error('获取运行记录失败');
    return response.json();
  },

  async getRunDetail(id: string): Promise<any> {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}/detail`);
    if (!response.ok) throw new Error('获取运行详情失败');
    return response.json();
  },

  async deleteRun(id: string): Promise< ApiResponse> {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}/delete`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '删除运行记录失败');
    }
    return response.json();
  },

  async listOutputFiles(id: string): Promise<{ files: { stepName: string; filename: string; size: number; agent: string; phaseName: string; role: string; iteration: number | null; maxIterations: number | null; timestamp: string; status: string }[] }> {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}/outputs`);
    if (!response.ok) throw new Error('获取输出文件列表失败');
    return response.json();
  },

  async getStepOutput(id: string, stepName: string): Promise<{ stepName: string; content: string }> {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}/outputs?step=${encodeURIComponent(stepName)}`);
    if (!response.ok) throw new Error('获取步骤输出失败');
    return response.json();
  },

  async listDocuments(id: string): Promise<{ files: { filename: string; stepName: string; baseName: string; iteration: number | null; agent: string; phaseName: string; role: string; size: number; modifiedTime: string }[] }> {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents`);
    if (!response.ok) return { files: [] };
    return response.json();
  },

  async getDocumentContent(id: string, filename: string): Promise<{ file: string; content: string }> {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents?file=${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error('获取文档内容失败');
    return response.json();
  },

  async createRun(data: { configFile: string; totalSteps: number }): Promise<{ id: string }> {
    const response = await fetch(`${API_BASE}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('创建运行记录失败');
    return response.json();
  },

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/runs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error('更新运行记录失败');
    return response.json();
  },

  async batchDeleteRuns(runIds: string[]): Promise<ApiResponse & { deletedCount: number; errors?: string[] }> {
    const response = await fetch(`${API_BASE}/runs/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', runIds }),
    });
    if (!response.ok) throw new Error('批量删除运行记录失败');
    return response.json();
  },
};

export const workflowApi = {
  async start(configFile: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '启动工作流失败');
    }
    return response.json();
  },

  async stop(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/stop`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('停止工作流失败');
    return response.json();
  },

  async resume(runId: string, action?: 'approve' | 'iterate', feedback?: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, action, feedback }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '恢复工作流失败');
    }
    return response.json();
  },

  async approve(): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/approve`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('批准检查点失败');
    return response.json();
  },

  async iterate(feedback: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });
    if (!response.ok) throw new Error('请求继续迭代失败');
    return response.json();
  },

  async injectFeedback(message: string, interrupt?: boolean): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/inject-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, interrupt }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '注入反馈失败');
    }
    return response.json();
  },

  async recallFeedback(message: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/recall-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '撤回反馈失败');
    }
    return response.json();
  },

  async forceCompleteStep(): Promise<any> {
    const response = await fetch(`${API_BASE}/workflow/force-complete`, {
      method: 'POST',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '强制完成失败');
    }
    return response.json();
  },

  async forceTransition(targetState: string, instruction?: string): Promise<any> {
    const response = await fetch(`${API_BASE}/workflow/force-transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState, instruction }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '强制跳转失败');
    }
    return response.json();
  },

  async getStatus(): Promise<WorkflowStatusResponse> {
    const response = await fetch(`${API_BASE}/workflow/status`);
    if (!response.ok) throw new Error('获取状态失败');
    return response.json();
  },

  async setContext(scope: 'global' | 'phase', context: string, phase?: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, phase, context }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '设置上下文失败');
    }
    return response.json();
  },

  async getContexts(): Promise<{ globalContext: string; phaseContexts: Record<string, string> }> {
    const response = await fetch(`${API_BASE}/workflow/context`);
    if (!response.ok) throw new Error('获取上下文失败');
    return response.json();
  },

  async rerunFromStep(runId: string, stepName: string): Promise<ApiResponse> {
    const response = await fetch(`${API_BASE}/workflow/rerun-from-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, stepName }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '重新运行失败');
    }
    return response.json();
  },

  connectEventStream(onMessage: (data: any) => void): EventSource {
    const eventSource = new EventSource(`${API_BASE}/workflow/events`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    eventSource.onerror = (error) => {
      console.error('EventSource 错误:', error);
    };

    return eventSource;
  },
};

export const processApi = {
  async list(): Promise<{ processes: any[]; stats: any }> {
    const response = await fetch(`${API_BASE}/processes`);
    if (!response.ok) throw new Error('获取进程列表失败');
    return response.json();
  },

  async get(id: string): Promise<any> {
    const response = await fetch(`${API_BASE}/processes/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('获取进程信息失败');
    return response.json();
  },
};

export const streamApi = {
  async getStreamContent(runId: string, stepName: string): Promise<string> {
    const response = await fetch(`${API_BASE}/runs/${encodeURIComponent(runId)}/stream?step=${encodeURIComponent(stepName)}`);
    if (!response.ok) return '';
    const data = await response.json();
    return data.content || '';
  },
};
