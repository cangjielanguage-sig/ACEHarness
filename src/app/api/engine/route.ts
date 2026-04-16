import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { existsSync, symlinkSync, mkdirSync, lstatSync, readlinkSync } from 'fs';
import path from 'path';
import { getEngineConfigDir } from '@/lib/engines/engine-config';
import { getEngineConfigPath } from '@/lib/app-paths';

const ENGINE_CONFIG_FILE = getEngineConfigPath();
const SKILLS_DIR = path.join(process.cwd(), 'skills');

interface EngineConfig {
  engine: string;
  defaultModel?: string;
  updatedAt: string;
}

export async function GET() {
  try {
    const exists = await fs.access(ENGINE_CONFIG_FILE).then(() => true).catch(() => false);

    if (!exists) {
      return NextResponse.json({ engine: 'claude-code', defaultModel: '' });
    }

    const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
    const config: EngineConfig = JSON.parse(content);

    return NextResponse.json({ engine: config.engine, defaultModel: config.defaultModel || '' });
  } catch (error) {
    console.error('Failed to read engine config:', error);
    return NextResponse.json({ engine: 'claude-code', defaultModel: '' });
  }
}

export async function POST(request: Request) {
  try {
    const { engine, defaultModel } = await request.json();

    if (!engine) {
      return NextResponse.json({ error: 'Engine is required' }, { status: 400 });
    }

    // Read existing config to preserve fields
    let existing: Partial<EngineConfig> = {};
    try {
      const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
      existing = JSON.parse(content);
    } catch { /* new file */ }

    const config: EngineConfig = {
      ...existing,
      engine,
      updatedAt: new Date().toISOString(),
    };
    // Only update defaultModel if explicitly provided
    if (defaultModel !== undefined) {
      config.defaultModel = defaultModel;
    }

    await fs.writeFile(ENGINE_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

    // Create engine config dir and symlink skills
    try {
      const engineConfigDir = getEngineConfigDir(engine);
      const configDir = path.join(process.cwd(), engineConfigDir);
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      const skillsLink = path.join(configDir, 'skills');
      if (existsSync(SKILLS_DIR) && !existsSync(skillsLink)) {
        symlinkSync(SKILLS_DIR, skillsLink);
        console.log(`[Engine] Linked ${engineConfigDir}/skills -> skills/`);
      }
    } catch (e) {
      console.warn('[Engine] Failed to setup skills symlink:', e);
    }

    return NextResponse.json({ success: true, engine, defaultModel: config.defaultModel });
  } catch (error) {
    console.error('Failed to save engine config:', error);
    return NextResponse.json({ error: 'Failed to save engine config' }, { status: 500 });
  }
}
