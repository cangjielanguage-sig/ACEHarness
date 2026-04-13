'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { ThemeToggle } from '@/components/theme-toggle';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { workspaceApi, type NotebookScope } from '@/lib/api';
import { buildNotebookFromConversation, buildNotebookFromAssistantMessage, createDefaultNotebookFileName } from '@/lib/chat-notebook';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatMessage, { RobotLogo } from '@/components/chat/ChatMessage';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import AuthGuard from '@/components/AuthGuard';
import UserMenu from '@/components/UserMenu';

// 动态导入 RichTextEditor - TipTap 是重量级库，延迟加载
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-[42px] rounded-xl border border-input bg-background animate-pulse" />
  ),
});

const SIDEBAR_STORAGE_KEY = 'chat-sidebar-width';
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function ChatPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    activeSession, sessions, createSession, sendMessage, stopStreaming,
    deleteMessage, retryFromMessage, continueFromMessage,
    loading, streamingMessageId,
    model, setModel, engine, effectiveEngine, setEngine,
    confirmAction, rejectAction, undoActionById, retryAction,
    skillSettings,
  } = useChat();
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [notebookExporting, setNotebookExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ type: 'conversation' } | { type: 'assistant'; messageId: string } | null>(null);
  const [exportFileName, setExportFileName] = useState('');
  const [exportScope, setExportScope] = useState<NotebookScope>('personal');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editContent, setEditContent] = useState('');
  const editorLoadedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const editEditorRef = useRef<RichTextEditorHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<{ username: string; email: string; role: 'admin' | 'user'; avatar?: string } | null>(null);

  const chatTitle = useMemo(() => {
    const notebookFile = searchParams.get('notebookFile');
    if (notebookFile) {
      const fileName = notebookFile.split('/').pop() || notebookFile;
      return `${fileName} · Notebook`;
    }

    const sessionTitle = activeSession?.title?.trim();
    return sessionTitle || '首页';
  }, [activeSession?.title, searchParams]);

  useDocumentTitle(chatTitle);

  // Load current user info
  useEffect(() => {
    try {
      const stored = localStorage.getItem('auth-user');
      if (stored) setCurrentUser(JSON.parse(stored));
    } catch {}
  }, []);

  // Load saved width
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) setSidebarWidth(w);
    }
  }, []);

  // Hide sidebar by default on mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Resize drag handler
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const x = e.clientX - containerRef.current.getBoundingClientRect().left;
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, x));
      setSidebarWidth(clamped);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, clamped.toString());
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Detect user scroll to lock/unlock auto-scroll
  const hasMessages = (activeSession?.messages?.length ?? 0) > 0;
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      const threshold = 80;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      autoScrollLockedRef.current = !nearBottom;
      setShowScrollBtn(!nearBottom && hasMessages);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMessages]);

  // Auto-scroll to bottom only if not locked by user
  useEffect(() => {
    if (!autoScrollLockedRef.current) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
    }
  }, [activeSession?.messages, loading]);

  useEffect(() => {
    editorRef.current?.focus();
  }, [activeSession?.id]);

  useEffect(() => {
    if (!editorLoaded && editorRef.current) {
      setEditorLoaded(true);
      editorLoadedRef.current = true;
    }
  }, [editorLoaded, activeSession?.id, input]);

  useEffect(() => {
    if (!editDialogOpen || !editEditorRef.current) return;
    editEditorRef.current.setContent(editContent);
  }, [editContent, editDialogOpen]);

  const getInputMarkdown = useCallback(() => {
    return editorRef.current?.getMarkdown().trim() || input.trim();
  }, [input]);

  const getEditMarkdown = useCallback(() => {
    return editEditorRef.current?.getMarkdown().trim() || editContent.trim();
  }, [editContent]);

  const updateNotebookUrl = useCallback((filePath: string, scope: NotebookScope = 'personal') => {
    const params = new URLSearchParams();
    params.set('notebook', '1');
    params.set('notebookFile', filePath);
    params.set('notebookScope', scope);
    router.push(`/notebook?${params.toString()}`);
  }, [router]);

  const normalizeNotebookFileName = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.endsWith('.cj.md') ? trimmed : `${trimmed}.cj.md`;
  }, []);

  const openNotebookExportDialog = useCallback((target: { type: 'conversation' } | { type: 'assistant'; messageId: string }) => {
    setPendingExport(target);
    setExportFileName(createDefaultNotebookFileName());
    setExportScope('personal');
    setExportDialogOpen(true);
  }, []);

  const closeNotebookExportDialog = useCallback(() => {
    if (notebookExporting) return;
    setExportDialogOpen(false);
    setPendingExport(null);
    setExportFileName('');
    setExportScope('personal');
  }, [notebookExporting]);

  const saveNotebookFile = useCallback(async (filePath: string, content: string, scope: NotebookScope) => {
    await workspaceApi.manageNotebook('create-file', { path: filePath }, { scope });
    await workspaceApi.saveNotebookFile(filePath, content, { scope });
    updateNotebookUrl(filePath, scope);
  }, [updateNotebookUrl]);

  const handleConfirmNotebookExport = useCallback(async () => {
    if (!pendingExport) return;

    const normalizedFileName = normalizeNotebookFileName(exportFileName);
    if (!normalizedFileName) {
      toast('warning', '请输入 Notebook 文件名');
      return;
    }

    const exportPayload = pendingExport.type === 'conversation'
      ? (activeSession ? { filePath: normalizedFileName, content: buildNotebookFromConversation(activeSession) } : null)
      : (() => {
          const message = activeSession?.messages.find((item) => item.id === pendingExport.messageId && item.role === 'assistant');
          if (!message) return null;
          const contentText = (message.rawContent || message.content || '').trim();
          if (!contentText) return null;
          return { filePath: normalizedFileName, content: buildNotebookFromAssistantMessage(message) };
        })();

    if (!exportPayload) {
      toast('warning', '没有可导出的内容');
      return;
    }

    try {
      setNotebookExporting(true);
      await saveNotebookFile(exportPayload.filePath, exportPayload.content, exportScope);
      toast('success', `已保存为 Notebook：${exportPayload.filePath}`);
      setExportDialogOpen(false);
      setPendingExport(null);
      setExportFileName('');
    } catch (error: any) {
      toast('error', error?.message || '保存 Notebook 失败');
    } finally {
      setNotebookExporting(false);
    }
  }, [pendingExport, normalizeNotebookFileName, exportFileName, toast, activeSession, saveNotebookFile, exportScope]);

  const handleSaveConversationAsNotebook = useCallback(async () => {
    if (!activeSession) return;
    const exportableMessages = activeSession.messages.filter((message) => {
      if (message.role === 'error') return false;
      return Boolean((message.rawContent || message.content || '').trim());
    });
    if (exportableMessages.length === 0) {
      toast('warning', '当前会话没有可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'conversation' });
  }, [activeSession, openNotebookExportDialog, toast]);

  const handleSaveAssistantMessageAsNotebook = useCallback(async (messageId: string) => {
    const message = activeSession?.messages.find((item) => item.id === messageId && item.role === 'assistant');
    if (!message) return;

    const contentText = (message.rawContent || message.content || '').trim();
    if (!contentText) {
      toast('warning', '这条消息暂无可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'assistant', messageId });
  }, [activeSession, openNotebookExportDialog, toast]);

  const unlockAutoScroll = useCallback(() => {
    autoScrollLockedRef.current = false;
    setShowScrollBtn(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    unlockAutoScroll();
    isProgrammaticScrollRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
  }, [unlockAutoScroll]);

  const handleSend = useCallback(async () => {
    const text = getInputMarkdown();
    if (!text || loading) return;

    if (editingMessageId) {
      deleteMessage(editingMessageId);
      setEditingMessageId(null);
    }

    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();
    await sendMessage(text);
    editorRef.current?.focus();
  }, [getInputMarkdown, loading, sendMessage, editingMessageId, deleteMessage, unlockAutoScroll]);

  const handleEditorEnter = useCallback(async (text: string) => {
    const markdown = text.trim() || getInputMarkdown();
    if (!markdown || loading) return;

    if (editingMessageId) {
      deleteMessage(editingMessageId);
      setEditingMessageId(null);
    }

    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();
    await sendMessage(markdown);
  }, [getInputMarkdown, loading, sendMessage, editingMessageId, deleteMessage, unlockAutoScroll]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (prompt && !prompt.includes('\n')) {
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      sendMessage(prompt);
    } else {
      setInput(prompt);
      editorRef.current?.setContent(prompt);
      editorRef.current?.focus();
    }
  }, [sendMessage, unlockAutoScroll]);

  const messages = activeSession?.messages || [];

  const handleEditMessage = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    setEditingMessageId(messageId);
    setEditContent(msg.content);
    setEditDialogOpen(true);
  }, [messages]);

  const handleConfirmEdit = useCallback(async () => {
    const text = getEditMarkdown();
    if (!editingMessageId || !text) return;

    // Delete the original message and any subsequent messages
    const msgIndex = messages.findIndex(m => m.id === editingMessageId);
    if (msgIndex !== -1) {
      const messagesToDelete = messages.slice(msgIndex);
      for (const msg of messagesToDelete) {
        if (msg.id) {
          deleteMessage(msg.id);
        }
      }
    }

    setEditDialogOpen(false);
    setEditingMessageId(null);
    setEditContent('');
    editEditorRef.current?.clear();
    await sendMessage(text);
  }, [getEditMarkdown, editingMessageId, messages, deleteMessage, sendMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditDialogOpen(false);
    setEditingMessageId(null);
    setEditContent('');
    editEditorRef.current?.clear();
  }, []);

  // Memoize message callbacks to prevent unnecessary re-renders
  const messageCallbacks = useMemo(() => {
    const callbacks: Record<string, {
      onConfirmAction: (id: string) => void;
      onRejectAction: (id: string) => void;
      onUndoAction: (id: string) => void;
      onRetryAction: (id: string) => void;
    }> = {};
    messages.forEach(msg => {
      callbacks[msg.id] = {
        onConfirmAction: (id) => confirmAction(msg.id, id),
        onRejectAction: (id) => rejectAction(msg.id, id),
        onUndoAction: (id) => undoActionById(msg.id, id),
        onRetryAction: (id) => retryAction(msg.id, id),
      };
    });
    return callbacks;
  }, [messages, confirmAction, rejectAction, undoActionById, retryAction]);

  const renderedMessages = useMemo(() => messages.map(msg => (
    <ChatMessage
      key={msg.id}
      message={msg}
      isStreaming={msg.id === streamingMessageId}
      onConfirmAction={messageCallbacks[msg.id]?.onConfirmAction}
      onRejectAction={messageCallbacks[msg.id]?.onRejectAction}
      onUndoAction={messageCallbacks[msg.id]?.onUndoAction}
      onRetryAction={messageCallbacks[msg.id]?.onRetryAction}
      onAction={handleQuickAction}
      onDelete={deleteMessage}
      onRetryFromMessage={msg.role === 'user' ? retryFromMessage : undefined}
      onEditMessage={msg.role === 'user' ? handleEditMessage : undefined}
      onContinue={msg.role === 'error' ? continueFromMessage : undefined}
      onSaveAsNotebook={msg.role === 'assistant' ? handleSaveAssistantMessageAsNotebook : undefined}
    />
  )), [messages, streamingMessageId, messageCallbacks, handleQuickAction, deleteMessage, retryFromMessage, handleEditMessage, continueFromMessage, handleSaveAssistantMessageAsNotebook]);

  return (
    <div ref={containerRef} className="h-screen flex overflow-hidden bg-background">
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div
          className={
            isMobile
              ? 'fixed inset-y-0 left-0 z-40 bg-background shadow-xl'
              : 'relative shrink-0'
          }
          style={{ width: isMobile ? `${Math.min(sidebarWidth, 320)}px` : `${sidebarWidth}px` }}
        >
          <ChatSidebar />
          {/* Resize handle (desktop only) */}
          {!isMobile && (
            <div
              className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 transition-all ${
                isResizing ? 'bg-primary w-1.5' : 'bg-border hover:bg-primary/60'
              }`}
              onMouseDown={e => { e.preventDefault(); setIsResizing(true); }}
            />
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background/80 backdrop-blur shrink-0">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(p => !p)} title="切换侧边栏">
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>menu</span>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-52 hidden sm:block">
              <EngineModelSelect engine={engine} model={model} onEngineChange={setEngine} onModelChange={setModel} className="h-8 text-xs" />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveConversationAsNotebook}
              disabled={!activeSession || notebookExporting || messages.length === 0}
              title="保存当前会话为 Notebook"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '4px' }}>note_add</span>
              <span className="hidden sm:inline">保存为 Notebook</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => createSession()} title="新建会话">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add</span>
            </Button>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={() => router.push('/dashboard')} title="切换到控制台">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', marginRight: '4px' }}>dashboard</span>
              <span className="hidden sm:inline">控制台</span>
            </Button>
            <UserMenu user={currentUser} />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 relative min-h-0">
          <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto px-4 py-6 md:px-8 lg:px-16">
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full gap-8">
                <div className="text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                    className="inline-flex p-3 mb-4"
                  >
                    <RobotLogo size={56} className="animate-robotPulse" />
                  </motion.div>
                  <motion.h2
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-500 to-purple-500 bg-clip-text text-transparent mb-2"
                  >
                    ACEHarness Multi-Agent 助手
                  </motion.h2>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="text-sm text-muted-foreground"
                  >
                    通过对话实现全流程 Multi-Agent 智能编排
                  </motion.p>
                </div>
                <QuickActions onAction={handleQuickAction} skillSettings={skillSettings} />
              </div>
            )}
            {renderedMessages}
            <div ref={messagesEndRef} />
          </div>
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/90 text-primary-foreground text-xs shadow-lg hover:bg-primary transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_downward</span>
              新消息
            </button>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t bg-background/80 backdrop-blur px-4 py-3 md:px-8 lg:px-16">
          {messages.length > 0 && (
            <QuickActionsBar onAction={handleQuickAction} skillSettings={skillSettings} />
          )}
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <div className="flex-1">
              <RichTextEditor
                ref={editorRef}
                onEnter={handleEditorEnter}
                onChange={(markdown) => setInput(markdown)}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                minHeight={42}
                disabled={loading}
                autoFocus={false}
                showFullscreenToggle={true}
                showToolbar={false}
              />
            </div>
            {loading ? (
              <Button className="rounded-xl h-[42px] px-4" variant="destructive" onClick={stopStreaming} title="停止生成">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>stop</span>
              </Button>
            ) : (
              <Button className="rounded-xl h-[42px] px-4" onClick={handleSend} disabled={!getInputMarkdown()}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>send</span>
              </Button>
            )}
          </div>
        </div>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>编辑消息</DialogTitle>
            </DialogHeader>
            <div className="min-h-[200px]">
              <RichTextEditor
                ref={editEditorRef}
                onChange={(markdown) => setEditContent(markdown)}
                placeholder="输入消息内容..."
                minHeight={200}
                maxHeight={400}
                autoFocus
                showFullscreenToggle={true}
                showToolbar={false}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelEdit}>取消</Button>
              <Button onClick={handleConfirmEdit}>发送</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={exportDialogOpen} onOpenChange={(open) => {
          if (!open) {
            closeNotebookExportDialog();
            return;
          }
          setExportDialogOpen(true);
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>保存为 Notebook</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                placeholder="请输入文件名"
                disabled={notebookExporting}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant={exportScope === 'personal' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setExportScope('personal')}
                  disabled={notebookExporting}
                >
                  保存至 Notebook（个人）
                </Button>
                <Button
                  variant={exportScope === 'global' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setExportScope('global')}
                  disabled={notebookExporting}
                >
                  保存至 Notebook（团队）
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">默认文件名为当前日期时间，你可以在保存前修改。</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeNotebookExportDialog} disabled={notebookExporting}>取消</Button>
              <Button onClick={handleConfirmNotebookExport} disabled={notebookExporting}>创建</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <AuthGuard>
      <ChatPageContent />
    </AuthGuard>
  );
}
