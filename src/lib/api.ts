/**
 * API 客户端 - 与后端服务器通信
 */

const API_BASE = '/api';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = { ...getAuthHeaders(), ...(init?.headers || {}) };
  return fetch(url, { ...init, headers });
}

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
  supervisorFlow?: Array<{
    type: string;
    from: string;
    to: string;
    question?: string;
    method?: string;
    round: number;
    timestamp: string;
    stateName?: string;
  }>;
  agentFlow?: Array<{
    id: string;
    type: string;
    fromAgent: string;
    toAgent: string;
    message?: string;
    stateName: string;
    stepName: string;
    round: number;
    timestamp: string;
  }>;
  pendingSdkPlanQuestion?: {
    questions: unknown[];
    fromAgent: string;
    stateName: string;
    stepName: string;
  } | null;
  pendingPlanReview?: {
    planContent: string;
    stepKey: string;
    agent: string;
    stateName: string;
    stepName: string;
  } | null;
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
    const response = await authFetch(`${API_BASE}/configs`);
    if (!response.ok) throw new Error('获取配置列表失败');
    return response.json();
  },

  async getConfig(filename: string): Promise<ConfigResponse> {
    const response = await authFetch(`${API_BASE}/configs/${filename}`);
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
    const response = await authFetch(`${API_BASE}/configs/${filename}`, {
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
    const response = await authFetch(`${API_BASE}/configs/${filename}/copy`, {
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
    const response = await authFetch(`${API_BASE}/configs/${filename}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('删除配置失败');
    return response.json();
  },
};

export const agentApi = {
  async listAgents(): Promise<{ agents: any[] }> {
    const response = await authFetch(`${API_BASE}/agents`);
    if (!response.ok) throw new Error('获取 Agent 列表失败');
    return response.json();
  },

  async getAgent(name: string): Promise<{ agent: any; raw: string }> {
    const response = await authFetch(`${API_BASE}/agents/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('读取 Agent 配置失败');
    return response.json();
  },

  async saveAgent(name: string, agent: any): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/agents/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const issues = Array.isArray(data?.details) ? data.details : data?.details?.issues;
      const details = issues?.map((d: any) => `${d.path?.join('.')}: ${d.message}`).join('; ');
      throw new Error(data?.error ? `${data.error}${details ? ` (${details})` : ''}` : '保存 Agent 配置失败');
    }
    return response.json();
  },

  async deleteAgent(name: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/agents/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('删除 Agent 配置失败');
    return response.json();
  },

  async batchReplaceModel(engine: string | undefined, fromModel: string, toModel: string): Promise<ApiResponse & { updatedCount: number }> {
    const response = await authFetch(`${API_BASE}/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'replace-model', engine, fromModel, toModel }),
    });
    if (!response.ok) throw new Error('批量替换模型失败');
    return response.json();
  },
};

export const runsApi = {
  async listAll(): Promise<{ runs: RunRecord[] }> {
    const response = await authFetch(`${API_BASE}/runs`);
    if (!response.ok) throw new Error('获取运行记录失败');
    return response.json();
  },

  async listByConfig(configFile: string): Promise<{ runs: RunRecord[] }> {
    const response = await authFetch(`${API_BASE}/runs/by-config/${encodeURIComponent(configFile)}`);
    if (!response.ok) throw new Error('获取运行记录失败');
    return response.json();
  },

  async getRunDetail(id: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/detail`);
    if (!response.ok) throw new Error('获取运行详情失败');
    return response.json();
  },

  async deleteRun(id: string): Promise< ApiResponse> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/delete`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '删除运行记录失败');
    }
    return response.json();
  },

  async listOutputFiles(id: string): Promise<{ files: { stepName: string; filename: string; size: number; agent: string; phaseName: string; role: string; iteration: number | null; maxIterations: number | null; timestamp: string; status: string }[] }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/outputs`);
    if (!response.ok) throw new Error('获取输出文件列表失败');
    return response.json();
  },

  async getStepOutput(id: string, stepName: string): Promise<{ stepName: string; content: string }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/outputs?step=${encodeURIComponent(stepName)}`);
    if (!response.ok) throw new Error('获取步骤输出失败');
    return response.json();
  },

  async listDocuments(id: string): Promise<{ files: { filename: string; stepName: string; baseName: string; iteration: number | null; agent: string; phaseName: string; role: string; size: number; modifiedTime: string }[] }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents`);
    if (!response.ok) return { files: [] };
    return response.json();
  },

  async getDocumentContent(id: string, filename: string): Promise<{ file: string; content: string }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents?file=${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error('获取文档内容失败');
    return response.json();
  },

  async renameDocument(id: string, file: string, newName: string): Promise<{ ok: boolean; newFilename: string }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, newName }),
    });
    if (!response.ok) throw new Error('重命名失败');
    return response.json();
  },

  async deleteDocuments(id: string, files: string[]): Promise<{ ok: boolean; deleted: string[] }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!response.ok) throw new Error('删除失败');
    return response.json();
  },

  async createRun(data: { configFile: string; totalSteps: number }): Promise<{ id: string }> {
    const response = await authFetch(`${API_BASE}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('创建运行记录失败');
    return response.json();
  },

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/runs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error('更新运行记录失败');
    return response.json();
  },

  async batchDeleteRuns(runIds: string[]): Promise<ApiResponse & { deletedCount: number; errors?: string[] }> {
    const response = await authFetch(`${API_BASE}/runs/batch`, {
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
    const response = await authFetch(`${API_BASE}/workflow/start`, {
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

  async stop(configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    if (!response.ok) throw new Error('停止工作流失败');
    return response.json();
  },

  async resume(runId: string, action?: 'approve' | 'iterate' | 'force-transition', feedback?: string, targetState?: string, instruction?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, action, feedback, targetState, instruction }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '恢复工作流失败');
    }
    return response.json();
  },

  async approve(configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    if (!response.ok) throw new Error('批准检查点失败');
    return response.json();
  },

  async iterate(feedback: string, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback, configFile }),
    });
    if (!response.ok) throw new Error('请求继续迭代失败');
    return response.json();
  },

  async injectFeedback(message: string, interrupt?: boolean, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/inject-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, interrupt, configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '注入反馈失败');
    }
    return response.json();
  },

  async recallFeedback(message: string, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/recall-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '撤回反馈失败');
    }
    return response.json();
  },

  async forceCompleteStep(configFile?: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/workflow/force-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '强制完成失败');
    }
    return response.json();
  },

  async forceTransition(targetState: string, instruction?: string, configFile?: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/workflow/force-transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState, instruction, configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '强制跳转失败');
    }
    return response.json();
  },

  async getStatus(configFile?: string): Promise<WorkflowStatusResponse> {
    const params = configFile ? `?configFile=${encodeURIComponent(configFile)}` : '';
    const response = await authFetch(`${API_BASE}/workflow/status${params}`);
    if (!response.ok) throw new Error('获取状态失败');
    return response.json();
  },

  async setContext(scope: 'global' | 'phase', context: string, phase?: string, runId?: string, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, phase, context, runId, configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '设置上下文失败');
    }
    return response.json();
  },

  async getContexts(runId?: string, configFile?: string): Promise<{ globalContext: string; phaseContexts: Record<string, string> }> {
    const params = new URLSearchParams();
    if (runId) params.set('runId', runId);
    if (configFile) params.set('configFile', configFile);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const response = await authFetch(`${API_BASE}/workflow/context${qs}`);
    if (!response.ok) throw new Error('获取上下文失败');
    return response.json();
  },

  async rerunFromStep(runId: string, stepName: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/rerun-from-step`, {
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
    const response = await authFetch(`${API_BASE}/processes`);
    if (!response.ok) throw new Error('获取进程列表失败');
    return response.json();
  },

  async get(id: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/processes/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('获取进程信息失败');
    return response.json();
  },
};

export const streamApi = {
  async getStreamContent(runId: string, stepName: string): Promise<string> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(runId)}/stream?step=${encodeURIComponent(stepName)}`);
    if (!response.ok) return '';
    const data = await response.json();
    return data.content || '';
  },

  /**
   * Connect to live SSE stream for a running step.
   * Returns EventSource; caller is responsible for closing it.
   */
  connectLiveStream(
    runId: string,
    stepName: string,
    onDelta: (content: string) => void,
    onDone?: (status: string) => void,
  ): EventSource {
    const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/stream?step=${encodeURIComponent(stepName)}&live=1`;
    const es = new EventSource(url);
    es.addEventListener('delta', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.content) onDelta(data.content);
      } catch {}
    });
    es.addEventListener('done', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        onDone?.(data.status || 'completed');
      } catch {}
      es.close();
    });
    es.onerror = () => {
      // Auto-reconnect is handled by EventSource; close on fatal
    };
    return es;
  },
};

