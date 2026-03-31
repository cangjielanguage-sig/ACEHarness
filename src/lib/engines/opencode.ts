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
      this.cleanup();
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
      this.cleanup();
    });

    await this.initialize();
  }

  private async initialize(): Promise<void> {
    const params: InitializeParams = {
      protocolVersion: 1,
      clientInfo: {
        name: 'aceflow',
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

    this.emit('session-created', {
      sessionId: this.sessionId,
      configOptions: result.configOptions,
      modes: result.modes,
      models: result.models,
    });

    return this.sessionId!;
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
    // JSON-RPC response
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
        });
        break;
      case 'tool_call_update':
        this.emit('tool-call-update', {
          id: update.toolCallId,
          title: update.title,
          status: update.status,
          content: update.content,
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

  private cleanup(): void {
    this.process = null;
    this.sessionId = null;
    this.initialized = false;
    this.pendingRequests.clear();
    this.buffer = '';
  }
}