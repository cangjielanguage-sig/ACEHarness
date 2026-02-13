'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { configApi, workflowApi, agentApi, runsApi, processApi, streamApi } from '@/lib/api';
import { useWorkflowState } from '@/hooks/useWorkflowState';
import type { ViewMode } from '@/hooks/useWorkflowState';
import FlowDiagram from '@/components/FlowDiagram';
import DesignFlowDiagram from '@/components/DesignFlowDiagram';
import AgentPanel from '@/components/AgentPanel';
import AgentConfigPanel from '@/components/AgentConfigPanel';
import EditNodeModal from '@/components/EditNodeModal';
import ProcessPanel from '@/components/ProcessPanel';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

  const { state, dispatch, addLog } = useWorkflowState(initialMode);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [viewingHistoryRun, setViewingHistoryRun] = useState(false);
  const [fullStepOutput, setFullStepOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ title: string; content: string } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [liveStream, setLiveStream] = useState<string | null>(null);
  const [showLiveStream, setShowLiveStream] = useState(false);
  const liveStreamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const {
    viewMode, workflowConfig, editingConfig, agentConfigs,
    workflowStatus, runId, currentPhase, currentStep, agents, logs, completedSteps, failedSteps,
    showCheckpoint, checkpointMessage, activeTab, selectedAgent, selectedStep,
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
      addLog('system', 'info', `查看历史运行: ${runId}`);
    } catch (error: any) {
      addLog('system', 'error', `加载历史运行失败: ${error.message}`);
    }
  };

  const loadWorkflowConfig = async () => {
    try {
      const { config, agents: loadedAgents } = await configApi.getConfig(configFile);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: loadedAgents || [] });
      dispatch({ type: 'SET_PROJECT_ROOT', payload: config.context?.projectRoot || '' });
      dispatch({ type: 'SET_REQUIREMENTS', payload: config.context?.requirements || '' });
      dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: config.context?.timeoutMinutes || 30 });
    } catch (error) {
      console.error('加载工作流配置失败:', error);
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
    try {
      const config = { ...workflowConfig, context: { ...workflowConfig.context, projectRoot, requirements, timeoutMinutes } };
      await configApi.saveConfig(configFile, config);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      alert('配置已保存');
    } catch (error: any) {
      alert('保存失败: ' + error.message);
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
      await workflowApi.approve();
      dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
      addLog('system', 'success', '✓ 检查点已批准，继续执行');
    } catch (error: any) {
      addLog('system', 'error', `批准失败: ${error.message}`);
    }
  };

  const rejectCheckpoint = async () => {
    dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
    await stopWorkflow();
    addLog('system', 'warning', '✗ 检查点被拒绝，工作流已停止');
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
    // Try to load full output from server
    const rid = runId || selectedRun?.id;
    if (rid) {
      try {
        const { content } = await runsApi.getStepOutput(rid, stepName);
        setMarkdownModal({ title: stepName, content });
        return;
      } catch { /* fall through to local */ }
    }
    setMarkdownModal({ title: stepName, content: result.output });
  };

  // --- Live stream polling ---
  const startLiveStream = () => {
    setShowLiveStream(true);
    setLiveStream(null);
    if (liveStreamRef.current) clearInterval(liveStreamRef.current);
    liveStreamRef.current = setInterval(async () => {
      try {
        // Try in-memory process first
        const { processes } = await processApi.list();
        const running = processes.find((p: any) => p.status === 'running');
        if (running?.streamContent) {
          setLiveStream(running.streamContent);
          return;
        }
        // Fallback: read from persisted stream file
        const rid = runId || selectedRun?.id;
        const step = currentStep || selectedStep?.name;
        if (rid && step) {
          const content = await streamApi.getStreamContent(rid, step);
          if (content) {
            setLiveStream(content);
            return;
          }
        }
        // Check latest completed process
        const latest = processes.sort((a: any, b: any) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        )[0];
        if (latest?.streamContent) {
          setLiveStream(latest.streamContent);
        } else {
          setLiveStream('(等待输出...)');
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
    if (!confirm('确定要删除吗？')) return;
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

  const handleSaveConfig = async () => {
    if (!editingConfig) return;
    try {
      await configApi.saveConfig(configFile, editingConfig);
      alert('配置已保存！下次运行时生效。');
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: editingConfig });
    } catch (error: any) {
      alert('保存失败: ' + error.message);
    }
  };

  const handleSaveAgent = async (agent: any) => {
    try {
      await agentApi.saveAgent(agent.name, agent);
      // Reload agents
      const { agents: updatedAgents } = await agentApi.listAgents();
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: updatedAgents });
    } catch (error: any) {
      alert('保存 Agent 失败: ' + error.message);
    }
  };

  const handleDeleteAgent = async (name: string) => {
    try {
      await agentApi.deleteAgent(name);
      const { agents: updatedAgents } = await agentApi.listAgents();
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: updatedAgents });
    } catch (error: any) {
      alert('删除 Agent 失败: ' + error.message);
    }
  };

  const getEditingNodeData = () => {
    if (!editingNode || !editingConfig) return null;
    if (editingNode.type === 'phase') return editingConfig.workflow.phases[editingNode.phaseIndex];
    if (editingNode.stepIndex !== undefined) return editingConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex];
    return null;
  };

  return (
    <div className={styles.ideContainer}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <Link href="/" className={styles.backBtn}>← 首页</Link>
          <h1 className={styles.appTitle}>
            <span className={styles.titleIcon}>⚡</span>
            {workflowConfig?.workflow?.name || configFile}
          </h1>
          <div className={styles.viewModeTabs}>
            <button className={`${styles.viewModeTab} ${viewMode === 'run' ? styles.active : ''}`}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'run' })}>▶️ 运行</button>
            <button className={`${styles.viewModeTab} ${viewMode === 'design' ? styles.active : ''}`}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'design' })}>✏️ 设计</button>
            <button className={`${styles.viewModeTab} ${viewMode === 'history' ? styles.active : ''}`}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'history' })}>📜 历史</button>
          </div>
        </div>
        <div className={styles.toolbarCenter}>
          {viewMode === 'run' && (<>
            <button onClick={startWorkflow} disabled={isRunning} className={`${styles.btn} ${styles.btnPrimary}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 4, verticalAlign: -2 }}><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>启动工作流</button>
            <button onClick={stopWorkflow} disabled={!isRunning} className={`${styles.btn} ${styles.btnDanger}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 4, verticalAlign: -2 }}><rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>停止</button>
            <button onClick={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: !showProcessPanel })}
              className={`${styles.btn} ${styles.btnSecondary}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 4, verticalAlign: -2 }}><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><circle cx="7" cy="7" r="2" fill="currentColor"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 1M10.2 10.2l1 1M11.2 2.8l-1 1M3.8 10.2l-1 1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>进程管理</button>
          </>)}
          {viewMode === 'design' && (
            <button onClick={handleSaveConfig} className={`${styles.btn} ${styles.btnSuccess}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 4, verticalAlign: -2 }}><path d="M2 1.5h7.5L12.5 4.5V12a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.3" fill="none"/><rect x="4" y="8" width="6" height="4" rx=".5" stroke="currentColor" strokeWidth="1" fill="none"/><path d="M5 1.5v3h4v-3" stroke="currentColor" strokeWidth="1"/></svg>保存配置</button>
          )}
        </div>
        <div className={styles.toolbarRight}>
          <div className={`${styles.statusIndicator} ${styles[workflowStatus]}`}>
            <span className={styles.statusDot}></span><span>{getStatusText(workflowStatus)}</span>
          </div>
        </div>
      </div>

      <div className={styles.mainContent}>
        {viewMode === 'run' && (<>
          <div className={styles.sidebar}>
            <div className={styles.sidebarTabs}>
              <button className={`${styles.tabBtn} ${activeTab === 'workflow' ? styles.active : ''}`}
                onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: 'workflow' })}><span className={styles.tabIcon}>📊</span>工作流</button>
              <button className={`${styles.tabBtn} ${activeTab === 'agents' ? styles.active : ''}`}
                onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: 'agents' })}><span className={styles.tabIcon}>🤖</span>Agents</button>
              <button className={`${styles.tabBtn} ${activeTab === 'config' ? styles.active : ''}`}
                onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: 'config' })}><span className={styles.tabIcon}>⚙️</span>配置</button>
            </div>
            <div className={styles.sidebarContent}>
              {activeTab === 'workflow' && workflowConfig && (
                <div className={styles.tabPanel}>
                  <div className={styles.workflowInfo}>
                    {editingName ? (
                      <input className={styles.inlineNameInput} autoFocus value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        onBlur={() => saveWorkflowName(nameValue)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveWorkflowName(nameValue); if (e.key === 'Escape') setEditingName(false); }}
                      />
                    ) : (
                      <h3 className={styles.editableName} onClick={() => { setNameValue(workflowConfig.workflow.name); setEditingName(true); }}
                        title="点击编辑名称">{workflowConfig.workflow.name}</h3>
                    )}
                    <p className={styles.workflowDesc}>{workflowConfig.workflow.description}</p>
                    <div className={styles.workflowStats}>
                      <div className={styles.stat}><span className={styles.statLabel}>阶段</span><span className={styles.statValue}>{workflowConfig.workflow.phases.length}</span></div>
                      <div className={styles.stat}><span className={styles.statLabel}>步骤</span><span className={styles.statValue}>{totalSteps}</span></div>
                      <div className={styles.stat}><span className={styles.statLabel}>Agent</span><span className={styles.statValue}>{agentConfigs.length}</span></div>
                    </div>
                  </div>
                  <div className={styles.phaseCards}>
                    {workflowConfig.workflow.phases.map((phase: any, idx: number) => {
                      const phaseAgents = phase.steps.map((s: any) => {
                        const role = agentConfigs.find((r: any) => r.name === s.agent);
                        return { name: s.agent, team: role?.team || 'blue', role: s.role };
                      });
                      const iterState = iterationStates[phase.name];
                      return (<div key={idx} className={styles.phaseCard}>
                        <div className={styles.phaseCardHeader}>
                          <span className={styles.phaseCardName}>{phase.name}</span>
                          {phase.iteration?.enabled && (<span className={styles.loopBadge}>🔄 {iterState ? `${iterState.currentIteration}/${iterState.maxIterations}` : `max ${phase.iteration.maxIterations}`}</span>)}
                        </div>
                        <div className={styles.agentChips}>
                          {phaseAgents.map((a: any, i: number) => (<span key={i} className={`${styles.agentChip} ${styles[a.team]}`}>{a.role === 'attacker' ? '⚔️' : a.role === 'judge' ? '⚖️' : '🛡️'} {a.name}</span>))}
                        </div>
                      </div>);
                    })}
                  </div>
                </div>
              )}
              {activeTab === 'agents' && (<div className={styles.tabPanel}><div className={styles.agentsList}>
                {agents.map((agent) => (<div key={agent.name} className={`${styles.agentItem} ${selectedAgent?.name === agent.name ? styles.active : ''}`}
                  onClick={() => dispatch({ type: 'SET_SELECTED_AGENT', payload: agent })}>
                  <div className={styles.agentItemHeader}><span className={styles.agentItemIcon}>🤖</span><span className={styles.agentItemName}>{agent.name}</span></div>
                  <div className={styles.agentItemStatus}><span className={styles.statusDot}></span>{agent.status}</div>
                </div>))}
              </div></div>)}
              {activeTab === 'config' && (<div className={styles.tabPanel}><div className={styles.configSection}><h4>项目配置</h4>
                <div className={styles.configItem}><label>项目根目录</label>
                  <input value={projectRoot} onChange={(e) => dispatch({ type: 'SET_PROJECT_ROOT', payload: e.target.value })} type="text" className={styles.configInput} placeholder="../cangjie_compiler" /></div>
                <div className={styles.configItem}><label>需求描述</label>
                  <textarea value={requirements} onChange={(e) => dispatch({ type: 'SET_REQUIREMENTS', payload: e.target.value })} className={styles.configTextarea} rows={6} placeholder="请输入需求描述..."></textarea></div>
                <div className={styles.configItem}><label>步骤超时（分钟）</label>
                  <input value={timeoutMinutes} onChange={(e) => dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: Math.max(1, parseInt(e.target.value) || 1) })} type="number" min={1} className={styles.configInput} /></div>
                <button onClick={saveConfig} className={`${styles.btn} ${styles.btnSuccess}`}>保存配置</button>
              </div></div>)}
            </div>
          </div>
          <div className={styles.centerPanel}>
            <div className={styles.panelHeader}><h2>工作流可视化</h2></div>
            <div className={styles.panelContent}>
              {workflowConfig ? (<FlowDiagram workflow={workflowConfig.workflow} currentPhase={currentPhase} currentStep={currentStep}
                agents={agents} completedSteps={completedSteps} failedSteps={failedSteps} iterationStates={iterationStates} onSelectStep={selectStep} />
              ) : (<div className={styles.emptyState}><span className={styles.emptyIcon}>📊</span><p>加载中...</p></div>)}
            </div>
          </div>
          <div className={styles.rightPanel}>
            <div className={styles.panelHeader}><h2>{selectedStep ? selectedStep.name : selectedAgent ? selectedAgent.name : 'Agent 详情'}</h2></div>
            <div className={styles.panelContent}>
              {selectedStep && (
                <div className={styles.stepDetail}>
                  <div className={styles.stepDetailHeader}>
                    <span className={styles.stepDetailRole}>
                      {selectedStep.role === 'attacker' ? '⚔️' : selectedStep.role === 'judge' ? '⚖️' : '🛡️'}
                    </span>
                    <span className={styles.stepDetailName}>{selectedStep.name}</span>
                    {selectedRoleConfig && (
                      <span className={`${styles.teamBadge} ${styles[selectedRoleConfig.team]}`}>{selectedRoleConfig.team}</span>
                    )}
                  </div>
                  <div className={styles.stepDetailTask}>
                    <div className={styles.detailLabel}>任务描述</div>
                    <div className={styles.detailValue}>{selectedStep.task}</div>
                  </div>
                  {selectedStep.constraints?.length > 0 && (
                    <div className={styles.stepDetailConstraints}>
                      <div className={styles.detailLabel}>约束条件</div>
                      <ul className={styles.constraintList}>
                        {selectedStep.constraints.map((c: string, i: number) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedRoleConfig && (
                    <div className={styles.roleConfigSection}>
                      <div className={styles.detailLabel}>Agent 配置</div>
                      <div className={styles.roleConfigGrid}>
                        <span className={styles.roleConfigKey}>模型</span>
                        <span className={styles.roleConfigVal}>{selectedRoleConfig.model || '-'}</span>
                      </div>
                      {selectedRoleConfig.temperature !== undefined && (
                        <div className={styles.roleConfigGrid}>
                          <span className={styles.roleConfigKey}>Temperature</span>
                          <span className={styles.roleConfigVal}>{selectedRoleConfig.temperature}</span>
                        </div>
                      )}
                      {selectedRoleConfig.capabilities?.length > 0 && (
                        <div className={styles.capabilitiesRow}>
                          {selectedRoleConfig.capabilities.map((cap: string, i: number) => (
                            <span key={i} className={styles.capabilityTag}>{cap}</span>
                          ))}
                        </div>
                      )}
                      {selectedRoleConfig.constraints?.length > 0 && (
                        <div className={styles.stepDetailConstraints}>
                          <div className={styles.detailLabel}>Agent 约束</div>
                          <ul className={styles.constraintList}>
                            {selectedRoleConfig.constraints.map((c: string, i: number) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedRoleConfig.systemPrompt && (
                        <div className={styles.systemPromptSection}>
                          <button className={styles.systemPromptToggle} onClick={() => setShowSystemPrompt(!showSystemPrompt)}>
                            {showSystemPrompt ? '▼' : '▶'} System Prompt
                          </button>
                          {showSystemPrompt && (
                            <pre className={styles.systemPromptContent}>{selectedRoleConfig.systemPrompt}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {selectedStep && stepResults[selectedStep.name] && (
                <div className={styles.stepDetail}>
                  <div className={styles.detailLabel}>
                    {stepResults[selectedStep.name].error ? '❌ 执行错误' : '✅ 执行结果'}
                  </div>
                  {stepResults[selectedStep.name].costUsd !== undefined && (
                    <div style={{ fontSize: 11, color: '#808080', marginBottom: 6 }}>
                      费用: ${stepResults[selectedStep.name].costUsd?.toFixed(4)}
                      {stepResults[selectedStep.name].durationMs ? ` · 耗时: ${(stepResults[selectedStep.name].durationMs! / 1000).toFixed(1)}s` : ''}
                    </div>
                  )}
                  {stepResults[selectedStep.name].error ? (
                    <pre className={styles.systemPromptContent} style={{ color: '#c75450', borderColor: '#c75450' }}>
                      {stepResults[selectedStep.name].error}
                    </pre>
                  ) : fullStepOutput ? (
                    <pre className={styles.systemPromptContent}>
                      {fullStepOutput}
                    </pre>
                  ) : (
                    <>
                      <pre className={styles.systemPromptContent}>
                        {stepResults[selectedStep.name].output.length > 2000
                          ? stepResults[selectedStep.name].output.substring(0, 2000) + '\n...(已截断)'
                          : stepResults[selectedStep.name].output}
                      </pre>
                      {stepResults[selectedStep.name].output.length > 2000 && (runId || selectedRun?.id) && (
                        <button onClick={() => loadFullOutput(selectedStep.name)}
                          disabled={loadingOutput}
                          className={`${styles.btn} ${styles.btnSecondary}`}
                          style={{ marginTop: 6, fontSize: 11 }}>
                          {loadingOutput ? '加载中...' : '📄 查看完整输出'}
                        </button>
                      )}
                    </>
                  )}
                  {!stepResults[selectedStep.name].error && (
                    <button onClick={() => openMarkdownModal(selectedStep.name)}
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      style={{ marginTop: 6, fontSize: 11 }}>
                      查看 Markdown
                    </button>
                  )}
                </div>
              )}
              {/* Resume button on failed/crashed step */}
              {selectedStep && failedSteps.includes(selectedStep.name) && !isRunning && (runId || selectedRun?.id) && (
                <div className={styles.stepDetail}>
                  <button onClick={() => resumeWorkflow()} disabled={isRunning}
                    className={`${styles.btn} ${styles.btnSuccess}`} style={{ fontSize: 12, width: '100%' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 6, verticalAlign: -2 }}>
                      <path d="M2 7a5 5 0 019.33-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                      <path d="M12 7a5 5 0 01-9.33 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                      <path d="M11 2v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      <path d="M3 12v-3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                    从此步骤恢复运行
                  </button>
                  <div style={{ fontSize: 11, color: '#808080', marginTop: 6 }}>
                    将跳过已完成的 {completedSteps.length} 个步骤，从「{selectedStep.name}」重新开始执行
                  </div>
                </div>
              )}
              {/* Resume button when viewing crashed/stopped run without specific step selected */}
              {!selectedStep && !isRunning && (workflowStatus === 'failed' || workflowStatus === 'stopped') && (runId || selectedRun?.id) && (
                <div className={styles.stepDetail}>
                  <button onClick={() => resumeWorkflow()} disabled={isRunning}
                    className={`${styles.btn} ${styles.btnSuccess}`} style={{ fontSize: 12, width: '100%' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 6, verticalAlign: -2 }}>
                      <path d="M2 7a5 5 0 019.33-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                      <path d="M12 7a5 5 0 01-9.33 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                      <path d="M11 2v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      <path d="M3 12v-3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                    恢复运行
                  </button>
                  <div style={{ fontSize: 11, color: '#808080', marginTop: 6 }}>
                    已完成 {completedSteps.length} 步，将从中断处继续
                  </div>
                </div>
              )}
              {/* Live stream button for currently running step */}
              {selectedStep && currentStep === selectedStep.name && isRunning && !stepResults[selectedStep.name] && (
                <div className={styles.stepDetail}>
                  <div className={styles.detailLabel}>🔄 正在执行中...</div>
                  <button onClick={startLiveStream}
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    style={{ marginTop: 6, fontSize: 12 }}>
                    📡 查看实时输出
                  </button>
                </div>
              )}
              {/* Also show live stream button when step has no result and is running */}
              {isRunning && !selectedStep && currentStep && (
                <div className={styles.stepDetail}>
                  <div className={styles.detailLabel}>🔄 当前步骤: {currentStep}</div>
                  <button onClick={startLiveStream}
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    style={{ marginTop: 6, fontSize: 12 }}>
                    📡 查看实时输出
                  </button>
                </div>
              )}
              {selectedAgent ? (<AgentPanel agent={selectedAgent} logs={logs} onClearLogs={(name) => dispatch({ type: 'CLEAR_AGENT_LOGS', payload: name })} />
              ) : (<div className={styles.emptyState}><span className={styles.emptyIcon}>🤖</span><p>选择一个 Agent 查看详情</p></div>)}
            </div>
          </div>
        </>)}
        {viewMode === 'design' && editingConfig && (<div className={styles.designLayout}>
          <div className={styles.designFlowArea}><div className={styles.panelHeader}><h2>工作流设计</h2></div>
            <div className={styles.panelContent}><DesignFlowDiagram workflow={editingConfig.workflow}
              onUpdateWorkflow={(wf: any) => dispatch({ type: 'SET_EDITING_CONFIG', payload: { ...editingConfig, workflow: wf } })}
              onSelectNode={handleSelectNode} /></div></div>
          <div className={styles.designConfigArea}><AgentConfigPanel agents={agentConfigs} onSaveAgent={handleSaveAgent} onDeleteAgent={handleDeleteAgent} /></div>
        </div>)}
        {viewMode === 'history' && (<div className={styles.mainContent} style={{ flex: 1 }}>
          <div className={styles.sidebar}>
            <div className={styles.panelHeader}><h2>运行记录</h2></div>
            <div className={styles.sidebarContent}>
              {historyRuns.length === 0 ? (
                <div style={{ color: '#808080', fontSize: 13, textAlign: 'center', padding: 20 }}>暂无运行记录</div>
              ) : (
                <div className={styles.agentsList}>
                  {historyRuns.map((run) => (
                    <div key={run.id} className={`${styles.agentItem} ${selectedRun?.id === run.id ? styles.active : ''}`}
                      onClick={() => { setSelectedRun(run); viewHistoryRun(run.id); }}>
                      <div className={styles.agentItemHeader}>
                        <span className={styles.agentItemIcon}>
                          {run.status === 'completed' ? '✅' : run.status === 'failed' || run.status === 'crashed' ? '❌' : run.status === 'stopped' ? '⏹️' : '🔄'}
                        </span>
                        <span className={styles.agentItemName}>{run.id}</span>
                      </div>
                      <div className={styles.agentItemStatus}>
                        <span className={`${styles.statusDot}`} style={{
                          background: run.status === 'completed' ? '#6a8759' : run.status === 'failed' || run.status === 'crashed' ? '#c75450' : run.status === 'stopped' ? '#cc7832' : '#4a88c7',
                          animation: 'none',
                        }}></span>
                        {run.status === 'crashed' ? '崩溃' : run.status === 'completed' ? '完成' : run.status === 'failed' ? '失败' : run.status === 'stopped' ? '已停止' : '运行中'}
                      </div>
                      <div style={{ fontSize: 11, color: '#808080', marginTop: 4 }}>
                        {new Date(run.startTime).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 11, color: '#808080', marginTop: 2 }}>
                        {run.phaseReached ? `阶段: ${run.phaseReached}` : ''} · {run.completedSteps}/{run.totalSteps} 步
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={styles.centerPanel}>
            <div className={styles.panelHeader}><h2>{selectedRun ? `运行详情 - ${selectedRun.id}` : '运行历史'}</h2></div>
            <div className={styles.panelContent}>
              {!selectedRun ? (
                <div className={styles.emptyState}><span className={styles.emptyIcon}>📜</span><p>选择一条运行记录查看详情</p></div>
              ) : !runDetail ? (
                <div className={styles.emptyState}><span className={styles.emptyIcon}>📄</span><p>无详细状态数据</p></div>
              ) : (
                <div style={{ padding: 16 }}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    {[
                      { label: '状态', value: runDetail.status, color: runDetail.status === 'completed' ? '#6a8759' : runDetail.status === 'failed' || runDetail.status === 'crashed' ? '#c75450' : '#cc7832' },
                      { label: '开始', value: new Date(runDetail.startTime).toLocaleString() },
                      { label: '结束', value: runDetail.endTime ? new Date(runDetail.endTime).toLocaleString() : '-' },
                      { label: '阶段', value: runDetail.currentPhase || '-' },
                      { label: '完成步骤', value: `${runDetail.completedSteps?.length || 0}` },
                    ].map((item, i) => (
                      <div key={i} className={styles.stat} style={{ flex: 'none', minWidth: 120 }}>
                        <span className={styles.statLabel}>{item.label}</span>
                        <span className={styles.statValue} style={{ fontSize: 14, color: item.color || '#a9b7c6' }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  {(runDetail.status === 'crashed' || runDetail.status === 'failed' || runDetail.status === 'stopped') && (
                    <div style={{ marginBottom: 16 }}>
                      {runDetail.statusReason && (
                        <div style={{
                          background: runDetail.status === 'crashed' ? '#402020' : '#3a3020',
                          border: `1px solid ${runDetail.status === 'crashed' ? '#c75450' : '#cc7832'}`,
                          borderRadius: 6, padding: '10px 14px', marginBottom: 12,
                        }}>
                          <div style={{ color: runDetail.status === 'crashed' ? '#c75450' : '#cc7832', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                            {runDetail.status === 'crashed' ? '💥 崩溃原因' : runDetail.status === 'failed' ? '❌ 失败原因' : '⏹️ 停止原因'}
                          </div>
                          <div style={{ color: '#a9b7c6', fontSize: 12, lineHeight: 1.5 }}>{runDetail.statusReason}</div>
                        </div>
                      )}
                      {!runDetail.statusReason && runDetail.status === 'crashed' && (
                        <div style={{
                          background: '#402020', border: '1px solid #c75450',
                          borderRadius: 6, padding: '10px 14px', marginBottom: 12,
                        }}>
                          <div style={{ color: '#c75450', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>💥 崩溃原因</div>
                          <div style={{ color: '#a9b7c6', fontSize: 12 }}>服务重启或进程意外终止，运行被标记为崩溃。</div>
                        </div>
                      )}
                      <button onClick={() => resumeWorkflow(selectedRun.id)} disabled={isRunning}
                        className={`${styles.btn} ${styles.btnSuccess}`} style={{ fontSize: 13 }}>
                        <span className={styles.btnIcon}>🔄</span>
                        从此处恢复运行 ({runDetail.completedSteps?.length || 0} 步已完成，跳过已完成步骤继续执行)
                      </button>
                    </div>
                  )}
                  {runDetail.agents?.length > 0 && (<>
                    <h3 style={{ color: '#a9b7c6', fontSize: 14, margin: '16px 0 8px' }}>Agent 状态</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {runDetail.agents.map((agent: any, i: number) => (
                        <div key={i} className={styles.phaseCard}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 14 }}>
                              {agent.status === 'completed' ? '✅' : agent.status === 'failed' ? '❌' : agent.status === 'running' ? '🔄' : '⏳'}
                            </span>
                            <span style={{ color: '#a9b7c6', fontSize: 13, fontWeight: 500, flex: 1 }}>{agent.name}</span>
                            <span className={`${styles.agentChip} ${styles[agent.team]}`}>{agent.team}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#808080' }}>
                            <span>模型: {agent.model}</span>
                            <span>完成: {agent.completedTasks} 任务</span>
                            <span>迭代: {agent.iterationCount}</span>
                            {agent.costUsd > 0 && <span>费用: ${agent.costUsd.toFixed(4)}</span>}
                            {(agent.tokenUsage?.inputTokens > 0 || agent.tokenUsage?.outputTokens > 0) && (
                              <span>Token: {agent.tokenUsage.inputTokens}↓ {agent.tokenUsage.outputTokens}↑</span>
                            )}
                          </div>
                          {agent.summary && (
                            <div style={{ fontSize: 12, color: '#a9b7c6', marginTop: 4, lineHeight: 1.4 }}>{agent.summary}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>)}
                  {runDetail.completedSteps?.length > 0 && (<>
                    <h3 style={{ color: '#a9b7c6', fontSize: 14, margin: '16px 0 8px' }}>完成的步骤</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {runDetail.completedSteps.map((step: string, i: number) => (
                        <span key={i} className={styles.capabilityTag} style={{ background: '#2d4a2d', color: '#6a8759' }}>{step}</span>
                      ))}
                    </div>
                  </>)}
                  {Object.keys(runDetail.iterationStates || {}).length > 0 && (<>
                    <h3 style={{ color: '#a9b7c6', fontSize: 14, margin: '16px 0 8px' }}>迭代状态</h3>
                    {Object.entries(runDetail.iterationStates).map(([phase, iter]: [string, any]) => (
                      <div key={phase} className={styles.phaseCard} style={{ marginBottom: 6 }}>
                        <div style={{ color: '#a9b7c6', fontSize: 13, fontWeight: 500 }}>{phase}</div>
                        <div style={{ fontSize: 11, color: '#808080', marginTop: 4 }}>
                          迭代: {iter.currentIteration}/{iter.maxIterations} · 连续无 Bug: {iter.consecutiveCleanRounds} 轮 · 状态: {iter.status}
                        </div>
                        {iter.bugsFoundPerRound?.length > 0 && (
                          <div style={{ fontSize: 11, color: '#808080', marginTop: 2 }}>
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

      {showProcessPanel && (<div className={styles.processOverlay}><div className={styles.processContainer}>
        <ProcessPanel onClose={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: false })} />
      </div></div>)}
      {editingNode && (<EditNodeModal isOpen={showEditNodeModal} type={editingNode.type} data={getEditingNodeData()} roles={agentConfigs}
        onClose={() => { dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false }); dispatch({ type: 'SET_EDITING_NODE', payload: null }); }}
        onSave={handleSaveNode} onDelete={handleDeleteNode} />)}
      {showCheckpoint && (<div className={styles.modalOverlay} onClick={() => dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false })}>
        <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}><h3>✋ 人工检查点</h3></div>
          <div className={styles.modalBody}><p className={styles.checkpointMessage}>{checkpointMessage}</p>
            <div className={styles.checkpointInfo}><p>当前阶段: <strong>{currentPhase}</strong></p><p>请审查工作成果，决定是否继续执行</p></div></div>
          <div className={styles.modalFooter}>
            <button onClick={approveCheckpoint} className={`${styles.btn} ${styles.btnSuccess}`}>✓ 批准继续</button>
            <button onClick={rejectCheckpoint} className={`${styles.btn} ${styles.btnDanger}`}>✗ 拒绝并停止</button>
          </div>
        </div>
      </div>)}
      {showLiveStream && (
        <div className={styles.modalOverlay} onClick={stopLiveStream}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ width: '80%', maxWidth: 800, maxHeight: '80vh' }}>
            <div className={styles.modalHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>📡 实时输出 {currentStep ? `- ${currentStep}` : ''}</h3>
              <button onClick={stopLiveStream} className={`${styles.btn} ${styles.btnSecondary}`} style={{ fontSize: 11, padding: '4px 10px' }}>关闭</button>
            </div>
            <div className={styles.modalBody} style={{ maxHeight: '60vh', overflow: 'auto' }}>
              <pre className={styles.systemPromptContent} style={{ maxHeight: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                {liveStream || '(等待输出...)'}
              </pre>
            </div>
          </div>
        </div>
      )}
      {markdownModal && (
        <div className={styles.modalOverlay} onClick={() => setMarkdownModal(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} style={{ width: '80%', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className={styles.modalHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{markdownModal.title}</h3>
              <button onClick={() => setMarkdownModal(null)} className={styles.btn} style={{ fontSize: 18, lineHeight: 1, padding: '4px 8px' }}>&times;</button>
            </div>
            <div className={styles.modalBody} style={{ flex: 1, overflow: 'auto' }}>
              <div className={styles.markdownContent}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownModal.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}