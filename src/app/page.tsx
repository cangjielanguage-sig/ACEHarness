'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { useCurrentEngine } from '@/components/EngineSelect';
import { ThemeToggle } from '@/components/theme-toggle';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog';
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
  const {
    activeSession, sessions, createSession, sendMessage, stopStreaming,
    deleteMessage, retryFromMessage, continueFromMessage,
    loading, streamingMessageId,
    model, setModel, engine, setEngine,
    confirmAction, rejectAction, undoActionById, retryAction,
    skillSettings,
  } = useChat();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const effectiveEngine = useCurrentEngine(engine);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editContent, setEditContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const editEditorRef = useRef<RichTextEditorHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<{ username: string; email: string; role: 'admin' | 'user'; avatar?: string } | null>(null);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, loading]);

  useEffect(() => {
    editorRef.current?.focus();
  }, [activeSession?.id]);

  const handleSend = useCallback(async () => {
    const text = editorRef.current?.getMarkdown().trim() || input.trim();
    if (!text || loading) return;

    // If editing, delete the original message first
    if (editingMessageId) {
      deleteMessage(editingMessageId);
      setEditingMessageId(null);
    }

    setInput('');
    editorRef.current?.clear();
    await sendMessage(text);
    editorRef.current?.focus();
  }, [input, loading, sendMessage, editingMessageId, deleteMessage]);

  const handleEditorEnter = useCallback(async (text: string) => {
    if (!text || loading) return;

    // If editing, delete the original message first
    if (editingMessageId) {
      deleteMessage(editingMessageId);
      setEditingMessageId(null);
    }

    setInput('');
    editorRef.current?.clear();
    await sendMessage(text);
  }, [loading, sendMessage, editingMessageId, deleteMessage]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (prompt && !prompt.includes('\n')) {
      setInput('');
      editorRef.current?.clear();
      sendMessage(prompt);
    } else {
      setInput(prompt);
      editorRef.current?.focus();
    }
  }, [sendMessage]);

  const messages = activeSession?.messages || [];

  const handleEditMessage = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    setEditingMessageId(messageId);
    setEditDialogOpen(true);
    // Set content after dialog opens
    setTimeout(() => {
      editEditorRef.current?.setContent(msg.content);
    }, 0);
  }, [messages]);

  const handleConfirmEdit = useCallback(async () => {
    const text = editEditorRef.current?.getMarkdown().trim() || editContent.trim();
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
  }, [editingMessageId, editContent, messages, deleteMessage, sendMessage]);

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
    />
  )), [messages, streamingMessageId, messageCallbacks, handleQuickAction, deleteMessage, retryFromMessage, handleEditMessage, continueFromMessage]);

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
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-16">
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
                onChange={(html, text) => setInput(text)}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                minHeight={42}
                disabled={loading}
                autoFocus={false}
                showFullscreenToggle={true}
              />
            </div>
            {loading ? (
              <Button className="rounded-xl h-[42px] px-4" variant="destructive" onClick={stopStreaming} title="停止生成">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>stop</span>
              </Button>
            ) : (
              <Button className="rounded-xl h-[42px] px-4" onClick={handleSend} disabled={!input.trim() && !editorRef.current?.getText()?.trim()}>
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
                onChange={(html, text) => setEditContent(text)}
                placeholder="输入消息内容..."
                minHeight={200}
                maxHeight={400}
                autoFocus
                showFullscreenToggle={true}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelEdit}>取消</Button>
              <Button onClick={handleConfirmEdit}>发送</Button>
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
