/**
 * 环境变量管理 - 存储到 data/env-vars.yaml
 * 支持单独启用/禁用，在 claude 进程启动前注入
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { parse, stringify } from 'yaml';

const ENV_VARS_PATH = resolve(process.cwd(), 'data', 'env-vars.yaml');

export interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

export async function loadEnvVars(): Promise<EnvVar[]> {
  try {
    const content = await readFile(ENV_VARS_PATH, 'utf-8');
    const parsed = parse(content);
    return Array.isArray(parsed?.vars) ? parsed.vars : [];
  } catch {
    return [];
  }
}

export async function saveEnvVars(vars: EnvVar[]): Promise<void> {
  await mkdir(dirname(ENV_VARS_PATH), { recursive: true });
  await writeFile(ENV_VARS_PATH, stringify({ vars }), 'utf-8');
}

/** Build a plain { KEY: VALUE } object from enabled vars only */
export function buildEnvObject(vars: EnvVar[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const v of vars) {
    if (v.enabled && v.key) {
      env[v.key] = v.value;
    }
  }
  return env;
}
