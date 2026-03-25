/**
 * Node.js-only instrumentation implementations
 * This file is only imported when NEXT_RUNTIME === 'nodejs'
 */

export async function runNodejsInstrumentation() {
  const { existsSync, symlinkSync } = await import('fs');
  const { join } = await import('path');

  const WORKSPACE_ROOT = process.cwd();
  const LOCAL_CLAUDE_DIR = join(WORKSPACE_ROOT, '.claude');
  const SKILLS_CLAUDE_DIR = join(WORKSPACE_ROOT, 'skills', '.claude');
  const SKILLS_YAML = join(WORKSPACE_ROOT, 'skills', 'skills.yaml');

  // 1. Auto-pull skills if not initialized
  const port = process.env.PORT || '3000';
  try {
    if (!existsSync(SKILLS_YAML)) {
      console.log('[AceFlow] Skills not initialized, auto-pulling...');
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
          console.error('[AceFlow] Skills auto-pull timed out');
        } else {
          console.error('[AceFlow] Skills auto-pull failed:', e);
        }
      }
    }
  } catch {
    // PORT may not be set yet, skip API trigger
  }

  // 2. Setup .claude symlink
  if (existsSync(LOCAL_CLAUDE_DIR)) {
    return;
  }
  if (existsSync(SKILLS_CLAUDE_DIR)) {
    try {
      symlinkSync(SKILLS_CLAUDE_DIR, LOCAL_CLAUDE_DIR);
      console.log('[AceFlow] Linked .claude -> skills/.claude');
    } catch (error) {
      console.error('[AceFlow] Failed to create .claude symlink:', error);
    }
  }

  // 3. Recover workflows
  try {
    const { workflowManager } = await import('./workflow-manager');
    await workflowManager.recoverFromCrash();
  } catch (error) {
    console.error('[AceFlow] Workflow recovery failed:', error);
  }
}
