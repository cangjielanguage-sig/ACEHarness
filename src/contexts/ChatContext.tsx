'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { ActionBlock, ActionState, ActionStatus, executeAction, undoAction, isSafeAction, parseActions } from '@/lib/chat-actions';

// --- Types ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  actions?: ActionState[];
  cards?: any[];
  costUsd?: number;
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  backendSessionId?: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface SessionSummary {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
}

interface DashboardChatContextType {
  isOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  createSession: () => string;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setActiveSessionId: (id: string) => void;
  sendMessage: (text: string) => Promise<void>;
  loading: boolean;
  model: string;
  setModel: (m: string) => void;
  confirmAction: (messageId: string, actionId: string) => Promise<void>;
  rejectAction: (messageId: string, actionId: string) => void;
  undoActionById: (messageId: string, actionId: string) => Promise<void>;
  retryAction: (messageId: string, actionId: string) => Promise<void>;
  skillSettings: Record<string, boolean>;
  discoveredSkills: { name: string; label: string; description: string }[];
  toggleSkill: (skill: string) => void;
}

const DashboardChatContext = createContext<DashboardChatContextType>({
  isOpen: false, openChat: () => {}, closeChat: () => {}, toggleChat: () => {},
  sessions: [], activeSessionId: null, activeSession: null,
  createSession: () => '', deleteSession: () => {}, renameSession: () => {},
  setActiveSessionId: () => {},
  sendMessage: async () => {}, loading: false,
  model: 'claude-sonnet-4-6', setModel: () => {},
  confirmAction: async () => {}, rejectAction: () => {},
  undoActionById: async () => {}, retryAction: async () => {},
  skillSettings: { 'power-gitcode': true }, discoveredSkills: [], toggleSkill: () => {},
});

const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// --- Server API helpers ---

async function apiListSessions(): Promise<SessionSummary[]> {
  const res = await fetch('/api/chat/sessions');
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions || [];
}

