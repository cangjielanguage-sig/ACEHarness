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
  getName(): string {
    return 'nga';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'nga',
      command: 'nga',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [],
    };
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('nga', [
      '/root/.local/bin',
      '/usr/local/bin',
      '/usr/bin',
    ]);
  }
}
