'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { configApi, workflowApi, agentApi, runsApi, processApi, streamApi } from '@/lib/api';
import { useWorkflowState } from '@/hooks/useWorkflowState';
import type { ViewMode } from '@/hooks/useWorkflowState';
import FlowDiagram from '@/components/FlowDiagram';
import DesignPanel from '@/components/DesignPanel';
import AgentPanel from '@/components/AgentPanel';
import AgentConfigPanel from '@/components/AgentConfigPanel';
import EditNodeModal from '@/components/EditNodeModal';
import ProcessPanel from '@/components/ProcessPanel';
import Markdown from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import styles from './page.module.css';

export default function WorkbenchPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const configFile = decodeURIComponent(params.config as string);
  const initialMode = (searchParams.get('mode') as ViewMode) || 'run';
  const initialRunId = searchParams.get('run');

  // Update URL query params without full navigation
  const updateUrl = useCallback((updates: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(updates)) {
      if (val === null) sp.delete(key);
      else sp.set(key, val);
    }
    const qs = sp.toString();
    router.replace(`/workbench/${encodeURIComponent(configFile)}${qs ? '?' + qs : ''}`, { scroll: false });
  }, [searchParams, configFile, router]);

  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const { state, dispatch, addLog } = useWorkflowState(initialMode);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [viewingHistoryRun, setViewingHistoryRun] = useState(false);
  const [fullStepOutput, setFullStepOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ title: string; chunks: string[] } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [liveStream, setLiveStream] = useState<string[]>([]);
  const [showLiveStream, setShowLiveStream] = useState(false);
  const [isNewNode, setIsNewNode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const liveStreamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveStreamLenRef = useRef(0);
  const {
    viewMode, workflowConfig, editingConfig, agentConfigs,
    workflowStatus, runId, currentPhase, currentStep, agents, logs, completedSteps, failedSteps,
    showCheckpoint, checkpointMessage, checkpointIsIterative, activeTab, selectedAgent, selectedStep,
    projectRoot, requirements, timeoutMinutes, showProcessPanel,
    showEditNodeModal, editingNode, iterationStates, stepResults,
  } = state;

  const isRunning = workflowStatus === 'running';
  const totalSteps = workflowConfig?.workflow?.phases?.reduce(
    (sum: number, phase: any) => sum + phase.steps.length, 0
  ) || 0;

  const fetchCurrentStatus = async () => {
    try {
      const status = await workflowApi.getStatus();
      if (status.status && status.status !== 'idle') {
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: status.status });
        if (status.runId) dispatch({ type: 'SET_RUN_ID', payload: status.runId });
        if (status.currentPhase) dispatch({ type: 'SET_CURRENT_PHASE', payload: status.currentPhase });
        if (status.currentStep) dispatch({ type: 'SET_CURRENT_STEP', payload: status.currentStep });
        if (status.agents?.length) dispatch({ type: 'SET_AGENTS', payload: status.agents });
        if (status.completedSteps) dispatch({ type: 'SET_COMPLETED_STEPS', payload: status.completedSteps });
        dispatch({ type: 'SET_FAILED_STEPS', payload: status.failedSteps || [] });
        if (status.stepLogs?.length) {
          const restoredResults: Record<string, { output: string; error?: string; costUsd?: number; durationMs?: number }> = {};
          for (const log of status.stepLogs) {
            restoredResults[log.stepName] = {
              output: log.output || '',
              error: log.error || undefined,
              costUsd: log.costUsd || undefined,
              durationMs: log.durationMs || undefined,
            };
          }
          dispatch({ type: 'SET_STEP_RESULTS', payload: restoredResults });
        }
        if (status.iterationStates) {
          Object.entries(status.iterationStates).forEach(([phase, iterState]) => {
            dispatch({ type: 'SET_ITERATION_STATE', payload: { phase, state: iterState as any } });
          });
        }
      }
    } catch { /* server might not be ready */ }
  };

  const loadHistory = async () => {
    try {
      const { runs } = await runsApi.listByConfig(configFile);
      setHistoryRuns(runs);
    } catch { /* ignore */ }
  };

  const loadRunDetail = async (runId: string) => {
    try {
      const detail = await runsApi.getRunDetail(runId);
      setRunDetail(detail);
    } catch {
      setRunDetail(null);
    }
  };

  useEffect(() => {
    loadWorkflowConfig();
    if (viewMode === 'run') {
      if (!viewingHistoryRun) {
        fetchCurrentStatus();
      }
      const eventSource = workflowApi.connectEventStream((event: any) => {
        // If we receive a live event, we're no longer viewing history
        setViewingHistoryRun(false);
        handleEventRef.current(event);
      });
      eventSource.addEventListener('open', () => {
        if (!viewingHistoryRun) {
          fetchCurrentStatus();
        }
      });
      return () => eventSource?.close();
    }
    if (viewMode === 'history') {
      loadHistory();
    }
  }, [viewMode]);

  // Auto-load run from URL ?run=xxx on mount
  useEffect(() => {
    if (initialRunId && !runId) {
      viewHistoryRun(initialRunId);
    }
  }, [initialRunId]);

  // Sync runId to URL
  useEffect(() => {
    const currentUrlRun = searchParams.get('run');
    if (runId && runId !== currentUrlRun) {
      updateUrl({ run: runId });
    }
  }, [runId]);

  // Poll status every 3s while running, as fallback for missed SSE events
  useEffect(() => {
    if (viewMode !== 'run' || !isRunning) return;
    const interval = setInterval(fetchCurrentStatus, 3000);
    return () => clearInterval(interval);
  }, [viewMode, isRunning]);

  useEffect(() => {
    if (viewMode === 'design' && workflowConfig) {
      dispatch({ type: 'SET_EDITING_CONFIG', payload: JSON.parse(JSON.stringify(workflowConfig)) });
    }
  }, [viewMode, workflowConfig]);

  const viewHistoryRun = async (runId: string) => {
    try {
      const detail = await runsApi.getRunDetail(runId);
      if (!detail) return;

      // Map persisted agents to the Agent shape the run view expects
      const agents = (detail.agents || []).map((a: any) => ({
        name: a.name,
        team: a.team,
        model: a.model,
        status: a.status || 'waiting',
        currentTask: null,
        completedTasks: a.completedTasks || 0,
        tokenUsage: a.tokenUsage || { inputTokens: 0, outputTokens: 0 },
        iterationCount: a.iterationCount || 0,
        summary: a.summary || '',
        changes: [],
      }));

      // Restore all state into the run view
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: detail.status === 'crashed' ? 'failed' : detail.status });
      dispatch({ type: 'SET_RUN_ID', payload: runId });
      dispatch({ type: 'SET_AGENTS', payload: agents });
      dispatch({ type: 'SET_COMPLETED_STEPS', payload: detail.completedSteps || [] });
      // Ensure the interrupted step is marked as failed for crashed runs
      const failed = [...(detail.failedSteps || [])];
      if ((detail.status === 'crashed' || detail.status === 'failed' || detail.status === 'stopped') && detail.currentStep
        && !detail.completedSteps?.includes(detail.currentStep) && !failed.includes(detail.currentStep)) {
        failed.push(detail.currentStep);
      }
      dispatch({ type: 'SET_FAILED_STEPS', payload: failed });
      if (detail.currentPhase) dispatch({ type: 'SET_CURRENT_PHASE', payload: detail.currentPhase });
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });

      // Restore step results from stepLogs
      const restoredResults: Record<string, any> = {};
      if (detail.stepLogs) {
        for (const log of detail.stepLogs) {
          restoredResults[log.stepName] = {
            output: log.output || '',
            error: log.error || undefined,
            costUsd: log.costUsd || undefined,
            durationMs: log.durationMs || undefined,
          };
        }
      }
      dispatch({ type: 'SET_STEP_RESULTS', payload: restoredResults });

      // Restore iteration states
      if (detail.iterationStates) {
        Object.entries(detail.iterationStates).forEach(([phase, iter]: [string, any]) => {
          dispatch({
            type: 'SET_ITERATION_STATE',
            payload: {
              phase,
              state: {
                phaseName: iter.phaseName || phase,
                currentIteration: iter.currentIteration || 0,
                maxIterations: iter.maxIterations || 0,
                consecutiveClean: iter.consecutiveCleanRounds || 0,
                status: iter.status || 'completed',
              },
            },
          });
        });
      }

      // Switch to run view
      setViewingHistoryRun(true);
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      updateUrl({ run: runId, mode: null });
      if (agents.length > 0) {
        dispatch({ type: 'SET_SELECTED_AGENT', payload: agents[0] });
      }
      // If there's a pending checkpoint, show the checkpoint dialog
      if (detail.pendingCheckpoint) {
        dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: detail.pendingCheckpoint.message });
        dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: !!detail.pendingCheckpoint.isIterativePhase });
        dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
      }
      addLog('system', 'info', `查看历史运行: ${runId}`);
    } catch (error: any) {
      addLog('system', 'error', `加载历史运行失败: ${error.message}`);
    }
  };

  const loadWorkflowConfig = async () => {
    setPageLoading(true);
    setLoadError(null);
    try {
      const { config, agents: loadedAgents } = await configApi.getConfig(configFile);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: loadedAgents || [] });
      dispatch({ type: 'SET_PROJECT_ROOT', payload: config.context?.projectRoot || '' });
      dispatch({ type: 'SET_REQUIREMENTS', payload: config.context?.requirements || '' });
      dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: config.context?.timeoutMinutes || 30 });
    } catch (error: any) {
      console.error('加载工作流配置失败:', error);
      setLoadError(error.message || '加载失败');
    } finally {
      setPageLoading(false);
    }
  };

  const handleEvent = useCallback((event: any) => {
    switch (event.type) {
      case 'status':
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: event.data.status });
        if (event.data.runId) dispatch({ type: 'SET_RUN_ID', payload: event.data.runId });
        addLog('system', 'info', event.data.message);
        break;
      case 'phase':
        dispatch({ type: 'SET_CURRENT_PHASE', payload: event.data.phase });
        addLog('system', 'info', `📍 ${event.data.message}`);
        break;
      case 'step':
        dispatch({ type: 'SET_CURRENT_STEP', payload: event.data.step });
        addLog(event.data.agent, 'info', `开始执行: ${event.data.step}`);
        break;
      case 'result':
        if (event.data.error) {
          addLog(event.data.agent, 'error', event.data.output);
          dispatch({ type: 'ADD_FAILED_STEP', payload: event.data.step });
          dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
          dispatch({ type: 'SET_STEP_RESULT', payload: {
            step: event.data.step,
            result: { output: '', error: event.data.errorDetail || event.data.output },
          }});
        } else {
          addLog(event.data.agent, 'success', `完成: ${event.data.step}`);
          dispatch({ type: 'ADD_COMPLETED_STEP', payload: event.data.step });
          dispatch({ type: 'SET_STEP_RESULT', payload: {
            step: event.data.step,
            result: {
              output: event.data.fullOutput || event.data.output,
              costUsd: event.data.costUsd,
              durationMs: event.data.durationMs,
            },
          }});
        }
        break;
      case 'agents':
        dispatch({ type: 'SET_AGENTS', payload: event.data.agents });
        if (!selectedAgent && event.data.agents.length > 0) {
          dispatch({ type: 'SET_SELECTED_AGENT', payload: event.data.agents[0] });
        }
        break;
      case 'checkpoint':
        dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
        dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: event.data.message });
        dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: !!event.data.isIterativePhase });
        addLog('system', 'warning', `✋ 检查点: ${event.data.checkpoint}`);
        break;
      case 'iteration':
        dispatch({
          type: 'SET_ITERATION_STATE',
          payload: {
            phase: event.data.phase,
            state: {
              phaseName: event.data.phase,
              currentIteration: event.data.iteration,
              maxIterations: event.data.maxIterations,
              consecutiveClean: event.data.consecutiveClean,
              status: 'running',
            },
          },
        });
        addLog('system', 'info', `🔄 迭代 ${event.data.iteration}/${event.data.maxIterations} - ${event.data.phase}`);
        break;
      case 'iteration-complete':
        addLog('system', 'success', `✅ 迭代完成: ${event.data.phase} (${event.data.totalIterations} 轮, 原因: ${event.data.reason})`);
        break;
      case 'escalation':
        addLog('system', 'warning', `⚠️ 升级人工: ${event.data.phase} - ${event.data.reason}`);
        break;
      case 'token-usage':
        dispatch({
          type: 'UPDATE_AGENT_TOKEN_USAGE',
          payload: { agent: event.data.agent, usage: event.data.delta },
        });
        break;
    }
  }, [selectedAgent, addLog]);

  // Keep a ref to the latest handleEvent so SSE callback never goes stale
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const saveConfig = async () => {
    setSaving(true);
    try {
      const config = { ...workflowConfig, context: { ...workflowConfig.context, projectRoot, requirements, timeoutMinutes } };
      await configApi.saveConfig(configFile, config);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      toast('success', '配置已保存');
    } catch (error: any) {
      toast('error', '保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const saveWorkflowName = async (newName: string) => {
    if (!newName.trim() || !workflowConfig) return;
    try {
      const config = { ...workflowConfig, workflow: { ...workflowConfig.workflow, name: newName.trim() } };
      await configApi.saveConfig(configFile, config);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
    } catch { /* non-critical */ }
    setEditingName(false);
  };

  const startWorkflow = async () => {
    setStarting(true);
    try {
      setViewingHistoryRun(false);
      dispatch({ type: 'RESET_RUN' });
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
      addLog('system', 'info', '正在启动工作流...');
      await workflowApi.start(configFile);
      addLog('system', 'success', '工作流启动成功，等待执行...');
      // Fetch status shortly after start to catch initial state
      setTimeout(fetchCurrentStatus, 500);
    } catch (error: any) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `启动失败: ${error.message}`);
    } finally {
      setStarting(false);
    }
  };

  const stopWorkflow = async () => {
    try {
      await workflowApi.stop();
      // Directly update local state — don't rely solely on SSE
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'stopped' });
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      addLog('system', 'warning', '工作流已停止');
    } catch (error: any) {
      addLog('system', 'error', `停止失败: ${error.message}`);
    }
  };

  const forceCompleteStep = async () => {
    try {
      const result = await workflowApi.forceCompleteStep();
      addLog('system', 'info', `步骤 "${result.step}" 已完成 (${result.outputLength} 字符)`);
    } catch (error: any) {
      addLog('system', 'error', `完成失败: ${error.message}`);
      toast('error', error.message);
    }
  };

  const resumeWorkflow = async (resumeRunId?: string) => {
    const rid = resumeRunId || runId || selectedRun?.id;
    if (!rid) return;
    try {
      setViewingHistoryRun(false);
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
      dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
      dispatch({ type: 'SET_RUN_ID', payload: rid });
      addLog('system', 'info', `正在恢复运行: ${rid}...`);
      await workflowApi.resume(rid);
      addLog('system', 'success', '工作流恢复成功，继续执行...');
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      // Fetch immediately, then polling effect takes over (every 3s)
      fetchCurrentStatus();
    } catch (error: any) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `恢复失败: ${error.message}`);
    }
  };

  const approveCheckpoint = async () => {
    try {
      if (isRunning) {
        await workflowApi.approve();
      } else {
        // Workflow not running (restored from pendingCheckpoint) — resume with approve action
        const rid = runId || selectedRun?.id;
        if (rid) {
          setViewingHistoryRun(false);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
          dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
          await workflowApi.resume(rid, 'approve');
          dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
          fetchCurrentStatus();
        }
      }
      dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
      addLog('system', 'success', '✓ 检查点已批准，继续执行');
    } catch (error: any) {
      addLog('system', 'error', `批准失败: ${error.message}`);
    }
  };

  const rejectCheckpoint = async () => {
    dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
    if (isRunning) {
      await stopWorkflow();
    }
    addLog('system', 'warning', '✗ 检查点被拒绝，工作流已停止');
  };

  const iterateCheckpoint = async () => {
    try {
      if (isRunning) {
        await workflowApi.iterate();
      } else {
        // Workflow not running — resume with iterate action
        const rid = runId || selectedRun?.id;
        if (rid) {
          setViewingHistoryRun(false);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
          dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
          await workflowApi.resume(rid, 'iterate');
          dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
          fetchCurrentStatus();
        }
      }
      dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
      addLog('system', 'info', '↻ 继续迭代，重新执行当前阶段');
    } catch (error: any) {
      addLog('system', 'error', `请求迭代失败: ${error.message}`);
    }
  };

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = { idle: '空闲', running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止', crashed: '崩溃' };
    return texts[status] || status;
  };

  const selectStep = (step: any) => {
    dispatch({ type: 'SET_SELECTED_STEP', payload: step });
    setShowSystemPrompt(false);
    setFullStepOutput(null);
    const agent = agents.find((a) => a.name === step.agent);
    if (agent) {
      dispatch({ type: 'SET_SELECTED_AGENT', payload: agent });
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'agents' });
    }
  };

  const loadFullOutput = async (stepName: string) => {
    const rid = runId || selectedRun?.id;
    if (!rid) return;
    setLoadingOutput(true);
    try {
      const { content } = await runsApi.getStepOutput(rid, stepName);
      setFullStepOutput(content);
    } catch {
      setFullStepOutput(null);
    }
    setLoadingOutput(false);
  };

  const openMarkdownModal = async (stepName: string) => {
    const result = stepResults[stepName];
    if (!result) return;
    const rid = runId || selectedRun?.id;
    if (rid) {
      try {
        // Try stream file first (has chunk separators for visual separation)
        const streamContent = await streamApi.getStreamContent(rid, stepName);
        if (streamContent) {
          const chunks = streamContent.split(CHUNK_SEP).filter(Boolean);
          if (chunks.length > 1) {
            setMarkdownModal({ title: stepName, chunks });
            return;
          }
        }
        // Fall back to output file
        const { content } = await runsApi.getStepOutput(rid, stepName);
        setMarkdownModal({ title: stepName, chunks: [content] });
        return;
      } catch { /* fall through to local */ }
    }
    setMarkdownModal({ title: stepName, chunks: [result.output] });
  };

  // Chunk separator used in persisted stream files
  const CHUNK_SEP = '\n\n<!-- chunk-boundary -->\n\n';

  // --- Live stream polling ---
  const startLiveStream = () => {
    setShowLiveStream(true);
    setLiveStream([]);
    liveStreamLenRef.current = 0;
    if (liveStreamRef.current) clearInterval(liveStreamRef.current);
    liveStreamRef.current = setInterval(async () => {
      try {
        // Try in-memory process first
        const { processes } = await processApi.list();
        const running = processes.find((p: any) => p.status === 'running');
        let content: string | null = null;
        let fromPersisted = false;
        if (running?.streamContent) {
          content = running.streamContent;
        } else {
          // Fallback: read from persisted stream file (contains chunk separators)
          const rid = runId || selectedRun?.id;
          const step = currentStep || selectedStep?.name;
          if (rid && step) {
            content = await streamApi.getStreamContent(rid, step);
            if (content) fromPersisted = true;
          }
          if (!content) {
            // Check latest completed process
            const latest = processes.sort((a: any, b: any) =>
              new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
            )[0];
            if (latest?.streamContent) {
              content = latest.streamContent;
            }
          }
        }
        if (content && content.length > liveStreamLenRef.current) {
          liveStreamLenRef.current = content.length;
          // Always split full content by chunk separator so boundaries render as visual dividers
          const chunks = content.split(CHUNK_SEP).filter(Boolean);
          setLiveStream(chunks);
        }
        // Stop polling if nothing is running
        if (!processes.some((p: any) => p.status === 'running') && !isRunning) {
          stopLiveStream();
        }
      } catch { /* ignore */ }
    }, 1000);
  };

  const stopLiveStream = () => {
    if (liveStreamRef.current) {
      clearInterval(liveStreamRef.current);
      liveStreamRef.current = null;
    }
    setShowLiveStream(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (liveStreamRef.current) clearInterval(liveStreamRef.current); };
  }, []);

  const selectedRoleConfig = selectedStep
    ? agentConfigs.find((r: any) => r.name === selectedStep.agent)
    : null;

  const handleSelectNode = (type: 'phase' | 'step', phaseIndex: number, stepIndex?: number) => {
    setIsNewNode(false);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type, phaseIndex, stepIndex } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleSaveNode = async (data: any) => {
    if (!editingNode || !editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    if (editingNode.type === 'phase') {
      newConfig.workflow.phases[editingNode.phaseIndex] = {
        ...newConfig.workflow.phases[editingNode.phaseIndex], ...data,
      };
    } else if (editingNode.stepIndex !== undefined) {
      newConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex] = {
        ...newConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex], ...data,
      };
    }
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false });
    dispatch({ type: 'SET_EDITING_NODE', payload: null });
  };

  const handleDeleteNode = async () => {
    if (!editingNode || !editingConfig) return;
    const ok = await confirm({
      title: '确认删除',
      description: '确定要删除吗？',
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    if (editingNode.type === 'phase') {
      newConfig.workflow.phases.splice(editingNode.phaseIndex, 1);
    } else if (editingNode.stepIndex !== undefined) {
      newConfig.workflow.phases[editingNode.phaseIndex].steps.splice(editingNode.stepIndex, 1);
    }
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false });
    dispatch({ type: 'SET_EDITING_NODE', payload: null });
  };

  const handleAddPhase = (afterIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const newPhase = {
      name: `新阶段 ${newConfig.workflow.phases.length + 1}`,
      steps: [],
      iteration: { enabled: false },
    };
    newConfig.workflow.phases.splice(afterIndex + 1, 0, newPhase);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    setIsNewNode(true);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type: 'phase' as const, phaseIndex: afterIndex + 1 } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleAddStep = (phaseIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const phase = newConfig.workflow.phases[phaseIndex];
    const newStep = {
      name: `新步骤 ${phase.steps.length + 1}`,
      agent: agentConfigs.length > 0 ? agentConfigs[0].name : '',
      task: '',
      role: 'defender',
    };
    phase.steps.push(newStep);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    setIsNewNode(true);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type: 'step' as const, phaseIndex, stepIndex: phase.steps.length - 1 } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleDeletePhase = async (phaseIndex: number) => {
    if (!editingConfig) return;
    const ok = await confirm({
      title: '确认删除阶段',
      description: `确定要删除阶段 "${editingConfig.workflow.phases[phaseIndex].name}" 吗？`,
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    newConfig.workflow.phases.splice(phaseIndex, 1);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleDeleteStep = async (phaseIndex: number, stepIndex: number) => {
    if (!editingConfig) return;
    const step = editingConfig.workflow.phases[phaseIndex].steps[stepIndex];
    const ok = await confirm({
      title: '确认删除步骤',
      description: `确定要删除步骤 "${step.name}" 吗？`,
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    newConfig.workflow.phases[phaseIndex].steps.splice(stepIndex, 1);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleAddStepAt = (phaseIndex: number, afterStepIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const phase = newConfig.workflow.phases[phaseIndex];
    const newStep = {
      name: `新步骤 ${phase.steps.length + 1}`,
      agent: agentConfigs.length > 0 ? agentConfigs[0].name : '',
      task: '',
      role: 'defender',
    };
    phase.steps.splice(afterStepIndex + 1, 0, newStep);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    setIsNewNode(true);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type: 'step' as const, phaseIndex, stepIndex: afterStepIndex + 1 } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleMoveStep = (phaseIndex: number, fromIndex: number, toIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const steps = newConfig.workflow.phases[phaseIndex].steps;
    if (toIndex < 0 || toIndex >= steps.length) return;
    const [moved] = steps.splice(fromIndex, 1);
    steps.splice(toIndex, 0, moved);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleToggleParallel = (phaseIndex: number, stepIndices: number[]) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const steps = newConfig.workflow.phases[phaseIndex].steps;
    // Reuse existing group ID if any target step is already in a group
    let groupId = stepIndices.map((si: number) => steps[si]?.parallelGroup).find((pg: string | undefined) => pg != null);
    if (!groupId) groupId = `parallel-${Date.now()}`;
    stepIndices.forEach((si: number) => {
      if (steps[si]) steps[si].parallelGroup = groupId;
    });
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleUngroup = (phaseIndex: number, stepIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const steps = newConfig.workflow.phases[phaseIndex].steps;
    const groupId = steps[stepIndex]?.parallelGroup;
    if (!groupId) return;
    steps.forEach((s: any) => { if (s.parallelGroup === groupId) delete s.parallelGroup; });
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleCrossPhaseMove = (fromPhase: number, fromIndex: number, toPhase: number, toIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const sourceSteps = newConfig.workflow.phases[fromPhase].steps;
    const targetSteps = newConfig.workflow.phases[toPhase].steps;
    const [moved] = sourceSteps.splice(fromIndex, 1);
    delete moved.parallelGroup;
    targetSteps.splice(Math.min(toIndex, targetSteps.length), 0, moved);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleMoveGroup = (fromPhase: number, groupStartIndex: number, toPhase: number, toIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const sourceSteps = newConfig.workflow.phases[fromPhase].steps;
    const groupId = sourceSteps[groupStartIndex]?.parallelGroup;
    if (!groupId) return;
    const groupSteps: any[] = [];
    let i = groupStartIndex;
    while (i < sourceSteps.length && sourceSteps[i].parallelGroup === groupId) {
      groupSteps.push(sourceSteps[i]);
      i++;
    }
    sourceSteps.splice(groupStartIndex, groupSteps.length);
    const targetSteps = fromPhase === toPhase ? sourceSteps : newConfig.workflow.phases[toPhase].steps;
    let insertAt = Math.min(toIndex, targetSteps.length);
    if (fromPhase === toPhase && toIndex > groupStartIndex) {
      insertAt = Math.max(0, toIndex - groupSteps.length);
    }
    targetSteps.splice(insertAt, 0, ...groupSteps);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleJoinGroup = (phaseIndex: number, stepIndex: number, groupId: string) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const step = newConfig.workflow.phases[phaseIndex].steps[stepIndex];
    if (step) step.parallelGroup = groupId;
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleSaveConfig = async () => {
    if (!editingConfig) return;
    setSaving(true);
    try {
      await configApi.saveConfig(configFile, editingConfig);
      toast('success', '配置已保存，下次运行时生效');
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: editingConfig });
    } catch (error: any) {
      toast('error', '保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAgent = async (agent: any) => {
    try {
      await agentApi.saveAgent(agent.name, agent);
      // Reload agents
      const { agents: updatedAgents } = await agentApi.listAgents();
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: updatedAgents });
    } catch (error: any) {
      toast('error', '保存 Agent 失败: ' + error.message);
    }
  };

  const handleDeleteAgent = async (name: string) => {
    try {
      await agentApi.deleteAgent(name);
      const { agents: updatedAgents } = await agentApi.listAgents();
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: updatedAgents });
    } catch (error: any) {
      toast('error', '删除 Agent 失败: ' + error.message);
    }
  };

  const getEditingNodeData = () => {
    if (!editingNode || !editingConfig) return null;
    if (editingNode.type === 'phase') return editingConfig.workflow.phases[editingNode.phaseIndex];
    if (editingNode.stepIndex !== undefined) return editingConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex];
    return null;
  };

  if (pageLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4">
        <span className="material-symbols-outlined text-4xl text-primary animate-spin">progress_activity</span>
        <p className="text-sm text-muted-foreground">加载工作流配置...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4">
        <span className="material-symbols-outlined text-4xl text-destructive">error</span>
        <p className="text-sm text-destructive">{loadError}</p>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/">返回首页</Link></Button>
          <Button onClick={loadWorkflowConfig}>重试</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background/80 text-foreground">
      <div className="shrink-0 bg-muted border-b flex flex-wrap items-center px-4 py-2 gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" asChild><Link href="/">
            <span className="material-symbols-outlined text-sm">arrow_back</span><span className="hidden sm:inline"> 首页</span>
          </Link></Button>
          <h1 className="text-sm sm:text-base font-semibold m-0 flex items-center gap-1.5 truncate max-w-[120px] sm:max-w-[200px] md:max-w-none">
            <span className="material-symbols-outlined text-lg sm:text-xl shrink-0">bolt</span>
            <span className="truncate">{workflowConfig?.workflow?.name || configFile}</span>
          </h1>
        </div>
        <div className="flex gap-0.5 bg-background/50 rounded-md p-0.5 shrink-0">
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${viewMode === 'run' ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'run' })}>
            <span className="material-symbols-outlined text-sm">play_arrow</span><span className="hidden sm:inline ml-1">运行</span>
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${viewMode === 'design' ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'design' })}>
            <span className="material-symbols-outlined text-sm">edit</span><span className="hidden sm:inline ml-1">设计</span>
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${viewMode === 'history' ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'history' })}>
            <span className="material-symbols-outlined text-sm">history</span><span className="hidden sm:inline ml-1">历史</span>
          </Button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {viewMode === 'run' && (<>
            <Button size="sm" onClick={startWorkflow} disabled={starting || isRunning}>
              <span className={`material-symbols-outlined text-sm mr-1 ${starting ? 'animate-spin' : ''}`}>{starting ? 'sync' : 'play_arrow'}</span>
              <span className="hidden sm:inline">{starting ? '启动中...' : '启动工作流'}</span>
              <span className="sm:hidden">{starting ? '...' : '启动'}</span>
            </Button>
            <Button variant="destructive" size="sm" onClick={stopWorkflow} disabled={!isRunning}>
              <span className="material-symbols-outlined text-sm">stop</span><span className="hidden sm:inline">停止</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: !showProcessPanel })}>
              <span className="material-symbols-outlined text-sm">settings</span><span className="hidden sm:inline">进程</span>
            </Button>
          </>)}
          {viewMode === 'design' && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleSaveConfig} disabled={saving}>
              <span className={`material-symbols-outlined text-sm mr-1 ${saving ? 'animate-spin' : ''}`}>{saving ? 'sync' : 'save'}</span>
              {saving ? '保存中...' : '保存配置'}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {workflowStatus === 'idle' && (
            <Badge variant="secondary"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          {workflowStatus === 'running' && (
            <Badge className="bg-blue-500/20 text-blue-400"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          {workflowStatus === 'completed' && (
            <Badge className="bg-green-500/20 text-green-400"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          {(workflowStatus === 'failed' || workflowStatus === 'stopped' || workflowStatus === 'crashed') && (
            <Badge className="bg-red-500/20 text-red-400"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          <ThemeToggle />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'run' && (<>
          <div className="w-[280px] bg-card border-r flex flex-col">
            <Tabs value={activeTab} onValueChange={(val) => dispatch({ type: 'SET_ACTIVE_TAB', payload: val })}>
              <TabsList className="w-full rounded-none border-b">
                <TabsTrigger value="workflow" className="flex-1 flex items-center justify-center gap-1 text-xs">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>monitoring</span>工作流
                </TabsTrigger>
                <TabsTrigger value="agents" className="flex-1 flex items-center justify-center gap-1 text-xs">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>smart_toy</span>Agents
                </TabsTrigger>
                <TabsTrigger value="config" className="flex-1 flex items-center justify-center gap-1 text-xs">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>settings</span>配置
                </TabsTrigger>
              </TabsList>
              <div className="flex-1 overflow-y-auto p-4">
                <TabsContent value="workflow" className="mt-0">
                  {workflowConfig && (
                    <div>
                      <div>
                        {editingName ? (
                          <Input autoFocus value={nameValue}
                            onChange={(e) => setNameValue(e.target.value)}
                            onBlur={() => saveWorkflowName(nameValue)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveWorkflowName(nameValue); if (e.key === 'Escape') setEditingName(false); }}
                          />
                        ) : (
                          <h3 className="text-base font-semibold mb-2 cursor-pointer border-b border-dashed border-transparent hover:border-muted-foreground"
                            onClick={() => { setNameValue(workflowConfig.workflow.name); setEditingName(true); }}
                            title="点击编辑名称">{workflowConfig.workflow.name}</h3>
                        )}
                        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{workflowConfig.workflow.description}</p>
                        <div className="flex gap-3">
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">阶段</span><span className="block text-xl font-semibold">{workflowConfig.workflow.phases.length}</span></div>
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">步骤</span><span className="block text-xl font-semibold">{totalSteps}</span></div>
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">Agent</span><span className="block text-xl font-semibold">{agentConfigs.length}</span></div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 mt-4">
                        {workflowConfig.workflow.phases.map((phase: any, idx: number) => {
                          const phaseAgents = phase.steps.map((s: any) => {
                            const role = agentConfigs.find((r: any) => r.name === s.agent);
                            return { name: s.agent, team: role?.team || 'blue', role: s.role };
                          });
                          const iterState = iterationStates[phase.name];
                          return (<div key={idx} className="bg-muted rounded-md p-2.5">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-medium">{phase.name}</span>
                              {phase.iteration?.enabled && (<Badge><span className="material-symbols-outlined text-xs">loop</span> {iterState ? `${iterState.currentIteration}/${iterState.maxIterations}` : `max ${phase.iteration.maxIterations}`}</Badge>)}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {phaseAgents.map((a: any, i: number) => (
                                <Badge key={i} variant="outline" className={`text-[10px] ${a.team === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : a.team === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/30' : a.team === 'judge' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : ''}`}>
                                  <span className="material-symbols-outlined text-xs">{a.role === 'attacker' ? 'swords' : a.role === 'judge' ? 'gavel' : 'shield'}</span> {a.name}
                                </Badge>
                              ))}
                            </div>
                          </div>);
                        })}
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="agents" className="mt-0"><div className="flex flex-col gap-2">
                  {agents.map((agent) => (<div key={agent.name}
                    className={`bg-muted p-3 rounded-md cursor-pointer transition-colors hover:bg-accent border-l-[3px] border-transparent ${selectedAgent?.name === agent.name ? 'border-l-primary bg-accent' : ''}`}
                    onClick={() => dispatch({ type: 'SET_SELECTED_AGENT', payload: agent })}>
                    <div className="flex items-center gap-2 mb-1.5"><span className="material-symbols-outlined text-lg">smart_toy</span><span className="text-sm font-medium">{agent.name}</span></div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={`w-2 h-2 rounded-full ${agent.status === 'running' ? 'bg-blue-500 animate-pulse' : agent.status === 'completed' ? 'bg-green-500' : agent.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'}`} />{agent.status}</div>
                  </div>))}
                </div></TabsContent>
                <TabsContent value="config" className="mt-0"><div><h4 className="text-sm font-semibold mb-4">项目配置</h4>
                  <div className="mb-4"><Label>项目根目录</Label>
                    <Input value={projectRoot} onChange={(e) => dispatch({ type: 'SET_PROJECT_ROOT', payload: e.target.value })} type="text" placeholder="../cangjie_compiler" /></div>
                  <div className="mb-4"><Label>需求描述</Label>
                    <Textarea value={requirements} onChange={(e) => dispatch({ type: 'SET_REQUIREMENTS', payload: e.target.value })} rows={6} placeholder="请输入需求描述..." /></div>
                  <div className="mb-4"><Label>步骤超时（分钟）</Label>
                    <Input value={timeoutMinutes} onChange={(e) => dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: Math.max(1, parseInt(e.target.value) || 1) })} type="number" min={1} /></div>
                  <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={saveConfig} disabled={saving}>
                    <span className={`material-symbols-outlined text-sm mr-1 ${saving ? 'animate-spin' : ''}`}>{saving ? 'sync' : 'save'}</span>
                    {saving ? '保存中...' : '保存配置'}
                  </Button>
                </div></TabsContent>
              </div>
            </Tabs>
          </div>
          <div className="flex-1 flex flex-col border-r">
            <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">工作流可视化</h2></div>
            <div className="flex-1 overflow-auto">
              {workflowConfig ? (<FlowDiagram workflow={workflowConfig.workflow} currentPhase={currentPhase} currentStep={currentStep}
                agents={agents} completedSteps={completedSteps} failedSteps={failedSteps} iterationStates={iterationStates} onSelectStep={selectStep} />
              ) : (<div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">monitoring</span><p>加载中...</p></div>)}
            </div>
          </div>
          <div className="w-[400px] flex flex-col">
            <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">{selectedStep ? selectedStep.name : selectedAgent ? selectedAgent.name : 'Agent 详情'}</h2></div>
            <div className="flex-1 overflow-auto">
              {selectedStep && (
                <div className="bg-muted border-b p-3.5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="material-symbols-outlined text-base">
                      {selectedStep.role === 'attacker' ? 'swords' : selectedStep.role === 'judge' ? 'gavel' : 'shield'}
                    </span>
                    <span className="text-sm font-semibold flex-1">{selectedStep.name}</span>
                    {selectedRoleConfig && (
                      <Badge className={selectedRoleConfig.team === 'blue' ? 'bg-blue-500/20 text-blue-400' : selectedRoleConfig.team === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}>{selectedRoleConfig.team}</Badge>
                    )}
                  </div>
                  <div className="mb-2.5">
                    <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">任务描述</div>
                    <div className="text-sm leading-relaxed">{selectedStep.task}</div>
                  </div>
                  {selectedStep.constraints?.length > 0 && (
                    <div className="mb-2.5">
                      <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">约束条件</div>
                      <ul className="list-disc pl-4 text-xs leading-relaxed">
                        {selectedStep.constraints.map((c: string, i: number) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedRoleConfig && (
                    <div className="border-t pt-2.5">
                      <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">Agent 配置</div>
                      <div className="flex gap-2 items-center mb-1.5">
                        <span className="text-xs text-muted-foreground">模型</span>
                        <span className="text-xs font-mono">{selectedRoleConfig.model || '-'}</span>
                      </div>
                      {selectedRoleConfig.temperature !== undefined && (
                        <div className="flex gap-2 items-center mb-1.5">
                          <span className="text-xs text-muted-foreground">Temperature</span>
                          <span className="text-xs font-mono">{selectedRoleConfig.temperature}</span>
                        </div>
                      )}
                      {selectedRoleConfig.capabilities?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedRoleConfig.capabilities.map((cap: string, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs">{cap}</Badge>
                          ))}
                        </div>
                      )}
                      {selectedRoleConfig.constraints?.length > 0 && (
                        <div className="mb-2.5">
                          <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">Agent 约束</div>
                          <ul className="list-disc pl-4 text-xs leading-relaxed">
                            {selectedRoleConfig.constraints.map((c: string, i: number) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedRoleConfig.systemPrompt && (
                        <div className="mt-1.5">
                          <Button variant="link" size="sm" className="p-0 h-auto text-xs" onClick={() => setShowSystemPrompt(!showSystemPrompt)}>
                            {showSystemPrompt ? '▼' : '▶'} System Prompt
                          </Button>
                          {showSystemPrompt && (
                            <pre className="bg-background border rounded p-2 text-xs leading-relaxed max-h-[200px] overflow-y-auto mt-1.5 whitespace-pre-wrap break-words font-mono">{selectedRoleConfig.systemPrompt}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {selectedStep && stepResults[selectedStep.name] && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">
                    {stepResults[selectedStep.name].error ? (<><span className="material-symbols-outlined text-xs text-red-400">error</span> 执行错误</>) : (<><span className="material-symbols-outlined text-xs text-green-400">check_circle</span> 执行结果</>)}
                  </div>
                  {stepResults[selectedStep.name].costUsd !== undefined && (
                    <div className="text-[11px] text-muted-foreground mb-1.5">
                      费用: ${stepResults[selectedStep.name].costUsd?.toFixed(4)}
                      {stepResults[selectedStep.name].durationMs ? ` · 耗时: ${(stepResults[selectedStep.name].durationMs! / 1000).toFixed(1)}s` : ''}
                    </div>
                  )}
                  {stepResults[selectedStep.name].error ? (
                    <pre className="bg-background border border-red-500 rounded p-2 text-xs leading-relaxed max-h-[200px] overflow-y-auto mt-1.5 whitespace-pre-wrap break-words font-mono text-red-400">
                      {stepResults[selectedStep.name].error}
                    </pre>
                  ) : (() => {
                    const raw = fullStepOutput || stepResults[selectedStep.name].output;
                    const displayText = !fullStepOutput && raw.length > 2000
                      ? raw.substring(0, 2000) + '\n\n...(已截断)'
                      : raw;
                    const chunks = displayText.split(CHUNK_SEP).filter(Boolean);
                    return (
                      <>
                        <div className={`${styles.markdownContent} bg-background border rounded p-2 text-sm leading-relaxed max-h-[200px] overflow-y-auto mt-1.5`}>
                          {chunks.map((chunk, i) => (
                            <div key={i} className={i < chunks.length - 1 ? 'border-b border-border/50 pb-3 mb-3' : ''}>
                              <Markdown>{chunk}</Markdown>
                            </div>
                          ))}
                        </div>
                        {!fullStepOutput && stepResults[selectedStep.name].output.length > 2000 && (runId || selectedRun?.id) && (
                          <Button variant="secondary" size="sm" className="mt-1.5 text-[11px]"
                            onClick={() => loadFullOutput(selectedStep.name)}
                            disabled={loadingOutput}>
                            {loadingOutput ? '加载中...' : (<><span className="material-symbols-outlined text-xs">description</span> 查看完整输出</>)}
                          </Button>
                        )}
                      </>
                    );
                  })()}
                  {!stepResults[selectedStep.name].error && (
                    <Button variant="secondary" size="sm" className="mt-1.5 text-[11px]"
                      onClick={() => openMarkdownModal(selectedStep.name)}>
                      查看 Markdown
                    </Button>
                  )}
                </div>
              )}
              {/* Resume button on failed/crashed step */}
              {selectedStep && failedSteps.includes(selectedStep.name) && !isRunning && (runId || selectedRun?.id) && (
                <div className="bg-muted border-b p-3.5">
                  <Button className="bg-green-600 hover:bg-green-700 text-white text-xs w-full" onClick={() => resumeWorkflow()} disabled={isRunning}>
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    从此步骤恢复运行
                  </Button>
                  <div className="text-[11px] text-muted-foreground mt-1.5">
                    将跳过已完成的 {completedSteps.length} 个步骤，从「{selectedStep.name}」重新开始执行
                  </div>
                </div>
              )}
              {/* Resume button when viewing crashed/stopped run without specific step selected */}
              {!selectedStep && !isRunning && (workflowStatus === 'failed' || workflowStatus === 'stopped') && (runId || selectedRun?.id) && (
                <div className="bg-muted border-b p-3.5">
                  <Button className="bg-green-600 hover:bg-green-700 text-white text-xs w-full" onClick={() => resumeWorkflow()} disabled={isRunning}>
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    恢复运行
                  </Button>
                  <div className="text-[11px] text-muted-foreground mt-1.5">
                    已完成 {completedSteps.length} 步，将从中断处继续
                  </div>
                </div>
              )}
              {/* Live stream button for currently running step */}
              {selectedStep && currentStep === selectedStep.name && isRunning && !stepResults[selectedStep.name] && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider"><span className="material-symbols-outlined text-xs">sync</span> 正在执行中...</div>
                  <div className="flex gap-2 mt-1.5">
                    <Button size="sm" className="text-xs" onClick={startLiveStream}>
                      <span className="material-symbols-outlined text-sm">cell_tower</span> 查看实时输出
                    </Button>
                    <Button size="sm" variant="secondary" className="text-xs" onClick={forceCompleteStep}>
                      <span className="material-symbols-outlined text-sm">done</span> 完成
                    </Button>
                  </div>
                </div>
              )}
              {/* Also show live stream button when step has no result and is running */}
              {isRunning && !selectedStep && currentStep && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider"><span className="material-symbols-outlined text-xs">sync</span> 当前步骤: {currentStep}</div>
                  <div className="flex gap-2 mt-1.5">
                    <Button size="sm" className="text-xs" onClick={startLiveStream}>
                      <span className="material-symbols-outlined text-sm">cell_tower</span> 查看实时输出
                    </Button>
                    <Button size="sm" variant="secondary" className="text-xs" onClick={forceCompleteStep}>
                      <span className="material-symbols-outlined text-sm">done</span> 完成
                    </Button>
                  </div>
                </div>
              )}
              {selectedAgent ? (<AgentPanel agent={selectedAgent} logs={logs} onClearLogs={(name) => dispatch({ type: 'CLEAR_AGENT_LOGS', payload: name })}
                stepSummary={selectedStep && stepResults[selectedStep.name]?.output ? stepResults[selectedStep.name].output : undefined} />
              ) : (<div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">smart_toy</span><p>选择一个 Agent 查看详情</p></div>)}
            </div>
          </div>
        </>)}
        {viewMode === 'design' && editingConfig && (<>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0">
              <div className="h-10 bg-muted border-b flex items-center px-4 min-w-0 overflow-hidden">
                <h2 className="text-sm font-semibold m-0 truncate min-w-0">工作流设计</h2>
              </div>
              <div className="flex-1 overflow-hidden"><DesignPanel workflow={editingConfig.workflow}
                onSelectNode={handleSelectNode}
                onAddPhase={handleAddPhase}
                onAddStep={handleAddStep}
                onAddStepAt={handleAddStepAt}
                onDeletePhase={handleDeletePhase}
                onDeleteStep={handleDeleteStep}
                onMoveStep={handleMoveStep}
                onToggleParallel={handleToggleParallel}
                onUngroup={handleUngroup}
                onCrossPhaseMove={handleCrossPhaseMove}
                onMoveGroup={handleMoveGroup}
                onJoinGroup={handleJoinGroup} /></div>
            </div>
          </div>
          {/* Floating Agent config button */}
          <button
            className="fixed right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
            onClick={() => setShowAgentDrawer(!showAgentDrawer)}
            title="Agent 配置"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>smart_toy</span>
          </button>
          {/* Agent config drawer */}
          {showAgentDrawer && (
            <div className="fixed inset-0 z-40" onClick={() => setShowAgentDrawer(false)}>
              <div className="absolute inset-0 bg-black/20" />
              <div className="absolute top-0 right-0 h-full w-[400px] max-w-[90vw] bg-card border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
                onClick={(e) => e.stopPropagation()}>
                <div className="h-10 bg-muted border-b flex items-center px-4 justify-between shrink-0">
                  <h2 className="text-sm font-semibold m-0">Agent 配置</h2>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowAgentDrawer(false)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <AgentConfigPanel agents={agentConfigs} onSaveAgent={handleSaveAgent} onDeleteAgent={handleDeleteAgent} />
                </div>
              </div>
            </div>
          )}
        </>)}
        {viewMode === 'history' && (<div className="flex-1 flex overflow-hidden">
          <div className="w-[280px] bg-card border-r flex flex-col">
            <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">运行记录</h2></div>
            <div className="flex-1 overflow-y-auto p-4">
              {historyRuns.length === 0 ? (
                <div className="text-muted-foreground text-sm text-center p-5">暂无运行记录</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {historyRuns.map((run) => (
                    <div key={run.id}
                      className={`bg-muted p-3 rounded-md cursor-pointer transition-colors hover:bg-accent border-l-[3px] border-transparent ${selectedRun?.id === run.id ? 'border-l-primary bg-accent' : ''}`}
                      onClick={() => { setSelectedRun(run); viewHistoryRun(run.id); }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="material-symbols-outlined text-lg">
                          {run.status === 'completed' ? 'check_circle' : run.status === 'failed' || run.status === 'crashed' ? 'error' : run.status === 'stopped' ? 'stop_circle' : 'sync'}
                        </span>
                        <span className="text-sm font-medium">{run.id}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{
                          background: run.status === 'completed' ? '#6a8759' : run.status === 'failed' || run.status === 'crashed' ? '#c75450' : run.status === 'stopped' ? '#cc7832' : '#4a88c7',
                        }}></span>
                        {run.status === 'crashed' ? '崩溃' : run.status === 'completed' ? '完成' : run.status === 'failed' ? '失败' : run.status === 'stopped' ? '已停止' : '运行中'}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {new Date(run.startTime).toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {run.phaseReached ? `阶段: ${run.phaseReached}` : ''} · {run.completedSteps}/{run.totalSteps} 步
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 flex flex-col border-r">
            <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">{selectedRun ? `运行详情 - ${selectedRun.id}` : '运行历史'}</h2></div>
            <div className="flex-1 overflow-auto">
              {!selectedRun ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">history</span><p>选择一条运行记录查看详情</p></div>
              ) : !runDetail ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">description</span><p>无详细状态数据</p></div>
              ) : (
                <div className="p-4">
                  <div className="flex gap-3 mb-4 flex-wrap">
                    {[
                      { label: '状态', value: runDetail.status, color: runDetail.status === 'completed' ? '#6a8759' : runDetail.status === 'failed' || runDetail.status === 'crashed' ? '#c75450' : '#cc7832' },
                      { label: '开始', value: new Date(runDetail.startTime).toLocaleString() },
                      { label: '结束', value: runDetail.endTime ? new Date(runDetail.endTime).toLocaleString() : '-' },
                      { label: '阶段', value: runDetail.currentPhase || '-' },
                      { label: '完成步骤', value: `${runDetail.completedSteps?.length || 0}` },
                    ].map((item, i) => (
                      <div key={i} className="bg-muted p-3 rounded-md text-center min-w-[120px]">
                        <span className="block text-xs text-muted-foreground mb-1">{item.label}</span>
                        <span className="block text-sm font-semibold" style={{ color: item.color }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  {(runDetail.status === 'crashed' || runDetail.status === 'failed' || runDetail.status === 'stopped') && (
                    <div className="mb-4">
                      {runDetail.statusReason && (
                        <div className={`rounded-md p-3 mb-3 border-l-[3px] ${runDetail.status === 'crashed' ? 'bg-red-500/10 border-l-red-500' : 'bg-yellow-500/10 border-l-yellow-500'}`}>
                          <div className={`text-sm font-semibold mb-1 ${runDetail.status === 'crashed' ? 'text-red-400' : 'text-yellow-400'}`}>
                            <span className="material-symbols-outlined text-sm">{runDetail.status === 'crashed' ? 'explosion' : runDetail.status === 'failed' ? 'error' : 'stop_circle'}</span>
                            {runDetail.status === 'crashed' ? ' 崩溃原因' : runDetail.status === 'failed' ? ' 失败原因' : ' 停止原因'}
                          </div>
                          <div className="text-xs leading-relaxed">{runDetail.statusReason}</div>
                        </div>
                      )}
                      {!runDetail.statusReason && runDetail.status === 'crashed' && (
                        <div className="bg-red-500/10 border-l-[3px] border-l-red-500 rounded-md p-3 mb-3">
                          <div className="text-sm font-semibold mb-1 text-red-400"><span className="material-symbols-outlined text-sm">explosion</span> 崩溃原因</div>
                          <div className="text-xs">服务重启或进程意外终止，运行被标记为崩溃。</div>
                        </div>
                      )}
                      <Button className="bg-green-600 hover:bg-green-700 text-white text-sm" onClick={() => resumeWorkflow(selectedRun.id)} disabled={isRunning}>
                        <span className="material-symbols-outlined text-sm">refresh</span>
                        从此处恢复运行 ({runDetail.completedSteps?.length || 0} 步已完成，跳过已完成步骤继续执行)
                      </Button>
                    </div>
                  )}
                  {runDetail.agents?.length > 0 && (<>
                    <h3 className="text-sm font-semibold mt-4 mb-2">Agent 状态</h3>
                    <div className="flex flex-col gap-1.5">
                      {runDetail.agents.map((agent: any, i: number) => (
                        <div key={i} className="bg-muted rounded-md p-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="material-symbols-outlined text-sm">
                              {agent.status === 'completed' ? 'check_circle' : agent.status === 'failed' ? 'error' : agent.status === 'running' ? 'sync' : 'hourglass_empty'}
                            </span>
                            <span className="text-sm font-medium flex-1">{agent.name}</span>
                            <Badge variant="outline" className={`text-[10px] ${agent.team === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : agent.team === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'}`}>{agent.team}</Badge>
                          </div>
                          <div className="flex gap-4 text-[11px] text-muted-foreground">
                            <span>模型: {agent.model}</span>
                            <span>完成: {agent.completedTasks} 任务</span>
                            <span>迭代: {agent.iterationCount}</span>
                            {agent.costUsd > 0 && <span>费用: ${agent.costUsd.toFixed(4)}</span>}
                            {(agent.tokenUsage?.inputTokens > 0 || agent.tokenUsage?.outputTokens > 0) && (
                              <span>Token: {agent.tokenUsage.inputTokens}↓ {agent.tokenUsage.outputTokens}↑</span>
                            )}
                          </div>
                          {agent.summary && (
                            <div className={`${styles.markdownContent} text-xs mt-1 leading-relaxed`}><Markdown>{agent.summary}</Markdown></div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>)}
                  {runDetail.completedSteps?.length > 0 && (<>
                    <h3 className="text-sm font-semibold mt-4 mb-2">完成的步骤</h3>
                    <div className="flex flex-wrap gap-1">
                      {runDetail.completedSteps.map((step: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs bg-green-500/20 text-green-400">{step}</Badge>
                      ))}
                    </div>
                  </>)}
                  {Object.keys(runDetail.iterationStates || {}).length > 0 && (<>
                    <h3 className="text-sm font-semibold mt-4 mb-2">迭代状态</h3>
                    {Object.entries(runDetail.iterationStates).map(([phase, iter]: [string, any]) => (
                      <div key={phase} className="bg-muted rounded-md p-2.5 mb-1.5">
                        <div className="text-sm font-medium">{phase}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          迭代: {iter.currentIteration}/{iter.maxIterations} · 连续无 Bug: {iter.consecutiveCleanRounds} 轮 · 状态: {iter.status}
                        </div>
                        {iter.bugsFoundPerRound?.length > 0 && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            每轮 Bug 数: [{iter.bugsFoundPerRound.join(', ')}]
                          </div>
                        )}
                      </div>
                    ))}
                  </>)}
                </div>
              )}
            </div>
          </div>
        </div>)}
      </div>

      {showProcessPanel && (<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><div className="bg-card rounded-lg w-[90%] max-w-[1200px] h-[80%] border relative overflow-hidden">
        <ProcessPanel onClose={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: false })} />
      </div></div>)}
      {editingNode && (<EditNodeModal isOpen={showEditNodeModal} type={editingNode.type} data={getEditingNodeData()} roles={agentConfigs}
        isNew={isNewNode}
        existingPhases={editingConfig?.workflow?.phases || []}
        existingSteps={editingConfig?.workflow?.phases?.flatMap((p: any) => p.steps) || []}
        onClose={() => { dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false }); dispatch({ type: 'SET_EDITING_NODE', payload: null }); setIsNewNode(false); }}
        onSave={handleSaveNode} onDelete={handleDeleteNode} />)}
      {showCheckpoint && (<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false })}>
        <div className="bg-card rounded-lg w-[500px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
          <div className="p-5 border-b"><h3 className="text-lg font-semibold"><span className="material-symbols-outlined text-lg mr-2 align-middle">pan_tool</span>人工检查点</h3></div>
          <div className="p-5"><p className="text-sm mb-4 leading-relaxed">{checkpointMessage}</p>
            <div className="bg-muted p-4 rounded-md border-l-[3px] border-l-yellow-500"><p className="text-sm text-muted-foreground mb-2">当前阶段: <strong className="text-foreground">{currentPhase}</strong></p><p className="text-sm text-muted-foreground">请审查工作成果，决定是否继续执行</p></div></div>
          <div className="p-5 border-t flex gap-3 justify-end">
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={approveCheckpoint}><span className="material-symbols-outlined text-sm mr-1">check</span>批准继续</Button>
            {checkpointIsIterative && (
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={iterateCheckpoint}><span className="material-symbols-outlined text-sm mr-1">refresh</span>继续迭代</Button>
            )}
            <Button variant="destructive" onClick={rejectCheckpoint}><span className="material-symbols-outlined text-sm mr-1">close</span>拒绝并停止</Button>
          </div>
        </div>
      </div>)}
      {showLiveStream && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={stopLiveStream}>
          <div className="bg-card rounded-lg border w-[80%] max-w-[800px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold"><span className="material-symbols-outlined text-lg mr-2 align-middle">cell_tower</span>实时输出 {currentStep ? `- ${currentStep}` : ''}</h3>
              <Button variant="secondary" size="sm" onClick={stopLiveStream}>关闭</Button>
            </div>
            <div className="p-5 flex-1 overflow-auto">
              {liveStream.length === 0 ? (
                <div className="text-muted-foreground text-sm text-center py-8">(等待输出...)</div>
              ) : (
                <div className="space-y-3">
                  {liveStream.map((chunk, i) => (
                    <div key={i} className={`${styles.markdownContent} text-sm border-b border-border/50 pb-3 last:border-0`}>
                      <Markdown>{chunk}</Markdown>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {markdownModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setMarkdownModal(null)}>
          <div className="bg-card rounded-lg border w-[80%] max-w-[900px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold">{markdownModal.title}</h3>
              <Button variant="ghost" size="icon" onClick={() => setMarkdownModal(null)}>
                <span className="material-symbols-outlined">close</span>
              </Button>
            </div>
            <div className="p-5 flex-1 overflow-auto">
              {markdownModal.chunks.length > 1 ? (
                <div className="space-y-3">
                  {markdownModal.chunks.map((chunk, i) => (
                    <div key={i} className={`${styles.markdownContent} text-sm border-b border-border/50 pb-3 last:border-0`}>
                      <Markdown>{chunk}</Markdown>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.markdownContent}>
                  <Markdown>{markdownModal.chunks[0]}</Markdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
    </div>
  );
}