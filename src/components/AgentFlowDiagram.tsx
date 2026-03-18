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
  OnNodesChange,
  OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
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
      return { stroke: '#22c55e', bg: 'bg-green-500' };
    case 'request':
      return { stroke: '#3b82f6', bg: 'bg-blue-500' };
    case 'response':
      return { stroke: '#a855f7', bg: 'bg-purple-500' };
    case 'supervisor':
      return { stroke: '#f97316', bg: 'bg-orange-500' };
    case 'user':
      return { stroke: '#6b7280', bg: 'bg-gray-500' };
    default:
      return { stroke: '#9ca3af', bg: 'bg-gray-500' };
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
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-blue-200 dark:shadow-blue-900' 
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

function calculateHandlePositions(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number }
): { sourceHandle: string; targetHandle: string } {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  if (angle >= -45 && angle < 45) {
    return { sourceHandle: 'right', targetHandle: 'left' };
  } else if (angle >= 45 && angle < 135) {
    return { sourceHandle: 'bottom', targetHandle: 'top' };
  } else if (angle >= 135 || angle < -135) {
    return { sourceHandle: 'left', targetHandle: 'right' };
  } else {
    return { sourceHandle: 'top', targetHandle: 'bottom' };
  }
}

function calculateInitialNodes(flow: AgentFlowRecord[], currentRound?: number): Node[] {
  const nodeList: Node[] = [];
  const agentSet = new Set<string>();
  let hasUser = false;
  let hasSupervisor = false;

  console.log('[AgentFlowDiagram] flow 数据:', JSON.stringify(flow, null, 2));

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

  console.log('[AgentFlowDiagram] agentSet:', Array.from(agentSet), 'hasUser:', hasUser, 'hasSupervisor:', hasSupervisor);

  const agentArray = Array.from(agentSet).filter(a => a !== 'user');
  
  const centerX = 400;
  const centerY = 300;
  
  if (hasSupervisor) {
    nodeList.push({
      id: 'supervisor',
      type: 'supervisorNode',
      position: { x: centerX, y: centerY },
      data: {
        flowCount: flow.length,
        currentRound: currentRound ?? 0,
      },
    });
  }

  if (agentArray.length === 1) {
    nodeList.push({
      id: agentArray[0],
      type: 'agentNode',
      position: { x: centerX - 200, y: centerY + 150 },
      data: {
        agentName: agentArray[0],
        isActive: false,
        stepName: '',
        isUser: false,
      },
    });
  } else if (agentArray.length > 1) {
    const radius = 220;
    agentArray.forEach((agent, index) => {
      const angle = (2 * Math.PI * index) / agentArray.length - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - 90;
      const y = centerY + radius * Math.sin(angle) + 50;
      
      const agentRecords = flow.filter(r => r.fromAgent === agent || r.toAgent === agent);
      const latestRecord = agentRecords.length > 0 ? agentRecords[agentRecords.length - 1] : null;
      const isActive = latestRecord && 
        ((latestRecord.toAgent === agent && latestRecord.type === 'request') || 
         (latestRecord.fromAgent === agent && latestRecord.type === 'stream'));

      nodeList.push({
        id: agent,
        type: 'agentNode',
        position: { x, y },
        data: {
          agentName: agent,
          isActive: !!isActive,
          stepName: latestRecord?.stepName || '',
          isUser: false,
        },
      });
    });
  }

  if (hasUser) {
    nodeList.push({
      id: 'user',
      type: 'agentNode',
      position: { x: centerX + 250, y: centerY - 50 },
      data: {
        agentName: '用户',
        isActive: false,
        stepName: '',
        isUser: true,
      },
    });
  }

  return nodeList;
}

function calculateEdges(flow: AgentFlowRecord[], nodes: Node[]): Edge[] {
  const edgeList: Edge[] = [];
  const agentPositions = new Map<string, { x: number; y: number }>();
  
  nodes.forEach(node => {
    agentPositions.set(node.id, node.position);
  });

  console.log('[AgentFlowDiagram] calculateEdges - nodes:', nodes.map(n => n.id), 'agentPositions:', Array.from(agentPositions.keys()));

  const addEdge = (record: AgentFlowRecord) => {
    const sourceId = record.fromAgent === 'supervisor' ? 'supervisor' : record.fromAgent;
    const targetId = record.toAgent === 'supervisor' ? 'supervisor' : record.toAgent;
    
    console.log('[AgentFlowDiagram] addEdge - from:', sourceId, 'to:', targetId, 'available:', Array.from(agentPositions.keys()));
    
    if (!agentPositions.has(sourceId) || !agentPositions.has(targetId)) {
      console.log('[AgentFlowDiagram] 跳过边 - 节点不存在');
      return;
    }
    
    const colors = getTypeColor(record.type);
    let edgeStyle: any = { stroke: colors.stroke, strokeWidth: 2 };
    let edgeAnimated = false;

    if (record.type === 'stream') {
      edgeStyle = { stroke: '#22c55e', strokeWidth: 3 };
      edgeAnimated = true;
    } else if (record.type === 'supervisor') {
      edgeStyle = { stroke: '#f97316', strokeWidth: 3 };
      edgeAnimated = true;
    } else if (record.type === 'request') {
      edgeStyle = { stroke: '#3b82f6', strokeWidth: 2 };
      edgeAnimated = true;
    } else if (record.type === 'response') {
      edgeStyle = { stroke: '#a855f7', strokeWidth: 2 };
      edgeAnimated = true;
    }

    const sourcePos = agentPositions.get(sourceId)!;
    const targetPos = agentPositions.get(targetId)!;
    const handles = calculateHandlePositions(sourcePos, targetPos);

    edgeList.push({
      id: `${record.id}-${record.fromAgent}-${record.toAgent}`,
      source: sourceId,
      target: targetId,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      label: getTypeLabel(record.type),
      type: 'smoothstep',
      animated: edgeAnimated,
      style: edgeStyle,
      labelStyle: { fontSize: 10, fill: colors.stroke },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: colors.stroke,
      },
      data: { type: record.type, round: record.round },
    });
  };

  flow.forEach(record => {
    if (record.type === 'supervisor') {
      addEdge(record);
    }
  });

  flow.forEach(record => {
    if (record.type !== 'supervisor') {
      addEdge(record);
    }
  });

  return edgeList;
}

function AgentFlowDiagramInner({
  flow,
  currentRound,
}: AgentFlowDiagramProps) {
  const initialNodes = useMemo(() => {
    return calculateInitialNodes(flow, currentRound);
  }, [flow, currentRound]);

  const initialEdges = useMemo(() => {
    return calculateEdges(flow, initialNodes);
  }, [flow, initialNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [flow, currentRound, initialNodes, initialEdges, setNodes, setEdges]);

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
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
      >
        <Controls />
        <Background color="#e5e7eb" gap={20} />
        <Panel position="top-right" className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border">
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="font-medium">执行</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="font-medium">请求</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-purple-500" />
              <span className="font-medium">响应</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="font-medium">Supervisor</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-gray-500" />
              <span className="font-medium">用户</span>
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
