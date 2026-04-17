/**
 * Node.js-only instrumentation implementations
 * This file is only imported when NEXT_RUNTIME === 'nodejs'
 */

export async function runNodejsInstrumentation() {
  const { existsSync, symlinkSync, mkdirSync, lstatSync, readlinkSync } = await import('fs');
  const { join } = await import('path');
  const { getEngineConfigDir } = await import('./engines/engine-config');
  const { getEngineConfigPath } = await import('./app-paths');

  const WORKSPACE_ROOT = process.cwd();
  const SKILLS_DIR = join(WORKSPACE_ROOT, 'skills');

  // Determine engine-aware config directory from persisted engine config
  let engineConfigDir = '.claude';
  try {
    const engineJson = getEngineConfigPath();
    if (existsSync(engineJson)) {
      const { readFileSync } = await import('fs');
      const config = JSON.parse(readFileSync(engineJson, 'utf-8'));
      if (config.engine) engineConfigDir = getEngineConfigDir(config.engine);
    }
  } catch { /* use default */ }

  // Create engine config dir (e.g. .kiro/) and symlink skills/ into it
  const configDir = join(WORKSPACE_ROOT, engineConfigDir);
  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      console.log(`[ACEHarness] Created ${engineConfigDir}/`);
    }
    const skillsLink = join(configDir, 'skills');
    if (existsSync(SKILLS_DIR)) {
      // Check if symlink already exists and points to the right place
      if (existsSync(skillsLink)) {
        try {
          const stat = lstatSync(skillsLink);
          if (stat.isSymbolicLink() && readlinkSync(skillsLink) === SKILLS_DIR) {
            // Already correct
          } else {
            // Wrong target or not a symlink — skip to avoid data loss
          }
        } catch { /* ignore */ }
      } else {
        symlinkSync(SKILLS_DIR, skillsLink);
        console.log(`[ACEHarness] Linked ${engineConfigDir}/skills -> skills/`);
      }
    }
  } catch (error) {
    console.error(`[ACEHarness] Failed to setup ${engineConfigDir}:`, error);
  }

  // Recover workflows
  try {
    const { WorkflowManager } = await import('./workflow-manager');
    const recoverer = new WorkflowManager();
    await recoverer.recoverFromCrash();
  } catch (error) {
    console.error('[ACEHarness] Workflow recovery failed:', error);
  }
}
