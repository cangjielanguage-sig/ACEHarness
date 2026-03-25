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
  stopStreaming: () => void;
  deleteMessage: (messageId: string) => void;
  retryFromMessage: (messageId: string) => void;
  continueFromMessage: (messageId: string) => Promise<void>;
  loading: boolean;
  streamingMessageId: string | null;
  model: string;
  setModel: (m: string) => void;
  confirmAction: (messageId: string, actionId: string) => Promise<void>;
  rejectAction: (messageId: string, actionId: string) => void;
  undoActionById: (messageId: string, actionId: string) => Promise<void>;
  retryAction: (messageId: string, actionId: string) => Promise<void>;
  skillSettings: Record<string, boolean>;
  discoveredSkills: { name: string; label: string; description: string; source?: string; tags?: string[] }[];
  toggleSkill: (skill: string) => void;
}

const DashboardChatContext = createContext<DashboardChatContextType>({
  isOpen: false, openChat: () => {}, closeChat: () => {}, toggleChat: () => {},
  sessions: [], activeSessionId: null, activeSession: null,
  createSession: () => '', deleteSession: () => {}, renameSession: () => {},
  setActiveSessionId: () => {},
  sendMessage: async () => {}, stopStreaming: () => {},
  deleteMessage: () => {}, retryFromMessage: () => {}, continueFromMessage: async () => {},
  loading: false, streamingMessageId: null,
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
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [model, setModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chat-model') || 'claude-sonnet-4-6';
    }
    return 'claude-sonnet-4-6';
  });

  // Persist model selection to localStorage whenever it changes
  const handleSetModel = useCallback((m: string) => {
    setModel(m);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-model', m);
    }
  }, []);
  const [skillSettings, setSkillSettings] = useState<Record<string, boolean>>({ 'power-gitcode': true });
  const [discoveredSkills, setDiscoveredSkills] = useState<{ name: string; label: string; description: string; source?: string; tags?: string[] }[]>([]);

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
  const activeEventSourceRef = useRef<EventSource | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const skillSettingsRef = useRef(skillSettings);
  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);
  activeSessionRef.current = activeSession;
  skillSettingsRef.current = skillSettings;

  // Load session list on mount
  useEffect(() => {
    apiListSessions().then(list => {
      setSessions(list);
      if (list.length > 0) setActiveSessionId(list[0].id);
    });
  }, []);

  // Re-parse messages with unparsed action/card blocks in content
  const reparseSession = useCallback((s: ChatSession): ChatSession => {
    let changed = false;
    const messages = s.messages.map(m => {
      if (m.role !== 'assistant' || !m.content) return m;
      const hasUnparsed = /```(?:action|card|json|)\s*\n\s*\{/.test(m.content);
      if (!hasUnparsed) return m;
      const { text, actions, cards } = parseActions(m.content);
      if (actions.length === 0 && cards.length === 0) return m;
      changed = true;
      const actionStates: ActionState[] = actions.map(a => ({
        id: genId(), action: a, status: 'pending' as ActionStatus, timestamp: m.timestamp,
      }));
      return {
        ...m,
        content: text,
        actions: actionStates.length > 0 ? [...(m.actions || []), ...actionStates] : m.actions,
        cards: cards.length > 0 ? [...(m.cards || []), ...cards] : m.cards,
      };
    });
    return changed ? { ...s, messages } : s;
  }, []);

  // Load full session when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) { setActiveSession(null); return; }
    // If we already have it loaded (e.g. just created), skip
    if (activeSession?.id === activeSessionId) return;
    // Close any active stream and reset loading state
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }
    setLoading(false);
    setStreamingMessageId(null);
    apiLoadSession(activeSessionId).then(s => {
      if (!s) { setActiveSession(null); return; }
      // Clean up empty assistant messages left by interrupted streams
      const cleaned = {
        ...s,
        messages: s.messages.filter(m => !(m.role === 'assistant' && !m.content && !m.actions?.length && !m.cards?.length)),
      };
      setActiveSession(reparseSession(cleaned));
    });
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

  // Inject context into actions before execution (e.g., filter skill.list by enabled skills)
  const enrichAction = useCallback((action: ActionBlock): ActionBlock => {
    if (action.type === 'skill.list') {
      const enabledSkills = Object.entries(skillSettingsRef.current)
        .filter(([, v]) => v)
        .map(([k]) => k);
      return { ...action, params: { ...action.params, enabledSkills } };
    }
    return action;
  }, []);

  const runAction = useCallback(async (messageId: string, actionState: ActionState) => {
    updateAction(messageId, actionState.id, { status: 'executing' });
    try {
      const enriched = enrichAction(actionState.action);
      const { result, snapshot } = await executeAction({ ...actionState, action: enriched }.action);
      updateAction(messageId, actionState.id, { status: 'success', result, snapshot });
    } catch (err: any) {
      updateAction(messageId, actionState.id, { status: 'error', error: err.message });
    }
  }, [updateAction, enrichAction]);

  const autoExecuteSafeActions = useCallback(async (messageId: string, actions: ActionState[], _retryCount?: number) => {
    const retryCount = _retryCount || 0;
    const results: { type: string; data: any }[] = [];
    for (const a of actions) {
      if (isSafeAction(a.action)) {
        updateAction(messageId, a.id, { status: 'auto_executing' });
        try {
          const enriched = enrichAction(a.action);
          const { result } = await executeAction(enriched);
          updateAction(messageId, a.id, { status: 'success', result });
          results.push({ type: a.action.type, data: result });
        } catch (err: any) {
          updateAction(messageId, a.id, { status: 'error', error: err.message });
        }
      }
    }
    // Feed results back to AI for analysis via streaming
    if (results.length > 0) {
      const summary = results.map(r => {
        const json = JSON.stringify(r.data, null, 2);
        const truncated = json.length > 4000 ? json.slice(0, 4000) + '\n...(truncated)' : json;
        return `[${r.type} 结果]:\n${truncated}`;
      }).join('\n\n');
      const followUpPrompt = `以下是刚才自动执行的操作返回的数据，请根据这些数据用 \`\`\`card 代码块生成结构化的可视化分析卡片，并在卡片的 actions 中给出 2-3 个上下文相关的后续操作建议：\n\n${summary}`;

      const followUpMsgId = genId();
      const followUpMsg: ChatMessage = {
        id: followUpMsgId, role: 'assistant', content: '', timestamp: Date.now(),
      };
      updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, followUpMsg] }));
      setLoading(true);
      setStreamingMessageId(followUpMsgId);

      try {
        const backendSid = activeSessionRef.current?.backendSessionId;
        const frontendSid = activeSessionRef.current?.id;
        const startRes = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: followUpPrompt, model, sessionId: backendSid || undefined, frontendSessionId: frontendSid || undefined, mode: 'dashboard' }),
        });
        const { chatId } = await startRes.json();
        if (!chatId) throw new Error('Failed to start stream');
        activeChatIdRef.current = chatId;

        await new Promise<void>((resolve, reject) => {
          let accumulated = '';
          let reconnectAttempts = 0;
          const MAX_RECONNECTS = 3;

          const connectSSE = () => {
            const es = new EventSource(`/api/chat/stream?id=${chatId}`);
            activeEventSourceRef.current = es;

            es.addEventListener('delta', (e) => {
              const { content } = JSON.parse(e.data);
              accumulated += content;
              // Extract cards in real-time so they render immediately without waiting for stream to finish
              const { text: cleanText, cards: newCards } = parseActions(accumulated);
              updateActiveSession(s => {
                const existingMsg = s.messages.find(m => m.id === followUpMsgId);
                const existingCards: any[] = existingMsg?.cards || [];
                const existingKeys = new Set(existingCards.map((c: any) => c.header?.title));
                const uniqueNewCards = newCards.filter((c: any) => !existingKeys.has(c.header?.title));
                return {
                  ...s, messages: s.messages.map(m => m.id === followUpMsgId ? { ...m, content: cleanText, cards: [...existingCards, ...uniqueNewCards] } : m),
                };
              });
            });

            es.addEventListener('done', (e) => {
              const data = JSON.parse(e.data);
              es.close();
              activeEventSourceRef.current = null;
              activeChatIdRef.current = null;
              if (data.sessionId) {
                updateActiveSession(s => ({ ...s, backendSessionId: data.sessionId }));
              }
              const fullText = data.result || accumulated;
              const { text: cleanText, actions: newActions, cards: newCards } = parseActions(fullText);
              const newActionStates: ActionState[] = newActions.map(a => ({
                id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
              }));
              updateActiveSession(s => ({
                ...s, updatedAt: Date.now(),
                messages: s.messages.map(m => m.id === followUpMsgId ? {
                  ...m, content: cleanText,
                  actions: newActionStates.length > 0 ? newActionStates : undefined,
                  cards: newCards.length > 0 ? newCards : undefined,
                } : m),
              }));
              if (newActionStates.length > 0) {
                autoExecuteSafeActions(followUpMsgId, newActionStates);
              }
              // If no cards and content is substantial, trigger a card-format retry
              if (newCards.length === 0 && cleanText.length > 200 && retryCount < 1) {
                resolve(); // resolve first, then retry below
                const retryPrompt = `你刚才的回复没有使用 \`\`\`card 代码块来展示结构化内容。请将上面的分析结果重新用 \`\`\`card 代码块格式输出为可视化卡片（不要用 \`\`\`json）。card 格式示例：{"header":{"icon":"图标","title":"标题","gradient":"from-blue-500 to-cyan-500"},"blocks":[...],"actions":[{"label":"按钮","prompt":"消息"}]}`;
                sendMessageRef.current?.(retryPrompt);
              }
              resolve();
            });

            es.addEventListener('error', () => {
              es.close();
              activeEventSourceRef.current = null;
              if (reconnectAttempts < MAX_RECONNECTS) {
                reconnectAttempts++;
                setTimeout(connectSSE, 1000 * reconnectAttempts);
              } else {
                // Try recovery via backendSessionId
                const backendSid = activeSessionRef.current?.backendSessionId;
                if (backendSid) {
                  fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(backendSid)}`)
                    .then(r => r.json())
                    .then(recData => {
                      if (recData.content) {
                        const { text: cleanText, actions: newActions, cards: newCards } = parseActions(recData.content);
                        updateActiveSession(s => ({
                          ...s, messages: s.messages.map(m => m.id === followUpMsgId ? { ...m, content: cleanText, cards: newCards } : m),
                        }));
                      }
                    })
                    .catch(() => {});
                }
                activeChatIdRef.current = null;
                reject(new Error('Stream error'));
              }
            });
          };

          connectSSE();
        });
      } catch { /* follow-up failed silently */ }
      setLoading(false);
      setStreamingMessageId(null);
    }
  }, [updateAction, model, updateActiveSession]);

  // --- Send message (streaming) ---
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

    const assistantMsgId = genId();
    const assistantMsg: ChatMessage = { id: assistantMsgId, role: 'assistant', content: '', timestamp: Date.now() };
    updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, assistantMsg] }));
    setLoading(true);
    setStreamingMessageId(assistantMsgId);

    try {
      const backendSid = activeSessionRef.current?.backendSessionId;
      const frontendSid = activeSessionRef.current?.id;
      const startRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, model, sessionId: backendSid || undefined, frontendSessionId: frontendSid || undefined, mode: 'dashboard' }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || startData.error) {
        updateActiveSession(s => ({
          ...s, updatedAt: Date.now(),
          messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, role: 'error' as const, content: startData.error || `HTTP ${startRes.status}` } : m),
        }));
        setLoading(false);
        setStreamingMessageId(null);
        return;
      }

      const { chatId } = startData;
      activeChatIdRef.current = chatId;
      await new Promise<void>((resolve, reject) => {
        let accumulated = '';
        let reconnectAttempts = 0;
        const MAX_RECONNECTS = 3;
        const INACTIVITY_TIMEOUT = 600_000; // 10 minutes without any data
        let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

        const resetInactivityTimer = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            if (activeEventSourceRef.current) {
              activeEventSourceRef.current.close();
              activeEventSourceRef.current = null;
            }
            activeChatIdRef.current = null;
            reject(new Error('响应超时，请重试'));
          }, INACTIVITY_TIMEOUT);
        };

        const connectSSE = () => {
          const es = new EventSource(`/api/chat/stream?id=${chatId}`);
          activeEventSourceRef.current = es;
          resetInactivityTimer();

          es.addEventListener('delta', (e) => {
            resetInactivityTimer();
            const { content } = JSON.parse(e.data);
            accumulated += content;
            // Extract cards in real-time so they render immediately without waiting for stream to finish
            const { text: cleanText, cards: newCards } = parseActions(accumulated);
            updateActiveSession(s => {
              const existingMsg = s.messages.find(m => m.id === assistantMsgId);
              const existingCards: any[] = existingMsg?.cards || [];
              // Merge cards by header.title to avoid duplicates
              const existingKeys = new Set(existingCards.map((c: any) => c.header?.title));
              const uniqueNewCards = newCards.filter((c: any) => !existingKeys.has(c.header?.title));
              return {
                ...s, messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, content: cleanText, cards: [...existingCards, ...uniqueNewCards] } : m),
              };
            });
          });

          es.addEventListener('done', (e) => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            const data = JSON.parse(e.data);
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            if (data.sessionId) {
              updateActiveSession(s => ({ ...s, backendSessionId: data.sessionId }));
            }
            const fullText = data.result || accumulated;
            const { text: cleanText, actions, cards } = parseActions(fullText);
            const actionStates: ActionState[] = actions.map(a => ({
              id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
            }));
            updateActiveSession(s => ({
              ...s, updatedAt: Date.now(),
              messages: s.messages.map(m => m.id === assistantMsgId ? {
                ...m, content: cleanText,
                actions: actionStates.length > 0 ? actionStates : undefined,
                cards: cards.length > 0 ? cards : undefined,
                costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
              } : m),
            }));
            if (actionStates.length > 0) {
              autoExecuteSafeActions(assistantMsgId, actionStates);
            }
            resolve();
          });

          es.addEventListener('error', () => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            es.close();
            activeEventSourceRef.current = null;
            if (reconnectAttempts < MAX_RECONNECTS) {
              reconnectAttempts++;
              setTimeout(connectSSE, 1000 * reconnectAttempts);
            } else {
              // All reconnects failed — try to recover full content from backend
              const backendSid = activeSessionRef.current?.backendSessionId;
              if (backendSid) {
                fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(backendSid)}`)
                  .then(r => r.json())
                  .then(recData => {
                    if (recData.content) {
                      const { text: cleanText, actions: newActions, cards: newCards } = parseActions(recData.content);
                      const newActionStates: ActionState[] = newActions.map(a => ({
                        id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
                      }));
                      updateActiveSession(s => ({
                        ...s, updatedAt: Date.now(),
                        messages: s.messages.map(m => m.id === assistantMsgId ? {
                          ...m, content: cleanText,
                          actions: newActionStates.length > 0 ? newActionStates : m.actions,
                          cards: newCards.length > 0 ? newCards : m.cards,
                        } : m),
                      }));
                      if (newActionStates.length > 0) {
                        autoExecuteSafeActions(assistantMsgId, newActionStates);
                      }
                    } else {
                      updateActiveSession(s => ({
                        ...s, messages: s.messages.map(m => m.id === assistantMsgId && !m.content
                          ? { ...m, role: 'error' as const, content: '流式连接中断' }
                          : m),
                      }));
                    }
                  })
                  .catch(() => {
                    updateActiveSession(s => ({
                      ...s, messages: s.messages.map(m => m.id === assistantMsgId && !m.content
                        ? { ...m, role: 'error' as const, content: '流式连接中断' }
                        : m),
                    }));
                  });
              }
              activeChatIdRef.current = null;
              resolve();
            }
          });
        };

        connectSSE();
      });
    } catch (err: any) {
      // If the assistant message is still empty, convert to error
      updateActiveSession(s => ({
        ...s, updatedAt: Date.now(),
        messages: s.messages.map(m => m.id === assistantMsgId && !m.content
          ? { ...m, role: 'error' as const, content: err.message || '请求失败' }
          : m),
      }));
    }
    setLoading(false);
    setStreamingMessageId(null);
  }, [activeSessionId, createSession, model, updateActiveSession, autoExecuteSafeActions]);
  sendMessageRef.current = sendMessage;
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

    updateAction(messageId, actionState.id, { status: 'executing' });
    try {
      const { result, snapshot } = await executeAction(actionState.action);
      updateAction(messageId, actionState.id, { status: 'success', result, snapshot });
    } catch (err: any) {
      const errorMsg = err.message || '执行失败';
      updateAction(messageId, actionState.id, { status: 'error', error: errorMsg });
      // Feed error back to AI so it can self-correct
      const { type, params } = actionState.action;
      const errorPrompt = `刚才执行的操作失败了，请根据错误信息修正后重试：\n\n操作类型: ${type}\n参数: ${JSON.stringify(params)}\n错误: ${errorMsg}\n\n请分析错误原因并给出正确的操作。`;
      sendMessage(errorPrompt);
    }
  }, [activeSession, updateAction, sendMessage]);

  // --- Stop streaming ---
  const stopStreaming = useCallback(() => {
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }
    if (activeChatIdRef.current) {
      fetch(`/api/chat/stream?id=${encodeURIComponent(activeChatIdRef.current)}`, { method: 'DELETE' }).catch(() => {});
      activeChatIdRef.current = null;
    }
    setLoading(false);
    setStreamingMessageId(null);
  }, []);

  // --- Delete message ---
  const deleteMessage = useCallback((messageId: string) => {
    if (loading) return;
    updateActiveSession(s => ({
      ...s, updatedAt: Date.now(),
      messages: s.messages.filter(m => m.id !== messageId),
    }));
  }, [loading, updateActiveSession]);

  // --- Retry from user message ---
  const retryFromMessage = useCallback((messageId: string) => {
    if (loading) return;
    const session = activeSessionRef.current;
    if (!session) return;
    const msgIndex = session.messages.findIndex(m => m.id === messageId);
    if (msgIndex < 0) return;
    const targetMsg = session.messages[msgIndex];
    if (targetMsg.role !== 'user') return;
    // Truncate everything after this user message
    updateActiveSession(s => ({
      ...s, updatedAt: Date.now(),
      messages: s.messages.slice(0, msgIndex),
    }));
    // Re-send the same text
    sendMessage(targetMsg.content);
  }, [loading, updateActiveSession, sendMessage]);

  // --- Continue from timeout ---
  const continueFromMessage = useCallback(async (messageId: string) => {
    const session = activeSessionRef.current;
    if (!session) return;
    const msg = session.messages.find(m => m.id === messageId);
    if (!msg || msg.role !== 'error') return;

    // Check if this is a timeout error
    if (!msg.content.includes('超时') && !msg.content.includes('timeout')) return;

    const backendSid = session.backendSessionId;
    if (!backendSid) return;

    setLoading(true);
    try {
      // Try to recover content from the backend
      const recRes = await fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(backendSid)}`);
      const recData = await recRes.json();

      if (recData.content) {
        const { text: cleanText, actions: newActions, cards: newCards } = parseActions(recData.content);
        const newActionStates: ActionState[] = newActions.map(a => ({
          id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
        }));

        // Update the error message with recovered content
        updateActiveSession(s => ({
          ...s, updatedAt: Date.now(),
          messages: s.messages.map(m => m.id === messageId ? {
            ...m,
            role: 'assistant' as const,
            content: cleanText,
            actions: newActionStates.length > 0 ? newActionStates : undefined,
            cards: newCards.length > 0 ? newCards : undefined,
          } : m),
        }));

        if (newActionStates.length > 0) {
          autoExecuteSafeActions(messageId, newActionStates);
        }
      } else {
        // No content recovered - could be that the process was killed
        // Try to check if there's an active stream
        const activeRes = await fetch(`/api/chat/stream/active?frontendSessionId=${encodeURIComponent(session.id)}`);
        const activeData = await activeRes.json();

        if (activeData.active && activeData.chatId) {
          // There's still an active stream - reconnect to it
          // This shouldn't normally happen for timeouts, but handle it anyway
          updateActiveSession(s => ({
            ...s, updatedAt: Date.now(),
            messages: s.messages.map(m => m.id === messageId ? {
              ...m,
              role: 'assistant' as const,
              content: '[重新连接中...]',
            } : m),
          }));
          // The reconnection logic would be handled by the SSE connection below
        }
      }
    } catch (err) {
      console.error('Continue from timeout failed:', err);
    } finally {
      setLoading(false);
    }
  }, [updateActiveSession, autoExecuteSafeActions]);

  return (
    <DashboardChatContext.Provider value={{
      isOpen, openChat, closeChat, toggleChat,
      sessions, activeSessionId, activeSession,
      createSession, deleteSession, renameSession, setActiveSessionId,
      sendMessage, stopStreaming, deleteMessage, retryFromMessage, continueFromMessage,
      loading, streamingMessageId, model, setModel: handleSetModel,
      confirmAction, rejectAction, undoActionById, retryAction,
      skillSettings, discoveredSkills, toggleSkill,
    }}>
      {children}
    </DashboardChatContext.Provider>
  );
}

export const useChat = () => useContext(DashboardChatContext);
