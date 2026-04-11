/**
 * 聊天会话持久化层
 * 将聊天记录存储为 JSON 文件：data/chat-sessions/{sessionId}.json
 */

import { mkdir, writeFile, readFile, readdir, unlink } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const CHAT_DIR = resolve(process.cwd(), 'data', 'chat-sessions');

export interface PersistedAction {
  id: string;
  action: { type: string; params: Record<string, any>; description?: string };
  status: string;
  result?: any;
  snapshot?: any;
  error?: string;
  timestamp: number;
}

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  actions?: PersistedAction[];
  costUsd?: number;
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
  timestamp: number;
}

export interface PersistedChatSession {
  id: string;
  title: string;
  model: string;
  backendSessionId?: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedMessage[];
  createdBy?: string;
  visibility?: 'public' | 'private';
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
  createdBy?: string;
  visibility?: 'public' | 'private';
}

async function ensureDir() {
  if (!existsSync(CHAT_DIR)) {
    await mkdir(CHAT_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(CHAT_DIR, `${safeId}.json`);
}

/** 截断过长的 action result，避免文件过大 */
function truncateResults(messages: PersistedMessage[]): PersistedMessage[] {
  const MAX_RESULT_LEN = 5000;
  return messages.map(m => ({
    ...m,
    actions: m.actions?.map(a => {
      let result = a.result;
      if (result && typeof result === 'object') {
        if (Array.isArray(result.skills)) {
          result = { ...result, skills: result.skills.map((s: any) => ({ ...s, detailedDescription: undefined })) };
        }
        if (Array.isArray(result.agents)) {
          result = { ...result, agents: result.agents.map((ag: any) => ({ ...ag, systemPrompt: ag.systemPrompt?.slice(0, 200) })) };
        }
      }
      return {
        ...a,
        result: result && JSON.stringify(result).length > MAX_RESULT_LEN
          ? { _truncated: true, summary: JSON.stringify(result).slice(0, 500) }
          : result,
        snapshot: undefined,
      };
    }),
  }));
}

export async function saveChatSession(session: PersistedChatSession): Promise<void> {
  await ensureDir();
  const data = {
    ...session,
    messages: truncateResults(session.messages),
  };
  await writeFile(sessionPath(session.id), JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadChatSession(id: string): Promise<PersistedChatSession | null> {
  try {
    const content = await readFile(sessionPath(id), 'utf-8');
    return JSON.parse(content) as PersistedChatSession;
  } catch {
    return null;
  }
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  await ensureDir();
  const files = await readdir(CHAT_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  const summaries: ChatSessionSummary[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await readFile(resolve(CHAT_DIR, file), 'utf-8');
      const session = JSON.parse(content) as PersistedChatSession;
      const lastMsg = session.messages?.filter(m => m.role !== 'error').slice(-1)[0];
      summaries.push({
        id: session.id,
        title: session.title,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages?.length || 0,
        lastMessage: lastMsg?.content?.slice(0, 100),
        createdBy: session.createdBy,
        visibility: session.visibility,
      });
    } catch { /* skip corrupted */ }
  }

  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const path = sessionPath(id);
  if (existsSync(path)) {
    await unlink(path);
    return true;
  }
  return false;
}

export async function deleteAllChatSessions(): Promise<number> {
  await ensureDir();
  const files = await readdir(CHAT_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  for (const file of jsonFiles) {
    await unlink(resolve(CHAT_DIR, file));
  }
  return jsonFiles.length;
}
