/**
 * Claude 进程管理器
 * 使用 CLI spawn (claude -p) + stream-json 流式读取
 * 支持 session resume、allowedTools、超时控制、执行日志
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const DEBUG_DIR = resolve(process.cwd(), 'runs', '.tmp');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function ts(): string { return new Date().toISOString(); }
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

export interface ClaudeJsonResult {
  result: string;
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export interface ProcessInfo {
  id: string;
  agent: string;
  step: string;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'timeout' | 'queued';
  pid?: number;
  sessionId?: string;
  startTime: Date;
  endTime?: Date;
  queuedAt?: Date;
  output: string;
  error: string;
  childProcess?: ChildProcess;
  jsonResult?: ClaudeJsonResult;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  streamContent: string;
  logLines: string[];
  logFile?: string;
  runId?: string;
}

interface ExecuteOptions {
  workingDirectory?: string;
  allowedTools?: string[];
  resumeSessionId?: string;
  appendSystemPrompt?: boolean;
  timeoutMs?: number;
  runId?: string;
}

class ProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private queue: string[] = [];
  private maxConcurrent = 3;
  private running = 0;

  private async flushLog(proc: ProcessInfo, cliArgs: string[]): Promise<void> {
    try {
      // Use run-specific logs directory if runId is available, otherwise fall back to .tmp
      const logDir = proc.runId
        ? resolve(process.cwd(), 'runs', proc.runId, 'logs')
        : DEBUG_DIR;
      if (!existsSync(logDir)) await mkdir(logDir, { recursive: true });
      const logFile = proc.logFile || resolve(logDir, `${proc.id}.log`);
      proc.logFile = logFile;

      const elapsed = Date.now() - proc.startTime.getTime();
      const header = [
        `=== Claude CLI Debug Log ===`,
        `ID: ${proc.id}`,
        `Agent: ${proc.agent} | Step: ${proc.step}`,
        `Status: ${proc.status}`,
        `PID: ${proc.pid || 'N/A'}`,
        `Started: ${proc.startTime.toISOString()}`,
        `Elapsed: ${fmtMs(elapsed)}`,
        `Command: claude ${cliArgs.join(' ')}`,
        `===========================`,
        '',
      ];

      const streamSection = proc.streamContent
        ? `\n--- Stream Content (${proc.streamContent.length} chars) ---\n${proc.streamContent.slice(-5000)}\n`
        : '';
      const stderrSection = proc.error ? `\n--- Stderr ---\n${proc.error}\n` : '';
      const outputSection = proc.output ? `\n--- Final Output ---\n${proc.output.slice(0, 5000)}\n` : '';

      const content = header.join('\n')
        + proc.logLines.join('\n')
        + streamSection
        + stderrSection
        + outputSection;

      await writeFile(logFile, content, 'utf-8');
    } catch { /* non-critical */ }
  }

  async executeClaudeCli(
    id: string,
    agent: string,
    step: string,
    prompt: string,
    systemPrompt: string,
    model: string,
    options: ExecuteOptions = {}
  ): Promise<ClaudeJsonResult> {
    const proc: ProcessInfo = {
      id, agent, step,
      status: 'queued',
      startTime: new Date(),
      queuedAt: new Date(),
      output: '', error: '',
      streamContent: '',
      logLines: [`[${ts()}] 任务已创建，等待执行队列...`],
      runId: options.runId,
    };
    this.processes.set(id, proc);

    // Queue if at capacity
    if (this.running >= this.maxConcurrent) {
      this.queue.push(id);
      proc.logLines.push(`[${ts()}] 排队中 (当前并发: ${this.running}/${this.maxConcurrent})`);
      this.emit('queued', { id, agent, step, position: this.queue.length });
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.running < this.maxConcurrent && this.queue[0] === id) {
            this.queue.shift();
            resolve();
          } else {
            setTimeout(check, 200);
          }
        };
        check();
      });
    }

    this.running++;
    proc.status = 'running';
    proc.startTime = new Date();
    proc.logLines.push(`[${ts()}] 开始执行`);

    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    proc.logLines.push(`[${ts()}] 超时阈值: ${fmtMs(timeoutMs)}`);

    // Build CLI args
    const cliArgs: string[] = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
    if (systemPrompt) {
      if (options.appendSystemPrompt) {
        cliArgs.push('--append-system-prompt', systemPrompt);
      } else {
        cliArgs.push('--system-prompt', systemPrompt);
      }
    }
    if (model) cliArgs.push('--model', model);
    if (options.allowedTools?.length) {
      for (const tool of options.allowedTools) {
        cliArgs.push('--allowedTools', tool);
      }
    }
    if (options.resumeSessionId) {
      cliArgs.push('--resume', options.resumeSessionId);
    }
    cliArgs.push('--dangerously-skip-permissions');

    proc.logLines.push(`[${ts()}] 命令: claude ${cliArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);
    console.log(`[ProcessManager] 启动 ${id}: claude ${cliArgs.slice(0, 6).join(' ')}...`);

    // Flush log immediately so .tmp has a file right away
    await this.flushLog(proc, cliArgs);

    // Build clean env
    const spawnEnv = { ...process.env };
    delete spawnEnv.CLAUDECODE;
    delete spawnEnv.CLAUDE_CODE_ENTRYPOINT;
    delete spawnEnv.CLAUDE_CODE_SESSION;
    delete spawnEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    // Allow --dangerously-skip-permissions under root
    spawnEnv.IS_SANDBOX = '1';

    return new Promise<ClaudeJsonResult>((resolvePromise, rejectPromise) => {
      const child = spawn('claude', cliArgs, {
        cwd: options.workingDirectory || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spawnEnv,
      });

      proc.childProcess = child;
      proc.pid = child.pid;
      proc.logLines.push(`[${ts()}] PID: ${child.pid}`);
      this.emit('started', { id, pid: child.pid, agent, step });

      // Timeout
      const timer = setTimeout(() => {
        proc.logLines.push(`[${ts()}] ⚠ 超时 (${fmtMs(timeoutMs)})，终止进程`);
        proc.status = 'timeout';
        proc.endTime = new Date();
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000);
        this.flushLog(proc, cliArgs);
        rejectPromise(new Error(`超时 (${fmtMs(timeoutMs)})`));
      }, timeoutMs);

      let buffer = '';
      let resultObj: ClaudeJsonResult | null = null;

      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const obj = JSON.parse(line);

          if (obj.type === 'system' && obj.subtype === 'init') {
            proc.sessionId = obj.session_id;
            proc.logLines.push(`[${ts()}] session_id: ${obj.session_id}`);
            if (obj.tools) {
              proc.logLines.push(`[${ts()}] 可用工具: ${obj.tools.length} 个`);
            }
          } else if (obj.type === 'stream_event') {
            // Token-by-token streaming via --include-partial-messages
            const delta = obj.event?.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              proc.streamContent += delta.text;
              this.emit('stream', { id, step, delta: delta.text, total: proc.streamContent });
            }
          } else if (obj.type === 'assistant') {
            // Insert chunk boundary so live stream viewers see visual separation between turns
            if (proc.streamContent && !proc.streamContent.endsWith('\n\n<!-- chunk-boundary -->\n\n')) {
              proc.streamContent += '\n\n<!-- chunk-boundary -->\n\n';
              this.emit('stream', { id, step, delta: '\n\n<!-- chunk-boundary -->\n\n', total: proc.streamContent });
            }
            // Full completed message block — use as final output
            if (obj.message?.content) {
              const textParts = obj.message.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text);
              if (textParts.length) {
                proc.output = textParts.join('\n');
              }
            }
            if (obj.session_id) proc.sessionId = obj.session_id;
          } else if (obj.type === 'result') {
            resultObj = {
              result: obj.result || proc.output || proc.streamContent,
              session_id: obj.session_id || proc.sessionId || '',
              cost_usd: obj.cost_usd || 0,
              duration_ms: obj.duration_ms || 0,
              duration_api_ms: obj.duration_api_ms || 0,
              is_error: obj.is_error || false,
              num_turns: obj.num_turns || 0,
              usage: {
                input_tokens: obj.usage?.input_tokens || 0,
                output_tokens: obj.usage?.output_tokens || 0,
                cache_creation_input_tokens: obj.usage?.cache_creation_input_tokens || 0,
                cache_read_input_tokens: obj.usage?.cache_read_input_tokens || 0,
              },
            };
            proc.jsonResult = resultObj;
            proc.logLines.push(`[${ts()}] result 事件: cost=$${resultObj.cost_usd.toFixed(4)}, turns=${resultObj.num_turns}`);
          }
        } catch {
          // Not valid JSON — might be partial line or stderr leak
        }
      };

      // Periodic log flush
      let lastFlush = Date.now();
      const flushInterval = setInterval(() => {
        this.flushLog(proc, cliArgs);
      }, 5000);

      child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          processLine(line);
        }
        // Flush log if >5s since last
        const now = Date.now();
        if (now - lastFlush > 5000) {
          lastFlush = now;
          this.flushLog(proc, cliArgs);
        }
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        proc.error += text;
        proc.logLines.push(`[${ts()}] stderr: ${text.trim().substring(0, 200)}`);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        clearInterval(flushInterval);
        proc.status = 'failed';
        proc.endTime = new Date();
        proc.logLines.push(`[${ts()}] ✗ spawn error: ${err.message}`);
        this.running--;
        this.flushLog(proc, cliArgs);
        this.processNext();
        rejectPromise(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        clearInterval(flushInterval);
        // Process remaining buffer
        if (buffer.trim()) processLine(buffer);

        const elapsed = Date.now() - proc.startTime.getTime();
        proc.logLines.push(`[${ts()}] 进程退出 code=${code}, 耗时 ${fmtMs(elapsed)}`);
        console.log(`[ProcessManager] ${id} 退出 code=${code}, 耗时 ${fmtMs(elapsed)}`);

        if (proc.status === 'timeout' || proc.status === 'killed') {
          // Already handled
          this.running--;
          this.flushLog(proc, cliArgs);
          this.processNext();
          return;
        }

        if (resultObj) {
          proc.status = 'completed';
          proc.endTime = new Date();
          if (!proc.output && proc.streamContent) {
            proc.output = proc.streamContent;
          }
          // Ensure result text is populated
          if (!resultObj.result && proc.output) {
            resultObj.result = proc.output;
          }
          proc.logLines.push(`[${ts()}] ✓ 完成: tokens=${resultObj.usage.input_tokens}+${resultObj.usage.output_tokens}, cost=$${resultObj.cost_usd.toFixed(4)}`);
          this.running--;
          this.flushLog(proc, cliArgs);
          this.processNext();
          resolvePromise(resultObj);
        } else if (code === 0 && proc.streamContent) {
          // Got stream content but no result event — synthesize result
          proc.status = 'completed';
          proc.endTime = new Date();
          proc.output = proc.output || proc.streamContent;
          const synth: ClaudeJsonResult = {
            result: proc.output,
            session_id: proc.sessionId || '',
            cost_usd: 0, duration_ms: elapsed, duration_api_ms: 0,
            is_error: false, num_turns: 0,
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          };
          proc.jsonResult = synth;
          proc.logLines.push(`[${ts()}] ✓ 完成 (合成 result，无 result 事件)`);
          this.running--;
          this.flushLog(proc, cliArgs);
          this.processNext();
          resolvePromise(synth);
        } else {
          proc.status = 'failed';
          proc.endTime = new Date();
          const errMsg = proc.error || `进程退出 code=${code}`;
          proc.logLines.push(`[${ts()}] ✗ 失败: ${errMsg.substring(0, 200)}`);
          this.running--;
          this.flushLog(proc, cliArgs);
          this.processNext();
          rejectPromise(new Error(errMsg));
        }
      });
    });
  }

  private processNext(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      // Queue processing is handled by the waiting promise in executeClaudeCli
    }
  }

  killProcess(id: string): boolean {
    const proc = this.processes.get(id);
    if (!proc || !proc.childProcess) return false;
    proc.status = 'killed';
    proc.endTime = new Date();
    proc.logLines.push(`[${ts()}] 手动终止`);
    try {
      proc.childProcess.kill('SIGTERM');
      setTimeout(() => proc.childProcess?.kill('SIGKILL'), 3000);
    } catch { /* already dead */ }
    return true;
  }

  async killAllSystem(): Promise<{ killed: number; pids: number[] }> {
    // Kill all managed processes
    for (const [, proc] of this.processes) {
      if (proc.status === 'running' && proc.childProcess) {
        proc.status = 'killed';
        proc.endTime = new Date();
        try { proc.childProcess.kill('SIGTERM'); } catch {}
      }
    }

    // Also kill orphan system claude processes
    const pids: number[] = [];
    try {
      const out = execSync("pgrep -f 'claude.*-p' || true", { encoding: 'utf-8' });
      const lines = out.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const pid = parseInt(line, 10);
        if (!isNaN(pid) && pid !== process.pid) {
          try {
            process.kill(pid, 'SIGTERM');
            pids.push(pid);
          } catch { /* already dead */ }
        }
      }
    } catch { /* pgrep not available or no matches */ }

    return { killed: pids.length, pids };
  }

  reset(): void {
    this.running = 0;
    this.queue = [];
    // Don't clear processes map — keep history
  }

  getAllProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values()).map(p => ({
      ...p,
      childProcess: undefined, // Don't serialize
    }));
  }

  getProcess(id: string): ProcessInfo | undefined {
    const p = this.processes.get(id);
    if (!p) return undefined;
    return { ...p, childProcess: undefined };
  }

  getStats(): { total: number; running: number; completed: number; failed: number; queued: number } {
    let running = 0, completed = 0, failed = 0, queued = 0;
    for (const [, p] of this.processes) {
      switch (p.status) {
        case 'running': running++; break;
        case 'completed': completed++; break;
        case 'failed': case 'killed': case 'timeout': failed++; break;
        case 'queued': queued++; break;
      }
    }
    return { total: this.processes.size, running, completed, failed, queued };
  }

  cleanup(): void {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, p] of this.processes) {
      if (p.endTime && p.endTime.getTime() < cutoff) {
        this.processes.delete(id);
      }
    }
  }
}

// 全局单例 — use globalThis to survive Next.js dev HMR
const globalForProcess = globalThis as unknown as { __processManager?: ProcessManager };
export const processManager = globalForProcess.__processManager ??= new ProcessManager();
