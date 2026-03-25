import { existsSync, symlinkSync, statSync } from 'fs';
import { join } from 'path';

const WORKSPACE_ROOT = process.cwd();
const LOCAL_CLAUDE_DIR = join(WORKSPACE_ROOT, '.claude');
const SKILLS_CLAUDE_DIR = join(WORKSPACE_ROOT, 'skills', '.claude');
const SKILLS_YAML = join(WORKSPACE_ROOT, 'skills', 'skills.yaml');

function setupClueDir() {
  // 如果 .claude 已存在（文件或目录），跳过
  if (existsSync(LOCAL_CLAUDE_DIR)) {
    return;
  }
  // 如果 skills/.claude 存在，创建软链接
  if (existsSync(SKILLS_CLAUDE_DIR)) {
    try {
      symlinkSync(SKILLS_CLAUDE_DIR, LOCAL_CLAUDE_DIR);
      console.log('[AceFlow] Linked .claude -> skills/.claude');
    } catch (error) {
      console.error('[AceFlow] Failed to create .claude symlink:', error);
    }
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 1. 如果 skills 未初始化（无 skills.yaml），触发自动拉取
    //    复用 skills 管理页面的逻辑：通过内部 API 触发
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
      // PORT 可能还未设置，跳过 API 触发（skills 管理页面会处理）
    }

    // 2. 建立 .claude 软链接（workspace root -> skills/.claude）
    setupClueDir();

    // 3. 恢复工作流（原有逻辑）
    const { workflowManager } = await import('./lib/workflow-manager');
    await workflowManager.recoverFromCrash();
  }
}