export const scheduleApi = {
  async list(): Promise<{ jobs: any[] }> {
    const res = await authFetch(`${API_BASE}/schedules`);
    if (!res.ok) throw new Error('获取定时任务列表失败');
    return res.json();
  },
  async get(id: string): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('获取定时任务失败');
    return res.json();
  },
  async create(job: any): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (!res.ok) throw new Error('创建定时任务失败');
    return res.json();
  },
  async update(id: string, patch: any): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('更新定时任务失败');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除定时任务失败');
  },
  async trigger(id: string): Promise<any> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}/trigger`, { method: 'POST' });
    if (!res.ok) throw new Error('触发定时任务失败');
    return res.json();
  },
  async toggle(id: string): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
    if (!res.ok) throw new Error('切换定时任务状态失败');
    return res.json();
  },
};

// ==================== Workspace API ====================

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export const workspaceApi = {
  async getTree(workspacePath: string, depth = 2): Promise<{ tree: TreeNode[] }> {
    const res = await authFetch(`${API_BASE}/workspace/tree?path=${encodeURIComponent(workspacePath)}&depth=${depth}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取文件树失败');
    }
    return res.json();
  },
  async getFile(workspace: string, file: string): Promise<{ content: string; size: number; path: string }> {
    const res = await authFetch(`${API_BASE}/workspace/file?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent(file)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || '读取文件失败') as Error & { size?: number };
      if (data.size != null) err.size = data.size;
      throw err;
    }
    return res.json();
  },
  async saveFile(workspace: string, file: string, content: string): Promise<{ success: boolean }> {
    const res = await authFetch(`${API_BASE}/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, file, content }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '保存文件失败');
    }
    return res.json();
  },
  async getFileBlob(workspace: string, file: string): Promise<Blob> {
    const res = await authFetch(`${API_BASE}/workspace/file?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent(file)}&mode=blob`);
    if (!res.ok) {
      throw new Error('获取文件失败');
    }
    return res.blob();
  },
  async manage(workspace: string, action: string, params: Record<string, any>): Promise<{ success: boolean }> {
    const res = await authFetch(`${API_BASE}/workspace/manage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, action, ...params }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '操作失败');
    }
    return res.json();
  },
};
