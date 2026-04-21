import { NextRequest, NextResponse } from 'next/server';
import { ACPEngine } from '@/lib/engines/acp-engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/engine/models?engine=opencode
 *
 * Spawns the specified ACP engine, initializes + creates a session to discover
 * available models, then immediately stops the engine.
 * Returns the list of models reported by the engine.
 */
export async function GET(request: NextRequest) {
  const engineType = request.nextUrl.searchParams.get('engine');
  if (!engineType) {
    return NextResponse.json({ error: 'engine parameter required' }, { status: 400 });
  }

  // These engines don't use ACP or are not available on this system
  if (engineType === 'claude-code' || engineType === 'cangjie-magic' || engineType === 'codex') {
    return NextResponse.json({ models: [], message: `${engineType} does not support ACP model discovery` });
  }

  const commandMap: Record<string, string> = {
    'opencode': 'opencode',
    'kiro-cli': 'kiro-cli',
    'cursor': 'agent',
    'trae-cli': 'trae-cli',
  };

  const command = commandMap[engineType];
  if (!command) {
    return NextResponse.json({ error: `Unknown engine: ${engineType}` }, { status: 400 });
  }

  const engine = new ACPEngine({
    engineType,
    command,
    workingDirectory: process.cwd(),
  });

  try {
    // Set a timeout — if engine doesn't respond in 30s, abort
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Engine model discovery timed out (30s)')), 30000)
    );

    const discover = async () => {
      await engine.start();
      await engine.createSession();
      return engine.getAvailableModels();
    };

    const models = await Promise.race([discover(), timeout]);

    return NextResponse.json({
      engine: engineType,
      models: models.map((m: any) => ({
        modelId: m.modelId,
        name: m.name,
      })),
    });
  } catch (error) {
    console.error(`[engine/models] Failed to discover models for ${engineType}:`, error);
    return NextResponse.json({
      error: `Failed to discover models: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  } finally {
    engine.stop();
  }
}
