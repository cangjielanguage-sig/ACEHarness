import { NextResponse } from 'next/server';
import { isEngineAvailable } from '@/lib/engines/engine-factory';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const engineType = searchParams.get('engine');

    if (!engineType) {
      return NextResponse.json({ error: 'Engine type is required' }, { status: 400 });
    }

    const available = await isEngineAvailable(engineType as any);

    return NextResponse.json({
      engine: engineType,
      available
    });
  } catch (error) {
    console.error('Failed to check engine availability:', error);
    return NextResponse.json({
      error: 'Failed to check engine availability',
      available: false
    }, { status: 500 });
  }
}
