import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const ENGINE_CONFIG_FILE = path.join(process.cwd(), '.engine.json');

interface EngineConfig {
  engine: string;
  updatedAt: string;
}

export async function GET() {
  try {
    const exists = await fs.access(ENGINE_CONFIG_FILE).then(() => true).catch(() => false);

    if (!exists) {
      // Default to claude-code
      return NextResponse.json({ engine: 'claude-code' });
    }

    const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
    const config: EngineConfig = JSON.parse(content);

    return NextResponse.json({ engine: config.engine });
  } catch (error) {
    console.error('Failed to read engine config:', error);
    return NextResponse.json({ engine: 'claude-code' });
  }
}

export async function POST(request: Request) {
  try {
    const { engine } = await request.json();

    if (!engine) {
      return NextResponse.json({ error: 'Engine is required' }, { status: 400 });
    }

    const config: EngineConfig = {
      engine,
      updatedAt: new Date().toISOString(),
    };

    await fs.writeFile(ENGINE_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

    return NextResponse.json({ success: true, engine });
  } catch (error) {
    console.error('Failed to save engine config:', error);
    return NextResponse.json({ error: 'Failed to save engine config' }, { status: 500 });
  }
}
