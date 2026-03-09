/**
 * Engine Factory
 *
 * Creates and manages different AI engine instances
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import type { Engine } from './engine-interface';
import { KiroCliEngineWrapper } from './kiro-cli-wrapper';

export type EngineType = 'claude-code' | 'kiro-cli' | 'codex' | 'cursor';

interface EngineConfig {
  engine: EngineType;
  updatedAt?: string;
}

/**
 * Get the configured engine type
 */
export async function getConfiguredEngine(): Promise<EngineType> {
  const configPath = resolve(process.cwd(), '.engine.json');

  if (existsSync(configPath)) {
    try {
      const content = await readFile(configPath, 'utf-8');
      const config: EngineConfig = JSON.parse(content);
      return config.engine || 'claude-code';
    } catch (error) {
      console.warn('Failed to read engine config, using default:', error);
    }
  }

  return 'claude-code';
}

/**
 * Create an engine instance based on type
 */
export async function createEngine(type?: EngineType): Promise<Engine | null> {
  const engineType = type || await getConfiguredEngine();
  console.log(`[EngineFactory] createEngine called with type: ${engineType}`);

  switch (engineType) {
    case 'kiro-cli':
      const kiroEngine = new KiroCliEngineWrapper();
      console.log('[EngineFactory] Checking kiro-cli availability...');
      const isAvailable = await kiroEngine.isAvailable();
      console.log(`[EngineFactory] kiro-cli available: ${isAvailable}`);
      if (!isAvailable) {
        console.warn('[EngineFactory] Kiro CLI is not available, falling back to Claude Code');
        return null;
      }
      console.log('[EngineFactory] Returning kiro-cli engine');
      return kiroEngine;

    case 'claude-code':
      // Claude Code is handled by the existing process-manager
      return null;

    case 'codex':
    case 'cursor':
      console.warn(`Engine ${engineType} is not yet implemented`);
      return null;

    default:
      console.warn(`Unknown engine type: ${engineType}`);
      return null;
  }
}

/**
 * Check if an engine is available
 */
export async function isEngineAvailable(type: EngineType): Promise<boolean> {
  switch (type) {
    case 'kiro-cli':
      const kiroEngine = new KiroCliEngineWrapper();
      return await kiroEngine.isAvailable();

    case 'claude-code':
      try {
        const { execSync } = require('child_process');
        // Use 'command -v' instead of 'which' for better compatibility
        execSync('command -v claude', { stdio: 'ignore', shell: '/bin/bash' });
        return true;
      } catch {
        // Fallback: check common installation paths
        const fs = require('fs');
        const commonPaths = [
          '/root/.local/bin/claude',
          '/usr/local/bin/claude',
          '/usr/bin/claude',
        ];
        for (const p of commonPaths) {
          if (fs.existsSync(p)) return true;
        }
        return false;
      }

    default:
      return false;
  }
}
