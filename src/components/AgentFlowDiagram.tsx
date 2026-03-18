'use client';

import { useMemo, useEffect, useState, useCallback } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  Panel,
  MarkerType,
  NodeTypes,
  Handle,
  Position,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Badge } from './ui/badge';

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

interface AgentFlowDiagramProps {
  flow: AgentFlowRecord[];
  currentRound?: number;
}

const getTypeColor = (type: string) => {
  switch (type) {
    case 'stream':
      return '#22c55e';
    case 'request':
      return '#3b82f6';
    case 'response':
      return '#a855f7';
    case 'supervisor':
      return '#f97316';
    case 'user':
      return '#6b7280';
    default:
      return '#9ca3af';
  }
};

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'stream': return '执行';
    case 'request': return '请求';
    case 'response': return '响应';
    case 'supervisor': return 'Supervisor';
    case 'user': return '用户';
    default: return type;
  }
};

function AgentNode({ data }: any) {
  const { agentName, isActive, stepName, isUser } = data;

  return (
    <div
      className={`
        px-4 py-3 rounded-xl border-2 min-w-[180px] transition-all shadow-lg cursor-move
        ${isActive 
          ? 'border-green-500 bg-green-50 dark:bg-green-950 shadow-green-200 dark:shadow-green-900' 
          : isUser
          ? 'border-gray-400 bg-gray-50 dark:bg-gray-800'
          : 'border-blue-300 bg-white dark:bg-gray-800 hover:shadow-xl'}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      
      <div className="flex items-center gap-3">
        <div className={`
          w-10 h-10 rounded-full flex items-center justify-center text-xl
          ${isUser ? 'bg-gray-200 dark:bg-gray-700' : 'bg-blue-100 dark:bg-blue-900'}
        `}>
          {isUser ? '👤' : '🤖'}
        </div>
        <div className="flex flex-col">
          <div className="font-bold text-sm">{agentName}</div>
          {stepName && (
            <div className="text-xs text-gray-500 dark:text-gray-400">{stepName}</div>
          )}
        </div>
      </div>
      
      {isActive && (
        <div className="mt-2 flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs text-blue-600 dark:text-blue-400">执行中</span>
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  );
}

function SupervisorNode({ data }: any) {
  const { flowCount, currentRound } = data;

  return (
    <div className="px-6 py-5 rounded-2xl border-2 border-orange-400 bg-orange-50 dark:bg-orange-950 min-w-[220px] shadow-xl shadow-orange-200 dark:shadow-orange-900 cursor-move">
      <Handle type="target" position={Position.Top} className="!bg-orange-400" />
      <Handle type="target" position={Position.Left} className="!bg-orange-400" />
      
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
          <span className="text-2xl">⚡</span>
        </div>
        <div className="flex flex-col">
          <div className="font-bold text-lg text-orange-700 dark:text-orange-300">Supervisor</div>
          <div className="text-xs text-orange-600 dark:text-orange-400">信息路由中转</div>
        </div>
      </div>
      
      {currentRound !== undefined && (
        <div className="mt-3 flex items-center gap-2">
          <Badge className="bg-orange-500 text-white text-xs">
            第 {currentRound + 1} 轮
          </Badge>
          <span className="text-xs text-orange-600 dark:text-orange-400">
            {flowCount} 条流转
          </span>
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="!bg-orange-400" />
      <Handle type="source" position={Position.Right} className="!bg-orange-400" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agentNode: AgentNode,
  supervisorNode: SupervisorNode,
};

function calculateInitialNodes(flow: AgentFlowRecord[], currentRound?: number): Node[] {
  const nodeList: Node[] = [];
  const agentSet = new Set<string>();
  let hasUser = false;
  let hasSupervisor = false;

  flow.forEach(record => {
    if (record.fromAgent && record.fromAgent !== 'supervisor') {
      agentSet.add(record.fromAgent);
      if (record.fromAgent === 'user') hasUser = true;
    }
    if (record.toAgent && record.toAgent !== 'supervisor') {
      agentSet.add(record.toAgent);
      if (record.toAgent === 'user') hasUser = true;
    }
    if (record.fromAgent === 'supervisor' || record.toAgent === 'supervisor') {
      hasSupervisor = true;
    }
  });

  const agentArray = Array.from(agentSet).filter(a => a !== 'user');
  const centerX = 500;

  // 默认三层布局：用户(上) -> Supervisor(中) -> Agents(下)
  const userY = 40;
  const supervisorY = 250;
  const agentsY = 500;

  // 按时间戳排序
  const sortedFlow = [...flow].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const latestRecord = sortedFlow.length > 0 ? sortedFlow[sortedFlow.length - 1] : null;
  // 用“最新一条流转记录”决定当前执行中的 Agent：
  // request: A -> Supervisor  => A 执行中
  // supervisor: Supervisor -> B => B 执行中
  // response: B -> A => A 收到回复后继续执行
  // stream: 状态流转，优先目标 Agent
  const activeAgent = (() => {
    if (!latestRecord) return null;
    if (latestRecord.type === 'request') return latestRecord.fromAgent;
    if (latestRecord.type === 'supervisor') return latestRecord.toAgent;
    if (latestRecord.type === 'response') return latestRecord.toAgent;
    if (latestRecord.type === 'stream') return latestRecord.toAgent || latestRecord.fromAgent;
    return null;
  })();

  if (hasSupervisor) {
    nodeList.push({
      id: 'supervisor',
      type: 'supervisorNode',
      position: { x: centerX, y: supervisorY },
      data: { flowCount: flow.length, currentRound: currentRound ?? 0 },
    });
  }

  if (agentArray.length === 0 && !hasUser) {
    return [];
  }

  if (agentArray.length === 1) {
    const agent = agentArray[0];
    const agentRecords = sortedFlow.filter(r => r.fromAgent === agent || r.toAgent === agent);
    const latestAgentRecord = agentRecords.length > 0 ? agentRecords[agentRecords.length - 1] : null;
    const isActive = activeAgent === agent;
    
    nodeList.push({
      id: agent,
      type: 'agentNode',
      position: { x: centerX, y: agentsY },
      data: { agentName: agent, isActive: !!isActive, stepName: latestAgentRecord?.stepName || '', isUser: false },
    });
  } else if (agentArray.length > 1) {
    const maxSpacing = 260;
    const minSpacing = 160;
    const spacing = Math.max(minSpacing, Math.min(maxSpacing, Math.floor(1100 / agentArray.length)));
    const totalWidth = spacing * (agentArray.length - 1);
    const startX = centerX - totalWidth / 2;

    agentArray.forEach((agent, index) => {
      const x = startX + index * spacing;
      const y = agentsY;
      
      const agentRecords = sortedFlow.filter(r => r.fromAgent === agent || r.toAgent === agent);
      const latestAgentRecord = agentRecords.length > 0 ? agentRecords[agentRecords.length - 1] : null;
      const isActive = activeAgent === agent;

      nodeList.push({
        id: agent,
        type: 'agentNode',
        position: { x, y },
        data: { agentName: agent, isActive: !!isActive, stepName: latestAgentRecord?.stepName || '', isUser: false },
      });
    });
  }

  if (hasUser) {
    nodeList.push({
      id: 'user',
      type: 'agentNode',
      position: { x: centerX, y: userY },
      data: { agentName: '用户', isActive: false, stepName: '', isUser: true },
    });
  }

  return nodeList;
}

function calculateEdges(flow: AgentFlowRecord[], nodes: Node[]): Edge[] {
  const edgeList: Edge[] = [];
  const nodeIds = new Set(nodes.map(n => n.id));

  // 保留三类可视化边：
  // stream（绿色状态流转）+ request（蓝色请求）+ supervisor（橙色路由）
  // response 仅用于驱动执行态，不画线。
  const filteredFlow = flow.filter(record => 
    record.type === 'stream' || record.type === 'request' || record.type === 'supervisor'
  );

  // 保留所有边，按时间排序后每条都显示
  // 使用类型+方向作为 key，避免不同类型的边被覆盖
  const sortedFlow = [...filteredFlow].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // 对于每种类型的边，分别保留最新的
  const edgeMap = new Map<string, AgentFlowRecord>();
  sortedFlow.forEach(record => {
    const key = `${record.type}-${record.fromAgent}->${record.toAgent}`;
    edgeMap.set(key, record);
  });

  edgeMap.forEach((record) => {
    let sourceId = record.fromAgent;
    let targetId = record.toAgent;

    // 过滤无效边和自环，避免画面拥挤
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
      return;
    }

    const color = getTypeColor(record.type);

    edgeList.push({
      id: `${record.id}-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      label: getTypeLabel(record.type),
      type: 'default',
      animated: true,
      style: { 
        stroke: color, 
        strokeWidth: 3
      },
      labelStyle: { fontSize: 10, fill: color },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, color: color },
    });
  });

  return edgeList;
}

function AgentFlowDiagramInner({
  flow,
  currentRound,
}: AgentFlowDiagramProps) {
  const nodesData = useMemo(() => calculateInitialNodes(flow, currentRound), [flow, currentRound]);
  const edgesData = useMemo(() => calculateEdges(flow, nodesData), [flow, nodesData]);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(nodesData);
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgesData);

  useEffect(() => {
    setNodes(nodesData);
    setEdges(edgesData);
  }, [nodesData, edgesData, setNodes, setEdges]);

  if (flow.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 p-8">
          <div className="text-5xl mb-4">🔄</div>
          <p className="text-lg font-medium">暂无 Agent 流转记录</p>
          <p className="text-sm mt-2 text-gray-400">Agent 执行时将显示信息流转图</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Controls />
        <Background color="#e5e7eb" gap={20} />
        <Panel position="top-right" className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border">
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="font-medium">步骤流转</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="font-medium">请求</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="font-medium">路由</span>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            提示：可拖动节点调整位置
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default function AgentFlowDiagram({ flow, currentRound }: AgentFlowDiagramProps) {
  return (
    <ReactFlowProvider>
      <AgentFlowDiagramInner flow={flow} currentRound={currentRound} />
    </ReactFlowProvider>
  );
}
