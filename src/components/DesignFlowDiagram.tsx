'use client';

import { useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import styles from './DesignFlowDiagram.module.css';

interface Step {
  name: string;
  agent: string;
  task: string;
  role?: 'attacker' | 'defender' | 'judge';
  constraints?: string[];
}

interface IterationConfig {
  enabled: boolean;
  maxIterations: number;
  exitCondition: string;
  consecutiveCleanRounds: number;
  escalateToHuman: boolean;
}

interface Phase {
  name: string;
  steps: Step[];
  checkpoint?: { name: string; message: string };
  iteration?: IterationConfig;
}

interface Workflow {
  name: string;
  description?: string;
  phases: Phase[];
}

interface DesignFlowDiagramProps {
  workflow: Workflow;
  onUpdateWorkflow: (workflow: Workflow) => void;
  onSelectNode: (type: 'phase' | 'step', phaseIndex: number, stepIndex?: number) => void;
}

export default function DesignFlowDiagram({
  workflow, onUpdateWorkflow, onSelectNode,
}: DesignFlowDiagramProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const colGap = 60;
    const checkpointGap = 40;
    const headerY = 0;
    const phaseHeaderH = 50;
    const stepNodeH = 90;
    const stepGap = 24;
    const stepNodeW = 220;
    const stepsStartY = phaseHeaderH + 50;

    // Pre-calculate group heights for checkpoint vertical centering
    const groupHeights: number[] = workflow.phases.map((phase) => {
      const stepCount = phase.steps.length;
      const lastStepBottom = stepCount > 0
        ? stepsStartY + (stepCount - 1) * (stepNodeH + stepGap) + stepNodeH
        : stepsStartY;
      return lastStepBottom + 15;
    });

    // Calculate X positions accounting for checkpoints between phases
    const phaseXPositions: number[] = [];
    let currentX = 0;
    workflow.phases.forEach((phase, pi) => {
      phaseXPositions.push(currentX);
      currentX += stepNodeW;
      if (phase.checkpoint) {
        currentX += checkpointGap + 50 + checkpointGap;
      } else {
        currentX += colGap;
      }
    });

    workflow.phases.forEach((phase, pi) => {
      const phaseId = `phase-${pi}`;
      const colX = phaseXPositions[pi];
      const isIterative = phase.iteration?.enabled;

      // Phase header
      nodes.push({
        id: phaseId,
        type: 'default',
        position: { x: colX, y: headerY },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div className={styles.phaseNode}>
              <div className={styles.phaseNumber}>{pi + 1}</div>
              <div className={styles.phaseName}>{phase.name}</div>
              {isIterative && <div className={styles.iterLabel}>🔄 max {phase.iteration!.maxIterations}</div>}
              <button className={styles.editBtn}
                onClick={(e) => { e.stopPropagation(); onSelectNode('phase', pi); }}>
                ✏️ 编辑
              </button>
            </div>
          ),
          phaseIndex: pi,
        },
        style: {
          background: '#3c3f41',
          border: isIterative ? '2px solid #4a88c7' : '2px solid #515151',
          borderLeft: isIterative ? '4px solid #4a88c7' : '4px solid #4a88c7',
          borderRadius: '6px',
          padding: '10px 14px',
          width: stepNodeW,
          minHeight: 50,
          cursor: 'pointer',
        },
        zIndex: 2,
      });

      // Checkpoint between this phase and next (placed at vertical center of group boxes)
      if (phase.checkpoint && pi < workflow.phases.length - 1) {
        const cpId = `checkpoint-${pi}`;
        const cpX = colX + stepNodeW + checkpointGap;
        const maxGroupH = Math.max(groupHeights[pi], groupHeights[pi + 1] || 0);
        const anchorCenterY = (maxGroupH - 10) / 2; // vertical center of group area

        // Invisible anchor on right edge of current group
        const anchorLeftId = `anchor-left-${pi}`;
        nodes.push({
          id: anchorLeftId,
          type: 'default',
          position: { x: colX + stepNodeW + 10, y: anchorCenterY },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: '' },
          style: { width: 1, height: 1, background: 'transparent', border: 'none', padding: 0, opacity: 0 },
          zIndex: 0,
          selectable: false,
          draggable: false,
        });

        // Checkpoint node — offset upward so its vertical center aligns with anchors
        const cpEstimatedH = 82; // approximate rendered height of checkpoint node
        nodes.push({
          id: cpId,
          type: 'default',
          position: { x: cpX, y: anchorCenterY - cpEstimatedH / 2 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: <div className={styles.checkpointNode}>✋ {phase.checkpoint.name}</div> },
          style: {
            background: '#3c3f41',
            border: '2px solid #cc7832',
            borderRadius: '4px',
            padding: '6px 8px',
            width: 50,
            textAlign: 'center' as const,
            lineHeight: '1.4',
            fontSize: '12px',
          },
          zIndex: 2,
        });

        // Invisible anchor on left edge of next group
        const nextColX = phaseXPositions[pi + 1];
        const anchorRightId = `anchor-right-${pi}`;
        nodes.push({
          id: anchorRightId,
          type: 'default',
          position: { x: nextColX - 11, y: anchorCenterY },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: '' },
          style: { width: 1, height: 1, background: 'transparent', border: 'none', padding: 0, opacity: 0 },
          zIndex: 0,
          selectable: false,
          draggable: false,
        });

        // Edge: left anchor → checkpoint
        edges.push({
          id: `${anchorLeftId}-${cpId}`,
          source: anchorLeftId, target: cpId,
          type: 'straight',
          style: { stroke: '#cc7832', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#cc7832' },
        });
        // Edge: checkpoint → right anchor
        edges.push({
          id: `${cpId}-${anchorRightId}`,
          source: cpId, target: anchorRightId,
          type: 'straight',
          style: { stroke: '#4a88c7', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#4a88c7' },
        });
      } else if (pi < workflow.phases.length - 1 && !phase.checkpoint) {
        edges.push({
          id: `inter-${pi}-${pi + 1}`,
          source: phaseId, target: `phase-${pi + 1}`,
          type: 'smoothstep',
          style: { stroke: '#4a88c7', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#4a88c7' },
        });
      }

      // Steps vertically below header
      phase.steps.forEach((step, si) => {
        const stepId = `step-${pi}-${si}`;
        const stepY = stepsStartY + si * (stepNodeH + stepGap);
        const roleColor = step.role === 'attacker' ? '#cc7832' : step.role === 'judge' ? '#ffc66d' : '#6897bb';

        nodes.push({
          id: stepId,
          type: 'default',
          position: { x: colX, y: stepY },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          data: {
            label: (
              <div className={styles.stepNode}>
                <div className={styles.stepHeader}>
                  {step.role ? (
                    <span className={styles.roleBadge}>
                      {step.role === 'attacker' ? '⚔️' : step.role === 'judge' ? '⚖️' : '🛡️'}
                    </span>
                  ) : (
                    <span className={styles.stepNumber}>{si + 1}</span>
                  )}
                  <span className={styles.stepName}>{step.name}</span>
                </div>
                <div className={styles.stepAgent}>
                  <span className={styles.agentIcon}>🤖</span>
                  <span>{step.agent}</span>
                </div>
                <button className={styles.editBtn}
                  onClick={(e) => { e.stopPropagation(); onSelectNode('step', pi, si); }}>
                  ✏️ 编辑
                </button>
              </div>
            ),
            phaseIndex: pi, stepIndex: si,
          },
          style: {
            background: '#313335',
            border: `2px solid ${roleColor}`,
            borderRadius: '8px',
            padding: '10px',
            width: stepNodeW,
            cursor: 'pointer',
          },
          zIndex: 1,
        });

        // Vertical edge: step → step (no edge from header, it's containment)
        if (si > 0) {
          edges.push({
            id: `step-${pi}-${si - 1}-${stepId}`,
            source: `step-${pi}-${si - 1}`, target: stepId,
            type: 'smoothstep',
            style: { stroke: roleColor, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: roleColor },
          });
        }
      });

      // Group background box for this phase column
      const groupHeight = groupHeights[pi];
      nodes.push({
        id: `group-${pi}`,
        type: 'default',
        position: { x: colX - 10, y: headerY - 10 },
        data: { label: '' },
        style: {
          background: 'rgba(74, 136, 199, 0.06)',
          border: '1px dashed #515151',
          borderRadius: '10px',
          width: stepNodeW + 20,
          height: groupHeight,
          pointerEvents: 'none' as const,
        },
        zIndex: -1,
        selectable: false,
        draggable: false,
        connectable: false,
      });
    });

    return { nodes, edges };
  }, [workflow, onSelectNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.data.stepIndex !== undefined) {
        onSelectNode('step', node.data.phaseIndex, node.data.stepIndex);
      } else if (node.data.phaseIndex !== undefined) {
        onSelectNode('phase', node.data.phaseIndex);
      }
    },
    [onSelectNode]
  );

  return (
    <div className={styles.flowContainer}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
      >
        <Background color="#515151" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('phase')) return '#4a88c7';
            if (node.id.startsWith('group')) return 'rgba(74, 136, 199, 0.2)';
            if (node.id.startsWith('checkpoint')) return '#cc7832';
            return '#313335';
          }}
          maskColor="rgba(0, 0, 0, 0.6)"
        />
      </ReactFlow>
    </div>
  );
}
