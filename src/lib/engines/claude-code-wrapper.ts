/**
 * Claude Code Engine Wrapper
 *
 * Unified wrapper implementing the Engine interface for Claude Code.
 * Uses @anthropic-ai/claude-agent-sdk for all execution:
 * - Normal mode: permissionMode 'bypassPermissions'
 * - Plan mode: permissionMode 'plan' + AskUserQuestion bridge + plan capture
 */

import { EventEmitter } from 'events';
import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { loadEnvVars, buildEnvObject } from '../env-manager';
import { fenced } from '../markdown-utils';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';

export type SdkPlanCapturedVia =
  | 'canUseTool_write'
  | 'stop_hook'
  | 'output_parse'
  | 'filesystem';
export type SdkPlanSubtaskTelemetry = {
  phase: 'start' | 'progress' | 'tool' | 'end';
  taskId: string;
  description: string;
  elapsedSec: number;
  detail?: string;
  toolName?: string;
  terminalStatus?: 'completed' | 'failed' | 'stopped';
  summary?: string;
  outputFile?: string;
};

// ============================================================================
// Helpers
// ============================================================================

const CAPTURE_PRIORITY: Record<SdkPlanCapturedVia, number> = {
  canUseTool_write: 0, stop_hook: 1, output_parse: 2, filesystem: 3,
};
function priorityOf(via: SdkPlanCapturedVia | ''): number {
  return via ? CAPTURE_PRIORITY[via] : 999;
}
function shortTaskId(id: string): string {
  return !id ? '?' : id.length <= 12 ? id : `${id.slice(0, 10)}…`;
}
function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}
function parseToolJson(inputJson: string): Record<string, unknown> | null {
  if (!inputJson.trim()) return null;
  try {
    const parsed = JSON.parse(inputJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}
function resolveToolName(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}
function toolPath(rawInput: Record<string, unknown>): string {
  const path = rawInput.file_path ?? rawInput.filePath ?? rawInput.path;
  return typeof path === 'string' ? path : '';
}
function formatClaudeToolResult(toolNameRaw: string, inputJson: string): string {
  const toolName = resolveToolName(toolNameRaw);
  const isTaskTool = toolName === 'task' || toolName.endsWith('/task') || toolName.includes('task');
  const rawInput = parseToolJson(inputJson) || {};
  const p = toolPath(rawInput);

  if (toolName === 'write') {
    const content = typeof rawInput.content === 'string' ? rawInput.content : '';
    const lines = content ? content.split('\n').length : 0;
    let out = `\n📝 写入文件: \`${p || '(未知路径)'}\`${lines ? ` (${lines} 行)` : ''}\n`;
    if (content) out += `\n<details><summary>查看内容 (${lines} 行)</summary>\n\n${fenced(content, p.split('.').pop() || '')}\n\n</details>\n`;
    return out;
  }
  if (toolName === 'bash') {
    const cmd = typeof rawInput.command === 'string' ? rawInput.command : '';
    if (!cmd) return '\n💻 执行命令\n';
    const cmdLines = cmd.split('\n');
    if (cmdLines.length <= 1 && cmd.length <= 120) return `\n💻 执行命令: \`${cmd}\`\n`;
    return `\n💻 执行命令 (${cmdLines.length} 行)\n\n<details><summary>查看命令</summary>\n\n${fenced(cmd, 'bash')}\n\n</details>\n`;
  }
  if (toolName === 'read') {
    return `\n📖 读取文件: \`${p || '(未知路径)'}\`\n`;
  }
  if (toolName === 'edit' || toolName === 'multiedit' || toolName === 'patch') {
    const oldStr = typeof rawInput.old_string === 'string' ? rawInput.old_string : (typeof rawInput.oldString === 'string' ? rawInput.oldString : '');
    const newStr = typeof rawInput.new_string === 'string' ? rawInput.new_string : (typeof rawInput.newString === 'string' ? rawInput.newString : '');
    const oldLines = oldStr ? oldStr.split('\n').length : 0;
    const newLines = newStr ? newStr.split('\n').length : 0;
    const added = Math.max(0, newLines - oldLines);
    const removed = Math.max(0, oldLines - newLines);
    let stats = `${Math.min(oldLines, newLines)} 行修改`;
    if (added > 0) stats += `, +${added} 行`;
    if (removed > 0) stats += `, -${removed} 行`;
    let out = `\n✏️ 编辑文件: \`${p || '(未知路径)'}\` (${stats})\n`;
    if (oldStr || newStr) {
      const diff = (oldStr ? oldStr.split('\n').map((l) => `- ${l}`).join('\n') + '\n' : '')
        + (newStr ? newStr.split('\n').map((l) => `+ ${l}`).join('\n') + '\n' : '');
      out += `\n<details><summary>查看变更 (${stats})</summary>\n\n${fenced(diff.trimEnd(), 'diff')}\n\n</details>\n`;
    }
    return out;
  }
  if (toolName === 'glob') {
    const pattern = typeof rawInput.pattern === 'string' ? rawInput.pattern : '';
    return `\n🔍 搜索文件: \`${pattern || '(空模式)'}\`\n`;
  }
  if (toolName === 'grep') {
    const pattern = typeof rawInput.pattern === 'string' ? rawInput.pattern : '';
    return `\n🔍 搜索内容: \`${pattern || '(空模式)'}\`\n`;
  }
  if (toolName === 'ls') {
    return `\n📂 列出目录: \`${p || '.'}\`\n`;
  }
  if (isTaskTool) {
    const desc = typeof rawInput.description === 'string' ? rawInput.description : '';
    return `\n🤖 启动子任务: ${desc || '(无描述)'}\n`;
  }
  if (toolName === 'todowrite' || toolName === 'todo') {
    const todosRaw = (rawInput.todos ?? rawInput.items) as unknown;
    if (!Array.isArray(todosRaw) || todosRaw.length === 0) return '\n📋 任务列表更新中...\n';
    const done = todosRaw.filter((t: any) => t?.status === 'completed' || t?.status === 'done').length;
    const inProg = todosRaw.filter((t: any) => t?.status === 'in_progress' || t?.status === 'in-progress').length;
    return `\n📋 任务列表 (${done}/${todosRaw.length} 完成${inProg ? `, ${inProg} 进行中` : ''})\n`;
  }
  if (toolName === 'webfetch') {
    const url = typeof rawInput.url === 'string' ? rawInput.url : '';
    return `\n🌐 获取网页: \`${url || '(未知URL)'}\`\n`;
  }
  if (toolName === 'websearch') {
    const q = typeof rawInput.query === 'string' ? rawInput.query : '';
    return `\n🔎 搜索: \`${q || '(空查询)'}\`\n`;
  }
  if (inputJson.trim()) {
    const lines = inputJson.split('\n').length;
    return `\n<details><summary>查看输入 (${lines} 行)</summary>\n\n${fenced(inputJson, 'json')}\n\n</details>\n`;
  }
  return '';
}

function formatClaudeToolBlock(toolNameRaw: string, inputJson: string, toolId?: string): string {
  const toolName = resolveToolName(toolNameRaw) || 'tool';
  const isTaskTool = toolName === 'task' || toolName.endsWith('/task') || toolName.includes('task');
  const titleMap: Record<string, string> = {
    read: '📖 Read',
    write: '📝 Write',
    bash: '💻 Bash',
    edit: '✏️ Edit',
    multiedit: '✏️ MultiEdit',
    patch: '✏️ Patch',
    grep: '🔍 Grep',
    glob: '🔍 Glob',
    ls: '📂 Ls',
    task: '🤖 Task',
    todo: '📋 Todo',
    todowrite: '📋 TodoWrite',
    webfetch: '🌐 WebFetch',
    websearch: '🔎 WebSearch',
  };
  const title = isTaskTool ? '🤖 子任务' : (titleMap[toolName] || `🔧 ${toolName}`);
  const detail = formatClaudeToolResult(toolName, inputJson);
  return `\n\n**${title}**\n${detail || '\n'}`;
}

export async function readLatestPlanFile(
  workDir: string
): Promise<{ path: string; content: string } | null> {
  const plansDir = join(workDir, '.claude', 'plans');
  if (!existsSync(plansDir)) return null;
  let best: { path: string; mtime: number } | null = null;
  try {
    const files = await readdir(plansDir);
    for (const name of files) {
      const p = join(plansDir, name);
      const st = await stat(p).catch(() => null);
      if (st?.isFile()) {
        if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs };
      }
    }
  } catch { return null; }
  if (!best) return null;
  try {
    const content = await readFile(best.path, 'utf-8');
    return { path: best.path, content };
  } catch { return null; }
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';

  if (Array.isArray(value)) {
    const pieces = value
      .map((item) => extractTextFromUnknown(item))
      .filter((item) => item.length > 0);
    if (pieces.length <= 1) return pieces[0] || '';
    return pieces.reduce((acc, piece) => {
      if (!acc) return piece;
      const prevEndsWithWhitespace = /\s$/.test(acc);
      const nextStartsWithWhitespace = /^\s/.test(piece);
      return prevEndsWithWhitespace || nextStartsWithWhitespace
        ? `${acc}${piece}`
        : `${acc}\n${piece}`;
    }, '');
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Common shapes from different providers/SDK adapters:
    // - { type: "text", text: "..." }
    // - { text: { value: "..." } }
    // - { content: ... } / { message: { content: ... } }
    // - OpenAI-ish: { type: "output_text", text: "..." }
    const directText = obj.text;
    if (typeof directText === 'string') return directText;
    if (directText && typeof directText === 'object') {
      const nestedValue = (directText as Record<string, unknown>).value;
      if (typeof nestedValue === 'string') return nestedValue;
    }

    if (typeof obj.content === 'string') return obj.content;
    if (obj.content != null) {
      const nested = extractTextFromUnknown(obj.content);
      if (nested) return nested;
    }

    if (obj.message != null) {
      const nested = extractTextFromUnknown(obj.message);
      if (nested) return nested;
    }
  }

  return '';
}

function extractAssistantText(msg: unknown): string {
  return extractTextFromUnknown(msg);
}

function extractTextFromStreamEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return '';
  const e = ev as Record<string, unknown>;
  const delta = e.delta as Record<string, unknown> | undefined;
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
  return '';
}

function extractThinkingFromStreamEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return '';
  const e = ev as Record<string, unknown>;
  const delta = e.delta as Record<string, unknown> | undefined;
  if (!delta) return '';

  if (typeof delta.thinking === 'string') return delta.thinking;
  if (typeof delta.text === 'string' && typeof delta.type === 'string' && delta.type.includes('thinking')) {
    return delta.text;
  }
  return '';
}

function buildCleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION;
  delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  env.IS_SANDBOX = '1';
  return env;
}
function formatElapsedSec(usageMs?: number, wallMs?: number): { text: string; sec: number } {
  const ms = usageMs ?? wallMs;
  if (ms == null || ms < 0) return { text: '?', sec: 0 };
  const sec = ms / 1000;
  const text = sec < 10 ? sec.toFixed(1) : String(Math.round(sec));
  return { text, sec };
}

// ============================================================================
// ClaudeCodeEngineWrapper
// ============================================================================

export class ClaudeCodeEngineWrapper extends EventEmitter implements Engine {
  private _abortController: AbortController | null = null;

  // Plan mode state
  private _capturedDeliverable = '';
  private _planFilePath = '';
  private _capturedVia: SdkPlanCapturedVia | '' = '';
  private _pendingQuestionResolver: ((answers: Record<string, string>) => void) | null = null;
  private _pendingQuestion: Record<string, unknown> | null = null;

