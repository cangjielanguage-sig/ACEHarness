'use client';

import { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  MarkerType,
  NodeTypes,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
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
      return { bg: 'bg-green-50 dark:bg-green-950', border: 'border-green-400', text: 'text-green-700 dark:text-green-300', icon: '▶' };
    case 'request':
      return { bg: 'bg-blue-50 dark:bg-blue-950', border: 'border-blue-400', text: 'text-blue-700 dark:text-blue-300', icon: '→' };
    case 'response':
      return { bg: 'bg-purple-50 dark:bg-purple-950', border: 'border-purple-400', text: 'text-purple-700 dark:text-purple-300', icon: '↩' };
    case 'supervisor':
      return { bg: 'bg-orange-50 dark:bg-orange-950', border: 'border-orange-400', text: 'text-orange-700 dark:text-orange-300', icon: '◎' };
    default:
      return { bg: 'bg-gray-50 dark:bg-gray-950', border: 'border-gray-400', text: 'text-gray-700 dark:text-gray-300', icon: '•' };
  }
};

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'stream': return '执行中';
    case 'request': return '请求';
    case 'response': return '响应';
    case 'supervisor': return 'Supervisor';
    default: return type;
  }
};

function AgentNode({ data }: any) {
  const { agentName, isActive, stepName, status } = data;
  const isSupervisor = agentName === 'supervisor';

  return (
    <div
      className={`
        px-3 py-2 rounded-lg border-2 min-w-[160px] transition-all
        ${isActive 
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg animate-pulse' 
          : isSupervisor 
          ? 'border-purple-400 bg-purple-50 dark:bg-purple-950' 
          : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800'}
      `}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />

      <div className="flex items-center gap-2">
        <span className={`text-lg ${isSupervisor ? 'text-purple-500' : 'text-blue-500'}`}>
          {isSupervisor ? '◎' : '🤖'}
        </span>
        <div className="flex flex-col">
          <div className="font-semibold text-sm">{agentName}</div>
          {stepName && (
            <div className="text-xs text-gray-500 dark:text-gray-400">{stepName}</div>
          )}
        </div>
      </div>
      
      {isActive && (
        <Badge className="mt-1 text-[10px] bg-blue-500 text-white">执行中</Badge>
      )}
    </div>
  );
}

function FlowEdge({ data }: any) {
  const { type, message, round } = data;
  const colors = getTypeColor(type);
  
  return (
    <div className="text-[10px] px-1 py-0.5 rounded bg-white dark:bg-gray-800 border">
      <div className="flex items-center gap-1">
        <span className={colors.text}>{colors.icon}</span>
        <span className={colors.text}>{getTypeLabel(type)}</span>
      </div>
      {round > 0 && (
        <div className="text-gray-400">第{round + 1}轮</div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agentNode: AgentNode,
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

function AgentFlowDiagramInner({
  flow,
  currentRound,
}: AgentFlowDiagramProps) {
  const [showAllEdges, setShowAllEdges] = useState(true);

  const { getNodes, getEdges, getNode, getEdge } = {
    getNodes: () => [],
    getEdges: () => [],
    getNode: (id: string) => null,
    getEdge: (id: string) => null,
  };

  const nodes: Node[] = useMemo(() => {
    const agentPositions = new Map<string, { x: number; y: number }>();
    const allAgents = new Set<string>();

    flow.forEach(record => {
      if (record.fromAgent && record.fromAgent !== 'supervisor' && record.fromAgent !== 'user') {
        allAgents.add(record.fromAgent);
      }
      if (record.toAgent && record.toAgent !== 'supervisor' && record.toAgent !== 'user') {
        allAgents.add(record.toAgent);
      }
    });

    const agentArray = Array.from(allAgents);
    
    agentArray.forEach((agent, index) => {
      const cols = Math.min(4, agentArray.length);
      const col = index % cols;
      const row = Math.floor(index / cols);
      agentPositions.set(agent, {
        x: col * 250 + 150,
        y: row * 200 + 100,
      });
    });

    const lastRecord = flow.length > 0 ? flow[flow.length - 1] : null;

    return agentArray.map(agent => {
      const position = agentPositions.get(agent)!;
      const agentRecords = flow.filter(r => r.fromAgent === agent || r.toAgent === agent);
      const latestRecord = agentRecords.length > 0 ? agentRecords[agentRecords.length - 1] : null;
      const isActive = latestRecord && 
        ((latestRecord.toAgent === agent && latestRecord.type === 'request') || 
         (latestRecord.fromAgent === agent && latestRecord.type === 'stream'));

      return {
        id: agent,
        type: 'agentNode',
        position,
        data: {
          agentName: agent,
          isActive: !!isActive,
          stepName: latestRecord?.stepName || '',
          status: latestRecord?.type || '',
        },
      };
    });
  }, [flow]);

  const edges: Edge[] = useMemo(() => {
    const edgeList: Edge[] = [];
    const edgeMap = new Map<string, AgentFlowRecord>();

    flow.forEach(record => {
      const edgeId = `${record.fromAgent}-${record.toAgent}`;
      if (!edgeMap.has(edgeId) || record.type === 'supervisor') {
        edgeMap.set(edgeId, record);
      }
    });

    const agentPositions = new Map<string, { x: number; y: number }>();
    nodes.forEach(node => {
      agentPositions.set(node.id, node.position);
    });

    edgeMap.forEach((record, edgeId) => {
      const colors = getTypeColor(record.type);
      let edgeStyle: any = {};
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

      const sourcePos = agentPositions.get(record.fromAgent);
      const targetPos = agentPositions.get(record.toAgent);
      let sourceHandle = 'right';
      let targetHandle = 'left';

      if (sourcePos && targetPos) {
        const handles = calculateHandlePositions(sourcePos, targetPos);
        sourceHandle = handles.sourceHandle;
        targetHandle = handles.targetHandle;
      }

      edgeList.push({
        id: edgeId,
        source: record.fromAgent,
        target: record.toAgent,
        sourceHandle,
        targetHandle,
        label: getTypeLabel(record.type),
        type: 'smoothstep',
        animated: edgeAnimated,
        style: edgeStyle,
        labelStyle: { fill: colors.text.replace('text-', '').split(' ')[0], fontSize: 10 },
        labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeStyle.stroke,
        },
        data: {
          type: record.type,
          message: record.message,
          round: record.round,
        },
      });
    });

    return edgeList;
  }, [flow, nodes]);

  if (flow.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 p-8">
          <div className="text-4xl mb-4">🔄</div>
          <p className="text-lg font-medium">暂无 Agent 流转记录</p>
          <p className="text-sm mt-2">Agent 执行时将显示信息流转图</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
      >
        <Controls />
        <Background color="#e5e7eb" gap={20} />
        <Panel position="top-right" className="bg-white dark:bg-gray-800 p-2 rounded-lg shadow-lg border">
          <div className="flex flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>执行中</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span>请求</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-purple-500" />
              <span>响应</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span>Supervisor</span>
            </div>
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
