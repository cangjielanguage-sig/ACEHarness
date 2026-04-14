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

function extractAssistantText(msg: { message?: { content?: unknown } }): string {
  const content = msg?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('');
}

function extractTextFromStreamEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return '';
  const e = ev as Record<string, unknown>;
  const delta = e.delta as Record<string, unknown> | undefined;
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
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
      let capturedSessionId: string | undefined;

      for await (const msg of iter) {
        // Capture session_id from any message
        if (!capturedSessionId && (msg as any).session_id) {
          capturedSessionId = (msg as any).session_id;
        }
        if (msg.type === 'assistant') {
          // assistant messages are full snapshots — skip emitting to avoid duplication
          // with stream_event deltas. Only use for accumulation if no stream_events received.
        } else if (msg.type === 'stream_event') {
          const ev = (msg as { event?: unknown }).event;
          const piece = extractTextFromStreamEvent(ev);
          if (piece) {
            accumulated += piece;
            this.emit('stream', { type: 'text', content: piece } as EngineStreamEvent);
          }
        } else if (msg.type === 'tool_progress') {
          const tp = msg as { tool_use_id: string; tool_name: string; elapsed_time_seconds: number; task_id?: string };
          const tid = tp.task_id || tp.tool_use_id;
          const desc = `工具「${tp.tool_name}」执行中`;
          const line = `\n[工具进行中] ${desc} · ⏱ ${tp.elapsed_time_seconds.toFixed(1)}s · 子任务 #${shortTaskId(tid)}\n`;
          accumulated += line;
          this.emit('stream', { type: 'text', content: line } as EngineStreamEvent);
          this.emit('sdk-plan-subtask', {
            phase: 'tool', taskId: tid, description: desc,
            elapsedSec: tp.elapsed_time_seconds, toolName: tp.tool_name,
            detail: `tool_use_id=${tp.tool_use_id}`,
          } satisfies SdkPlanSubtaskTelemetry);
        } else if (msg.type === 'system') {
          const sys = msg as { subtype?: string; message?: string; tool_name?: string };
          if (sys.subtype === 'task_started') {
            const t = msg as { task_id: string; description?: string; task_type?: string; workflow_name?: string; prompt?: string };
            taskStartedAt.set(t.task_id, Date.now());
            const doing = clip(t.description || t.prompt || '(无描述)', 200);
            const meta = [t.task_type ? `类型 ${t.task_type}` : null, t.workflow_name ? `工作流 ${t.workflow_name}` : null].filter(Boolean).join(' · ');
            const line = `\n[子任务·启动] #${shortTaskId(t.task_id)} · 在做什么：${doing}${meta ? ` · ${meta}` : ''} · ⏱ 0s\n`;
            accumulated += line;
            this.emit('stream', { type: 'text', content: line } as EngineStreamEvent);
            this.emit('sdk-plan-subtask', { phase: 'start', taskId: t.task_id, description: doing, elapsedSec: 0, detail: meta || undefined } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }
          if (sys.subtype === 'task_progress') {
            const t = msg as { task_id: string; description?: string; last_tool_name?: string; summary?: string; usage?: { duration_ms?: number; tool_uses?: number; total_tokens?: number } };
            const start = taskStartedAt.get(t.task_id);
            const wallMs = start != null ? Date.now() - start : undefined;
            const { text: elapsedText, sec: elapsedSec } = formatElapsedSec(t.usage?.duration_ms, wallMs);
            const doing = clip(t.description || t.summary || '(进行中)', 200);
            const bits = [`在做什么：${doing}`, t.last_tool_name ? `最近工具：${t.last_tool_name}` : null, t.summary && t.summary !== t.description ? `进度摘要：${clip(t.summary, 120)}` : null].filter(Boolean).join(' · ');
            const detailExtra = [t.last_tool_name ? `最近工具：${t.last_tool_name}` : null, t.summary && t.summary !== t.description ? `进度摘要：${clip(t.summary, 120)}` : null].filter(Boolean).join(' · ');
            const line = `\n[子任务·进行中] #${shortTaskId(t.task_id)} · ${bits} · ⏱ ${elapsedText}s\n`;
            accumulated += line;
            this.emit('stream', { type: 'text', content: line } as EngineStreamEvent);
            this.emit('sdk-plan-subtask', { phase: 'progress', taskId: t.task_id, description: doing, elapsedSec, detail: detailExtra || undefined, toolName: t.last_tool_name } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }
          if (sys.subtype === 'task_notification') {
            const t = msg as { task_id: string; status: 'completed' | 'failed' | 'stopped'; summary?: string; output_file?: string; usage?: { duration_ms?: number } };
            const start = taskStartedAt.get(t.task_id);
            const wallMs = start != null ? Date.now() - start : undefined;
            taskStartedAt.delete(t.task_id);
            const { text: elapsedText, sec: elapsedSec } = formatElapsedSec(t.usage?.duration_ms, wallMs);
            const statusCn: Record<string, string> = { completed: '已完成', failed: '失败', stopped: '已停止' };
            const sum = clip(t.summary || '(无摘要)', 240);
            const line = `\n[子任务·${statusCn[t.status] ?? t.status}] #${shortTaskId(t.task_id)} · ${sum} · ⏱ ${elapsedText}s${t.output_file ? ` · 输出 ${t.output_file}` : ''}\n`;
            accumulated += line;
            this.emit('stream', { type: 'text', content: line } as EngineStreamEvent);
            this.emit('sdk-plan-subtask', { phase: 'end', taskId: t.task_id, description: sum, elapsedSec, terminalStatus: t.status, summary: t.summary, outputFile: t.output_file } satisfies SdkPlanSubtaskTelemetry);
            continue;
          }
          let info = '';
          if (sys.subtype === 'api_retry') {
            const retry = msg as { attempt?: number; retry_delay_ms?: number };
            info = `[SDK] API 重试 #${retry.attempt ?? '?'}，等待 ${Math.round((retry.retry_delay_ms ?? 0) / 1000)}s…`;
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
            // Don't re-emit resultText — it was already streamed via assistant/stream_event messages.
            // Only use it as fallback if nothing was accumulated.
            if (!accumulated && resultText) {
              accumulated = resultText;
            }
            if (isPlan) {
              const fsHit = await readLatestPlanFile(options.workingDirectory);
              if (fsHit?.content?.trim()) this.setCapturedDeliverable(fsHit.content, fsHit.path, 'filesystem');
            }
            return {
              success: true,
              output: isPlan ? (this._capturedDeliverable || accumulated || resultText) : (accumulated || resultText),
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
