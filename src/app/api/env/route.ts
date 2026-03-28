import { NextRequest, NextResponse } from 'next/server';
import { loadEnvVars, saveEnvVars } from '@/lib/env-manager';

export async function GET() {
  const vars = await loadEnvVars();
  return NextResponse.json({ vars });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    await saveEnvVars(body.vars || []);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
