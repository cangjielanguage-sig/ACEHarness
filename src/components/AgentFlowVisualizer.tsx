'use client';

import { useMemo } from 'react';
import { Badge } from './ui/badge';
import { ArrowRight, Bot, GitBranch, Play, Send, MessageCircle, User, HelpCircle } from 'lucide-react';

interface AgentFlowRecord {
  id: string;
  type: 'stream' | 'request' | 'response' | 'supervisor';
  fromAgent: string;
  toAgent: string;
  message?: string;
  stateName: string;
  stepName: string;
  round: number;
  timestamp: string;
}

interface AgentFlowVisualizerProps {
  flow: AgentFlowRecord[];
  currentRound?: number;
}

export default function AgentFlowVisualizer({
  flow,
  currentRound,
}: AgentFlowVisualizerProps) {
  const sortedFlow = useMemo(() => {
    return [...flow].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [flow]);

  const allAgents = useMemo(() => {
    const agentSet = new Set<string>();
    sortedFlow.forEach(record => {
      if (record.fromAgent && record.fromAgent !== 'supervisor' && record.fromAgent !== 'user') {
        agentSet.add(record.fromAgent);
      }
      if (record.toAgent && record.toAgent !== 'supervisor' && record.toAgent !== 'user') {
        agentSet.add(record.toAgent);
      }
    });
    return Array.from(agentSet);
  }, [sortedFlow]);

  if (flow.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold">Agent 工作流</h3>
        </div>
        <div className="text-center text-gray-500 py-8">
          <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无 Agent 工作流记录</p>
          <p className="text-xs mt-1">当 Agent 开始执行或相互通信时，将显示信息传递路径</p>
        </div>
        {currentRound !== undefined && (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200">
            当前第 {currentRound + 1} 轮
          </Badge>
        )}
      </div>
    );
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'stream':
        return <Play className="w-3 h-3 text-green-500" />;
      case 'request':
        return <Send className="w-3 h-3 text-blue-500" />;
      case 'response':
        return <MessageCircle className="w-3 h-3 text-purple-500" />;
      case 'supervisor':
        return <GitBranch className="w-3 h-3 text-orange-500" />;
      default:
        return <Bot className="w-3 h-3 text-gray-500" />;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'stream':
        return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] py-0 h-5">执行中</Badge>;
      case 'request':
        return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] py-0 h-5">请求</Badge>;
      case 'response':
        return <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px] py-0 h-5">响应</Badge>;
      case 'supervisor':
        return <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px] py-0 h-5">Supervisor</Badge>;
      default:
        return null;
    }
  };

  const getFromLabel = (agent: string) => {
    if (agent === 'supervisor') return 'Supervisor';
    if (agent === 'user') return '用户';
    return agent;
  };

  const getToLabel = (agent: string) => {
    if (agent === 'supervisor') return 'Supervisor';
    if (agent === 'user') return '用户';
    return agent;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold">Agent 工作流</h3>
          <Badge variant="secondary">{flow.length} 条记录</Badge>
          {allAgents.length > 0 && (
            <Badge variant="outline" className="text-[10px] py-0 h-5">
              {allAgents.length} 个 Agent
            </Badge>
          )}
        </div>
        {currentRound !== undefined && (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200">
            当前第 {currentRound + 1} 轮
          </Badge>
        )}
      </div>

      {allAgents.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {allAgents.map(agent => (
            <div
              key={agent}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950 text-xs text-blue-700 dark:text-blue-300"
            >
              <Bot className="w-3 h-3" />
              {agent}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {sortedFlow.map((record, idx) => (
          <div key={record.id || idx} className="relative pl-8">
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-blue-200" />
            <div className="absolute left-2 top-3 w-2 h-2 rounded-full bg-blue-500 border-2 border-white dark:border-gray-800" />
            
            <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-1 text-xs text-blue-500">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" strokeWidth="2" />
                    <path strokeLinecap="round" strokeWidth="2" d="M12 6v6l4 2" />
                  </svg>
                  {new Date(record.timestamp).toLocaleTimeString()}
                </div>
                {getTypeBadge(record.type)}
                {record.stateName && (
                  <Badge variant="outline" className="text-[10px] py-0 h-5">
                    {record.stateName}
                  </Badge>
                )}
                {record.round > 0 && (
                  <Badge variant="outline" className="text-[10px] py-0 h-5">
                    第 {record.round + 1} 轮
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm flex-wrap">
                <div className={`
                  flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                  ${record.fromAgent === 'supervisor'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : record.fromAgent === 'user'
                    ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  }
                `}>
                  {record.fromAgent === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : record.fromAgent === 'supervisor' ? (
                    <GitBranch className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3" />
                  )}
                  {getFromLabel(record.fromAgent)}
                </div>

                <div className="flex items-center gap-1">
                  {getTypeIcon(record.type)}
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                </div>

                <div className={`
                  flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                  ${record.toAgent === 'supervisor'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : record.toAgent === 'user'
                    ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }
                `}>
                  {record.toAgent === 'user' ? (
                    <User className="w-3 h-3" />
                  ) : record.toAgent === 'supervisor' ? (
                    <GitBranch className="w-3 h-3" />
                  ) : (
                    <Bot className="w-3 h-3" />
                  )}
                  {getToLabel(record.toAgent)}
                </div>
              </div>

              {record.message && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900/50 rounded p-2 max-h-24 overflow-y-auto">
                  {record.message.length > 200 ? record.message.substring(0, 200) + '...' : record.message}
                </div>
              )}

              {record.stepName && record.type === 'stream' && (
                <div className="mt-2 text-xs text-green-600 dark:text-green-400">
                  <Play className="w-3 h-3 inline mr-1" />
                  执行步骤: {record.stepName}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <Play className="w-3 h-3 text-green-500" />
            <span>执行中</span>
          </div>
          <div className="flex items-center gap-1">
            <Send className="w-3 h-3 text-blue-500" />
            <span>请求</span>
          </div>
          <div className="flex items-center gap-1">
            <MessageCircle className="w-3 h-3 text-purple-500" />
            <span>响应</span>
          </div>
          <div className="flex items-center gap-1">
            <GitBranch className="w-3 h-3 text-orange-500" />
            <span>Supervisor 路由</span>
          </div>
        </div>
      </div>
    </div>
  );
}