  getName(): string { return 'claude-code'; }

  async isAvailable(): Promise<boolean> {
    try {
      await import('@anthropic-ai/claude-agent-sdk');
      return true;
    } catch { return false; }
  }

  cancel(): void {
    try { this._abortController?.abort(); } catch {}
  }

  cleanup(): void {
    this.cancel();
    this.removeAllListeners();
  }

  // ---- Plan mode public API ----

  get capturedDeliverable(): string { return this._capturedDeliverable; }
  get planFilePath(): string { return this._planFilePath; }
  get capturedVia(): SdkPlanCapturedVia | '' { return this._capturedVia; }

  setCapturedDeliverable(content: string, filePath: string, via: SdkPlanCapturedVia): void {
    if (!content?.trim()) return;
    if (this._capturedVia && priorityOf(via) > priorityOf(this._capturedVia)) return;
    this._capturedDeliverable = content;
    this._planFilePath = filePath;
    this._capturedVia = via;
    this.emit('plan-file-captured', { path: filePath, length: content.length, via });
  }

  getPendingQuestion(): Record<string, unknown> | null { return this._pendingQuestion; }

  submitAnswers(answers: Record<string, string>): void {
    if (this._pendingQuestionResolver) {
      this._pendingQuestionResolver(answers);
      this._pendingQuestionResolver = null;
      this._pendingQuestion = null;
    }
  }

