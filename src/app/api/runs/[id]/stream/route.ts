import { NextRequest, NextResponse } from 'next/server';
import { loadStreamContent } from '@/lib/run-state-persistence';
import { processManager } from '@/lib/process-manager';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const step = request.nextUrl.searchParams.get('step');
  if (!step) {
    return NextResponse.json({ error: '缺少 step 参数' }, { status: 400 });
  }

  const live = request.nextUrl.searchParams.get('live');

  // Legacy non-SSE mode: return persisted content as JSON
  if (!live) {
    const content = await loadStreamContent(id, step);
    return NextResponse.json({ step, content: content || '' });
  }

  // SSE mode: stream real-time content from processManager
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Send any already-accumulated content first (prefer running process over completed ones)
      const allProcs = processManager.getAllProcesses();
      const existing = allProcs.find((p: any) => p.runId === id && p.status === 'running' && p.streamContent)
        || allProcs.find((p: any) => p.runId === id && p.streamContent);
      if (existing?.streamContent) {
        send('delta', { content: existing.streamContent });
      }

      // Listen for live stream events
      const onStream = (evt: any) => {
        if (closed) return;
        // Match by runId — processManager stream events carry { id, step, delta, total }
        // The process id contains the runId, or we match by step name
        const proc = processManager.getProcessRaw?.(evt.id);
        if (proc?.runId === id) {
          if (evt.delta) {
            send('delta', { content: evt.delta });
          }
          if (evt.thinking) {
            send('thinking', { content: evt.thinking });
          }
        }
      };

      processManager.on('stream', onStream);

      // Only signal done when no running processes remain for this runId
      const checkDone = setInterval(() => {
        if (closed) { clearInterval(checkDone); return; }
        const procs = processManager.getAllProcesses();
        const hasRunning = procs.some((p: any) => p.runId === id && p.status === 'running');
        if (hasRunning) return;
        const finished = procs.find((p: any) => p.runId === id && (p.status === 'completed' || p.status === 'failed' || p.status === 'killed'));
        if (finished) {
          send('done', { status: finished.status });
          cleanup();
        }
      }, 2000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        processManager.off('stream', onStream);
        clearInterval(checkDone);
        try { controller.close(); } catch {}
      };

      request.signal.addEventListener('abort', cleanup);
      send('connected', { runId: id, step });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
