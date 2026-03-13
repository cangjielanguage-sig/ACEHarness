/**
 * B-Lite Supervisor 路由器模块
 * 负责解析 Agent 的信息请求并路由到合适的回答者（另一个 Agent 或用户）
 */

export interface InfoRequest {
  fromAgent: string;
  question: string;
  isHuman: boolean;
}

export interface RouteDecision {
  route_to: string;
  question: string;
  reason: string;
  method: 'human-tag' | 'keyword' | 'llm';
}

export interface AgentSummary {
  name: string;
  description: string;
  keywords: string[];
}

const NEED_INFO_REGEX = /\[NEED_INFO(?::human)?\]\s*(.+?)(?=\[NEED_INFO|$)/gi;
const PLAN_DONE_REGEX = /\[PLAN_DONE\]/i;

export function parseNeedInfo(output: string): InfoRequest[] {
  const requests: InfoRequest[] = [];
  const matches = output.matchAll(NEED_INFO_REGEX);

  for (const match of matches) {
    const fullMatch = match[0];
    const question = match[1].trim();
    const isHuman = fullMatch.toLowerCase().includes(':human');

    if (question) {
      requests.push({
        fromAgent: '',
        question,
        isHuman,
      });
    }
  }

  return requests;
}

export function isPlanDone(output: string): boolean {
  return PLAN_DONE_REGEX.test(output);
}

export async function routeInfoRequest(
  req: InfoRequest,
  availableAgents: AgentSummary[],
  currentStep: string,
  llmCaller?: (prompt: string) => Promise<string>
): Promise<RouteDecision> {
  const lowerQuestion = req.question.toLowerCase();

  for (const agent of availableAgents) {
    if (agent.keywords && agent.keywords.length > 0) {
      for (const keyword of agent.keywords) {
        if (lowerQuestion.includes(keyword.toLowerCase())) {
          return {
            route_to: agent.name,
            question: req.question,
            reason: `关键词匹配: "${keyword}"`,
            method: 'keyword',
          };
        }
      }
    }
  }

  if (llmCaller) {
    const llmPrompt = buildRoutingPrompt(req.question, availableAgents, currentStep);
    try {
      const llmResponse = await llmCaller(llmPrompt);
      const decision = parseLLMRoutingResponse(llmResponse, availableAgents);
      if (decision) {
        return {
          route_to: decision.route_to,
          question: req.question,  
          reason: `LLM 路由决策`,
          method: 'llm',
        };
      }
    } catch (error) {
      console.error('[SupervisorRouter] LLM 路由失败:', error);
    }
  }

  return {
    route_to: 'user',
    question: req.question,
    reason: '无匹配，fallback 到用户',
    method: 'llm',
  };
}

function buildRoutingPrompt(question: string, agents: AgentSummary[], currentStep: string): string {
  const agentDescriptions = agents
    .map(a => `- ${a.name}: ${a.description || '无描述'} (关键词: ${a.keywords?.join(', ') || '无'})`)
    .join('\n');

  return `你是一个路由器，需要决定谁最适合回答以下问题。

当前执行步骤: ${currentStep}

问题: ${question}

可用 Agent:
${agentDescriptions}

请选择一个最合适的 Agent 来回答问题。只返回 Agent 名称，不要返回其他内容。`;
}

function parseLLMRoutingResponse(response: string, agents: AgentSummary[]): RouteDecision | null {
  const trimmed = response.trim();
  const matchedAgent = agents.find(a => a.name.toLowerCase() === trimmed.toLowerCase());

  if (matchedAgent) {
    return {
      route_to: matchedAgent.name,
      question: '',
      reason: `LLM 选择`,
      method: 'llm',
    };
  }

  for (const agent of agents) {
    if (trimmed.toLowerCase().includes(agent.name.toLowerCase())) {
      return {
        route_to: agent.name,
        question: '',
        reason: `LLM 选择`,
        method: 'llm',
      };
    }
  }

  return null;
}
