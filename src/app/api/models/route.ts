import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { parse, stringify } from 'yaml';
import { getModelOptions, clearModelsCache, type ModelOption } from '@/lib/models';

const MODELS_CONFIG_FILE = path.join(process.cwd(), 'configs', 'models', 'models.yaml');

export async function GET() {
  try {
    const models = await getModelOptions();
    return NextResponse.json({ models });
  } catch (error) {
    console.error('Failed to read models:', error);
    return NextResponse.json({ error: 'Failed to read models' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { models } = await request.json();

    // Read current config
    let config: { models: ModelOption[] };
    try {
      const content = await fs.readFile(MODELS_CONFIG_FILE, 'utf-8');
      config = parse(content) || { models: [] };
    } catch {
      config = { models: [] };
    }

    // Update models
    config.models = models;

    // Write back to YAML
    const yamlContent = stringify(config, { lineWidth: 0 });
    await fs.writeFile(MODELS_CONFIG_FILE, yamlContent, 'utf-8');

    // Clear cache so next read gets fresh data
    clearModelsCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save models:', error);
    return NextResponse.json({ error: 'Failed to save models' }, { status: 500 });
  }
}