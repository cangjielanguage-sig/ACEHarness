import { NextRequest } from 'next/server';
import { workflowManager } from '@/lib/workflow-manager';
import { stateMachineWorkflowManager } from '@/lib/state-machine-workflow-manager';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: any) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // 监听工作流事件
      const handlers = {
        status: (data: any) => sendEvent({ type: 'status', data }),
        phase: (data: any) => sendEvent({ type: 'phase', data }),
        step: (data: any) => sendEvent({ type: 'step', data }),
        result: (data: any) => sendEvent({ type: 'result', data }),
        checkpoint: (data: any) => sendEvent({ type: 'checkpoint', data }),
        agents: (data: any) => sendEvent({ type: 'agents', data }),
        iteration: (data: any) => sendEvent({ type: 'iteration', data }),
        'iteration-complete': (data: any) => sendEvent({ type: 'iteration-complete', data }),
        escalation: (data: any) => sendEvent({ type: 'escalation', data }),
        'token-usage': (data: any) => sendEvent({ type: 'token-usage', data }),
        'feedback-injected': (data: any) => sendEvent({ type: 'feedback-injected', data }),
        'feedback-recalled': (data: any) => sendEvent({ type: 'feedback-recalled', data }),
        'context-updated': (data: any) => sendEvent({ type: 'context-updated', data }),
        // Supervisor-Lite Plan 循环事件
        'plan-question': (data: any) => sendEvent({ type: 'plan-question', data }),
        'plan-round': (data: any) => sendEvent({ type: 'plan-round', data }),
        'route-decision': (data: any) => sendEvent({ type: 'route-decision', data }),
      };

      // 状态机专属事件
      const smHandlers = {
        'state-change': (data: any) => sendEvent({ type: 'phase', data: { phase: data.state, message: data.message } }),
        'step-start': (data: any) => sendEvent({ type: 'step', data: { id: data.id, step: `${data.state}-${data.step}`, agent: data.agent } }),
        'step-complete': (data: any) => sendEvent({ type: 'result', data: { id: data.id, step: `${data.state}-${data.step}`, agent: data.agent, output: data.output, costUsd: data.costUsd, durationMs: data.durationMs } }),
        'transition': (data: any) => sendEvent({ type: 'sm-transition', data }),
        'force-transition': (data: any) => sendEvent({ type: 'force-transition', data }),
        'transition-forced': (data: any) => sendEvent({ type: 'transition-forced', data }),
        'human-approval-required': (data: any) => sendEvent({ type: 'human-approval-required', data }),
        status: (data: any) => sendEvent({ type: 'status', data }),
        agents: (data: any) => sendEvent({ type: 'agents', data }),
        escalation: (data: any) => sendEvent({ type: 'escalation', data }),
        'token-usage': (data: any) => sendEvent({ type: 'token-usage', data }),
        'feedback-injected': (data: any) => sendEvent({ type: 'feedback-injected', data }),
        'feedback-recalled': (data: any) => sendEvent({ type: 'feedback-recalled', data }),
        // Supervisor-Lite Plan 循环事件
        'plan-question': (data: any) => sendEvent({ type: 'plan-question', data }),
        'plan-round': (data: any) => sendEvent({ type: 'plan-round', data }),
        'route-decision': (data: any) => sendEvent({ type: 'route-decision', data }),
        // Agent 工作流事件
        'agent-flow': (data: any) => sendEvent({ type: 'agent-flow', data }),
      };

      Object.entries(handlers).forEach(([event, handler]) => {
        workflowManager.on(event, handler);
      });
      Object.entries(smHandlers).forEach(([event, handler]) => {
        stateMachineWorkflowManager.on(event, handler);
      });

      // 清理函数
      request.signal.addEventListener('abort', () => {
        Object.entries(handlers).forEach(([event, handler]) => {
          workflowManager.off(event, handler);
        });
        Object.entries(smHandlers).forEach(([event, handler]) => {
          stateMachineWorkflowManager.off(event, handler);
        });
        controller.close();
      });

      // 发送初始连接消息
      sendEvent({ type: 'connected', data: { message: '已连接到事件流' } });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