async function apiCreateSession(session: ChatSession): Promise<void> {
  await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

async function apiLoadSession(id: string): Promise<ChatSession | null> {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.session || null;
}

async function apiSaveSession(session: ChatSession): Promise<void> {
  await fetch(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

async function apiDeleteSession(id: string): Promise<void> {
  await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function ChatProvider({ children }: { children: ReactNode }) {
  // Legacy modal state
  const [isOpen, setIsOpen] = useState(false);
  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen(prev => !prev), []);

  // Dashboard chat state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [skillSettings, setSkillSettings] = useState<Record<string, boolean>>({ 'power-gitcode': true });
  const [discoveredSkills, setDiscoveredSkills] = useState<{ name: string; label: string; description: string }[]>([]);

  // Load skill settings on mount
  useEffect(() => {
    fetch('/api/chat/settings').then(r => r.json()).then(data => {
      if (data.skills) setSkillSettings(data.skills);
      if (data.discoveredSkills) setDiscoveredSkills(data.discoveredSkills);
    }).catch(() => {});
  }, []);

  const toggleSkill = useCallback((skill: string) => {
    setSkillSettings(prev => {
      const next = { ...prev, [skill]: !prev[skill] };
      fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  // Debounced save ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionRef = useRef<ChatSession | null>(null);
  activeSessionRef.current = activeSession;

  // Load session list on mount
  useEffect(() => {
    apiListSessions().then(list => {
      setSessions(list);
      if (list.length > 0) setActiveSessionId(list[0].id);
    });
  }, []);

  // Load full session when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) { setActiveSession(null); return; }
    // If we already have it loaded (e.g. just created), skip
    if (activeSession?.id === activeSessionId) return;
    apiLoadSession(activeSessionId).then(s => setActiveSession(s));
  }, [activeSessionId]);

  // Debounced persist to server
  const scheduleSave = useCallback((session: ChatSession) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      apiSaveSession(session).catch(console.error);
    }, 300);
  }, []);

  // Helper: update active session in state + schedule save
  const updateActiveSession = useCallback((updater: (s: ChatSession) => ChatSession) => {
    setActiveSession(prev => {
      if (!prev) return prev;
      const updated = updater(prev);
      scheduleSave(updated);
      // Also update summary in sessions list
      setSessions(list => list.map(s => s.id === updated.id ? {
        ...s,
        title: updated.title,
        updatedAt: updated.updatedAt,
        messageCount: updated.messages.length,
        lastMessage: updated.messages.filter(m => m.role !== 'error').slice(-1)[0]?.content?.slice(0, 100),
      } : s));
      return updated;
    });
  }, [scheduleSave]);

  const createSession = useCallback(() => {
    const id = genId();
    const session: ChatSession = {
      id, title: '新对话', model, messages: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    const summary: SessionSummary = {
      id, title: '新对话', model,
      createdAt: session.createdAt, updatedAt: session.updatedAt,
      messageCount: 0,
    };
    setSessions(prev => [summary, ...prev]);
    setActiveSession(session);
    setActiveSessionId(id);
    apiCreateSession(session).catch(console.error);
    return id;
  }, [model]);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        const nextId = next.length > 0 ? next[0].id : null;
        setActiveSessionId(nextId);
        if (!nextId) setActiveSession(null);
      }
      return next;
    });
    apiDeleteSession(id).catch(console.error);
  }, [activeSessionId]);

  const renameSession = useCallback((id: string, title: string) => {
    if (activeSession?.id === id) {
      updateActiveSession(s => ({ ...s, title, updatedAt: Date.now() }));
    } else {
      // Rename a non-active session: load, update, save
      apiLoadSession(id).then(s => {
        if (s) apiSaveSession({ ...s, title, updatedAt: Date.now() });
      });
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title, updatedAt: Date.now() } : s));
    }
  }, [activeSession, updateActiveSession]);

  // --- Action helpers ---
  const updateAction = useCallback((messageId: string, actionId: string, patch: Partial<ActionState>) => {
    updateActiveSession(s => ({
      ...s,
      updatedAt: Date.now(),
      messages: s.messages.map(m =>
        m.id === messageId
          ? { ...m, actions: m.actions?.map(a => a.id === actionId ? { ...a, ...patch } : a) }
          : m
      ),
    }));
  }, [updateActiveSession]);

  const runAction = useCallback(async (messageId: string, actionState: ActionState) => {
    updateAction(messageId, actionState.id, { status: 'executing' });
    try {
      const { result, snapshot } = await executeAction(actionState.action);
      updateAction(messageId, actionState.id, { status: 'success', result, snapshot });
    } catch (err: any) {
      updateAction(messageId, actionState.id, { status: 'error', error: err.message });
    }
  }, [updateAction]);

  const autoExecuteSafeActions = useCallback(async (messageId: string, actions: ActionState[]) => {
    const results: { type: string; data: any }[] = [];
    for (const a of actions) {
      if (isSafeAction(a.action)) {
        updateAction(messageId, a.id, { status: 'auto_executing' });
        try {
          const { result } = await executeAction(a.action);
          updateAction(messageId, a.id, { status: 'success', result });
          results.push({ type: a.action.type, data: result });
        } catch (err: any) {
          updateAction(messageId, a.id, { status: 'error', error: err.message });
        }
      }
    }
    // Feed results back to AI for analysis and follow-up suggestions
    if (results.length > 0) {
      const summary = results.map(r => {
        const json = JSON.stringify(r.data, null, 2);
        // Truncate large results to avoid token explosion
        const truncated = json.length > 4000 ? json.slice(0, 4000) + '\n...(truncated)' : json;
        return `[${r.type} 结果]:\n${truncated}`;
      }).join('\n\n');
      const followUpPrompt = `以下是刚才自动执行的操作返回的数据，请根据这些数据用 \`\`\`card 代码块生成结构化的可视化分析卡片，并在卡片的 actions 中给出 2-3 个上下文相关的后续操作建议：\n\n${summary}`;

      setLoading(true);
      try {
        const backendSid = activeSessionRef.current?.backendSessionId;
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: followUpPrompt,
            model,
            sessionId: backendSid || undefined,
            mode: 'dashboard',
          }),
        });
        const data = await res.json();
        if (res.ok && !data.error) {
          if (data.sessionId) {
            updateActiveSession(s => ({ ...s, backendSessionId: data.sessionId }));
          }
          const { text: cleanText, actions: newActions, cards: newCards } = parseActions(data.result || '');
          const newActionStates: ActionState[] = newActions.map(a => ({
            id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
          }));
          const followUpMsg: ChatMessage = {
            id: genId(), role: 'assistant', content: cleanText,
            actions: newActionStates.length > 0 ? newActionStates : undefined,
            cards: newCards.length > 0 ? newCards : undefined,
            timestamp: Date.now(),
          };
          updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, followUpMsg] }));
          if (newActionStates.length > 0) {
            autoExecuteSafeActions(followUpMsg.id, newActionStates);
          }
        }
      } catch { /* follow-up failed silently */ }
      setLoading(false);
    }
  }, [updateAction, model, updateActiveSession]);

  // --- Send message ---
  const sendMessage = useCallback(async (text: string) => {
    let sid = activeSessionId;
    if (!sid) { sid = createSession(); }

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text, timestamp: Date.now() };
    updateActiveSession(s => ({
      ...s,
      updatedAt: Date.now(),
      title: s.messages.length === 0 ? text.slice(0, 30) : s.title,
      messages: [...s.messages, userMsg],
    }));

    setLoading(true);
    try {
      const backendSid = activeSessionRef.current?.backendSessionId;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          model,
          sessionId: backendSid || undefined,
          mode: 'dashboard',
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        const errMsg: ChatMessage = { id: genId(), role: 'error', content: data.error || `HTTP ${res.status}`, timestamp: Date.now() };
        updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, errMsg] }));
      } else {
        if (data.sessionId) {
          updateActiveSession(s => ({ ...s, backendSessionId: data.sessionId }));
        }
        const { text: cleanText, actions, cards } = parseActions(data.result || '');
        const actionStates: ActionState[] = actions.map(a => ({
          id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
        }));
        const assistantMsg: ChatMessage = {
          id: genId(), role: 'assistant', content: cleanText,
          actions: actionStates.length > 0 ? actionStates : undefined,
          cards: cards.length > 0 ? cards : undefined,
          costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
          timestamp: Date.now(),
        };
        updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, assistantMsg] }));

        if (actionStates.length > 0) {
          autoExecuteSafeActions(assistantMsg.id, actionStates);
        }
      }
    } catch (err: any) {
      const errMsg: ChatMessage = { id: genId(), role: 'error', content: err.message || '请求失败', timestamp: Date.now() };
      updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, errMsg] }));
    }
    setLoading(false);
  }, [activeSessionId, createSession, model, updateActiveSession, autoExecuteSafeActions]);

  // --- Confirm / Reject / Undo / Retry ---
  const confirmAction = useCallback(async (messageId: string, actionId: string) => {
    const msg = activeSession?.messages.find(m => m.id === messageId);
    const actionState = msg?.actions?.find(a => a.id === actionId);
    if (!actionState) return;
    await runAction(messageId, actionState);
  }, [activeSession, runAction]);

  const rejectAction = useCallback((messageId: string, actionId: string) => {
    updateAction(messageId, actionId, { status: 'error', error: '用户已拒绝' });
  }, [updateAction]);

  const undoActionById = useCallback(async (messageId: string, actionId: string) => {
    const msg = activeSession?.messages.find(m => m.id === messageId);
    const actionState = msg?.actions?.find(a => a.id === actionId);
    if (!actionState || !actionState.snapshot) return;
    try {
      await undoAction(actionState);
      updateAction(messageId, actionId, { status: 'undone' });
    } catch (err: any) {
      updateAction(messageId, actionId, { error: `撤销失败: ${err.message}` });
    }
  }, [activeSession, updateAction]);

  const retryAction = useCallback(async (messageId: string, actionId: string) => {
    const msg = activeSession?.messages.find(m => m.id === messageId);
    const actionState = msg?.actions?.find(a => a.id === actionId);
    if (!actionState) return;
    await runAction(messageId, actionState);
  }, [activeSession, runAction]);

  return (
    <DashboardChatContext.Provider value={{
      isOpen, openChat, closeChat, toggleChat,
      sessions, activeSessionId, activeSession,
      createSession, deleteSession, renameSession, setActiveSessionId,
      sendMessage, loading, model, setModel,
      confirmAction, rejectAction, undoActionById, retryAction,
      skillSettings, discoveredSkills, toggleSkill,
    }}>
      {children}
    </DashboardChatContext.Provider>
  );
}

export const useChat = () => useContext(DashboardChatContext);
