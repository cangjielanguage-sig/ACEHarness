/**
 * NGA / ngagent Engine Wrapper
 *
 * OpenCode-compatible CLI (`nga`): ACP 启动参数与 opencode 一致，进程级默认附带 `--disable-update`（见 acp-engine buildCommandArgs）。
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';
import { commandExists } from '../command-exists';

export class NgaEngineWrapper extends ACPWrapperBase {
  private resolveCommand(): string {
    // Some distributions expose a separate `ngagent` binary intended for ACP stdio.
    // Prefer it when available, otherwise fall back to `nga`.
    const extraPaths = [
      '/root/.local/bin',
      '/usr/local/bin',
      '/usr/bin',
    ];
    if (commandExists('ngagent', extraPaths)) return 'ngagent';
    return 'nga';
  }

  getName(): string {
    return 'nga';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    const command = this.resolveCommand();
    return {
      engineType: 'nga',
      command,
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    const extraPaths = [
      '/root/.local/bin',
      '/usr/local/bin',
      '/usr/bin',
    ];
    return commandExists('ngagent', extraPaths) || commandExists('nga', extraPaths);
  }
}
