/**
 * ACP (Agent Client Protocol) Protocol Types
 * 
 * Unified protocol definition for all ACP-compatible engines:
 * - Kiro CLI
 * - OpenCode
 * - Codex
 * - Cursor CLI
 */

// ============================================================================
// Core ACP Types
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
  provider: string;
}

export interface ACPSessionResult {
  sessionId: string;
  configOptions?: any;
  modes?: any;
  models?: {
    availableModels: ACPModelInfo[];
    currentModelId?: string;
  };
}

// ============================================================================
// ACP Engine Configuration
// ============================================================================

export interface ACPEngineConfig {
  /** Engine type identifier */
  type: 'kiro-cli' | 'opencode' | 'codex' | 'cursor';
  
  /** Command to execute (e.g., 'kiro-cli', 'opencode', 'cursor') */
  command: string;
  
  /** ACP subcommand (e.g., 'acp', 'agent') */
  subcommand: string;
  
  /** Additional arguments */
  args?: string[];
  
  /** Environment variables */
  env?: Record<string, string>;
  
  /** Model resolution strategy */
  modelResolver?: (shortName: string, availableModels: ACPModelInfo[]) => string;
}

// ============================================================================
// ACP Engine Options
// ============================================================================

export interface ACPEngineOptions {
  /** Working directory */
  workingDirectory: string;
  
  /** Agent name (optional) */
  agentName?: string;
  
  /** Model to use (optional) */
  model?: string;
  
  /** Additional configuration */
  config?: Record<string, any>;
}

// ============================================================================
// ACP Engine Interface
// ============================================================================

export interface ACPEngine {
  /**
   * Start the ACP engine process
   */
  start(): Promise<void>;
  
  /**
   * Stop the ACP engine process
   */
  stop(): void;
  
  /**
   * Initialize ACP connection
   */
  initialize(): Promise<void>;
  
  /**
   * Create a new session
   */
  createSession(): Promise<string>;
  
  /**
   * Resume an existing session
   */
  resumeSession(sessionId: string): Promise<string>;
  
  /**
   * Send a prompt to the current session
   */
  sendPrompt(prompt: string): Promise<ACPStopReason>;
  
  /**
   * Set the model for the current session
   */
  setModel(modelId: string): Promise<void>;
  
  /**
   * Cancel the current session
   */
  cancelSession(): void;
  
  /**
   * Get available models
   */
  getAvailableModels(): ACPModelInfo[];
  
  /**
   * Event emitter methods
   */
  on(event: 'session-update', listener: (update: ACPSessionUpdate) => void): void;
  on(event: 'log', listener: (message: string) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): void;
  off(event: string, listener: Function): void;
  emit(event: string, ...args: any[]): boolean;
}