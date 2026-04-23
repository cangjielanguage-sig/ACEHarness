import { cp, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { getInstallPath, getWorkspaceCacheFile, getWorkspaceSkillPath, getWorkspaceSkillsDir } from '@/lib/app-paths';

const INSTALL_SKILLS_DIR = getInstallPath('skills');
let seedPromise: Promise<void> | null = null;

async function copyMissingRecursive(src: string, dst: string): Promise<void> {
  const srcStat = await stat(src);
  if (srcStat.isDirectory()) {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyMissingRecursive(resolve(src, entry.name), resolve(dst, entry.name));
    }
    return;
  }

  if (existsSync(dst)) return;
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: false });
}

export async function ensureRuntimeSkillsSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const runtimeSkillsDir = getWorkspaceSkillsDir();
    if (!existsSync(INSTALL_SKILLS_DIR)) {
      await mkdir(runtimeSkillsDir, { recursive: true });
      return;
    }

    if (!existsSync(runtimeSkillsDir)) {
      await mkdir(dirname(runtimeSkillsDir), { recursive: true });
      await cp(INSTALL_SKILLS_DIR, runtimeSkillsDir, { recursive: true, force: false });
      return;
    }

    await copyMissingRecursive(INSTALL_SKILLS_DIR, runtimeSkillsDir);
  })().finally(() => {
    seedPromise = null;
  });

  return seedPromise;
}

export async function getRuntimeSkillsDirPath(): Promise<string> {
  await ensureRuntimeSkillsSeeded();
  return getWorkspaceSkillsDir();
}

export async function getRuntimeSkillPath(...segments: string[]): Promise<string> {
  await ensureRuntimeSkillsSeeded();
  return getWorkspaceSkillPath(...segments);
}

export function getSkillsTempPath(...segments: string[]): string {
  return getWorkspaceCacheFile('skills', ...segments);
}
