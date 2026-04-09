/**
 * Unified ACP Engine
 * 
 * A complete ACP implementation based on OpenCode's implementation.
 * This can be used by all ACP-compatible engines:
 * - OpenCode
 * - Kiro CLI
 * - Codex
 * - Cursor CLI
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// ============================================================================
// ACP Protocol Types
// ============================================================================

export interface ACPInitializeParams {
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

export interface ACPSessionNewParams {
  cwd: string;
  mcpServers: any[];
}

export interface ACPSessionPromptParams {
  sessionId: string;
  prompt: ACPContentBlock[];
}

export interface ACPContentBlock {
  type: 'text' | 'image' | 'resource_link';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
}

export interface ACPSessionUpdate {
  sessionUpdate: string;
  content?: any;
  toolCallId?: string;
  title?: string;
  status?: string;
  rawInput?: any;
  [key: string]: any;
}

export type ACPStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export interface ACPModelInfo {
  modelId: string;
  name: string;
}

// ============================================================================
// ACP Engine Configuration
// ============================================================================

export interface ACPEngineConfig {
  /** Engine type: 'opencode', 'kiro-cli', 'codex', 'cursor' */
  engineType: string;
  
  /** Command to execute (e.g., 'opencode', 'kiro-cli', 'cursor') */
  command: string;
  
  /** Working directory */
  workingDirectory: string;
  
  /** Agent name (optional) */
  agentName?: string;
  
  /** Model to use (optional) */
  model?: string;
  
  /** Additional arguments */
  args?: string[];
  
  /** Environment variables */
  env?: Record<string, string>;
}

// ============================================================================
// Unified ACP Engine
// ============================================================================

export class ACPEngine extends EventEmitter {
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

  constructor(private config: ACPEngineConfig) {
    super();
  }

  /**
   * Start the ACP engine process
   */
  async start(): Promise<void> {
    const args = this.buildCommandArgs();
    
    this.process = spawn(this.config.command, args, {
      cwd: this.config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/root/.local/bin:/usr/local/bin`,
        ...this.config.env
      },
    });

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      throw new Error(`Failed to create ${this.config.engineType} process streams`);
    }

    this.process.stdout.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    this.process.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.error(`[${this.config.engineType} stderr] ${msg.trim()}`);
      this.emit('log', msg);
    });

    this.process.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      this.cleanup(`${this.config.engineType} process exited (code=${code}, signal=${signal})`);
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
      this.cleanup(`${this.config.engineType} process error: ${error.message}`);
    });

    await this.initialize();
  }

  /**
   * Build command arguments based on engine type
   */
  private buildCommandArgs(): string[] {
    const args: string[] = [];
    
    switch (this.config.engineType) {
      case 'opencode':
        args.push('acp', '--cwd', this.config.workingDirectory);
        break;
        
      case 'kiro-cli':
        args.push('acp', '-a');
        if (this.config.agentName) {
          args.push('--agent', this.config.agentName);
        }
        if (this.config.model) {
          args.push('--model', this.config.model);
        }
        break;
        
      case 'codex':
        // Codex ACP implementation (to be implemented)
        args.push('acp');
        break;
        
      case 'cursor':
        // Cursor CLI ACP implementation (to be implemented)
        args.push('acp');
        break;
        
      default:
        throw new Error(`Unknown engine type: ${this.config.engineType}`);
    }
    
    // Add any additional arguments
    if (this.config.args) {
      args.push(...this.config.args);
    }
    
    return args;
  }

  /**
   * Initialize ACP connection
   */
  private async initialize(): Promise<void> {
    const params: ACPInitializeParams = {
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

  /**
   * Create a new session
   */
  async createSession(): Promise<string> {
    if (!this.initialized) {
      throw new Error(`${this.config.engineType} not initialized`);
    }

    const params: ACPSessionNewParams = {
      cwd: this.config.workingDirectory,
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

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<string> {
    if (!this.initialized) {
      throw new Error(`${this.config.engineType} not initialized`);
    }

    const params = {
      sessionId,
      cwd: this.config.workingDirectory,
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

  /**
   * Send a prompt to the current session
   */
  async sendPrompt(prompt: string): Promise<ACPStopReason> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const params: ACPSessionPromptParams = {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: prompt }],
    };

    const result = await this.sendRequest('session/prompt', params);
    return result.stopReason;
  }

  /**
   * Set the model for the current session
   */
  async setModel(modelId: string): Promise<void> {
    if (!this.sessionId) throw new Error('No active session');
    const resolved = this.resolveModelId(modelId);
    await this.sendRequest('session/set_model', { sessionId: this.sessionId, modelId: resolved });
  }

  /**
   * Resolve model ID from short name
   */
  private resolveModelId(shortName: string): string {
    if (shortName.includes('/')) return shortName;
    
    // Exact suffix match
    const exact = this.availableModels.find(m => m.modelId.endsWith('/' + shortName));
    if (exact) return exact.modelId;
    
    // Fuzzy match
    const fuzzy = this.availableModels
      .filter(m => m.name.toLowerCase().includes(shortName.toLowerCase()))
      .sort((a, b) => a.modelId.length - b.modelId.length);
    
    return fuzzy[0]?.modelId || shortName;
  }

  /**
   * Cancel the current session
   */
  cancelSession(): void {
    if (!this.sessionId) return;
    this.sendNotification('session/cancel', { sessionId: this.sessionId });
  }

  /**
   * Stop the engine
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

  /**
   * Send a JSON-RPC notification
   */
  private sendNotification(method: string, params: any): void {
    if (this.process?.stdin) {
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }
  }

  /**
   * Handle stdout data
   */
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

  /**
   * Handle JSON-RPC messages
   */
  private handleMessage(message: any): void {
    // JSON-RPC request FROM server
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
   * Handle server requests (permission, fs, terminal)
   */
  private handleServerRequest(message: any): void {
    const { id, method, params } = message;

    if (method === 'session/request_permission' || method === 'permission/request') {
      // Auto-approve all tool permissions
      this.sendResponse(id, { outcome: { outcome: 'selected', optionId: 'always' } });
      this.emit('permission', params);
      return;
    }

    // fs.readTextFile / fs.writeTextFile — not implemented
    if (method.startsWith('fs.') || method.startsWith('terminal.')) {
      this.sendResponse(id, null, { code: -32601, message: `Method not supported: ${method}` });
      return;
    }

    // Unknown server request
    this.sendResponse(id, null, { code: -32601, message: `Unknown method: ${method}` });
  }

  /**
   * Send JSON-RPC response
   */
  private sendResponse(id: number, result: any, error?: any): void {
    if (!this.process?.stdin) return;
    const response: any = { jsonrpc: '2.0', id };
    if (error) response.error = error;
    else response.result = result;
    this.process.stdin.write(JSON.stringify(response) + '\n');
  }

  /**
   * Handle session updates
   */
  private handleSessionUpdate(params: any): void {
    const update: ACPSessionUpdate = params.update;

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

  /**
   * Clean up resources
   */
  private cleanup(reason?: string): void {
    this.process = null;
    this.sessionId = null;
    this.initialized = false;
    
    // Reject all pending requests
    const err = new Error(reason || `${this.config.engineType} process exited`);
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(err);
    }
    this.pendingRequests.clear();
    this.buffer = '';
  }
}