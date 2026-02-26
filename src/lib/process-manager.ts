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

/**
 * Format a tool_use block into a human-readable summary for the live stream.
 * Shows file paths, commands, and code snippets depending on the tool type.
 */
function formatToolUseSummary(toolName: string, inputJson: string): string {
  try {
    const input = JSON.parse(inputJson);
    switch (toolName) {
      case 'Write':
      case 'write': {
        const wPath = input.file_path || '';
        const wContent = input.content || '';
        const wLines = wContent ? wContent.split('\n').length : 0;
        let wBlock = `\n📝 写入文件: \`${wPath}\` (${wLines} 行)\n`;
        if (wContent) {
          const ext = wPath.split('.').pop() || '';
          wBlock += `\n<details><summary>查看内容 (${wLines} 行)</summary>\n\n`;
          wBlock += `\`\`\`${ext}\n${wContent}\n\`\`\`\n`;
          wBlock += `\n</details>\n`;
        }
        return wBlock;
      }
      case 'Edit':
      case 'edit': {
        const filePath = input.file_path || '';
        const oldStr = input.old_string || '';
        const newStr = input.new_string || '';
        const oldLines = oldStr.split('\n').length;
        const newLines = newStr.split('\n').length;
        const added = Math.max(0, newLines - oldLines);
        const removed = Math.max(0, oldLines - newLines);
        const changed = Math.min(oldLines, newLines);
        let stats = `${changed} 行修改`;
        if (added > 0) stats += `, +${added} 行`;
        if (removed > 0) stats += `, -${removed} 行`;
        let diffBlock = `\n✏️ 编辑文件: \`${filePath}\` (${stats})\n`;
        if (oldStr || newStr) {
          diffBlock += `\n<details><summary>查看变更 (${stats})</summary>\n\n`;
          if (oldStr) {
            diffBlock += `\`\`\`diff\n${oldStr.split('\n').map((l: string) => '- ' + l).join('\n')}\n`;
            diffBlock += `${newStr.split('\n').map((l: string) => '+ ' + l).join('\n')}\n\`\`\`\n`;
          } else {
            diffBlock += `\`\`\`diff\n${newStr.split('\n').map((l: string) => '+ ' + l).join('\n')}\n\`\`\`\n`;
          }
          diffBlock += `\n</details>\n`;
        }
        return diffBlock;
      }
      case 'Read':
      case 'read':
        return `\n📖 读取文件: \`${input.file_path || ''}\`\n`;
      case 'Bash':
      case 'bash': {
        const cmd = input.command || '';
        const cmdLines = cmd.split('\n');
        if (cmdLines.length <= 1 && cmd.length <= 120) {
          return `\n💻 执行命令: \`${cmd}\`\n`;
        }
        let block = `\n💻 执行命令 (${cmdLines.length} 行)\n`;
        block += `\n<details><summary>查看命令</summary>\n\n`;
        block += `\`\`\`bash\n${cmd}\n\`\`\`\n`;
        block += `\n</details>\n`;
        return block;
      }
      case 'Glob':
      case 'glob':
        return `\n🔍 搜索文件: \`${input.pattern || ''}\`\n`;
      case 'Grep':
      case 'grep':
        return `\n🔍 搜索内容: \`${input.pattern || ''}\`\n`;
      case 'Task':
      case 'task':
        return `\n🤖 启动子任务: ${input.description || ''}\n`;
      case 'TaskOutput':
      case 'taskoutput':
        return `\n📋 获取任务输出: \`${input.task_id || ''}\`\n`;
      case 'TodoWrite':
      case 'todowrite':
      case 'mcp__TodoWrite':
      case 'TodoRead': {
        // Render a visual todo list — handle various parameter shapes from Claude Code
        // Claude Code TodoWrite uses { todos: [...] } with fields: id, content, status, priority
        // Also handle: top-level array, { items: [...] }, or single-todo wrapper
        let todos: Array<{ id?: string; content?: string; status?: string; priority?: string }> = [];
        if (Array.isArray(input)) {
          todos = input;
        } else if (Array.isArray(input.todos)) {
          todos = input.todos;
        } else if (Array.isArray(input.items)) {
          todos = input.items;
        } else if (input.content || input.id) {
          // Single todo item passed as flat object
          todos = [input];
        }
        if (!todos.length) return `\n📋 任务列表 (空)\n`;
        const done = todos.filter(t => t.status === 'completed' || t.status === 'done').length;
        const inProg = todos.filter(t => t.status === 'in_progress' || t.status === 'in-progress').length;
        const pending = todos.length - done - inProg;
        const header = `📋 任务列表 (${done}/${todos.length} 完成${inProg ? `, ${inProg} 进行中` : ''})`;
        let block = `\n<!-- todo-list-marker -->\n`;
        block += `<div class="ace-todo-list">\n`;
        block += `<div class="ace-todo-header">${header}</div>\n`;
        block += `<div class="ace-todo-progress"><div class="ace-todo-progress-bar" style="width:${todos.length ? Math.round(((done + inProg * 0.5) / todos.length) * 100) : 0}%"></div></div>\n`;
        for (const t of todos) {
          const st = t.status || 'pending';
          const icon = st === 'completed' || st === 'done' ? '✅' : st === 'in_progress' || st === 'in-progress' ? '🔄' : '⬜';
          const cls = st === 'completed' || st === 'done' ? 'ace-todo-done' : st === 'in_progress' || st === 'in-progress' ? 'ace-todo-active' : 'ace-todo-pending';
          block += `<div class="ace-todo-item ${cls}">${icon} ${t.content || t.id || ''}</div>\n`;
        }
        block += `</div>\n`;
        return block;
      }
      default:
        return `\n⚙️ ${toolName}\n`;
    }
  } catch {
    // inputJson wasn't valid JSON (partial or empty) — try to extract useful info
    const lowerName = toolName.toLowerCase();
    if (lowerName === 'todowrite' || lowerName === 'todoread' || lowerName === 'mcp__todowrite') {
      return `\n📋 任务列表更新中...\n`;
    }
    return `\n⚙️ ${toolName}\n`;
  }
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
  agents?: Record<string, any>; // For review panel mode
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
    if (options.agents) {
      cliArgs.push('--agents', JSON.stringify(options.agents));
    }
    cliArgs.push('--dangerously-skip-permissions');

    proc.logLines.push(`[${ts()}] 命令: claude ${cliArgs.map(a => a.length > 100 ? a.substring(0, 100) + '...' : a.includes(' ') ? `"${a}"` : a).join(' ')}`);
    console.log(`[ProcessManager] 启动 ${id}: claude -p [prompt ${prompt.length} chars] ${cliArgs.filter(a => a !== '-p' && a !== prompt).slice(0, 6).join(' ')}...`);

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
      // Track current tool_use block being streamed
      let currentToolUse: { name: string; inputJson: string } | null = null;
      // Track whether the last content block was a tool_use (to insert separator before text)
      let lastBlockWasTool = false;
      // Track the last tool name for formatting tool results
      let lastToolName = '';

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
            const evt = obj.event;
            const delta = evt?.delta;

            if (evt?.type === 'content_block_start' && evt.content_block?.type === 'text') {
              // Text block starting — if previous block was a tool, insert a visual separator
              if (lastBlockWasTool) {
                const sep = '\n\n<!-- chunk-boundary -->\n\n';
                proc.streamContent += sep;
                this.emit('stream', { id, step, delta: sep, total: proc.streamContent });
              }
              lastBlockWasTool = false;
            } else if (delta?.type === 'text_delta' && delta.text) {
              // Regular text output — insert separator if coming right after a tool block
              if (lastBlockWasTool) {
                const sep = '\n\n<!-- chunk-boundary -->\n\n';
                proc.streamContent += sep;
                this.emit('stream', { id, step, delta: sep, total: proc.streamContent });
                lastBlockWasTool = false;
              }
              proc.streamContent += delta.text;
              this.emit('stream', { id, step, delta: delta.text, total: proc.streamContent });
            } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
              // Tool call started — show tool name
              const toolName = evt.content_block.name || 'unknown';
              currentToolUse = { name: toolName, inputJson: '' };
              const header = `\n\n**🔧 ${toolName}**\n`;
              proc.streamContent += header;
              this.emit('stream', { id, step, delta: header, total: proc.streamContent });
            } else if (delta?.type === 'input_json_delta' && delta.partial_json && currentToolUse) {
              // Accumulate tool input JSON for rendering
              currentToolUse.inputJson += delta.partial_json;
            } else if (evt?.type === 'content_block_stop' && currentToolUse) {
              // Tool input complete — render a summary of what the tool is doing
              const toolBlock = formatToolUseSummary(currentToolUse.name, currentToolUse.inputJson);
              if (toolBlock) {
                proc.streamContent += toolBlock;
                this.emit('stream', { id, step, delta: toolBlock, total: proc.streamContent });
              }
              lastToolName = currentToolUse.name;
              currentToolUse = null;
              lastBlockWasTool = true;
            }
          } else if (obj.type === 'user') {
            // Tool result from CLI — display the output
            const toolResult = obj.tool_use_result;
            const msgContent = obj.message?.content;
            if (toolResult || msgContent) {
              let resultBlock = '';
              // Format based on tool type
              const tn = lastToolName.toLowerCase();
              if (toolResult) {
                const stdout = toolResult.stdout || '';
                const stderr = toolResult.stderr || '';
                const output = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
                if (output) {
                  const lines = output.split('\n');
                  if (tn === 'bash' || tn === 'glob' || tn === 'grep') {
                    if (lines.length <= 5 && output.length <= 500) {
                      resultBlock = `\n\`\`\`\n${output}\n\`\`\`\n`;
                    } else {
                      resultBlock = `\n<details><summary>执行结果 (${lines.length} 行)</summary>\n\n\`\`\`\n${output}\n\`\`\`\n\n</details>\n`;
                    }
                  } else {
                    if (lines.length <= 3 && output.length <= 200) {
                      resultBlock = `\n> ${lines.join('\n> ')}\n`;
                    } else {
                      resultBlock = `\n<details><summary>返回结果 (${lines.length} 行)</summary>\n\n\`\`\`\n${output}\n\`\`\`\n\n</details>\n`;
                    }
                  }
                }
              } else if (Array.isArray(msgContent)) {
                // Fallback: extract content from message
                for (const block of msgContent) {
                  if (block.type === 'tool_result' && block.content) {
                    const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                    const lines = content.split('\n');
                    if (lines.length <= 5 && content.length <= 500) {
                      resultBlock = `\n\`\`\`\n${content}\n\`\`\`\n`;
                    } else {
                      resultBlock = `\n<details><summary>返回结果 (${lines.length} 行)</summary>\n\n\`\`\`\n${content}\n\`\`\`\n\n</details>\n`;
                    }
                    break;
                  }
                }
              }
              if (resultBlock) {
                proc.streamContent += resultBlock;
                this.emit('stream', { id, step, delta: resultBlock, total: proc.streamContent });
              }
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
          } else {
            // Log unhandled event types for debugging
            proc.logLines.push(`[${ts()}] 未处理事件: type=${obj.type}, subtype=${obj.subtype || ''}, keys=${Object.keys(obj).join(',')}`);
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
          // Already handled — reject so the caller can proceed
          this.running--;
          this.flushLog(proc, cliArgs);
          this.processNext();
          rejectPromise(new Error(`进程被${proc.status === 'timeout' ? '超时终止' : '手动终止'}`));
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
