/**
 * Engine Interface
 *
 * Abstract interface for different AI engines (Claude Code, Kiro CLI, etc.)
 */

export interface EngineOptions {
  agent: string;
  step: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  workingDirectory: string;
  allowedTools?: string[];
  timeoutMs?: number;
  sessionId?: string;
  appendSystemPrompt?: boolean;
  runId?: string;
}

export interface EngineResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  stopReason?: string;
}

export interface EngineStreamEvent {
  type: 'text' | 'tool' | 'thought' | 'error' | 'log';
  content: string;
  metadata?: any;
}

export interface Engine {
  /**
   * Execute a task with the engine
   */
  execute(options: EngineOptions): Promise<EngineResult>;

  /**
   * Cancel the current execution
   */
  cancel(): void;

  /**
   * Check if the engine is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get engine name
   */
  getName(): string;

  /**
   * Listen to stream events
   */
  on(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
  off(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
}
