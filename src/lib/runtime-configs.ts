import { cp, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  getInstallConfigPath,
  getInstallConfigsDir,
  getWorkspaceAgentsDir,
  getWorkspaceConfigPath,
  getWorkspaceConfigsDir,
} from '@/lib/app-paths';

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

export async function ensureRuntimeConfigsSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const runtimeConfigsDir = getWorkspaceConfigsDir();
    const installConfigsDir = getInstallConfigsDir();

    if (!existsSync(runtimeConfigsDir)) {
      await mkdir(dirname(runtimeConfigsDir), { recursive: true });
      await cp(installConfigsDir, runtimeConfigsDir, { recursive: true, force: false });
      return;
    }

    await copyMissingRecursive(installConfigsDir, runtimeConfigsDir);
  })().finally(() => {
    seedPromise = null;
  });

  return seedPromise;
}

export async function getRuntimeWorkflowConfigPath(filename: string): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath(filename);
}

export async function getRuntimeAgentConfigPath(name: string): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('agents', `${name}.yaml`);
}

export async function getRuntimeModelsConfigPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('models', 'models.yaml');
}

export async function getRuntimeSdkSettingsPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('settings', 'cangjie-sdks.yaml');
}

export async function getRuntimeConfigsDirPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigsDir();
}

export async function getRuntimeAgentsDirPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceAgentsDir();
}

export function getBundledWorkflowConfigPath(filename: string): string {
  return getInstallConfigPath(filename);
}
