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
import { CangjieMagicEngineWrapper } from './cangjie-magic-wrapper';
import { OpenCodeEngineWrapper } from './opencode-wrapper';

export type EngineType = 'claude-code' | 'kiro-cli' | 'codex' | 'cursor' | 'cangjie-magic' | 'opencode';

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

  switch (engineType) {
    case 'kiro-cli':
      const kiroEngine = new KiroCliEngineWrapper();
      const isAvailable = await kiroEngine.isAvailable();
      if (!isAvailable) {
        console.warn('[EngineFactory] Kiro CLI is not available, falling back to Claude Code');
        return null;
      }
      return kiroEngine;

    case 'claude-code':
      // Claude Code is handled by the existing process-manager
      return null;

    case 'codex':
    case 'cursor':
      console.warn(`Engine ${engineType} is not yet implemented`);
      return null;

    case 'cangjie-magic':
      const cjEngine = new CangjieMagicEngineWrapper();
      if (!(await cjEngine.isAvailable())) {
        console.warn('[EngineFactory] CangjieMagic is not available, falling back to Claude Code');
        return null;
      }
      return cjEngine;

    case 'opencode':
      const ocEngine = new OpenCodeEngineWrapper();
      if (!(await ocEngine.isAvailable())) {
        console.warn('[EngineFactory] OpenCode is not available, falling back to Claude Code');
        return null;
      }
      return ocEngine;

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

    case 'cangjie-magic':
      const cjCheck = new CangjieMagicEngineWrapper();
      return await cjCheck.isAvailable();

    case 'opencode':
      const ocCheck = new OpenCodeEngineWrapper();
      return await ocCheck.isAvailable();

    default:
      return false;
  }
}