  // ---- Execute (unified SDK entry) ----

  async execute(options: EngineOptions): Promise<EngineResult> {
    const isPlan = options.mode === 'plan';
    this._abortController = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
    const timer = setTimeout(() => { try { this._abortController?.abort(); } catch {} }, timeoutMs);

    let accumulated = '';
    const MAX_API_RETRY_ATTEMPTS = 5;
    const execStartedAt = Date.now();
    let firstDeltaAt = 0;
    let lastDeltaAt = 0;
    let lastProgressLogAt = 0;
    let deltaCount = 0;
    let deltaBytes = 0;
    let assistantTextBytesEmitted = 0;
    let assistantSnapshotCount = 0;
    const streamDebug = process.env.ACE_CHAT_STREAM_DEBUG === '1';
    const seenMsgTypes = new Set<string>();
    const seenSystemSubtypes = new Set<string>();
    const seenDeltaTypes = new Set<string>();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      // Build prompt
      const userFacingPrompt = options.systemPrompt?.trim()
        ? `# 系统指令\n${options.systemPrompt}\n\n---\n\n# 任务与上下文\n${options.prompt}`
        : options.prompt;

      // Build env
      const spawnEnv = buildCleanEnv();
      try {
        const userEnvVars = await loadEnvVars();
        const userEnv = buildEnvObject(userEnvVars);
        Object.assign(spawnEnv, userEnv);
      } catch {}

      // SDK query options
      const sdkOptions: Record<string, unknown> = {
        env: spawnEnv,
        cwd: options.workingDirectory,
        model: options.model || undefined,
        permissionMode: isPlan ? 'plan' : 'bypassPermissions',
        allowDangerouslySkipPermissions: !isPlan,
        includePartialMessages: true,
        abortController: this._abortController,
        maxTurns: isPlan ? 80 : 200,
      };

      if (options.sessionId) {
        (sdkOptions as any).resume = options.sessionId;
      }

      // Plan mode: canUseTool hook for AskUserQuestion + Write capture
      if (isPlan) {
        sdkOptions.canUseTool = async (toolName: string, input: unknown) => {
          if (toolName === 'AskUserQuestion') {
            const questions = (input as { questions?: unknown }).questions ?? [];
            this._pendingQuestion = input as Record<string, unknown>;
            this.emit('ask-user-question', { questions });
            this.emit('stream', { type: 'text', content: '\n⏳ 等待用户回答问题…\n' } as EngineStreamEvent);
            const answers = await new Promise<Record<string, string>>((resolve) => {
              this._pendingQuestionResolver = resolve;
            });
            const formatted = Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join('\n');
            this.emit('stream', { type: 'text', content: `\n✅ 用户已回答:\n${formatted}\n` } as EngineStreamEvent);
            return { behavior: 'allow' as const, updatedInput: { ...(input as Record<string, unknown>), answers } };
          }
          if (toolName === 'Write') {
            const ti = input as Record<string, unknown>;
            const filePath = String(ti.file_path ?? ti.filePath ?? '');
            const content = String(ti.content ?? '');
            if ((filePath.includes('.claude/plans') || filePath.includes('.claude\\plans')) && content.trim()) {
              this.setCapturedDeliverable(content, filePath, 'canUseTool_write');
            }
            return { behavior: 'allow' as const, updatedInput: input };
          }
          return { behavior: 'allow' as const, updatedInput: input };
        };
      }

      const iter = query({ prompt: userFacingPrompt, options: sdkOptions as any });
      const taskStartedAt = new Map<string, number>();
      const streamToolBlocks = new Map<number, { id: string; name: string; inputJson: string }>();
      let capturedSessionId: string | undefined;
      let sawStreamEvent = false;
      let lastAssistantSnapshot = '';
      let lastBlockWasTool = false;

      for await (const msg of iter) {
        if (streamDebug) {
          const mt = String((msg as { type?: unknown })?.type || 'unknown');
          if (!seenMsgTypes.has(mt)) {
            seenMsgTypes.add(mt);
          }
        }
        // Capture session_id from any message
        if (!capturedSessionId && (msg as any).session_id) {
          capturedSessionId = (msg as any).session_id;
        }
        if (msg.type === 'assistant') {
          assistantSnapshotCount += 1;
          // Some providers may not emit stream_event consistently.
          // In that case, use assistant snapshot as incremental stream source.
          if (!sawStreamEvent) {
            const snapshotText = extractAssistantText(msg as { message?: { content?: unknown } });
            if (snapshotText) {
              let piece = '';
              if (lastAssistantSnapshot && snapshotText.startsWith(lastAssistantSnapshot)) {
                piece = snapshotText.slice(lastAssistantSnapshot.length);
              } else if (!lastAssistantSnapshot) {
                piece = snapshotText;
              }
              if (piece) {
                const now = Date.now();
                deltaCount += 1;
                deltaBytes += Buffer.byteLength(piece, 'utf8');
                assistantTextBytesEmitted += Buffer.byteLength(piece, 'utf8');
                if (!firstDeltaAt) {
                  firstDeltaAt = now;
                } else if (lastDeltaAt && now - lastProgressLogAt >= 2000) {
                  lastProgressLogAt = now;
                }
                lastDeltaAt = now;
                const nextPiece = lastBlockWasTool && !piece.startsWith('\n') ? `\n\n${piece}` : piece;
                accumulated += nextPiece;
                this.emit('stream', { type: 'text', content: nextPiece } as EngineStreamEvent);
                lastBlockWasTool = false;
              }
              lastAssistantSnapshot = snapshotText;
            }
          }
        } else if (msg.type === 'stream_event') {
          sawStreamEvent = true;
          const ev = (msg as { event?: unknown }).event;
          const streamEvent = (ev && typeof ev === 'object') ? (ev as Record<string, unknown>) : null;
          const eventType = String(streamEvent?.type || '');
          const eventIndex = Number(streamEvent?.index);
          if (streamDebug && ev && typeof ev === 'object') {
            const delta = (ev as Record<string, unknown>).delta as Record<string, unknown> | undefined;
            const dt = String(delta?.type || 'unknown');
            if (!seenDeltaTypes.has(dt)) {
              seenDeltaTypes.add(dt);
            }
          }
          if (eventType === 'content_block_start' && Number.isFinite(eventIndex)) {
            const contentBlock = streamEvent?.content_block as Record<string, unknown> | undefined;
            if (contentBlock?.type === 'tool_use') {
              const toolId = String(contentBlock.id || '');
              const toolName = String(contentBlock.name || 'tool');
              streamToolBlocks.set(eventIndex, { id: toolId, name: toolName, inputJson: '' });
            }
          } else if (eventType === 'content_block_delta' && Number.isFinite(eventIndex)) {
            const delta = streamEvent?.delta as Record<string, unknown> | undefined;
            if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const tool = streamToolBlocks.get(eventIndex);
              if (tool) {
                tool.inputJson += delta.partial_json;
                streamToolBlocks.set(eventIndex, tool);
              }
            }
          } else if (eventType === 'content_block_stop' && Number.isFinite(eventIndex)) {
            const tool = streamToolBlocks.get(eventIndex);
            if (tool) {
              const block = formatClaudeToolBlock(tool.name, tool.inputJson, tool.id);
              accumulated += block;
              this.emit('stream', { type: 'text', content: block } as EngineStreamEvent);
              lastBlockWasTool = true;
              streamToolBlocks.delete(eventIndex);
            }
          }
          const thinkingPiece = extractThinkingFromStreamEvent(ev);
          if (thinkingPiece) {
            this.emit('stream', { type: 'thought', content: thinkingPiece } as EngineStreamEvent);
          }
          const piece = extractTextFromStreamEvent(ev);
          if (piece) {
            const now = Date.now();
            deltaCount += 1;
            deltaBytes += Buffer.byteLength(piece, 'utf8');
            assistantTextBytesEmitted += Buffer.byteLength(piece, 'utf8');
            if (!firstDeltaAt) {
              firstDeltaAt = now;
            } else if (lastDeltaAt && now - lastProgressLogAt >= 2000) {
              lastProgressLogAt = now;
            }
            lastDeltaAt = now;
            const nextPiece = lastBlockWasTool && !piece.startsWith('\n') ? `\n\n${piece}` : piece;
            accumulated += nextPiece;
            this.emit('stream', { type: 'text', content: nextPiece } as EngineStreamEvent);
            lastBlockWasTool = false;
          }
        } else if (msg.type === 'tool_progress') {
          const tp = msg as { tool_use_id: string; tool_name: string; elapsed_time_seconds: number; task_id?: string };
          const tid = tp.task_id || tp.tool_use_id;
          const desc = `工具「${tp.tool_name}」执行中`;
          this.emit('sdk-plan-subtask', {
            phase: 'tool', taskId: tid, description: desc,
            elapsedSec: tp.elapsed_time_seconds, toolName: tp.tool_name,
            detail: `tool_use_id=${tp.tool_use_id}`,
          } satisfies SdkPlanSubtaskTelemetry);
        } else if (msg.type === 'system') {
          const sys = msg as { subtype?: string; message?: string; tool_name?: string };
          if (streamDebug) {
            const st = String(sys.subtype || 'unknown');
            if (!seenSystemSubtypes.has(st)) {
              seenSystemSubtypes.add(st);
            }
          }
          if (sys.subtype === 'task_started') {
            const t = msg as { task_id: string; description?: string; task_type?: string; workflow_name?: string; prompt?: string };
            taskStartedAt.set(t.task_id, Date.now());
            const doing = clip(t.description || t.prompt || '(无描述)', 200);
            const meta = [t.task_type ? `类型 ${t.task_type}` : null, t.workflow_name ? `工作流 ${t.workflow_name}` : null].filter(Boolean).join(' · ');
            this.emit('sdk-plan-subtask', { phase: 'start', taskId: t.task_id, description: doing, elapsedSec: 0, detail: meta || undefined } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }
          if (sys.subtype === 'task_progress') {
            const t = msg as { task_id: string; description?: string; last_tool_name?: string; summary?: string; usage?: { duration_ms?: number; tool_uses?: number; total_tokens?: number } };
            const start = taskStartedAt.get(t.task_id);
            const wallMs = start != null ? Date.now() - start : undefined;
            const { sec: elapsedSec } = formatElapsedSec(t.usage?.duration_ms, wallMs);
            const doing = clip(t.description || t.summary || '(进行中)', 200);
            const detailExtra = [t.last_tool_name ? `最近工具：${t.last_tool_name}` : null, t.summary && t.summary !== t.description ? `进度摘要：${clip(t.summary, 120)}` : null].filter(Boolean).join(' · ');
            this.emit('sdk-plan-subtask', { phase: 'progress', taskId: t.task_id, description: doing, elapsedSec, detail: detailExtra || undefined, toolName: t.last_tool_name } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }
          if (sys.subtype === 'task_notification') {
            const t = msg as { task_id: string; status: 'completed' | 'failed' | 'stopped'; summary?: string; output_file?: string; usage?: { duration_ms?: number } };
            const start = taskStartedAt.get(t.task_id);
            const wallMs = start != null ? Date.now() - start : undefined;
            taskStartedAt.delete(t.task_id);
            const { sec: elapsedSec } = formatElapsedSec(t.usage?.duration_ms, wallMs);
            const sum = clip(t.summary || '(无摘要)', 240);
            this.emit('sdk-plan-subtask', { phase: 'end', taskId: t.task_id, description: sum, elapsedSec, terminalStatus: t.status, summary: t.summary, outputFile: t.output_file } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }
          let info = '';
          if (sys.subtype === 'api_retry') {
            const retry = msg as { attempt?: number; retry_delay_ms?: number; message?: string };
            const attempt = Number(retry.attempt || 0);
            if (attempt >= MAX_API_RETRY_ATTEMPTS) {
              try { this._abortController?.abort(); } catch {}
              throw new Error(`SDK API 重试已达上限（${MAX_API_RETRY_ATTEMPTS} 次），已终止请求`);
            }
            // Hide SDK retry noise from end-user stream output.
            continue;
          } else if (sys.subtype === 'init' || sys.subtype === 'session_start') {
            // Skip init/session_start messages — not useful for output
          } else if (sys.message) {
            info = `[SDK] ${sys.subtype ?? 'system'}: ${sys.message}`;
          } else if (sys.subtype) {
            info = `[SDK] ${sys.subtype}`;
          }
          if (info) {
            accumulated += `\n${info}\n`;
            this.emit('stream', { type: 'text', content: `\n${info}\n` } as EngineStreamEvent);
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            const r = msg as { result?: string; session_id?: string };
            const resultText = r.result ?? '';
            if (resultText && isPlan) {
              this.maybeParsePlanFromOutput(resultText);
            }
            const streamedHasAssistantText = assistantTextBytesEmitted > 0;
            const finalOutput = streamedHasAssistantText
              ? (accumulated || resultText)
              : (resultText || accumulated);
            if (isPlan) {
              const fsHit = await readLatestPlanFile(options.workingDirectory);
              if (fsHit?.content?.trim()) this.setCapturedDeliverable(fsHit.content, fsHit.path, 'filesystem');
            }
            return {
              success: true,
              output: isPlan ? (this._capturedDeliverable || finalOutput) : finalOutput,
              sessionId: r.session_id || capturedSessionId,
            };
          }
          const err = msg as { errors?: string[] };
          return {
            success: false,
            output: accumulated,
            error: err.errors?.join('; ') || 'SDK execution failed',
          };
        }
      }

      // Post-loop: filesystem fallback + persist plan
      if (isPlan) {
        const fsHit = await readLatestPlanFile(options.workingDirectory);
        if (fsHit?.content?.trim()) {
          this.setCapturedDeliverable(fsHit.content, fsHit.path, 'filesystem');
        }
        const planText = this._capturedDeliverable || accumulated;
        if (planText?.trim()) {
          try {
            const plansDir = join(options.workingDirectory, '.claude', 'plans');
            await mkdir(plansDir, { recursive: true });
            await writeFile(join(plansDir, `plan-${Date.now()}.md`), planText, 'utf-8');
          } catch {}
        }
      }

      return {
        success: true,
        output: isPlan ? (this._capturedDeliverable || accumulated) : accumulated,
        sessionId: capturedSessionId,
      };
    } catch (e: unknown) {
      return {
        success: false,
        output: accumulated,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private maybeParsePlanFromOutput(text: string): void {
    if (!text?.trim()) return;
    const fence = /```(?:plan|markdown)?\s*([\s\S]*?)```/i.exec(text);
    if (fence?.[1]?.trim()) {
      this.setCapturedDeliverable(fence[1].trim(), '(parsed-from-output)', 'output_parse');
    }
  }
}
