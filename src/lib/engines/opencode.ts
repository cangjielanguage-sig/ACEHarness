/**
 * OpenCode Engine Adapter
 *
 * Implements ACP (Agent Client Protocol) communication with OpenCode
 * using JSON-RPC 2.0 over stdio. Protocol-identical to Kiro CLI.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type {
  InitializeParams,
  SessionNewParams,
  SessionPromptParams,
  SessionUpdate,
  StopReason,
} from './kiro-cli';

export interface OpenCodeOptions {
  workingDirectory: string;
}

export class OpenCodeEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();
  private sessionId: string | null = null;
  private buffer = '';
  private initialized = false;
  private availableModels: Array<{ modelId: string; name: string }> = [];

  constructor(private options: OpenCodeOptions) {
    super();
  }

  async start(): Promise<void> {
    this.process = spawn('opencode', ['acp', '--cwd', this.options.workingDirectory], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/root/.local/bin:/usr/local/bin`,
      },
    });

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      throw new Error('Failed to create OpenCode process streams');
    }

    this.process.stdout.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    this.process.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.error(`[OpenCode stderr] ${msg.trim()}`);
      this.emit('log', msg);
    });

    this.process.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      this.cleanup(`OpenCode process exited (code=${code}, signal=${signal})`);
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
      this.cleanup(`OpenCode process error: ${error.message}`);
    });

    await this.initialize();
  }

  private async initialize(): Promise<void> {
    const params: InitializeParams = {
      protocolVersion: 1,
      clientInfo: {
        name: 'aceharness',
        version: '1.0.0',
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    };

    const result = await this.sendRequest('initialize', params);
    this.initialized = true;
    this.emit('initialized', result);
  }

  async createSession(): Promise<string> {
    if (!this.initialized) {
      throw new Error('OpenCode not initialized');
    }

    const params: SessionNewParams = {
      cwd: this.options.workingDirectory,
      mcpServers: [],
    };

    const result = await this.sendRequest('session/new', params);
    this.sessionId = result.sessionId;
    this.availableModels = result.models?.availableModels || [];

    this.emit('session-created', {
      sessionId: this.sessionId,
      configOptions: result.configOptions,
      modes: result.modes,
      models: result.models,
    });

    return this.sessionId!;
  }

  async resumeSession(sessionId: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('OpenCode not initialized');
    }

    const params = {
      sessionId,
      cwd: this.options.workingDirectory,
      mcpServers: [],
    };

    const result = await this.sendRequest('session/load', params);
    this.sessionId = sessionId;
    this.availableModels = result.models?.availableModels || this.availableModels;

    this.emit('session-resumed', {
      sessionId: this.sessionId,
      configOptions: result.configOptions,
      modes: result.modes,
      models: result.models,
    });

    return this.sessionId;
  }

  async sendPrompt(prompt: string): Promise<StopReason> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const params: SessionPromptParams = {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: prompt }],
    };

    const result = await this.sendRequest('session/prompt', params);
    return result.stopReason;
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.sessionId) throw new Error('No active session');
    // Resolve short model name (e.g. "claude-opus-4-6") to full provider/model ID
    const resolved = this.resolveModelId(modelId);
    await this.sendRequest('session/set_model', { sessionId: this.sessionId, modelId: resolved });
  }

  private resolveModelId(shortName: string): string {
    if (shortName.includes('/')) return shortName;
    // Exact suffix match (e.g. "gpt-5.3-codex" matches ".../gpt-5.3-codex" not ".../gpt-5.3-codex-spark")
    const exact = this.availableModels.find(m => m.modelId.endsWith('/' + shortName));
    if (exact) return exact.modelId;
    // Fuzzy: match name, prefer shortest modelId to avoid spark/nano variants
    const fuzzy = this.availableModels
      .filter(m => m.name.toLowerCase().includes(shortName.toLowerCase()))
      .sort((a, b) => a.modelId.length - b.modelId.length);
    return fuzzy[0]?.modelId || shortName;
  }

  cancelSession(): void {
    if (!this.sessionId) return;
    this.sendNotification('session/cancel', { sessionId: this.sessionId });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.cleanup();
    }
  }

  private sendRequest(method: string, params: any, timeoutMs?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request = { jsonrpc: '2.0', id, method, params };

      this.pendingRequests.set(id, { resolve, reject });

      if (!this.process?.stdin) {
        reject(new Error('Process not running'));
        return;
      }

      this.process.stdin.write(JSON.stringify(request) + '\n');

      const timeout = timeoutMs || (method === 'session/prompt' ? 3600000 : 30000);
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, timeout);
    });
  }

  private sendNotification(method: string, params: any): void {
    if (this.process?.stdin) {
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }
  }

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          this.handleMessage(JSON.parse(line));
        } catch (error) {
          this.emit('error', new Error(`Failed to parse JSON: ${line}`));
        }
      }
    }
  }

  private handleMessage(message: any): void {
    // JSON-RPC request FROM server (e.g. permission/request)
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    // JSON-RPC response to our request
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // JSON-RPC notification
    if (message.method === 'session/update') {
      this.handleSessionUpdate(message.params);
    }
  }

  /**
   * Handle JSON-RPC requests from the server (permission, fs, terminal).
   * Auto-approve all permissions so tools don't block.
   */
  private handleServerRequest(message: any): void {
    const { id, method, params } = message;

    if (method === 'session/request_permission' || method === 'permission/request') {
      // Auto-approve all tool permissions
      this.sendResponse(id, { outcome: { outcome: 'selected', optionId: 'always' } });
      this.emit('permission', params);
      return;
    }

    // fs.readTextFile / fs.writeTextFile — not implemented, return error
    if (method.startsWith('fs.') || method.startsWith('terminal.')) {
      this.sendResponse(id, null, { code: -32601, message: `Method not supported: ${method}` });
      return;
    }

    // Unknown server request — return method not found
    this.sendResponse(id, null, { code: -32601, message: `Unknown method: ${method}` });
  }

  private sendResponse(id: number, result: any, error?: any): void {
    if (!this.process?.stdin) return;
    const response: any = { jsonrpc: '2.0', id };
    if (error) response.error = error;
    else response.result = result;
    this.process.stdin.write(JSON.stringify(response) + '\n');
  }

  private handleSessionUpdate(params: any): void {
    const update: SessionUpdate = params.update;

    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.emit('user-message', update.content);
        break;
      case 'agent_message_chunk':
        this.emit('agent-message', update.content);
        break;
      case 'agent_thought_chunk':
        this.emit('agent-thought', update.content);
        break;
      case 'tool_call':
        this.emit('tool-call', {
          id: update.toolCallId,
          title: update.title,
          status: update.status,
          kind: update.kind,
          content: update.content,
          locations: update.locations,
          rawInput: update.rawInput,
        });
        break;
      case 'tool_call_update':
        this.emit('tool-call-update', {
          id: update.toolCallId,
          title: update.title,
          status: update.status,
          kind: update.kind,
          content: update.content,
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
        });
        break;
      case 'plan':
        this.emit('plan', update.entries);
        break;
      case 'current_mode_update':
        this.emit('mode-changed', update.currentModeId);
        break;
      case 'config_option_update':
        this.emit('config-changed', update.configOptions);
        break;
      default:
        this.emit('update', update);
    }
  }

  private cleanup(reason?: string): void {
    this.process = null;
    this.sessionId = null;
    this.initialized = false;
    // Reject all pending requests so promises don't hang until timeout
    const err = new Error(reason || 'OpenCode process exited');
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(err);
    }
    this.pendingRequests.clear();
    this.buffer = '';
  }
}