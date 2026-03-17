'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ClipLoader } from 'react-spinners';
import { configApi, workflowApi, agentApi, runsApi, processApi, streamApi } from '@/lib/api';
import { useWorkflowState } from '@/hooks/useWorkflowState';
import type { ViewMode } from '@/hooks/useWorkflowState';
import FlowDiagram from '@/components/FlowDiagram';
import StateMachineDiagram from '@/components/StateMachineDiagram';
import StateMachineDesignPanel from '@/components/StateMachineDesignPanel';
import StateMachineExecutionView from '@/components/StateMachineExecutionView';
import DesignPanel from '@/components/DesignPanel';
import AgentPanel from '@/components/AgentPanel';
import AgentConfigPanel from '@/components/AgentConfigPanel';
import EditNodeModal from '@/components/EditNodeModal';
import ProcessPanel from '@/components/ProcessPanel';
import DocumentsPanel from '@/components/DocumentsPanel';
import Markdown from '@/components/Markdown';
import ResizablePanels from '@/components/ResizablePanels';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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

  // 格式化状态名称
  const formatStateName = (name: string) => {
    if (name === '__origin__') return '开始';
    if (name === '__human_approval__') return '人工审查';
    return name;
  };

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
  const [focusedState, setFocusedState] = useState<string | null>(null); // 用于流程图视图跳转
  const [runDetail, setRunDetail] = useState<any>(null);
  const [viewingHistoryRun, setViewingHistoryRun] = useState(false);
  const [pendingCheckpointPhase, setPendingCheckpointPhase] = useState<string | null>(null);
  const [fullStepOutput, setFullStepOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ title: string; chunks: string[] } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [smStateHistory, setSmStateHistory] = useState<any[]>([]);
  const [smIssueTracker, setSmIssueTracker] = useState<any[]>([]);
  const [smTransitionCount, setSmTransitionCount] = useState(0);
  const [runStartTime, setRunStartTime] = useState<string | null>(null);
  const [runEndTime, setRunEndTime] = useState<string | null>(null);
  const [humanApprovalData, setHumanApprovalData] = useState<{
    currentState: string;
    nextState: string;
    result: any;
    availableStates: string[];
  } | null>(null);
  const [liveStream, setLiveStream] = useState<string[]>([]);
  const [showLiveStream, setShowLiveStream] = useState(false);
  const [liveStreamFullscreen, setLiveStreamFullscreen] = useState(false);
  const [isNewNode, setIsNewNode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);
  const [starting, setStarting] = useState(false);
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const [showDesignRequirements, setShowDesignRequirements] = useState(true);
  const [showRunRequirements, setShowRunRequirements] = useState(true);
  const [iterationFeedback, setIterationFeedback] = useState('');
  const [pendingPlanQuestion, setPendingPlanQuestion] = useState<{ question: string; fromAgent: string; round: number } | null>(null);
  const [supervisorFlow, setSupervisorFlow] = useState<{
    type: 'question' | 'decision';
    from: string;
    to: string;
    question?: string;
    method?: string;
    round: number;
    timestamp: string;
  }[]>([]);
  const [currentPlanRound, setCurrentPlanRound] = useState<number>(0);
  const [planAnswer, setPlanAnswer] = useState('');
  const [sendingPlanAnswer, setSendingPlanAnswer] = useState(false);
  const [liveStreamFeedback, setLiveStreamFeedback] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [inlineFeedbacks, setInlineFeedbacks] = useState<{ message: string; timestamp: string; streamIndex: number }[]>([]);
  const [showContextEditor, setShowContextEditor] = useState(false);
  const [showPromptAnalysis, setShowPromptAnalysis] = useState(false);
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<any[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<{ totalSteps: number; avgScore: number } | null>(null);
  const [selectedOptimizations, setSelectedOptimizations] = useState<Set<number>>(new Set());
  const [applyingOptimization, setApplyingOptimization] = useState(false);
  const [editingContextScope, setEditingContextScope] = useState<'global' | 'phase'>('global');
  const [editingContextPhase, setEditingContextPhase] = useState('');
  const [editingContextValue, setEditingContextValue] = useState('');
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showSkillSelector, setShowSkillSelector] = useState(false);
  const [designTab, setDesignTab] = useState<'workflow' | 'config'>('workflow');
  const [forceTransitionModal, setForceTransitionModal] = useState<{ targetState: string; instruction: string } | null>(null);
  const liveStreamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveStreamLenRef = useRef(0);
  const liveStreamStepRef = useRef<string>('');
  const liveStreamScrollRef = useRef<HTMLDivElement | null>(null);
  const LIVE_STREAM_PAGE_SIZE = 30;
  const [liveStreamVisibleCount, setLiveStreamVisibleCount] = useState(LIVE_STREAM_PAGE_SIZE);
  const liveStreamUserScrolledUp = useRef(false);
  const {
    viewMode, workflowConfig, editingConfig, agentConfigs,
    workflowStatus, runId, currentPhase, currentStep, agents, logs, completedSteps, failedSteps,
    showCheckpoint, checkpointMessage, checkpointIsIterative, activeTab, selectedAgent, selectedStep,
    projectRoot, requirements, timeoutMinutes, skills, showProcessPanel,
    showEditNodeModal, editingNode, iterationStates, stepResults,
    globalContext, phaseContexts,
  } = state;

  // Explicitly convert viewMode to string for conditional rendering
  const isDesignMode = state.viewMode === 'design';
  const isRunMode = state.viewMode === 'run';
  const isHistoryMode = state.viewMode === 'history';

  const isRunning = workflowStatus === 'running';
  const totalSteps = workflowConfig?.workflow?.mode === 'state-machine'
    ? (workflowConfig?.workflow?.states?.reduce(
        (sum: number, state: any) => sum + (state.steps?.length ?? 0), 0
      ) ?? 0)
    : (workflowConfig?.workflow?.phases?.reduce(
        (sum: number, phase: any) => sum + phase.steps.length, 0
      ) ?? 0);

  const fetchCurrentStatus = async () => {
    try {
      const status = await workflowApi.getStatus();
      // Only apply status if it's for the current config file
      if (status.status && status.status !== 'idle') {
        // Check if the running workflow is for this config file
        const isForCurrentConfig = !status.currentConfigFile || status.currentConfigFile === configFile;
        if (!isForCurrentConfig) {
          // Running workflow is for a different config, don't apply this status
          return;
        }

        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: status.status });
        if (status.runId) dispatch({ type: 'SET_RUN_ID', payload: status.runId });
        if (status.currentPhase) dispatch({ type: 'SET_CURRENT_PHASE', payload: status.currentPhase });
        if (status.currentStep) dispatch({ type: 'SET_CURRENT_STEP', payload: status.currentStep });
        if (status.agents?.length) dispatch({ type: 'SET_AGENTS', payload: status.agents });
        if (status.completedSteps) dispatch({ type: 'SET_COMPLETED_STEPS', payload: status.completedSteps });
        dispatch({ type: 'SET_FAILED_STEPS', payload: status.failedSteps || [] });

        // Restore contexts
        if (status.globalContext !== undefined) {
          dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: status.globalContext });
        }
        if (status.phaseContexts) {
          dispatch({ type: 'SET_PHASE_CONTEXTS', payload: status.phaseContexts });
        }

        {
          const restoredResults: Record<string, { output: string; error?: string; costUsd?: number; durationMs?: number }> = {};
          if (status.stepLogs?.length) {
            for (const log of status.stepLogs) {
              restoredResults[log.stepName] = {
                output: log.output || '',
                error: log.error || undefined,
                costUsd: log.costUsd || undefined,
                durationMs: log.durationMs || undefined,
              };
            }
          }
          dispatch({ type: 'SET_STEP_RESULTS', payload: restoredResults });
        }
        if (status.iterationStates) {
          Object.entries(status.iterationStates).forEach(([phase, iterState]) => {
            dispatch({ type: 'SET_ITERATION_STATE', payload: { phase, state: iterState as any } });
          });
        }

        // Restore state machine specific data
        if (status.stateHistory) {
          setSmStateHistory(status.stateHistory);
        }
        if (status.issueTracker) {
          setSmIssueTracker(status.issueTracker);
        }
        if (status.transitionCount !== undefined) {
          setSmTransitionCount(status.transitionCount);
        }
        if (status.startTime) {
          setRunStartTime(status.startTime);
        }
        if (status.endTime) {
          setRunEndTime(status.endTime);
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

  const loadContexts = async () => {
    try {
      const contexts = await workflowApi.getContexts();
      if (contexts.globalContext !== undefined) {
        dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: contexts.globalContext });
      }
      if (contexts.phaseContexts) {
        dispatch({ type: 'SET_PHASE_CONTEXTS', payload: contexts.phaseContexts });
      }
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
    loadContexts(); // Load contexts on page load
    if (isRunMode) {
      // 如果正在查看历史运行，不连接实时事件流
      if (viewingHistoryRun) {
        return;
      }
      // 如果 URL 中有 run 参数但还没加载历史数据，等待加载
      if (initialRunId && !runId) {
        return;
      }
      // 否则连接实时事件流
      fetchCurrentStatus();
      const eventSource = workflowApi.connectEventStream((event: any) => {
        // If we receive a live event, we're no longer viewing history
        setViewingHistoryRun(false);
        handleEventRef.current(event);
      });
      eventSource.addEventListener('open', () => {
        fetchCurrentStatus();
      });
      return () => eventSource?.close();
    }
    if (isHistoryMode) {
      loadHistory();
    }
  }, [viewMode, viewingHistoryRun, initialRunId, runId]);

  // Auto-load run from URL ?run=xxx on mount
  useEffect(() => {
    if (initialRunId && !runId && workflowConfig) {
      viewHistoryRun(initialRunId);
    }
  }, [initialRunId, runId, workflowConfig]);

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
    if (isDesignMode && workflowConfig) {
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

      // Restore state machine data
      if (detail.stateHistory) {
        setSmStateHistory(detail.stateHistory);
      }
      if (detail.issueTracker) {
        setSmIssueTracker(detail.issueTracker);
      }
      if (detail.transitionCount !== undefined) {
        setSmTransitionCount(detail.transitionCount);
      }

      // Restore contexts
      if (detail.globalContext !== undefined) {
        dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: detail.globalContext });
      }
      if (detail.phaseContexts) {
        dispatch({ type: 'SET_PHASE_CONTEXTS', payload: detail.phaseContexts });
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
        setPendingCheckpointPhase(detail.pendingCheckpoint.phase || null);
      } else {
        setPendingCheckpointPhase(null);
      }

      // Restore state-machine human approval dialog when viewing a historical run
      if (detail.mode === 'state-machine' && detail.currentState === '__human_approval__') {
        const approvalTransition = (detail.stateHistory || []).findLast?.((item: any) => item.to === '__human_approval__');
        const currentStateName = detail.currentState || '__human_approval__';
        const workflowStates = (workflowConfig as any)?.workflow?.states?.map((state: any) => state.name) || [];
        const restoredAvailableStates = detail.pendingCheckpoint?.availableStates
          || workflowStates.filter((stateName: string) => stateName !== '__human_approval__');
        const suggestedNextState = detail.pendingCheckpoint?.suggestedNextState
          || restoredAvailableStates[0]
          || '完成';
        setHumanApprovalData({
          currentState: currentStateName,
          nextState: suggestedNextState,
          result: {
            verdict: approvalTransition?.issues?.length > 0 ? 'conditional_pass' : 'pass',
            issues: approvalTransition?.issues || [],
            summary: approvalTransition?.reason || '等待人工审查',
            stepOutputs: [],
          },
          availableStates: restoredAvailableStates,
        });
      } else {
        setHumanApprovalData(null);
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
      dispatch({ type: 'SET_SKILLS', payload: config.context?.skills || [] });

      // Load available skills
      try {
        const skillsRes = await fetch('/api/skills');
        const skillsData = await skillsRes.json();
        setAvailableSkills(skillsData.skills?.map((s: any) => ({ name: s.name, description: s.description })) || []);
      } catch { /* ignore */ }
    } catch (error: any) {
      console.error('加载工作流配置失败:', error);
      setLoadError(error.message || '加载失败');
    } finally {
      setPageLoading(false);
    }
  };

  const handleEvent = useCallback((event: any) => {
    // For status events, only apply if they're for the current config file
    if (event.type === 'status' && event.data.currentConfigFile && event.data.currentConfigFile !== configFile) {
      return; // Ignore status events from other workflow configs
    }

    switch (event.type) {
      case 'status':
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: event.data.status });
        if (event.data.runId) dispatch({ type: 'SET_RUN_ID', payload: event.data.runId });
        if (event.data.startTime) setRunStartTime(event.data.startTime);
        if (event.data.endTime) setRunEndTime(event.data.endTime);
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
        setPendingCheckpointPhase(event.data.phase || null);
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
      case 'human-approval-required':
        addLog('system', 'info', `👤 等待人工审查: ${event.data.currentState} → ${event.data.nextState}`);
        // Show human approval dialog
        setHumanApprovalData({
          currentState: event.data.currentState,
          nextState: event.data.nextState,
          result: event.data.result,
          availableStates: event.data.availableStates || [],
        });
        break;
      case 'force-transition':
        addLog('system', 'warning', `⚡ 强制跳转请求: ${event.data.from} → ${event.data.targetState}`);
        break;
      case 'transition-forced':
        addLog('system', 'info', `⚡ 已强制跳转: ${event.data.from} → ${event.data.to}`);
        dispatch({ type: 'SET_CURRENT_PHASE', payload: event.data.to });
        break;
      case 'sm-transition':
        setSmStateHistory(prev => [...prev, {
          from: event.data.from,
          to: event.data.to,
          reason: event.data.reason || '',
          issues: event.data.issues || [],
          timestamp: new Date().toISOString(),
        }]);
        setSmTransitionCount(event.data.transitionCount || 0);
        break;
      case 'token-usage':
        dispatch({
          type: 'UPDATE_AGENT_TOKEN_USAGE',
          payload: { agent: event.data.agent, usage: event.data.delta },
        });
        break;
      case 'feedback-injected':
        addLog('system', 'info', `反馈已接收: ${event.data.message.substring(0, 50)}${event.data.message.length > 50 ? '...' : ''}`);
        setInlineFeedbacks(prev => [...prev, {
          message: event.data.message,
          timestamp: event.data.timestamp,
          streamIndex: liveStreamLenRef.current,
        }]);
        break;
      case 'feedback-recalled':
        addLog('system', 'info', `反馈已撤回: ${event.data.message.substring(0, 50)}${event.data.message.length > 50 ? '...' : ''}`);
        setInlineFeedbacks(prev => {
          const idx = prev.findIndex(f => f.message === event.data.message);
          if (idx === -1) return prev;
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        });
        break;
      case 'context-updated':
        if (event.data.scope === 'global') {
          dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: event.data.context });
        } else if (event.data.phase) {
          dispatch({ type: 'SET_PHASE_CONTEXT', payload: { phase: event.data.phase, context: event.data.context } });
        }
        addLog('system', 'info', `上下文已更新: ${event.data.scope === 'global' ? '全局' : event.data.phase}`);
        break;
      case 'plan-question':
        setPendingPlanQuestion({
          question: event.data.question,
          fromAgent: event.data.fromAgent,
          round: event.data.round
        });
        setSupervisorFlow(prev => [...prev, {
          type: 'question',
          from: event.data.fromAgent,
          to: 'user',
          question: event.data.question,
          round: event.data.round,
          timestamp: new Date().toISOString(),
        }]);
        addLog('system', 'warning', `❓ 需要用户回答: ${event.data.question}`);
        break;
      case 'plan-round':
        setCurrentPlanRound(event.data.round);
        addLog('system', 'info', `🔄 Plan 循环第 ${event.data.round + 1} 轮 - 收集 ${event.data.infoRequests?.length || 0} 个请求`);
        break;
      case 'route-decision':
        setSupervisorFlow(prev => [...prev, {
          type: 'decision',
          from: event.data.fromAgent || 'system',
          to: event.data.route_to,
          method: event.data.method,
          question: event.data.question,
          round: event.data.round,
          timestamp: new Date().toISOString(),
        }]);
        addLog('system', 'info', `🔀 Supervisor 路由: ${event.data.fromAgent || 'system'} → ${event.data.route_to} (${event.data.method})`);
        break;
    }
  }, [selectedAgent, addLog]);

  // Keep a ref to the latest handleEvent so SSE callback never goes stale
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const saveConfig = async () => {
    setSaving(true);
    try {
      const config = { ...workflowConfig, context: { ...(workflowConfig.context || {}), projectRoot, requirements, timeoutMinutes, skills } };
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
      setSmStateHistory([]);
      setSmIssueTracker([]);
      setSmTransitionCount(0);
      setSupervisorFlow([]);
      setCurrentPlanRound(0);
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

  const handleForceTransition = (targetState: string) => {
    setForceTransitionModal({ targetState, instruction: '' });
  };

  const executeForceTransition = async () => {
    if (!forceTransitionModal) return;
    try {
      const rid = runId || selectedRun?.id;

      // 先查后端内存里的实际状态，避免重复 resume
      const liveStatus = await workflowApi.getStatus();
      const alreadyRunningInMemory = liveStatus.status === 'running';

      if (!alreadyRunningInMemory && rid) {
        // 内存里没有运行中的 workflow，先 resume 再 force-transition
        setViewingHistoryRun(false);
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
        dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
        await workflowApi.resume(
          rid,
          'force-transition',
          undefined,
          forceTransitionModal.targetState,
          forceTransitionModal.instruction || undefined
        );
        dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
        fetchCurrentStatus();
      } else {
        // 内存里已经有运行中的 workflow，直接 force-transition
        await workflowApi.forceTransition(forceTransitionModal.targetState, forceTransitionModal.instruction || undefined);
      }
      toast('success', `已请求跳转到: ${forceTransitionModal.targetState}`);
      setForceTransitionModal(null);
      setHumanApprovalData(null);
      setPendingCheckpointPhase(null);
    } catch (e: any) {
      toast('error', e.message);
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
      const rid = runId || selectedRun?.id;

      // 先查后端内存里的实际状态，避免重复 resume
      const liveStatus = await workflowApi.getStatus();
      const alreadyRunningInMemory = liveStatus.status === 'running';

      if (!alreadyRunningInMemory) {
        // 内存里没有运行中的 workflow，先弹确认再 resume
        dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
        await new Promise(resolve => setTimeout(resolve, 0));

        const confirmed = await confirm({
          title: '恢复运行后继续批准？',
          description: '检测到该工作流当前可能未在服务内存中运行。这通常发生在服务重启或打开历史运行记录时。是否先恢复该运行，再自动执行"批准"？',
          confirmLabel: '恢复并批准',
          cancelLabel: '取消',
        });

        if (!confirmed) {
          dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
          return;
        }

        if (rid) {
          setViewingHistoryRun(false);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
          dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
          await workflowApi.resume(rid, 'approve');
          dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
          fetchCurrentStatus();
        }
      } else {
        // 内存里已经有运行中的 workflow，直接 approve
        await workflowApi.approve();
      }

      dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
      setIterationFeedback('');
      setPendingCheckpointPhase(null);
      addLog('system', 'success', '✓ 检查点已批准，继续执行');
    } catch (error: any) {
      addLog('system', 'error', `批准失败: ${error.message}`);
    }
  };

  const rejectCheckpoint = async () => {
    dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
    setIterationFeedback(''); // 清空反馈
    setPendingCheckpointPhase(null);
    if (isRunning) {
      await stopWorkflow();
    }
    addLog('system', 'warning', '✗ 检查点被拒绝，工作流已停止');
  };

  const iterateCheckpoint = async () => {
    if (!iterationFeedback.trim()) {
      toast('error', '请输入迭代意见');
      return;
    }
    try {
      if (isRunning) {
        await workflowApi.iterate(iterationFeedback);
      } else {
        // Workflow not running — resume with iterate action
        const rid = runId || selectedRun?.id;
        if (rid) {
          setViewingHistoryRun(false);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
          dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
          await workflowApi.resume(rid, 'iterate', iterationFeedback);
          dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
          fetchCurrentStatus();
        }
      }
      dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
      setIterationFeedback('');
      setPendingCheckpointPhase(null);
      addLog('system', 'info', '↻ 继续迭代，重新执行当前阶段');
    } catch (error: any) {
      addLog('system', 'error', `请求迭代失败: ${error.message}`);
    }
  };

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = { idle: '空闲', running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止', crashed: '崩溃' };
    return texts[status] || status;
  };

  const handleDeleteRun = async (runId: string) => {
    const confirmed = await confirm({
      title: '删除运行记录',
      description: '确定要删除这个运行记录吗？此操作不可撤销。',
      confirmLabel: '删除',
      cancelLabel: '取消',
    });
    if (!confirmed) return;

    try {
      await runsApi.deleteRun(runId);
      toast('success', '运行记录已删除');
      // Reload history
      await loadHistory();
    } catch (error: any) {
      toast('error', `删除失败: ${error.message}`);
    }
  };

  const handleAnalyzeRunPrompts = async (runId: string) => {
    setAnalyzingRunId(runId);
    setShowPromptAnalysis(true);
    setAnalysisResults([]);
    setAnalysisSummary(null);
    setSelectedOptimizations(new Set());

    try {
      const response = await fetch(`/api/prompt-analysis?runId=${runId}`);
      const data = await response.json();

      if (data.success) {
        setAnalysisResults(data.steps || []);
        setAnalysisSummary(data.summary);
      } else {
        toast('error', data.error || '分析失败');
      }
    } catch (error: any) {
      toast('error', `分析失败: ${error.message}`);
    } finally {
      setAnalyzingRunId(null);
    }
  };

  const handleApplyOptimizations = async () => {
    if (selectedOptimizations.size === 0) {
      toast('warning', '请先选择要应用的优化');
      return;
    }

    setApplyingOptimization(true);

    try {
      for (const index of selectedOptimizations) {
        const result = analysisResults[index];
        if (!result || !result.analysis?.optimizedPrompt) continue;

        // Save optimized prompt to agent config
        const agentName = result.agentName;
        const agentConfig = agentConfigs.find((a: any) => a.name === agentName);

        if (agentConfig) {
          const updatedConfig = {
            ...agentConfig,
            systemPrompt: result.analysis.optimizedPrompt,
          };

          await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedConfig),
          });
        }
      }

      toast('success', `已应用 ${selectedOptimizations.size} 项优化`);
      setShowPromptAnalysis(false);
    } catch (error: any) {
      toast('error', `应用失败: ${error.message}`);
    } finally {
      setApplyingOptimization(false);
    }
  };

  const handleBatchDeleteRuns = async () => {
    if (selectedRunIds.length === 0) {
      toast('warning', '请先选择要删除的运行记录');
      return;
    }

    const confirmed = await confirm({
      title: '批量删除运行记录',
      description: `确定要删除选中的 ${selectedRunIds.length} 条运行记录吗？此操作不可撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
    });
    if (!confirmed) return;

    setBatchDeleting(true);
    try {
      const result = await runsApi.batchDeleteRuns(selectedRunIds);
      toast('success', result.message);
      setSelectedRunIds([]);
      await loadHistory();
    } catch (error: any) {
      toast('error', `批量删除失败: ${error.message}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const toggleRunSelection = (runId: string) => {
    setSelectedRunIds(prev =>
      prev.includes(runId) ? prev.filter(id => id !== runId) : [...prev, runId]
    );
  };

  const toggleAllRunsSelection = () => {
    if (selectedRunIds.length === historyRuns.filter(r => r.status !== 'running').length) {
      setSelectedRunIds([]);
    } else {
      setSelectedRunIds(historyRuns.filter(r => r.status !== 'running').map(r => r.id));
    }
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
  const CHUNK_WITH_TIME_REGEX = /^<!-- timestamp: (.+?) -->\n/;

  // Parse chunk with optional timestamp
  const HUMAN_FEEDBACK_REGEX = /^<!-- human-feedback: (.+?) -->\n/;

  const parseChunk = (chunk: string) => {
    // Check for human feedback marker first
    const fbMatch = chunk.match(HUMAN_FEEDBACK_REGEX);
    if (fbMatch) {
      return {
        timestamp: fbMatch[1],
        content: chunk.substring(fbMatch[0].length),
        isHumanFeedback: true,
      };
    }
    const match = chunk.match(CHUNK_WITH_TIME_REGEX);
    if (match) {
      return {
        timestamp: match[1],
        content: chunk.substring(match[0].length),
        isHumanFeedback: false,
      };
    }
    return { timestamp: null, content: chunk, isHumanFeedback: false };
  };

  // --- Live stream polling ---
  const startLiveStream = () => {
    setShowLiveStream(true);
    setLiveStream([]);
    setLiveStreamFeedback('');
    setInlineFeedbacks([]);
    liveStreamLenRef.current = 0;
    setLiveStreamVisibleCount(LIVE_STREAM_PAGE_SIZE);
    liveStreamUserScrolledUp.current = false;
    if (liveStreamRef.current) clearInterval(liveStreamRef.current);
    liveStreamRef.current = setInterval(async () => {
      try {
        const { processes } = await processApi.list();
        // Prefer persisted stream file (contains accumulated content across feedback rounds)
        let content: string | null = null;
        const rid = runId || selectedRun?.id;
        // Use running process step name to track step changes across iterations
        const runningProc = processes.find((p: any) => p.status === 'running');
        const activeStep = runningProc?.step || currentStep || selectedStep?.name;
        console.log(`[LiveStream] rid=${rid}, activeStep=${activeStep}, runningProc=${runningProc?.id}, processes=${processes.length}, streamContentLen=${runningProc?.streamContent?.length || 0}`);
        if (rid && activeStep) {
          // Detect step change — reset stream state when a new step starts
          if (activeStep !== liveStreamStepRef.current) {
            liveStreamStepRef.current = activeStep;
            liveStreamLenRef.current = 0;
            setLiveStream([]);
          }
          content = await streamApi.getStreamContent(rid, activeStep);
          console.log(`[LiveStream] streamApi content length: ${content?.length || 0}`);
        }
        if (!content) {
          // Fallback: try in-memory process
          const running = processes.find((p: any) => p.status === 'running');
          if (running?.streamContent) {
            content = running.streamContent;
          } else {
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
      } catch (e) { console.error('[LiveStream] polling error:', e); }
    }, 1000);
  };

  const stopLiveStream = () => {
    if (liveStreamRef.current) {
      clearInterval(liveStreamRef.current);
      liveStreamRef.current = null;
    }
    setShowLiveStream(false);
    setLiveStreamFullscreen(false);
  };

  const sendLiveFeedback = async (interrupt?: boolean) => {
    if (!liveStreamFeedback.trim() || sendingFeedback) return;
    setSendingFeedback(true);
    try {
      await workflowApi.injectFeedback(liveStreamFeedback.trim(), interrupt);
      setLiveStreamFeedback('');
      if (interrupt) {
        toast('success', '已打断当前执行，反馈将立即处理');
      }
    } catch (error: any) {
      toast('error', `发送反馈失败: ${error.message}`);
    }
    setSendingFeedback(false);
  };

  const recallFeedback = async (message: string) => {
    try {
      await workflowApi.recallFeedback(message);
    } catch (error: any) {
      toast('error', `撤回失败: ${error.message}`);
    }
  };

  const openContextEditor = (scope: 'global' | 'phase', phase?: string) => {
    setEditingContextScope(scope);
    setEditingContextPhase(phase || '');
    setEditingContextValue(
      scope === 'global' ? globalContext : (phase ? phaseContexts[phase] || '' : '')
    );
    setShowContextEditor(true);
  };

  const saveContext = async () => {
    try {
      await workflowApi.setContext(editingContextScope, editingContextValue, editingContextPhase || undefined);
      if (editingContextScope === 'global') {
        dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: editingContextValue });
      } else if (editingContextPhase) {
        dispatch({ type: 'SET_PHASE_CONTEXT', payload: { phase: editingContextPhase, context: editingContextValue } });
      }
      setShowContextEditor(false);
      toast('success', '上下文已保存');
    } catch (error: any) {
      toast('error', `保存失败: ${error.message}`);
    }
  };

  const handleRerunFromStep = async (stepName: string) => {
    const rid = runId || selectedRun?.id;
    if (!rid) return;
    const ok = await confirm({
      title: '从此步骤重新运行',
      description: `将从步骤 "${stepName}" 开始重新运行，该步骤及之后的所有步骤结果将被清除。`,
      confirmLabel: '重新运行',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      setViewingHistoryRun(false);
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
      dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
      dispatch({ type: 'SET_STEP_RESULTS', payload: {} });
      dispatch({ type: 'SET_RUN_ID', payload: rid });
      addLog('system', 'info', `正在从步骤 "${stepName}" 重新运行...`);
      await workflowApi.rerunFromStep(rid, stepName);
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      fetchCurrentStatus();
    } catch (error: any) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `重新运行失败: ${error.message}`);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (liveStreamRef.current) clearInterval(liveStreamRef.current); };
  }, []);

  // Auto-scroll live stream to bottom when content updates (only if user hasn't scrolled up)
  useEffect(() => {
    if (liveStreamScrollRef.current && !liveStreamUserScrolledUp.current) {
      liveStreamScrollRef.current.scrollTop = liveStreamScrollRef.current.scrollHeight;
    }
  }, [liveStream]);

  const selectedRoleConfig = selectedStep
    ? agentConfigs.find((r: any) => r.name === selectedStep.agent)
    : null;

  // Find the latest iteration result key for a step (e.g. "代码审计" → "代码审计-迭代3" if that's the latest)
  const getLatestStepKey = (baseName: string): string => {
    if (!baseName) return baseName;
    // If baseName itself has an iteration suffix (e.g. "设计修复方案-迭代2"), try it directly first,
    // then fall back to the base name (without suffix) in case stepLogs use the base name as key.
    const iterSuffixMatch = baseName.match(/^(.+)-迭代(\d+)$/);
    const effectiveBase = iterSuffixMatch ? iterSuffixMatch[1] : baseName;

    // If currentStep matches this base step, prefer it (it's the active iteration)
    // Return currentStep even if stepResults doesn't have it yet (for running steps)
    if (currentStep && (currentStep === effectiveBase || currentStep.startsWith(effectiveBase + '-迭代')
      || currentStep.endsWith('-' + effectiveBase))) {
      return currentStep;
    }

    // If user clicked on a specific iteration node (e.g. "功能测试-迭代4")
    if (iterSuffixMatch) {
      const clickedIterNum = parseInt(iterSuffixMatch[2], 10);
      // Check if this specific iteration is currently running
      const expectedCurrentStep = baseName;
      if (currentStep === expectedCurrentStep || currentStep?.startsWith(effectiveBase + '-迭代' + clickedIterNum)) {
        return baseName;
      }
      // If the exact key exists in results, use it
      if (stepResults[baseName]) return baseName;

      // Check if this iteration number is higher than any existing iteration
      let maxExistingIter = 0;
      for (const key of Object.keys(stepResults)) {
        const m = key.match(new RegExp(`^${effectiveBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-迭代(\\d+)$`));
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxExistingIter) maxExistingIter = n;
        }
      }
      // If clicked iteration is higher than existing, return baseName (will show as not executed)
      if (clickedIterNum > maxExistingIter) return baseName;
    }

    // Find highest iteration number in stepResults for the effective base name
    // Also check state-machine format keys like "stateName-stepName"
    let latest = effectiveBase;
    let maxIter = 0;
    for (const key of Object.keys(stepResults)) {
      if (key === effectiveBase) { if (maxIter === 0) latest = key; continue; }
      // Match state-machine format: "stateName-stepName" (key ends with "-baseName")
      if (key.endsWith('-' + effectiveBase)) { if (maxIter === 0) latest = key; continue; }
      const m = key.match(new RegExp(`^${effectiveBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-迭代(\\d+)$`));
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxIter) { maxIter = n; latest = key; }
      }
      // Also match state-machine iteration format: "stateName-stepName-迭代N"
      const sm = key.match(new RegExp(`-${effectiveBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-迭代(\\d+)$`));
      if (sm) {
        const n = parseInt(sm[1], 10);
        if (n > maxIter) { maxIter = n; latest = key; }
      }
    }
    return latest;
  };

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
        <ClipLoader color="hsl(var(--primary))" size={40} />
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
          <Button variant="outline" size="sm" onClick={() => {
            if (document.referrer && document.referrer.includes('/workflows')) {
              router.push('/workflows');
            } else {
              router.push('/');
            }
          }}>
            <span className="material-symbols-outlined text-sm">arrow_back</span><span className="hidden sm:inline"> 返回</span>
          </Button>
          <h1 className="text-sm sm:text-base font-semibold m-0 flex items-center gap-1.5 truncate max-w-[120px] sm:max-w-[200px] md:max-w-none">
            <span className="material-symbols-outlined text-lg sm:text-xl shrink-0">bolt</span>
            {isDesignMode ? (
              editingName ? (
                <Input
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={() => saveWorkflowName(nameValue)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveWorkflowName(nameValue);
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  className="h-6 text-sm font-semibold w-[150px]"
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => { setEditingName(true); setNameValue(workflowConfig?.workflow?.name || ''); }}
                  className="flex items-center gap-1 text-sm font-semibold hover:bg-background/50 px-2 py-0.5 rounded truncate"
                >
                  <span className="truncate">{workflowConfig?.workflow?.name || configFile}</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>
                </button>
              )
            ) : (
              <span className="truncate">{workflowConfig?.workflow?.name || configFile}</span>
            )}
          </h1>
        </div>
        <div className="flex gap-0.5 bg-background/50 rounded-md p-0.5 shrink-0">
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${isRunMode ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'run' })}>
            <span className="material-symbols-outlined text-sm">play_arrow</span><span className="hidden sm:inline ml-1">运行</span>
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${isDesignMode ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'design' })}>
            <span className="material-symbols-outlined text-sm">edit</span><span className="hidden sm:inline ml-1">设计</span>
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${isHistoryMode ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'history' })}>
            <span className="material-symbols-outlined text-sm">history</span><span className="hidden sm:inline ml-1">历史</span>
          </Button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunMode && (<>
            <Button size="sm" onClick={startWorkflow} disabled={starting || isRunning || workflowStatus === 'running'}>
              {starting ? (
                <ClipLoader color="currentColor" size={14} className="mr-1" />
              ) : (
                <span className="material-symbols-outlined text-sm mr-1">play_arrow</span>
              )}
              <span className="hidden sm:inline">{starting ? '启动中...' : '启动工作流'}</span>
              <span className="sm:hidden">{starting ? '...' : '启动'}</span>
            </Button>
            <Button variant="destructive" size="sm" onClick={stopWorkflow} disabled={!isRunning && workflowStatus !== 'running'}>
              <span className="material-symbols-outlined text-sm">stop</span><span className="hidden sm:inline">停止</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: !showProcessPanel })}>
              <span className="material-symbols-outlined text-sm">settings</span><span className="hidden sm:inline">进程</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openContextEditor('global')} title="全局上下文">
              <span className="material-symbols-outlined text-sm">edit_note</span><span className="hidden sm:inline">上下文</span>
            </Button>
          </>)}
          {isDesignMode && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleSaveConfig} disabled={saving}>
              {saving ? (
                <ClipLoader color="currentColor" size={14} className="mr-1" />
              ) : (
                <span className="material-symbols-outlined text-sm mr-1">save</span>
              )}
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
        {isRunMode && (
          <ResizablePanels
            leftPanel={
              <div className="flex flex-col h-full overflow-hidden">
              {/* Requirements panel - prominent at top */}
              <div className="border-b shrink-0">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent hover:from-primary/15 transition-colors"
                  onClick={() => setShowRunRequirements(!showRunRequirements)}
                >
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>assignment</span>
                  <span className="text-sm font-semibold text-primary">配置</span>
                  {!showRunRequirements && requirements && <span className="text-[10px] text-muted-foreground truncate flex-1 text-left ml-1">{requirements.substring(0, 50)}{requirements.length > 50 ? '...' : ''}</span>}
                  <span className="material-symbols-outlined text-muted-foreground ml-auto" style={{ fontSize: 16 }}>{showRunRequirements ? 'expand_less' : 'expand_more'}</span>
                </button>
                {showRunRequirements && (
                  <div className="px-4 py-3 space-y-2.5 bg-card/50">
                    {projectRoot && (
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">项目根目录</Label>
                        <p className="text-sm mt-1">{projectRoot}</p>
                      </div>
                    )}
                    {requirements && (
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">需求描述</Label>
                        <p className="text-sm mt-1 leading-relaxed">{requirements}</p>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">步骤超时</Label>
                      <p className="text-sm mt-1">{timeoutMinutes} 分钟</p>
                    </div>
                    {skills.length > 0 && (
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">Skills</Label>
                        <p className="text-sm mt-1">{skills.join(', ')}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <Tabs value={activeTab} onValueChange={(val) => dispatch({ type: 'SET_ACTIVE_TAB', payload: val })} className="flex flex-col flex-1 overflow-hidden">
                <TabsList className="w-full rounded-none border-b flex-shrink-0">
                  <TabsTrigger value="workflow" className="flex-1 flex items-center justify-center gap-1 text-xs">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>monitoring</span>工作流
                  </TabsTrigger>
                  <TabsTrigger value="agents" className="flex-1 flex items-center justify-center gap-1 text-xs">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>smart_toy</span>Agents
                  </TabsTrigger>
        {(isDesignMode) && <TabsTrigger value="config" className="flex-1 flex items-center justify-center gap-1 text-xs"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>settings</span>配置</TabsTrigger>}
                  <TabsTrigger value="documents" className="flex-1 flex items-center justify-center gap-1 text-xs">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>文档
                  </TabsTrigger>
                </TabsList>
                <div className="flex-1 overflow-hidden min-h-0">
                <TabsContent value="workflow" className="mt-0 overflow-y-auto h-full p-4">
                  {workflowConfig && (
                    <div>
                      <div>
                        <h3 className="text-base font-semibold mb-2">{workflowConfig.workflow.name}</h3>
                        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{workflowConfig.workflow.description}</p>
                        <div className="flex gap-3">
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">{workflowConfig.workflow.mode === 'state-machine' ? '状态' : '阶段'}</span><span className="block text-xl font-semibold">{workflowConfig.workflow.mode === 'state-machine' ? (workflowConfig.workflow.states?.length ?? 0) : (workflowConfig.workflow.phases?.length ?? 0)}</span></div>
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">步骤</span><span className="block text-xl font-semibold">{totalSteps}</span></div>
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">Agent</span><span className="block text-xl font-semibold">{agentConfigs.length}</span></div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 mt-4">
                        {(workflowConfig.workflow.mode === 'state-machine'
                          ? workflowConfig.workflow.states
                          : workflowConfig.workflow.phases
                        )?.map((phase: any, idx: number) => {
                          const phaseAgents = phase.steps 
                            ? phase.steps.map((s: any) => {
                                const role = agentConfigs.find((r: any) => r.name === s.agent);
                                return { name: s.agent, team: role?.team || 'blue', role: s.role };
                              })
                            : [{ name: phase.agent, team: 'blue', role: undefined }];
                          const iterState = iterationStates[phase.name];
                          const isActive = currentPhase === phase.name;
                          const isDone = phase.steps 
                            ? phase.steps.every((s: any) => completedSteps?.includes(s.name))
                            : completedSteps?.includes(phase.name);
                          return (<div key={idx}
                            className={`bg-muted rounded-md p-2.5 cursor-pointer transition-colors hover:bg-accent border-l-[3px] ${
                              isActive ? 'border-l-primary bg-accent' : isDone ? 'border-l-green-500' : 'border-transparent'
                            }`}
                            onClick={() => {
                              // 触发流程图跳转到该节点
                              setFocusedState(phase.name);
                              if (phase.steps.length > 0) {
                                selectStep(phase.steps[0]);
                              }
                            }}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-medium">{phase.name}</span>
                              <div className="flex items-center gap-1">
                                {phaseContexts[phase.name] && (
                                  <Badge variant="outline" className="text-[10px]"><span className="material-symbols-outlined" style={{ fontSize: 10 }}>edit_note</span></Badge>
                                )}
                                {phase.iteration?.enabled && (<Badge><span className="material-symbols-outlined" style={{ fontSize: 10 }}>loop</span> {iterState ? `${iterState.currentIteration}/${iterState.maxIterations}` : `max ${phase.iteration.maxIterations}`}</Badge>)}
                                {workflowConfig.workflow.mode !== 'state-machine' && (
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); openContextEditor('phase', phase.name); }} title="设置阶段上下文">
                                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit_note</span>
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {phaseAgents.map((a: any, i: number) => (
                                <Badge key={i} variant="outline" className={`text-[10px] ${a.team === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : a.team === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/30' : a.team === 'judge' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : ''}`}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 10 }}>{a.role === 'attacker' ? 'swords' : a.role === 'judge' ? 'gavel' : 'shield'}</span> {a.name}
                                </Badge>
                              ))}
                            </div>
                          </div>);
                        })}
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="agents" className="mt-0 overflow-y-auto h-full p-4"><div className="flex flex-col gap-2">
                  {agents.map((agent) => (<div key={agent.name}
                    className={`bg-muted p-3 rounded-md cursor-pointer transition-colors hover:bg-accent border-l-[3px] border-transparent ${selectedAgent?.name === agent.name ? 'border-l-primary bg-accent' : ''}`}
                    onClick={() => dispatch({ type: 'SET_SELECTED_AGENT', payload: agent })}>
                    <div className="flex items-center gap-2 mb-1.5"><span className="material-symbols-outlined text-lg">smart_toy</span><span className="text-sm font-medium">{agent.name}</span></div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={`w-2 h-2 rounded-full ${agent.status === 'running' ? 'bg-blue-500 animate-pulse' : agent.status === 'completed' ? 'bg-green-500' : agent.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'}`} />{agent.status}</div>
                  </div>))}
                </div></TabsContent>
{isDesignMode && <TabsContent value="config" className="mt-0 overflow-y-auto h-full p-4"><div><h4 className="text-sm font-semibold mb-4">高级配置</h4>
          </div></TabsContent>}
<TabsContent value="documents" className="mt-0 h-full">
                  <DocumentsPanel runId={runId || selectedRun?.id || null} />
                </TabsContent>
              </div>
            </Tabs>
            </div>
            }
            centerPanel={
              <>
                <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">工作流可视化</h2></div>
                <div className="flex-1 overflow-auto">
                  {workflowConfig ? (
                    workflowConfig.workflow.mode === 'state-machine' ? (
                      isDesignMode ? (
                        <StateMachineDiagram
                          states={workflowConfig.workflow.states || []}
                          currentState={currentPhase}
                          currentStep={currentStep}
                          completedSteps={completedSteps}
                          stateHistory={smStateHistory}
                          isRunning={isRunning}
                          onStepClick={(step) => selectStep(step)}
                          onForceTransition={handleForceTransition}
                        />
                      ) : (
                        <div className="h-full p-4">
                          <StateMachineExecutionView
                            states={workflowConfig.workflow.states || []}
                            currentState={currentPhase}
                            currentStep={currentStep}
                            completedSteps={completedSteps}
                            stateHistory={smStateHistory}
                            issueTracker={smIssueTracker}
                            transitionCount={smTransitionCount}
                            maxTransitions={workflowConfig.workflow.maxTransitions || 50}
                            status={workflowStatus as any}
                            isRunning={isRunning}
                            focusedState={focusedState}
                            startTime={runStartTime}
                            endTime={runEndTime}
                            supervisorFlow={supervisorFlow}
                            currentPlanRound={currentPlanRound}
                            onStateClick={(s) => setFocusedState(s)}
                            onStepClick={(step) => selectStep(step)}
                            onForceTransition={handleForceTransition}
                          />
                        </div>
                      )
                    ) : (
                      <FlowDiagram workflow={workflowConfig.workflow} currentPhase={currentPhase} currentStep={currentStep}
                        agents={agents} completedSteps={completedSteps} failedSteps={failedSteps} iterationStates={iterationStates} onSelectStep={selectStep}
                        pendingCheckpointPhase={pendingCheckpointPhase || undefined}
                        onSelectCheckpoint={(cp) => {
                          const phase = workflowConfig.workflow.phases?.find((p: any) => p.checkpoint?.name === cp.name);
                          dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: cp.message });
                          dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: !!phase?.iteration?.enabled });
                          dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
                        }} />
                    )
                  ) : (<div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">monitoring</span><p>加载中...</p></div>)}
                </div>
              </>
            }
            rightPanel={
              <>
                {(() => {
                  // Resolve the latest iteration key for the selected step
                  const stepKey = selectedStep ? getLatestStepKey(selectedStep.name) : '';
                  const stepResult = selectedStep ? stepResults[stepKey] : null;
                  const isCurrentStepRunning = selectedStep && isRunning && (
                    currentStep === selectedStep.name || currentStep?.startsWith(selectedStep.name + '-迭代')
                    || currentStep?.endsWith('-' + selectedStep.name)
                  );
                  // For steps with iteration suffix (e.g. "设计修复方案-迭代2"), also check the base name
                  // in completedSteps/failedSteps, since FlowDiagram marks non-last rounds as completed
                  // even if completedSteps only contains the base name or a different iteration key.
                  const stepBaseName = selectedStep?.name.match(/^(.+)-迭代\d+$/)
                    ? selectedStep.name.replace(/-迭代\d+$/, '')
                    : selectedStep?.name;
                  const isStepDone = selectedStep && (
                    completedSteps.includes(selectedStep.name) ||
                    (stepBaseName && completedSteps.some(s => s === stepBaseName || s.startsWith(stepBaseName + '-迭代'))) ||
                    !!stepResult
                  );
                  const isStepFailed = selectedStep && (
                    failedSteps.includes(selectedStep.name) ||
                    (stepBaseName && failedSteps.some(s => s === stepBaseName || s.startsWith(stepBaseName + '-迭代')))
                  );
                  return (<>
                <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">{selectedStep ? (stepKey !== selectedStep.name ? stepKey : selectedStep.name) : selectedAgent ? selectedAgent.name : 'Agent 详情'}</h2></div>
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
              {selectedStep && stepResult && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wider">
                    {stepResult.error ? (<><span className="material-symbols-outlined text-xs text-red-400">error</span> 执行错误</>) : (<><span className="material-symbols-outlined text-xs text-green-400">check_circle</span> 执行结果</>)}
                  </div>
                  <div className="flex gap-3 mb-2 flex-wrap">
                    {stepResult.durationMs !== undefined && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">耗时: </span>
                        <span className="font-semibold">{(stepResult.durationMs! / 1000).toFixed(2)}s</span>
                      </div>
                    )}
                    {stepResult.costUsd !== undefined && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">费用: </span>
                        <span className="font-semibold">${stepResult.costUsd?.toFixed(4)}</span>
                      </div>
                    )}
                    {stepResult.startTime && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">开始: </span>
                        <span className="font-mono">{new Date(stepResult.startTime!).toLocaleTimeString('zh-CN')}</span>
                      </div>
                    )}
                    {stepResult.endTime && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">结束: </span>
                        <span className="font-mono">{new Date(stepResult.endTime!).toLocaleTimeString('zh-CN')}</span>
                      </div>
                    )}
                  </div>
                  {stepResult.error ? (
                    <pre className="bg-background border border-red-500 rounded p-2 text-xs leading-relaxed max-h-[200px] overflow-y-auto mt-1.5 whitespace-pre-wrap break-words font-mono text-red-400">
                      {stepResult.error}
                    </pre>
                  ) : (() => {
                    const raw = fullStepOutput || stepResult.output;
                    const displayText = !fullStepOutput && raw.length > 2000
                      ? raw.substring(0, 2000) + '\n\n...(已截断)'
                      : raw;
                    const chunks = displayText.split(CHUNK_SEP).filter(Boolean);
                    // Deduplicate TodoWrite: only keep the latest todo-list chunk
                    const TODO_MK2 = '<!-- todo-list-marker -->';
                    let lastTodo2 = -1;
                    for (let k = chunks.length - 1; k >= 0; k--) {
                      if (chunks[k].includes(TODO_MK2)) { lastTodo2 = k; break; }
                    }
                    const dedupedChunks = chunks.filter((c, idx) => {
                      if (c.includes(TODO_MK2) && idx !== lastTodo2) return false;
                      // Filter out filler chunks (e.g. lone "." between tool calls)
                      const stripped = c.replace(/\*\*🔧 .+?\*\*/g, '').replace(/<!--.*?-->/gs, '').trim();
                      if (stripped.length <= 1) return false;
                      return true;
                    });
                    return (
                      <>
                        <div className={`${styles.markdownContent} bg-background border rounded p-2 text-sm leading-relaxed max-h-[200px] overflow-y-auto mt-1.5`}>
                          {dedupedChunks.map((chunk, i) => (
                            <div key={i} className={i < dedupedChunks.length - 1 ? 'border-b border-border/50 pb-3 mb-3' : ''}>
                              <Markdown>{chunk}</Markdown>
                            </div>
                          ))}
                        </div>
                        {!fullStepOutput && stepResult.output.length > 2000 && (runId || selectedRun?.id) && (
                          <Button variant="secondary" size="sm" className="mt-1.5 text-[11px]"
                            onClick={() => loadFullOutput(stepKey)}
                            disabled={loadingOutput}>
                            {loadingOutput ? '加载中...' : (<><span className="material-symbols-outlined text-xs">description</span> 查看完整输出</>)}
                          </Button>
                        )}
                      </>
                    );
                  })()}
                  {!stepResult.error && (
                    <Button variant="secondary" size="sm" className="mt-1.5 text-[11px]"
                      onClick={() => openMarkdownModal(stepKey)}>
                      查看 Markdown
                    </Button>
                  )}
                </div>
              )}
              {/* Resume button on failed/crashed step */}
              {selectedStep && isStepFailed && !isRunning && (runId || selectedRun?.id) && (
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
              {/* Rerun from step button — for completed or failed steps when not running */}
              {selectedStep && !isRunning && (runId || selectedRun?.id) && (isStepDone || isStepFailed) && (
                <div className="bg-muted border-b p-3.5">
                  <Button variant="secondary" size="sm" className="text-xs w-full" onClick={() => handleRerunFromStep(selectedStep.name)}>
                    <span className="material-symbols-outlined text-sm">replay</span>
                    从此步骤重新运行
                  </Button>
                  <div className="text-[11px] text-muted-foreground mt-1.5">
                    该步骤及之后的所有步骤将被重新执行
                  </div>
                </div>
              )}
              {/* Resume button when viewing crashed/stopped run without specific step selected */}
              {!selectedStep && !isRunning && (workflowStatus === 'failed' || workflowStatus === 'stopped' || workflowStatus === 'pending') && (runId || selectedRun?.id) && (
                <div className="bg-muted border-b p-3.5">
                  <Button className="bg-green-600 hover:bg-green-700 text-white text-xs w-full" onClick={() => resumeWorkflow()} disabled={isRunning}>
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    {workflowStatus === 'pending' ? '启动运行' : '恢复运行'}
                  </Button>
                  <div className="text-[11px] text-muted-foreground mt-1.5">
                    {workflowStatus === 'pending'
                      ? '从当前状态开始执行工作流'
                      : `已完成 ${completedSteps.length} 步，将从中断处继续`}
                  </div>
                </div>
              )}
              {/* Live stream button for currently running step */}
              {selectedStep && isCurrentStepRunning && !stepResult && (
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
              {/* Show status when running but no current step */}
              {isRunning && !selectedStep && !currentStep && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">
                    <span className="material-symbols-outlined text-xs">sync</span> 工作流运行中
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    {currentPhase === '__human_approval__' ? '等待人工审查...' : '等待步骤开始执行...'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    当前状态: {formatStateName(currentPhase || '') || '未知'}
                  </div>
                </div>
              )}
              {selectedAgent ? (<AgentPanel agent={selectedAgent} logs={logs} onClearLogs={(name) => dispatch({ type: 'CLEAR_AGENT_LOGS', payload: name })}
                stepSummary={selectedStep && stepResult?.output ? stepResult.output : undefined} />
              ) : (<div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">smart_toy</span><p>选择一个 Agent 查看详情</p></div>)}
            </div>
                  </>);
                })()}
              </>
            }
          />
        )}
        {isDesignMode && editingConfig && (<>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0">
              {/* Design Tabs */}
              <div className="shrink-0 border-b bg-muted/30">
                <div className="flex gap-0.5 px-2 pt-1">
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'workflow' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setDesignTab('workflow')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">account_tree</span>
                    工作流设计
                  </button>
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'config' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setDesignTab('config')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">settings</span>
                    配置
                  </button>
                </div>
              </div>

              {/* Workflow Design Tab */}
              {designTab === 'workflow' && editingConfig?.workflow && (
                <div className="flex-1 overflow-hidden">
                  {editingConfig.workflow.mode === 'state-machine' ? (
                    <StateMachineDesignPanel
                      states={editingConfig.workflow.states || []}
                      onStatesChange={(states) => {
                        const newConfig = JSON.parse(JSON.stringify(editingConfig));
                        newConfig.workflow.states = states;
                        dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
                      }}
                      availableAgents={agentConfigs}
                      availableSkills={availableSkills}
                    />
                  ) : (
                    <DesignPanel workflow={editingConfig.workflow}
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
                      onJoinGroup={handleJoinGroup} />
                  )}
                </div>
              )}

              {/* Config Tab */}
              {designTab === 'config' && (
                <div className="flex-1 overflow-auto bg-muted/20">
                  <div className="max-w-xl mx-auto p-6">
                    <div className="bg-card border rounded-lg shadow-sm">
                      <div className="p-5 border-b">
                        <h3 className="text-base font-semibold">工作流配置</h3>
                        <p className="text-xs text-muted-foreground mt-1">配置工作流运行时的基本参数</p>
                      </div>
                      <div className="p-5 space-y-5">
                        <div>
                          <Label className="text-sm font-medium">项目根目录</Label>
                          <Input
                            value={projectRoot}
                            onChange={(e) => dispatch({ type: 'SET_PROJECT_ROOT', payload: e.target.value })}
                            type="text"
                            placeholder="../cangjie_compiler"
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">工作流执行时的项目根目录路径</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">需求描述</Label>
                          <Textarea
                            value={requirements}
                            onChange={(e) => dispatch({ type: 'SET_REQUIREMENTS', payload: e.target.value })}
                            rows={4}
                            placeholder="请输入需求描述..."
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">详细描述本次工作流执行的目标和需求</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">步骤超时（分钟）</Label>
                          <Input
                            value={timeoutMinutes}
                            onChange={(e) => dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: Math.max(1, parseInt(e.target.value) || 1) })}
                            type="number"
                            min={1}
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">每个步骤的最大执行时间</p>
                        </div>

                        {availableSkills.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between">
                              <Label className="text-sm font-medium">Skills</Label>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setShowSkillSelector(true)}
                              >
                                <span className="material-symbols-outlined text-xs mr-1">list</span>
                                选择 ({skills.length})
                              </Button>
                            </div>
                            <div className="mt-2 min-h-[40px] p-3 border rounded-md bg-muted/30">
                              {skills.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {skills.map((skillName) => (
                                    <Badge key={skillName} variant="secondary" className="text-xs">
                                      {skillName}
                                      <button
                                        type="button"
                                        className="ml-1 hover:text-destructive"
                                        onClick={() => dispatch({ type: 'SET_SKILLS', payload: skills.filter(s => s !== skillName) })}
                                      >
                                        ×
                                      </button>
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <div className="flex items-center justify-center text-muted-foreground text-sm py-2">
                                  <span className="material-symbols-outlined text-base mr-1">info</span>
                                  未选择任何 Skills
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5">选择工作流运行时可用的 Skills</p>
                          </div>
                        )}
                      </div>
                      <div className="p-5 border-t bg-muted/30 flex justify-end">
                        <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={saveConfig} disabled={saving}>
                          {saving ? <ClipLoader color="currentColor" size={14} className="mr-2" /> : <span className="material-symbols-outlined text-sm mr-2">save</span>}
                          {saving ? '保存中...' : '保存配置'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Floating Agent config button - navigate to agents page */}
          <Link href="/agents">
            <button
              className="fixed right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
              title="Agent 管理"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>smart_toy</span>
            </button>
          </Link>
        </>)}
        {isHistoryMode && (<div className="flex-1 flex flex-col overflow-hidden">
          <div className="h-10 bg-muted border-b flex items-center justify-between px-4">
            <h2 className="text-sm font-semibold m-0">运行历史</h2>
            {selectedRunIds.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-500 hover:text-red-600"
                onClick={handleBatchDeleteRuns}
                disabled={batchDeleting}
              >
                <span className="material-symbols-outlined text-sm mr-1">delete</span>
                删除选中 ({selectedRunIds.length})
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4">
            {historyRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <span className="material-symbols-outlined text-5xl mb-4">history</span>
                <p>暂无运行记录</p>
              </div>
            ) : (
              <div className="bg-card border rounded-lg overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead className="bg-muted border-b sticky top-0">
                    <tr>
                      <th className="text-left p-3 text-sm font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={selectedRunIds.length > 0 && selectedRunIds.length === historyRuns.filter(r => r.status !== 'running').length}
                          onChange={toggleAllRunsSelection}
                          className="cursor-pointer"
                        />
                      </th>
                      <th className="text-left p-3 text-sm font-semibold">运行ID</th>
                      <th className="text-left p-3 text-sm font-semibold">状态</th>
                      <th className="text-left p-3 text-sm font-semibold hidden md:table-cell">开始时间</th>
                      <th className="text-left p-3 text-sm font-semibold hidden md:table-cell">结束时间</th>
                      <th className="text-left p-3 text-sm font-semibold hidden sm:table-cell">阶段</th>
                      <th className="text-left p-3 text-sm font-semibold">进度</th>
                      <th className="text-left p-3 text-sm font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRuns.map((run) => (
                      <tr key={run.id} className="border-b hover:bg-accent transition-colors">
                        <td className="p-3">
                          {run.status !== 'running' && (
                            <input
                              type="checkbox"
                              checked={selectedRunIds.includes(run.id)}
                              onChange={() => toggleRunSelection(run.id)}
                              className="cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="p-3 text-sm font-mono">{run.id}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{
                              background: run.status === 'completed' ? '#6a8759' : run.status === 'failed' || run.status === 'crashed' ? '#c75450' : run.status === 'stopped' ? '#cc7832' : '#4a88c7',
                            }}></span>
                            <span className="text-sm">
                              {run.status === 'crashed' ? '崩溃' : run.status === 'completed' ? '完成' : run.status === 'failed' ? '失败' : run.status === 'stopped' ? '已停止' : '运行中'}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                          {new Date(run.startTime).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                          {run.endTime ? new Date(run.endTime).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          }) : '-'}
                        </td>
                        <td className="p-3 text-sm hidden sm:table-cell">{run.currentPhase || '-'}</td>
                        <td className="p-3 text-sm">{run.completedSteps}/{run.totalSteps}</td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => { setSelectedRun(run); viewHistoryRun(run.id); }}>
                              <span className="material-symbols-outlined text-sm mr-1">visibility</span>
                              查看
                            </Button>
                            {(run.status === 'failed' || run.status === 'stopped' || run.status === 'pending') && (
                              <Button size="sm" variant="outline" className="text-green-600 hover:text-green-700" onClick={() => { setSelectedRun(run); resumeWorkflow(run.id); }}>
                                <span className="material-symbols-outlined text-sm mr-1">refresh</span>
                                恢复
                              </Button>
                            )}
                            {run.status !== 'running' && (
                              <Button size="sm" variant="outline" className="text-blue-500 hover:text-blue-600" onClick={() => handleAnalyzeRunPrompts(run.id)}>
                                <span className="material-symbols-outlined text-sm mr-1">psychology</span>
                                分析
                              </Button>
                            )}
                            {run.status !== 'running' && (
                              <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" onClick={() => handleDeleteRun(run.id)}>
                                <span className="material-symbols-outlined text-sm mr-1">delete</span>
                                删除
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>)}
      </div>

      {showProcessPanel && (<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><div className="bg-card rounded-lg w-[90%] max-w-[1200px] h-[80%] border relative overflow-hidden">
        <ProcessPanel onClose={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: false })} />
      </div></div>)}
      {editingNode && (<EditNodeModal isOpen={showEditNodeModal} type={editingNode.type} data={getEditingNodeData()} roles={agentConfigs}
        availableSkills={availableSkills}
        isNew={isNewNode}
        existingPhases={editingConfig?.workflow?.phases || []}
        existingSteps={editingConfig?.workflow?.phases?.flatMap((p: any) => p.steps) || []}
        onClose={() => { dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false }); dispatch({ type: 'SET_EDITING_NODE', payload: null }); setIsNewNode(false); }}
        onSave={handleSaveNode} onDelete={handleDeleteNode} />)}
      {showCheckpoint && (<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false })}>
        <div className="bg-card rounded-lg w-[600px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
          <div className="p-5 border-b"><h3 className="text-lg font-semibold"><span className="material-symbols-outlined text-lg mr-2 align-middle">person</span>人工检查点</h3></div>
          <div className="p-5"><p className="text-sm mb-4 leading-relaxed">{checkpointMessage}</p>
            <div className="bg-muted p-4 rounded-md border-l-[3px] border-l-yellow-500 mb-4">
              <p className="text-sm text-muted-foreground mb-2">当前阶段: <strong className="text-foreground">{formatStateName(currentPhase || '')}</strong></p>
              <p className="text-sm text-muted-foreground">请审查工作成果，决定是否继续执行</p>
            </div>
            {checkpointIsIterative && (
              <div className="mb-4">
                <Label htmlFor="iteration-feedback" className="text-sm font-medium mb-2 block">迭代意见（继续迭代时必填）</Label>
                <Textarea
                  id="iteration-feedback"
                  value={iterationFeedback}
                  onChange={(e) => setIterationFeedback(e.target.value)}
                  placeholder="请输入本轮迭代的评审意见，这些意见将作为下一轮迭代的检查项..."
                  rows={4}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">提示：评审意见将作为AI的检查项，指导下一轮迭代的改进方向</p>
              </div>
            )}
          </div>
          <div className="p-5 border-t flex gap-3 justify-end">
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={approveCheckpoint}><span className="material-symbols-outlined text-sm mr-1">check</span>通过</Button>
            {checkpointIsIterative && (
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={iterateCheckpoint}><span className="material-symbols-outlined text-sm mr-1">refresh</span>继续迭代</Button>
            )}
            <Button variant="destructive" onClick={rejectCheckpoint}><span className="material-symbols-outlined text-sm mr-1">close</span>拒绝并停止</Button>
          </div>
        </div>
      </div>)}
      {pendingPlanQuestion && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg w-[600px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b"><h3 className="text-lg font-semibold"><span className="material-symbols-outlined text-lg mr-2 align-middle">help</span>需要用户回答</h3></div>
            <div className="p-5">
              <div className="bg-muted p-4 rounded-md border-l-[3px] border-l-blue-500 mb-4">
                <p className="text-sm text-muted-foreground mb-2">来自 Agent: <strong className="text-foreground">{pendingPlanQuestion.fromAgent}</strong> (第 {pendingPlanQuestion.round + 1} 轮)</p>
              </div>
              <p className="text-base mb-4">{pendingPlanQuestion.question}</p>
              <Textarea
                value={planAnswer}
                onChange={(e) => setPlanAnswer(e.target.value)}
                placeholder="请输入您的回答..."
                rows={4}
                className="w-full"
              />
            </div>
            <div className="p-5 border-t flex gap-3 justify-end">
              <Button 
                onClick={async () => {
                  if (!planAnswer.trim()) return;
                  setSendingPlanAnswer(true);
                  try {
                    const res = await fetch('/api/workflow/plan-answer', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ answer: planAnswer })
                    });
                    if (res.ok) {
                      setPendingPlanQuestion(null);
                      setPlanAnswer('');
                      addLog('system', 'success', '✓ 回答已提交');
                    } else {
                      const data = await res.json();
                      addLog('system', 'error', `提交失败: ${data.error}`);
                    }
                  } catch (err: any) {
                    addLog('system', 'error', `提交失败: ${err.message}`);
                  } finally {
                    setSendingPlanAnswer(false);
                  }
                }}
                disabled={!planAnswer.trim() || sendingPlanAnswer}
              >
                {sendingPlanAnswer ? '提交中...' : '提交回答'}
              </Button>
            </div>
          </div>
        </div>
      )}
      {showLiveStream && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={stopLiveStream}>
          <div className={`bg-card rounded-lg border flex flex-col ${liveStreamFullscreen ? 'w-full h-full rounded-none' : 'w-[80%] max-w-[800px] max-h-[80vh]'}`} onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold"><span className="material-symbols-outlined text-lg mr-2 align-middle">cell_tower</span>实时输出 {currentStep ? `- ${currentStep}` : ''}</h3>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setLiveStreamFullscreen(f => !f)} title={liveStreamFullscreen ? '退出全屏' : '全屏'}>
                  <span className="material-symbols-outlined text-sm">{liveStreamFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={stopLiveStream}>关闭</Button>
              </div>
            </div>
            <div ref={liveStreamScrollRef} className="p-5 flex-1 overflow-auto" onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
              liveStreamUserScrolledUp.current = !atBottom;
              if (el.scrollTop === 0 && liveStream.length > liveStreamVisibleCount) {
                setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE);
              }
            }}>
              {liveStream.length === 0 ? (
                <div className="text-muted-foreground text-sm text-center py-8">(等待输出...)</div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    // Merge stream chunks and inline feedbacks by position
                    type Item = { type: 'chunk'; content: string; index: number } | { type: 'feedback'; message: string; timestamp: string };
                    const items: Item[] = [];
                    // Collect feedback messages already embedded in stream chunks to avoid duplicates
                    const streamFeedbackMessages = new Set<string>();
                    for (const chunk of liveStream) {
                      const parsed = parseChunk(chunk);
                      if (parsed.isHumanFeedback) {
                        // Stream stores feedback as numbered lines ("1. msg"), extract raw messages
                        const lines = parsed.content.trim().split('\n');
                        for (const line of lines) {
                          const stripped = line.replace(/^\d+\.\s*/, '').trim();
                          if (stripped) streamFeedbackMessages.add(stripped);
                        }
                      }
                    }
                    let fbIdx = 0;
                    for (let i = 0; i < liveStream.length; i++) {
                      // Insert any feedbacks that were sent before this chunk (skip if already in stream)
                      while (fbIdx < inlineFeedbacks.length && inlineFeedbacks[fbIdx].streamIndex <= i) {
                        if (!streamFeedbackMessages.has(inlineFeedbacks[fbIdx].message.trim())) {
                          items.push({ type: 'feedback', message: inlineFeedbacks[fbIdx].message, timestamp: inlineFeedbacks[fbIdx].timestamp });
                        }
                        fbIdx++;
                      }
                      items.push({ type: 'chunk', content: liveStream[i], index: i });
                    }
                    // Remaining feedbacks after all chunks (skip if already in stream)
                    while (fbIdx < inlineFeedbacks.length) {
                      if (!streamFeedbackMessages.has(inlineFeedbacks[fbIdx].message.trim())) {
                        items.push({ type: 'feedback', message: inlineFeedbacks[fbIdx].message, timestamp: inlineFeedbacks[fbIdx].timestamp });
                      }
                      fbIdx++;
                    }
                    // Deduplicate TodoWrite: only keep the latest todo-list chunk
                    const TODO_MARKER = '<!-- todo-list-marker -->';
                    let lastTodoIdx = -1;
                    for (let j = items.length - 1; j >= 0; j--) {
                      if (items[j].type === 'chunk' && (items[j] as any).content.includes(TODO_MARKER)) {
                        if (lastTodoIdx === -1) { lastTodoIdx = j; } else {
                          // Remove older todo chunks — replace content with empty
                          (items[j] as any).content = '';
                        }
                      }
                    }
                    const filteredItems = items.filter(it => {
                      if (it.type === 'feedback') return true;
                      const c = (it as any).content as string;
                      if (!c) return false;
                      // Filter out chunks that are just filler text between tool calls (e.g. lone ".")
                      const stripped = c.replace(/\*\*🔧 .+?\*\*/g, '').replace(/<!--.*?-->/gs, '').trim();
                      if (stripped.length <= 1) return false;
                      return true;
                    });
                    const hasMore = filteredItems.length > liveStreamVisibleCount;
                    const visibleItems = hasMore ? filteredItems.slice(filteredItems.length - liveStreamVisibleCount) : filteredItems;
                    return (<>
                      {hasMore && (
                        <div className="text-center py-2">
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE)}
                          >
                            加载更早的 {filteredItems.length - liveStreamVisibleCount} 条内容...
                          </button>
                        </div>
                      )}
                      {visibleItems.map((item, i) => {
                      if (item.type === 'feedback') {
                        return (
                          <div key={`fb-${i}`} className="flex justify-end group">
                            <div className="bg-primary/15 border border-primary/30 rounded-lg px-3 py-2 max-w-[80%] relative">
                              <div className="text-[10px] text-muted-foreground mb-0.5 text-right font-mono flex items-center justify-end gap-1">
                                {new Date(item.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                {isRunning && (
                                  <button
                                    onClick={() => recallFeedback(item.message)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                    title="撤回"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>undo</span>
                                  </button>
                                )}
                              </div>
                              <div className="text-sm">{item.message}</div>
                            </div>
                          </div>
                        );
                      }
                      const parsed = parseChunk(item.content);
                      if (parsed.isHumanFeedback) {
                        return (
                          <div key={`c-${i}`} className="flex justify-end">
                            <div className="bg-primary/15 border border-primary/30 rounded-lg px-3 py-2 max-w-[80%]">
                              {parsed.timestamp && (
                                <div className="text-[10px] text-muted-foreground mb-0.5 text-right font-mono">
                                  {new Date(parsed.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </div>
                              )}
                              <div className="text-sm">{parsed.content}</div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={`c-${i}`} className="border-b border-border/50 pb-3 last:border-0">
                          {parsed.timestamp && (
                            <div className="text-[10px] text-muted-foreground mb-1 font-mono">
                              {new Date(parsed.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          )}
                          <div className="text-sm">
                            <Markdown>{parsed.content}</Markdown>
                          </div>
                        </div>
                      );
                    })}
                    </>);
                  })()}
                  {isRunning && (() => {
                    // Determine status: if last content ends with a tool call, show "执行中", otherwise "思考中"
                    const lastChunk = liveStream[liveStream.length - 1] || '';
                    const isExecuting = /\*\*🔧 .+?\*\*[^]*$/.test(lastChunk) && !/<\/details>\s*$/.test(lastChunk.trim());
                    const statusText = isExecuting ? '执行中' : '思考中';
                    return (
                    <div className={styles.thinkingBot}>
                      <svg className={styles.botSvg} width="28" height="28" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <linearGradient id="botBody" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#6C8EF2" />
                            <stop offset="100%" stopColor="#4A6CF7" />
                          </linearGradient>
                          <linearGradient id="botFace" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#E8F0FE" />
                            <stop offset="100%" stopColor="#C5D8F9" />
                          </linearGradient>
                        </defs>
                        <g transform="translate(0,800) scale(0.1,-0.1)" stroke="none">
                          {/* Body */}
                          <path fill="url(#botBody)" d="M4552 6155 c-67 -19 -85 -29 -136 -74 -30 -27 -60 -42 -111 -55 -332 -85 -548 -304 -619 -627 l-17 -75 -67 -12 c-140 -24 -291 -88 -355 -150 -42 -40 -87 -123 -87 -159 0 -14 -6 -23 -16 -23 -25 0 -186 -67 -325 -136 -137 -67 -286 -164 -381 -247 -94 -82 -217 -242 -279 -363 -30 -58 -58 -108 -64 -109 -92 -25 -102 -30 -155 -84 -67 -66 -128 -183 -161 -307 -32 -121 -38 -325 -11 -429 28 -112 67 -188 131 -258 61 -65 116 -96 172 -97 33 0 37 -3 48 -40 18 -60 103 -180 179 -251 200 -190 486 -332 852 -425 408 -104 751 -110 1225 -23 290 54 481 113 670 209 257 130 410 270 525 483 37 69 60 94 60 68 0 -16 86 -24 122 -12 159 52 236 422 168 803 -40 221 -177 406 -286 385 -22 -4 -28 2 -51 47 -96 190 -259 360 -505 527 -130 88 -335 191 -465 234 -54 17 -83 32 -83 41 0 20 -27 71 -59 112 -36 46 -143 115 -235 152 -74 30 -248 70 -302 70 -25 0 -26 2 -20 38 4 20 25 75 47 121 68 138 167 224 333 286 l66 25 15 -29 c21 -42 90 -98 143 -115 58 -20 157 -20 212 -1 58 20 115 68 148 123 22 39 27 58 26 112 -1 111 -54 199 -148 245 -66 32 -136 39 -204 20z m138 -245 c23 -44 -27 -77 -87 -57 -20 6 -38 17 -39 22 -2 6 16 24 39 41 45 33 67 32 87 -6z m-700 -845 c52 -8 124 -24 160 -36 138 -47 135 -47 -311 -51 -228 -2 -418 0 -423 4 -5 4 19 21 55 36 130 58 329 76 519 47z m480 -315 c310 -123 560 -279 738 -458 125 -127 188 -244 244 -452 31 -115 33 -389 4 -520 -28 -129 -63 -235 -113 -340 -75 -157 -208 -273 -437 -380 -174 -82 -369 -135 -676 -184 -311 -50 -435 -56 -631 -32 -478 60 -928 244 -1156 475 -78 79 -127 163 -164 282 -54 172 -64 240 -63 424 1 150 4 182 27 267 31 116 94 265 149 351 57 89 228 255 333 323 92 60 291 161 458 234 92 40 100 42 142 31 62 -15 273 -14 456 4 201 19 284 23 454 17 133 -4 145 -6 235 -42z m-2447 -1152 c-3 -93 -1 -200 5 -248 26 -198 25 -189 7 -157 -48 84 -70 306 -45 453 10 54 28 114 35 114 2 0 1 -73 -2 -162z m3711 -133 c1 -154 -2 -177 -23 -240 -13 -38 -27 -74 -32 -79 -13 -15 -11 54 6 179 8 61 15 180 16 265 l1 155 15 -55 c11 -38 16 -107 17 -225z"/>
                          {/* Face screen */}
                          <path fill="url(#botFace)" d="M3640 4394 c-194 -14 -558 -57 -625 -74 -224 -57 -381 -189 -480 -403 -56 -121 -76 -219 -82 -402 -6 -197 14 -311 77 -443 108 -225 363 -358 801 -418 179 -25 751 -25 1014 0 331 31 463 65 601 158 133 89 235 248 291 453 26 93 27 113 27 295 0 185 -2 199 -28 280 -43 131 -82 196 -171 286 -68 68 -97 89 -185 133 -215 105 -383 132 -845 136 -187 1 -365 1 -395 -1z m571 -234 c216 -22 460 -91 572 -162 172 -110 237 -232 237 -444 0 -245 -115 -458 -292 -542 -186 -89 -521 -129 -983 -118 -296 7 -440 22 -595 61 -378 96 -471 204 -474 545 -1 155 13 221 70 338 63 126 163 199 331 241 267 67 853 109 1134 81z"/>
                          {/* Left eye */}
                          <path fill="#2D3748" d="M3163 3865 c-156 -43 -257 -181 -257 -350 0 -144 60 -254 171 -312 78 -40 140 -50 218 -34 103 22 178 79 226 174 87 171 73 314 -42 429 -90 90 -205 124 -316 93z m44 -263 c-36 -38 -69 -81 -73 -96 -7 -30 9 -56 37 -56 22 0 123 103 145 148 13 28 18 31 30 21 9 -7 22 -26 30 -42 34 -65 -28 -179 -111 -207 -134 -44 -241 120 -150 229 29 34 99 71 134 71 22 0 17 -8 -42 -68z">
                            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
                          </path>
                          {/* Right eye */}
                          <path fill="#2D3748" d="M4373 3856 c-100 -32 -195 -114 -236 -204 -17 -37 -22 -66 -22 -137 0 -82 3 -97 33 -157 37 -77 90 -128 172 -167 47 -22 69 -26 145 -26 78 0 98 4 153 29 212 98 257 390 86 560 -92 92 -231 135 -331 102z m107 -212 c0 -3 -22 -31 -50 -61 -70 -80 -79 -133 -20 -133 22 0 35 10 64 50 20 27 44 66 55 85 l18 34 23 -24 c28 -29 37 -99 20 -150 -16 -48 -70 -74 -156 -75 -49 0 -67 5 -94 25 -44 32 -50 43 -50 87 0 44 36 90 107 137 42 28 83 40 83 25z">
                            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
                          </path>
                        </g>
                      </svg>
                      <span className={styles.thinkingText}>{statusText}</span>
                      <span className={styles.thinkingDots}>
                        <span>.</span><span>.</span><span>.</span>
                      </span>
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="p-3 border-t flex gap-2">
              <Input
                value={liveStreamFeedback}
                onChange={(e) => setLiveStreamFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLiveFeedback(); } }}
                placeholder="输入反馈意见..."
                className="flex-1"
                disabled={sendingFeedback}
              />
              <Button size="sm" onClick={() => sendLiveFeedback()} disabled={sendingFeedback || !liveStreamFeedback.trim()} title="发送反馈（等待当前执行完成后处理）">
                <span className="material-symbols-outlined text-sm">send</span>
              </Button>
              <Button size="sm" variant="destructive" onClick={() => sendLiveFeedback(true)} disabled={sendingFeedback || !liveStreamFeedback.trim()} title="打断当前执行，立即处理反馈">
                <span className="material-symbols-outlined text-sm">bolt</span>
              </Button>
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
                  {(() => {
                    // Deduplicate TodoWrite: only keep the latest todo-list chunk
                    const TODO_MK = '<!-- todo-list-marker -->';
                    let lastIdx = -1;
                    const filtered = markdownModal.chunks.filter((chunk, idx) => {
                      // Filter out filler chunks (e.g. lone "." between tool calls)
                      const stripped = chunk.replace(/\*\*🔧 .+?\*\*/g, '').replace(/<!--.*?-->/gs, '').trim();
                      if (stripped.length <= 1) return false;
                      if (!chunk.includes(TODO_MK)) return true;
                      if (lastIdx === -1) {
                        // Scan forward to find the last one
                        for (let k = markdownModal.chunks.length - 1; k >= 0; k--) {
                          if (markdownModal.chunks[k].includes(TODO_MK)) { lastIdx = k; break; }
                        }
                      }
                      return idx === lastIdx;
                    });
                    return filtered.map((chunk, i) => (
                      <div key={i} className={`${styles.markdownContent} text-sm border-b border-border/50 pb-3 last:border-0`}>
                        <Markdown>{chunk}</Markdown>
                      </div>
                    ));
                  })()}
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
      {showSkillSelector && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowSkillSelector(false)}>
          <div className="bg-card rounded-lg w-[700px] max-w-[90%] max-h-[80vh] flex flex-col border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b flex items-center justify-between shrink-0">
              <h3 className="text-lg font-semibold">
                <span className="material-symbols-outlined text-lg mr-2 align-middle">list</span>
                选择 Skills
              </h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowSkillSelector(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 w-8"></th>
                    <th className="text-left py-2 px-2">名称</th>
                    <th className="text-left py-2 px-2">描述</th>
                    <th className="text-left py-2 px-2">标签</th>
                  </tr>
                </thead>
                <tbody>
                  {availableSkills.map((skill) => (
                    <tr key={skill.name} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-2">
                        <Checkbox
                          checked={skills.includes(skill.name)}
                          onCheckedChange={(checked) => {
                            const newSkills = checked
                              ? [...skills, skill.name]
                              : skills.filter(s => s !== skill.name);
                            dispatch({ type: 'SET_SKILLS', payload: newSkills });
                          }}
                        />
                      </td>
                      <td className="py-2 px-2 font-medium">{skill.name}</td>
                      <td className="py-2 px-2 text-muted-foreground">{skill.description}</td>
                      <td className="py-2 px-2">
                        <div className="flex flex-wrap gap-1">
                          {(skill as any).tags?.slice(0, 3).map((tag: string) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t flex justify-between items-center shrink-0">
              <span className="text-sm text-muted-foreground">已选择 {skills.length} 个</span>
              <Button onClick={() => setShowSkillSelector(false)}>确定</Button>
            </div>
          </div>
        </div>
      )}
      {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
      {showContextEditor && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowContextEditor(false)}>
          <div className="bg-card rounded-lg w-[600px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold">
                <span className="material-symbols-outlined text-lg mr-2 align-middle">edit_note</span>
                {editingContextScope === 'global' ? '全局上下文' : `阶段上下文 — ${editingContextPhase}`}
              </h3>
            </div>
            <div className="p-5">
              <p className="text-sm text-muted-foreground mb-3">
                {editingContextScope === 'global'
                  ? '全局上下文将注入到所有步骤的 prompt 中'
                  : `此上下文将注入到「${editingContextPhase}」阶段所有步骤的 prompt 中`}
              </p>
              <Textarea
                value={editingContextValue}
                onChange={(e) => setEditingContextValue(e.target.value)}
                placeholder="输入上下文信息，例如：注意代码风格要符合项目规范..."
                rows={6}
                className="w-full"
              />
            </div>
            <div className="p-5 border-t flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowContextEditor(false)}>取消</Button>
              <Button onClick={saveContext}>保存</Button>
            </div>
          </div>
        </div>
      )}

      {/* 人工审查对话框 */}
      {humanApprovalData && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg w-[700px] max-w-[90%] border shadow-2xl">
            <div className="p-5 border-b bg-orange-50 dark:bg-orange-950">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-orange-500">person</span>
                人工审查 - {humanApprovalData.currentState}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                状态已完成，请选择下一步操作
              </p>
            </div>

            <div className="p-5 max-h-[60vh] overflow-y-auto">
              {/* 执行结果摘要 */}
              <div className="mb-4 p-3 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium mb-2">执行结果</div>
                <div className="text-xs text-muted-foreground">
                  <div>判定: <span className="font-medium">{humanApprovalData.result?.verdict || 'N/A'}</span></div>
                  <div>问题数: <span className="font-medium">{humanApprovalData.result?.issues?.length || 0}</span></div>
                  {humanApprovalData.result?.summary && (
                    <div className="mt-2 text-xs">{humanApprovalData.result.summary}</div>
                  )}
                </div>
              </div>

              {/* Agent 输出内容 */}
              {humanApprovalData.result?.stepOutputs?.length > 0 && (
                <div className="mb-4">
                  <div className="text-sm font-medium mb-2">Agent 输出</div>
                  <div className="space-y-2">
                    {humanApprovalData.result.stepOutputs.map((output: string, idx: number) => (
                      <details key={idx} open={humanApprovalData.result.stepOutputs.length === 1}>
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground py-1">
                          步骤 {idx + 1} 输出 ({output.length > 200 ? `${Math.ceil(output.length / 1024)}KB` : `${output.length} 字符`})
                        </summary>
                        <div className="mt-1 p-3 bg-muted/20 rounded border text-xs font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                          {output}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              {/* AI 建议的下一步 */}
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="text-sm font-medium mb-1 text-blue-700 dark:text-blue-400">
                  AI 建议
                </div>
                <div className="text-sm">
                  → {humanApprovalData.nextState}
                </div>
              </div>

              {/* 可选的跳转目标 */}
              <div className="mb-2">
                <div className="text-sm font-medium mb-2">选择下一步：</div>
                <div className="space-y-2">
                  {humanApprovalData.availableStates.map((stateName) => (
                    <button
                      key={stateName}
                      onClick={() => handleForceTransition(stateName)}
                      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                        stateName === humanApprovalData.nextState
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-950'
                          : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{stateName}</span>
                        {stateName === humanApprovalData.nextState && (
                          <Badge variant="outline" className="text-xs bg-blue-100 dark:bg-blue-900">推荐</Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 强制跳转对话框 */}
      {forceTransitionModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setForceTransitionModal(null)}>
          <div className="bg-card rounded-lg w-[600px] max-w-[90%] border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-orange-500">alt_route</span>
                强制跳转到: {forceTransitionModal.targetState}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                可选：为 AI 提供跳转指令
              </p>
            </div>

            <div className="p-5">
              <Textarea
                value={forceTransitionModal.instruction}
                onChange={(e) => setForceTransitionModal({ ...forceTransitionModal, instruction: e.target.value })}
                placeholder="输入给 AI 的指令，例如：重点关注性能问题，忽略代码风格..."
                rows={4}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                此指令将被添加到 AI 的 prompt 中，帮助 AI 更好地理解你的意图
              </p>
            </div>

            <div className="p-5 border-t flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setForceTransitionModal(null)}>取消</Button>
              <Button onClick={executeForceTransition}>
                <span className="material-symbols-outlined text-sm mr-1">check</span>
                确认跳转
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}