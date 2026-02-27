import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const MODELS_FILE = path.join(process.cwd(), 'src/lib/models.ts');

export async function GET() {
  try {
    const content = await fs.readFile(MODELS_FILE, 'utf-8');

    // Extract MODEL_OPTIONS array from the file
    const match = content.match(/export const MODEL_OPTIONS: ModelOption\[\] = (\[[\s\S]*?\]);/);
    if (!match) {
      return NextResponse.json({ error: 'Failed to parse models' }, { status: 500 });
    }

    // Parse the array (simple eval for now, could use a proper parser)
    const modelsStr = match[1];
    const models = eval(modelsStr);

    return NextResponse.json({ models });
  } catch (error) {
    console.error('Failed to read models:', error);
    return NextResponse.json({ error: 'Failed to read models' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { models } = await request.json();

    // Read current file
    const content = await fs.readFile(MODELS_FILE, 'utf-8');

    // Generate new MODEL_OPTIONS array
    const modelsStr = JSON.stringify(models, null, 2)
      .replace(/"value":/g, 'value:')
      .replace(/"label":/g, 'label:')
      .replace(/"costMultiplier":/g, 'costMultiplier:')
      .replace(/"/g, "'");

    // Replace the MODEL_OPTIONS array
    const newContent = content.replace(
      /export const MODEL_OPTIONS: ModelOption\[\] = \[[\s\S]*?\];/,
      `export const MODEL_OPTIONS: ModelOption[] = ${modelsStr};`
    );

    await fs.writeFile(MODELS_FILE, newContent, 'utf-8');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save models:', error);
    return NextResponse.json({ error: 'Failed to save models' }, { status: 500 });
  }
}
