'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { newConfigFormSchema, type NewConfigForm } from '@/lib/schemas';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import WorkflowModeSelector from './WorkflowModeSelector';
import { EngineModelSelect } from './EngineModelSelect';
import { ComboboxPortalProvider } from './ui/combobox';
import Markdown from './Markdown';
import UniversalCard from './chat/cards/UniversalCard';
import { parseActions } from '@/lib/chat-actions';
import WorkspaceDirectoryPicker from './common/WorkspaceDirectoryPicker';

interface NewConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (filename: string) => void;
}

export default function NewConfigModal({
  isOpen,
  onClose,
  onSuccess,
}: NewConfigModalProps) {
  const { toast } = useToast();
  const [workflowMode, setWorkflowMode] = useState<'phase-based' | 'state-machine' | 'ai-guided'>('phase-based');
  // Two-step form: step 1 = mode + basic info, step 2 = AI streaming (ai-guided only)
  const [formStep, setFormStep] = useState<1 | 2>(1);

  // AI streaming state
  const [aiPhase, setAiPhase] = useState<'idle' | 'streaming' | 'waiting' | 'done'>('idle');
  const [aiMessages, setAiMessages] = useState<Array<{ role: 'ai' | 'user' | 'thinking'; content: string }>>([]);
  const [currentStream, setCurrentStream] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [userInput, setUserInput] = useState('');
  const [aiFilename, setAiFilename] = useState('');
  const [backendSessionId, setBackendSessionId] = useState<string | undefined>();
  const streamContentRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const userInputRef = useRef<HTMLInputElement>(null);

  // Engine/model selection for AI mode
  const [aiEngine, setAiEngine] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiRestartFlag, setAiRestartFlag] = useState(0);
  // Refs to always read latest engine/model in sendToAi
  const aiEngineRef = useRef('');
  const aiModelRef = useRef('');

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    formState: { errors, isSubmitting },
    reset,
    watch,
    getValues,
  } = useForm<NewConfigForm>({
    defaultValues: {
      mode: 'phase-based',
      workingDirectory: '',
    },
  });
  const workingDirectoryValue = watch('workingDirectory');

  const generateDefaultFilename = useCallback(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 6);
    return `workflow-${y}${m}${d}-${hh}${mm}-${rand}.yaml`;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const current = (getValues('filename') || '').trim();
    if (current) return;
    setValue('filename', generateDefaultFilename(), { shouldDirty: false, shouldValidate: true });
  }, [generateDefaultFilename, getValues, isOpen, setValue]);

  const applySchemaIssues = useCallback((issues: Array<{ path?: (string | number)[]; message?: string }>) => {
    const supported = ['filename', 'workflowName', 'workingDirectory', 'description', 'requirements', 'mode'];
    clearErrors();
    const messages: string[] = [];
    for (const issue of issues) {
      const field = issue?.path?.[0];
      const message = issue?.message || '输入不合法';
      if (typeof field === 'string' && supported.includes(field)) {
        setError(field as keyof NewConfigForm, { type: 'validate', message });
      }
      messages.push(message);
    }
    if (messages.length > 0) {
      toast('error', [...new Set(messages)].join('\n'));
    }
  }, [clearErrors, setError, toast]);

  // Auto-scroll streaming content
  useEffect(() => {
    if (streamContentRef.current) {
      streamContentRef.current.scrollTop = streamContentRef.current.scrollHeight;
    }
  }, [aiMessages, currentStream, currentThinking]);

  // Focus input when waiting
  useEffect(() => {
    if (aiPhase === 'waiting' && userInputRef.current) {
      userInputRef.current.focus();
    }
  }, [aiPhase]);

  // Cleanup on unmount/close
  const cleanupStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (chatIdRef.current) {
      fetch(`/api/chat/stream?id=${encodeURIComponent(chatIdRef.current)}`, { method: 'DELETE' }).catch(() => {});
      chatIdRef.current = null;
    }
  }, []);

  const resetAll = useCallback(() => {
    cleanupStream();
    setAiPhase('idle');
    setAiMessages([]);
    setCurrentStream('');
    setCurrentThinking('');
    setUserInput('');
    setAiFilename('');
    setBackendSessionId(undefined);
    setFormStep(1);
  }, [cleanupStream]);

  // When engine or model changes during step 2, restart the AI conversation
  const handleAiEngineChange = (engine: string) => {
    setAiEngine(engine);
    aiEngineRef.current = engine;
    if (formStep === 2) {
      cleanupStream();
      setAiMessages([]);
      setCurrentStream('');
      setCurrentThinking('');
      setAiFilename('');
      setBackendSessionId(undefined);
      setAiRestartFlag(f => f + 1);
    }
  };
  const handleAiModelChange = (model: string) => {
    setAiModel(model);
    aiModelRef.current = model;
    if (formStep === 2) {
      cleanupStream();
      setAiMessages([]);
      setCurrentStream('');
      setCurrentThinking('');
      setAiFilename('');
      setBackendSessionId(undefined);
      setAiRestartFlag(f => f + 1);
    }
  };

  // Send a message to the AI stream and show the response
  const sendToAi = useCallback(async (message: string, sessionId?: string) => {
    setAiPhase('streaming');
    setCurrentStream('');
    setCurrentThinking('');

    try {
      const startRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          model: aiModelRef.current,
          engine: aiEngineRef.current,
          sessionId: sessionId || undefined,
          mode: 'dashboard',
        }),
      });

      const startData = await startRes.json();
      if (!startRes.ok || !startData.chatId) {
        toast('error', startData.error || 'AI 流式请求失败');
        setAiPhase('waiting');
        return;
      }

      const chatId = startData.chatId;
      chatIdRef.current = chatId;

      const es = new EventSource(`/api/chat/stream?id=${chatId}`);
      eventSourceRef.current = es;
      let accumulated = '';
      let thinkingAccumulated = '';

      es.addEventListener('delta', (e) => {
        const { content } = JSON.parse(e.data);
        accumulated += content;
        setCurrentStream(accumulated);
      });

      es.addEventListener('thinking', (e) => {
        const { content } = JSON.parse(e.data);
        thinkingAccumulated += content;
        setCurrentThinking(thinkingAccumulated);
      });

      es.addEventListener('done', (e) => {
        const data = JSON.parse(e.data);
        es.close();
        eventSourceRef.current = null;
        chatIdRef.current = null;

        if (data.sessionId) {
          setBackendSessionId(data.sessionId);
        }

        const finalContent = data.result || accumulated;

        setAiMessages(prev => {
          const msgs = [...prev];
          if (thinkingAccumulated) {
            msgs.push({ role: 'thinking', content: thinkingAccumulated });
          }
          msgs.push({ role: 'ai', content: finalContent });
          return msgs;
        });
        setCurrentStream('');
        setCurrentThinking('');

        const fileCreated = finalContent.match(/configs\/([a-zA-Z0-9_-]+\.yaml)/);
        if (fileCreated) {
          setAiFilename(fileCreated[1]);
        }

        const isDone = finalContent.includes('验证通过') || finalContent.includes('创建成功') || finalContent.includes('已写入');
        if (isDone && fileCreated) {
          setAiPhase('done');
        } else {
          setAiPhase('waiting');
        }
      });

      es.addEventListener('error', () => {
        es.close();
        eventSourceRef.current = null;
        chatIdRef.current = null;
        if (accumulated) {
          setAiMessages(prev => {
            const msgs = [...prev];
            if (thinkingAccumulated) msgs.push({ role: 'thinking', content: thinkingAccumulated });
            msgs.push({ role: 'ai', content: accumulated });
            return msgs;
          });
        }
        setCurrentStream('');
        setCurrentThinking('');
        setAiPhase('waiting');
      });
    } catch (err: any) {
      toast('error', 'AI 请求失败: ' + err.message);
      setAiPhase('waiting');
    }
  }, [toast]);

  // PLACEHOLDER_SUBMIT_AND_RENDER

  // Start AI-guided streaming (step 2)
  const startAiStream = async () => {
    const data = getValues();
    const filename = data.filename;
    const reqs = data.requirements || data.description || '';
    const workDir = data.workingDirectory;

    setAiFilename(filename);
    setAiMessages([]);

    const prompt = `请帮我创建一个 AceHarness 工作流配置文件。

**目标文件名**: configs/${filename}
**工作流名称**: ${data.workflowName}
**工作目录**: ${workDir}
**需求描述**: ${reqs}
${data.description ? `**补充说明**: ${data.description}` : ''}

请按照 aceharness-workflow-creator 技能的流程来创建：
1. 先分析需求，了解要解决的问题
2. 查看可用的 Agent 资源（查阅 configs/agents/ 目录）
3. 设计工作流方案并展示预览
4. 等我确认后再写入 configs/${filename} 文件
5. 写入后运行验证脚本确保格式正确

请开始第一步：分析需求。`;

    await sendToAi(prompt);
  };

  // Re-trigger AI stream after engine/model change
  useEffect(() => {
    if (aiRestartFlag > 0 && formStep === 2) {
      startAiStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRestartFlag]);

  // Handle "下一步" for AI mode: validate step 1 fields, then go to step 2
  const handleNextStep = async () => {
    const draft = getValues();
    const validation = newConfigFormSchema.safeParse({
      filename: draft.filename,
      workflowName: draft.workflowName,
      workingDirectory: draft.workingDirectory,
      description: draft.description,
      requirements: draft.requirements,
      mode: workflowMode,
    });
    if (!validation.success) {
      applySchemaIssues(validation.error.issues as any);
      return;
    }

    const reqs = getValues('requirements') || '';
    if (reqs.trim().length < 5) {
      toast('error', '请提供需求描述（至少5个字符）');
      return;
    }

    setFormStep(2);

    // If there's already conversation history (user went back and returned), just resume
    if (aiMessages.length > 0) {
      setAiPhase(aiFilename ? 'done' : 'waiting');
      return;
    }

    await startAiStream();
  };

  // Handle user reply in AI conversation
  const handleUserReply = async () => {
    const text = userInput.trim();
    if (!text) return;
    setAiMessages(prev => [...prev, { role: 'user', content: text }]);
    setUserInput('');
    await sendToAi(text, backendSessionId);
  };

  const handleQuickConfirm = async () => {
    const text = '确认，请创建文件';
    setAiMessages(prev => [...prev, { role: 'user', content: text }]);
    await sendToAi(text, backendSessionId);
  };

  const onSubmit = async (data: NewConfigForm) => {
    // AI-guided mode uses the two-step flow, not direct submit
    if (workflowMode === 'ai-guided') return;
    const validation = newConfigFormSchema.safeParse({ ...data, mode: workflowMode });
    if (!validation.success) {
      applySchemaIssues(validation.error.issues as any);
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
      const response = await fetch('/api/configs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...data, mode: workflowMode }),
      });
      const result = await response.json();
      if (!response.ok) {
        const details = Array.isArray(result.details)
          ? result.details
          : Array.isArray(result.details?.issues)
            ? result.details.issues
            : [];
        if (details.length > 0) {
          for (const issue of details) {
            const field = issue?.path?.[0];
            if (typeof field === 'string' && ['filename', 'workflowName', 'workingDirectory', 'description', 'requirements', 'mode'].includes(field)) {
              setError(field as keyof NewConfigForm, { type: 'server', message: issue.message });
            }
          }
          toast('error', '表单验证失败:\n' + details.map((e: any) => e.message).join('\n'));
        } else {
          toast('error', result.message || result.error);
        }
        return;
      }
      toast('success', result.message || '配置文件已创建');
      reset();
      onSuccess(data.filename);
      onClose();
    } catch (error: any) {
      toast('error', '创建失败: ' + error.message);
    }
  };

  const onInvalid = (formErrors: FieldErrors<NewConfigForm>) => {
    const messages = [
      formErrors.filename?.message,
      formErrors.workflowName?.message,
      formErrors.workingDirectory?.message,
      formErrors.description?.message,
      formErrors.requirements?.message,
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (messages.length > 0) {
      toast('error', messages.join('\n'));
      return;
    }
    toast('error', '请先修正表单中的错误项');
  };

  const handleClose = () => {
    resetAll();
    reset();
    onClose();
  };

  const handleBackToStep1 = () => {
    cleanupStream();
    // Only stop active streaming, keep conversation history and form data
    if (aiPhase === 'streaming') {
      if (currentStream) {
        setAiMessages(prev => [...prev, { role: 'ai', content: currentStream }]);
      }
      setCurrentStream('');
      setCurrentThinking('');
    }
    setAiPhase('idle');
    setFormStep(1);
  };

  const handleAiComplete = () => {
    const filename = aiFilename;
    resetAll();
    reset();
    onSuccess(filename);
    onClose();
  };

  const normalizeFilenameField = () => {
    const raw = (getValues('filename') || '').trim();
    if (!raw) return;

    let normalized = raw;
    if (/\.yml$/i.test(normalized)) {
      normalized = normalized.replace(/\.yml$/i, '.yaml');
    } else if (!/\.yaml$/i.test(normalized)) {
      normalized = `${normalized}.yaml`;
    }

    if (normalized !== getValues('filename')) {
      setValue('filename', normalized, { shouldDirty: true, shouldValidate: true });
    }
  };

  // PLACEHOLDER_RENDER_AI_VIEW

  // AI conversation view (step 2 for ai-guided mode)
  if (formStep === 2 && workflowMode === 'ai-guided') {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-4xl flex flex-col p-0 max-h-[90vh] h-[80vh]">
          <ComboboxPortalProvider>
          <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="icon" onClick={handleBackToStep1} title="返回上一步">
                <span className="material-symbols-outlined">arrow_back</span>
              </Button>
              <DialogTitle className="flex items-center gap-2">
                <span className="material-symbols-outlined text-green-500">auto_awesome</span>
                AI 工作流创建
                {aiPhase === 'streaming' && (
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground font-normal">
                    <span className="animate-pulse text-green-500">●</span> 生成中...
                  </span>
                )}
                {aiPhase === 'waiting' && (
                  <span className="inline-flex items-center gap-1 text-sm text-blue-500 font-normal">
                    ● 等待回复
                  </span>
                )}
                {aiPhase === 'done' && (
                  <span className="inline-flex items-center gap-1 text-sm text-green-600 font-normal">
                    ✓ 创建完成
                  </span>
                )}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              <EngineModelSelect
                engine={aiEngine}
                model={aiModel}
                onEngineChange={handleAiEngineChange}
                onModelChange={handleAiModelChange}
                className="w-56"
              />
              <Button type="button" variant="ghost" size="icon" onClick={handleClose}>
                <span className="material-symbols-outlined">close</span>
              </Button>
            </div>
          </div>

          {/* Conversation area */}
          <div ref={streamContentRef} className="flex-1 overflow-auto px-6 pb-4 space-y-4">
            {aiMessages.map((msg, i) => (
              <div key={i}>
                {msg.role === 'thinking' ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 mb-1 font-medium">
                      <span className="material-symbols-outlined text-sm">psychology</span>
                      思考过程
                    </div>
                    <pre className="text-xs text-amber-800 dark:text-amber-300 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-auto">{msg.content}</pre>
                  </div>
                ) : msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-blue-500 text-white px-4 py-2 rounded-2xl rounded-br-md max-w-[80%]">
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  (() => {
                    const { text, cards } = parseActions(msg.content);
                    return (
                      <div className="bg-muted/50 rounded-lg p-4 border space-y-3">
                        {text && <Markdown>{text}</Markdown>}
                        {cards.map((card, ci) => (
                          <UniversalCard key={ci} card={card} />
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
            ))}

            {currentThinking && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 mb-1 font-medium">
                  <span className="material-symbols-outlined text-sm">psychology</span>
                  思考过程<span className="animate-pulse">...</span>
                </div>
                <pre className="text-xs text-amber-800 dark:text-amber-300 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-auto">{currentThinking}</pre>
              </div>
            )}

            {currentStream && (
              (() => {
                const { text, cards } = parseActions(currentStream);
                return (
                  <div className="bg-muted/50 rounded-lg p-4 border space-y-3">
                    {text && <Markdown>{text}</Markdown>}
                    {cards.map((card, ci) => (
                      <UniversalCard key={ci} card={card} />
                    ))}
                    <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-0.5" />
                  </div>
                );
              })()
            )}

            {aiPhase === 'streaming' && !currentStream && !currentThinking && (
              <div className="flex items-center gap-3 text-muted-foreground py-4">
                <div className="animate-spin w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full" />
                <span className="text-sm">AI 正在分析需求...</span>
              </div>
            )}
          </div>

          {/* Input area for user replies */}
          {aiPhase === 'waiting' && (
            <div className="px-6 pb-2 space-y-2">
              <div className="flex gap-2 flex-wrap">
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setAiMessages(prev => [...prev, { role: 'user', content: '分析完成，请继续下一步' }]);
                  sendToAi('分析完成，请继续下一步', backendSessionId);
                }}>
                  → 下一步
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleQuickConfirm}>
                  ✓ 确认创建
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setAiMessages(prev => [...prev, { role: 'user', content: '请调整方案，然后重新展示预览' }]);
                  sendToAi('请调整方案，然后重新展示预览', backendSessionId);
                }}>
                  ↻ 调整方案
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  ref={userInputRef}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUserReply(); } }}
                  placeholder="输入回复..."
                  className="flex-1"
                />
                <Button type="button" onClick={handleUserReply} disabled={!userInput.trim()}>
                  发送
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
            {aiPhase === 'streaming' && (
              <Button type="button" variant="outline" onClick={() => {
                cleanupStream();
                setAiPhase('waiting');
                if (currentStream) {
                  setAiMessages(prev => [...prev, { role: 'ai', content: currentStream }]);
                  setCurrentStream('');
                }
              }}>
                <span className="material-symbols-outlined text-sm mr-1">stop</span>
                停止
              </Button>
            )}
            <Button type="button" variant="outline" onClick={handleClose}>
              关闭
            </Button>
            {(aiPhase === 'done' || (aiPhase === 'waiting' && aiFilename)) && (
              <Button type="button" onClick={handleAiComplete}>
                <span className="material-symbols-outlined text-sm mr-1">open_in_new</span>
                打开设计页面
              </Button>
            )}
          </div>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>
    );
  }

  // PLACEHOLDER_RENDER_FORM

  // Step 1: Form view (all modes)
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl flex flex-col p-0 max-h-[90vh]">
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
          <DialogTitle>新建工作流配置</DialogTitle>
          <Button type="button" variant="ghost" size="icon" onClick={handleClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>
        <form id="new-config-form" onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex-1 overflow-auto px-6 space-y-6">
          {/* 工作流模式选择 */}
          <div className="space-y-2">
            <Label className="text-base font-semibold">
              选择工作流模式 <span className="text-destructive">*</span>
            </Label>
            <WorkflowModeSelector
              value={workflowMode}
              onChange={setWorkflowMode}
              showDetails={true}
            />
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700" />

          {/* AI 引导模式的需求输入 */}
          {workflowMode === 'ai-guided' && (
            <div className="space-y-4 bg-green-50 dark:bg-green-950/30 rounded-lg p-4 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <span className="material-symbols-outlined">auto_awesome</span>
                <span className="font-medium">描述你的工作流需求</span>
              </div>
              <Textarea
                {...register('requirements')}
                placeholder="例如：我想创建一个代码审查工作流，包含设计评审、代码审查、测试验证等阶段，需要支持发现问题时自动回退..."
                rows={5}
                className="bg-background"
              />
              <p className="text-xs text-green-600 dark:text-green-500">
                AI 将根据你的需求描述，实时分析、设计并生成工作流配置。你可以在对话中查看 AI 的思考过程，确认方案后 AI 会自动创建并验证文件。
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="workflowName">
              工作流名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="workflowName"
              placeholder="我的工作流"
              {...register('workflowName')}
              className={errors.workflowName ? 'border-destructive' : ''}
            />
            {errors.workflowName && (
              <p className="text-sm text-destructive">{errors.workflowName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="workingDirectory">
              工作目录 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="workingDirectory"
              placeholder="/path/to/your/project"
              value={workingDirectoryValue || ''}
              onChange={(event) => {
                setValue('workingDirectory', event.target.value, { shouldDirty: true, shouldValidate: true });
              }}
              className={errors.workingDirectory ? 'border-destructive' : ''}
            />
            <WorkspaceDirectoryPicker
              workspaceRoot="/"
              value={workingDirectoryValue || ''}
              onChange={(path) => setValue('workingDirectory', path, { shouldDirty: true, shouldValidate: true })}
              className="h-60"
            />
            {errors.workingDirectory && (
              <p className="text-sm text-destructive">{errors.workingDirectory.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              工作流执行时的工作目录
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="filename">
              文件名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="filename"
              placeholder="my-workflow.yaml"
              {...register('filename', {
                onBlur: normalizeFilenameField,
              })}
              className={errors.filename ? 'border-destructive' : ''}
            />
            {errors.filename && (
              <p className="text-sm text-destructive">{errors.filename.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              文件名必须以 .yaml 结尾，只能包含字母、数字、下划线和连字符
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述（可选）</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="描述这个工作流的用途..."
              {...register('description')}
            />
          </div>
        </form>

        <div className="flex gap-2 justify-end p-6 pt-4 border-t flex-shrink-0">
          <Button type="button" variant="outline" onClick={handleClose}>
            取消
          </Button>
          {workflowMode === 'ai-guided' ? (
            <Button type="button" onClick={handleNextStep} disabled={isSubmitting}>
              AI 引导创建
            </Button>
          ) : (
            <Button type="submit" form="new-config-form" disabled={isSubmitting}>
              {isSubmitting ? '创建中...' : '创建'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
