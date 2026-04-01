/**
 * Node.js-only instrumentation implementations
 * This file is only imported when NEXT_RUNTIME === 'nodejs'
 */

export async function runNodejsInstrumentation() {
  const { existsSync, symlinkSync, readFileSync } = await import('fs');
  const { join } = await import('path');
  const { getEngineConfigDir } = await import('./engines/engine-config');

  const WORKSPACE_ROOT = process.cwd();
  const SKILLS_CLAUDE_DIR = join(WORKSPACE_ROOT, 'skills', '.claude');
  const SKILLS_YAML = join(WORKSPACE_ROOT, 'skills', 'skills.yaml');

  // Determine engine-aware config directory
  let engineConfigDir = '.claude';
  try {
    const engineJson = join(WORKSPACE_ROOT, '.engine.json');
    if (existsSync(engineJson)) {
      const config = JSON.parse(readFileSync(engineJson, 'utf-8'));
      if (config.engine) engineConfigDir = getEngineConfigDir(config.engine);
    }
  } catch { /* use default */ }
  const LOCAL_CONFIG_DIR = join(WORKSPACE_ROOT, engineConfigDir);

  // 1. Auto-pull skills if not initialized
  const port = process.env.PORT || '3000';
  try {
    if (!existsSync(SKILLS_YAML)) {
      console.log('[ACEHarness] Skills not initialized, auto-pulling...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        await fetch(`http://localhost:${port}/api/skills`, {
          method: 'POST',
          signal: controller.signal,
        });
        clearTimeout(timeout);
      } catch (e) {
        clearTimeout(timeout);
        if (e instanceof Error && e.name === 'AbortError') {
          console.error('[ACEHarness] Skills auto-pull timed out');
        } else {
          console.error('[ACEHarness] Skills auto-pull failed:', e);
        }
      }
    }
  } catch {
    // PORT may not be set yet, skip API trigger
  }

  // 2. Setup engine-aware config symlink (e.g. .claude, .kiro, .opencode)
  if (existsSync(LOCAL_CONFIG_DIR)) {
    return;
  }
  if (existsSync(SKILLS_CLAUDE_DIR)) {
    try {
      symlinkSync(SKILLS_CLAUDE_DIR, LOCAL_CONFIG_DIR);
      console.log(`[ACEHarness] Linked ${engineConfigDir} -> skills/.claude`);
    } catch (error) {
      console.error(`[ACEHarness] Failed to create ${engineConfigDir} symlink:`, error);
    }
  }

  // 3. Recover workflows
  try {
    const { WorkflowManager } = await import('./workflow-manager');
    const recoverer = new WorkflowManager();
    await recoverer.recoverFromCrash();
  } catch (error) {
    console.error('[ACEHarness] Workflow recovery failed:', error);
  }
}
