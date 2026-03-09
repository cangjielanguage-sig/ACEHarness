/**
 * Kiro CLI Engine Adapter
 *
 * Implements ACP (Agent Client Protocol) communication with Kiro CLI
 * using JSON-RPC 2.0 over stdio.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface KiroCliOptions {
  agentName?: string;
  workingDirectory: string;
  model?: string;
}

export interface InitializeParams {
  protocolVersion: number;
  clientInfo: {
    name: string;
    version: string;
  };
  clientCapabilities: {
    fs: {
      readTextFile: boolean;
      writeTextFile: boolean;
    };
    terminal: boolean;
  };
}

export interface SessionNewParams {
  cwd: string;
  mcpServers: any[];
}

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'image' | 'resource_link';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
}

export interface SessionUpdate {
  sessionUpdate: string;
  content?: any;
  toolCallId?: string;
  title?: string;
  status?: string;
  [key: string]: any;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

// ============================================================================
// Kiro CLI Engine
// ============================================================================

export class KiroCliEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();
  private sessionId: string | null = null;
  private buffer = '';
  private initialized = false;

  constructor(private options: KiroCliOptions) {
    super();
  }

  /**
   * Start the Kiro CLI process and initialize connection
   */
  async start(): Promise<void> {
    const args = ['acp'];
    if (this.options.agentName) {
      args.push('--agent', this.options.agentName);
    }

    this.process = spawn('kiro-cli', args, {
      cwd: this.options.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.PATH}:/root/.local/bin:/usr/local/bin` },
    });

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      throw new Error('Failed to create Kiro CLI process streams');
    }

    // Handle stdout (JSON-RPC messages)
    this.process.stdout.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    // Handle stderr (logs)
    this.process.stderr.on('data', (data: Buffer) => {
      this.emit('log', data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      this.cleanup();
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.emit('error', error);
      this.cleanup();
    });

    // Initialize the connection
    await this.initialize();
  }

  /**
   * Initialize the ACP connection
   */
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

  /**
   * Create a new session
   */
  async createSession(): Promise<string> {
    if (!this.initialized) {
      throw new Error('Kiro CLI not initialized');
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
    });

    return this.sessionId!;
  }

  /**
   * Send a prompt to the current session
   */
  async sendPrompt(prompt: string): Promise<StopReason> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const params: SessionPromptParams = {
      sessionId: this.sessionId,
      prompt: [
        {
          type: 'text',
          text: prompt,
        },
      ],
    };

    const result = await this.sendRequest('session/prompt', params);
    return result.stopReason;
  }

  /**
   * Cancel the current operation
   */
  cancelSession(): void {
    if (!this.sessionId) {
      return;
    }

    this.sendNotification('session/cancel', {
      sessionId: this.sessionId,
    });
  }

  /**
   * Set session mode
   */
  async setMode(modeId: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    await this.sendRequest('session/set_mode', {
      sessionId: this.sessionId,
      modeId,
    });
  }

  /**
   * Set configuration option
   */
  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    await this.sendRequest('session/set_config_option', {
      sessionId: this.sessionId,
      configId,
      value,
    });
  }

  /**
   * Stop the Kiro CLI process
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.cleanup();
    }
  }

  /**
   * Send a JSON-RPC request
   */
  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      if (!this.process?.stdin) {
        reject(new Error('Process not running'));
        return;
      }

      const message = JSON.stringify(request) + '\n';
      this.process.stdin.write(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private sendNotification(method: string, params: any): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    if (this.process?.stdin) {
      const message = JSON.stringify(notification) + '\n';
      this.process.stdin.write(message);
    }
  }

  /**
   * Handle stdout data from Kiro CLI
   */
  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (error) {
          this.emit('error', new Error(`Failed to parse JSON: ${line}`));
        }
      }
    }
  }

  /**
   * Handle a JSON-RPC message
   */
  private handleMessage(message: any): void {
    // Response to a request
    if ('id' in message && message.id !== null) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message || 'Unknown error'));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Notification
    if (message.method === 'session/update') {
      this.handleSessionUpdate(message.params);
    }
  }

  /**
   * Handle session update notifications
   */
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

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.process = null;
    this.sessionId = null;
    this.initialized = false;
    this.pendingRequests.clear();
    this.buffer = '';
  }
}
