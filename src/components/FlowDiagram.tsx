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
  MarkerType,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import styles from './FlowDiagram.module.css';

// --- SVG status & role icons ---
const IconCheck = () => (
  <svg className={styles.statusIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="#6a8759" opacity="0.2" />
    <circle cx="8" cy="8" r="7" stroke="#6a8759" strokeWidth="1.5" fill="none" />
    <path d="M4.5 8.2 7 10.5 11.5 5.5" stroke="#6a8759" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
const IconFail = () => (
  <svg className={styles.statusIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="#c75450" opacity="0.2" />
    <circle cx="8" cy="8" r="7" stroke="#c75450" strokeWidth="1.5" fill="none" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#c75450" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const IconRunning = () => (
  <svg className={`${styles.statusIcon} ${styles.spinIcon}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="#4a88c7" strokeWidth="1.5" opacity="0.25" fill="none" />
    <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="#4a88c7" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </svg>
);
const IconPending = () => (
  <svg className={styles.statusIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="#515151" strokeWidth="1.5" fill="none" />
    <circle cx="5.5" cy="8" r="1" fill="#515151" />
    <circle cx="8" cy="8" r="1" fill="#515151" />
    <circle cx="10.5" cy="8" r="1" fill="#515151" />
  </svg>
);
const IconAttacker = () => (
  <svg className={styles.roleBadge} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5 L10 6 L15 6.5 L11 10 L12.5 15 L8 12 L3.5 15 L5 10 L1 6.5 L6 6 Z" fill="#cc7832" opacity="0.25" stroke="#cc7832" strokeWidth="1" />
    <path d="M8 4v5M6 7h4" stroke="#cc7832" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IconDefender = () => (
  <svg className={styles.roleBadge} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5C5.5 3 3 3.5 3 3.5s0 4.5 1.5 7c1 1.7 2.5 3 3.5 3.5 1-.5 2.5-1.8 3.5-3.5C13 8 13 3.5 13 3.5S10.5 3 8 1.5z" fill="#6897bb" opacity="0.2" stroke="#6897bb" strokeWidth="1.2" />
    <path d="M6.5 8.2 7.8 9.5 10 6.5" stroke="#6897bb" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
const IconJudge = () => (
  <svg className={styles.roleBadge} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 8h10M8 3v10" stroke="#ffc66d" strokeWidth="0.8" opacity="0.3" />
    <circle cx="8" cy="8" r="6" stroke="#ffc66d" strokeWidth="1.2" fill="none" />
    <path d="M5 6.5 L8 4 L11 6.5" stroke="#ffc66d" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <rect x="5" y="8" width="6" height="3" rx="0.5" stroke="#ffc66d" strokeWidth="1" fill="#ffc66d" opacity="0.2" />
    <path d="M8 8v3" stroke="#ffc66d" strokeWidth="0.8" />
  </svg>
);
const IconAgent = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
    <rect x="3" y="2" width="8" height="6" rx="2" stroke="#808080" strokeWidth="1.2" fill="none" />
    <circle cx="5.5" cy="5" r="0.8" fill="#808080" />
    <circle cx="8.5" cy="5" r="0.8" fill="#808080" />
    <path d="M4 10c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v1.5H4V10z" stroke="#808080" strokeWidth="1" fill="none" />
  </svg>
);

interface Step {
  name: string;
  agent: string;
  task: string;
  role?: 'attacker' | 'defender' | 'judge';
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

interface Agent {
  name: string;
  team: string;
}

interface IterationStateInfo {
  phaseName: string;
  currentIteration: number;
  maxIterations: number;
  status: string;
}

interface FlowDiagramProps {
  workflow: Workflow;
  currentPhase: string;
  currentStep: string;
  agents: Agent[];
  completedSteps: string[];
  failedSteps?: string[];
  iterationStates?: Record<string, IterationStateInfo>;
  onSelectStep: (step: Step) => void;
}

export default function FlowDiagram({
  workflow, currentPhase, currentStep, agents, completedSteps,
  failedSteps = [], iterationStates = {}, onSelectStep,
}: FlowDiagramProps) {
  const getAgentTeam = (agentName: string) => {
    return agents?.find((a) => a.name === agentName)?.team || 'blue';
  };

  const getStepStatus = (step: Step) => {
    if (failedSteps?.includes(step.name)) return 'failed';
    if (currentStep === step.name) return 'running';
    if (completedSteps?.includes(step.name)) return 'completed';
    return 'pending';
  };

  // Horizontal column layout: phases as columns, steps stacked vertically
  // Checkpoints placed horizontally between phase columns
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
    const stepsStartY = phaseHeaderH + 30;

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
      // If this phase has a checkpoint, add space for it
      if (phase.checkpoint) {
        currentX += checkpointGap + 50 + checkpointGap; // gap + checkpoint width + gap
      } else {
        currentX += colGap;
      }
    });

    workflow.phases.forEach((phase, pi) => {
      const phaseId = `phase-${pi}`;
      const colX = phaseXPositions[pi];
      const isActive = currentPhase === phase.name;
      const isDone = phase.steps.every((s) => completedSteps?.includes(s.name));
      const iterState = iterationStates[phase.name];
      const isIterative = phase.iteration?.enabled;

      // Phase header node
      nodes.push({
        id: phaseId,
        type: 'default',
        position: { x: colX, y: headerY },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div className={`${styles.phaseNode} ${isActive ? styles.activePhase : ''}`}>
              <div className={styles.phaseNumber}>{pi + 1}</div>
              <div className={styles.phaseName}>{phase.name}</div>
              {isIterative && (
                <div className={styles.iterationBadge}>
                  🔄 {iterState ? `${iterState.currentIteration}/${iterState.maxIterations}` : `max ${phase.iteration!.maxIterations}`}
                </div>
              )}
            </div>
          ),
        },
        style: {
          background: isActive ? '#2d3f50' : isDone ? '#2d4a2d' : '#3c3f41',
          border: isActive ? '2px solid #4a88c7' : isDone ? '2px solid #6a8759' : '2px solid #515151',
          borderLeft: isActive ? '4px solid #4a88c7' : isDone ? '4px solid #6a8759' : '4px solid #4a88c7',
          borderRadius: '6px',
          padding: '10px 14px',
          width: stepNodeW,
          minHeight: 50,
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
        // Direct inter-phase edge (horizontal)
        edges.push({
          id: `inter-${pi}-${pi + 1}`,
          source: phaseId, target: `phase-${pi + 1}`,
          type: 'smoothstep',
          animated: isActive,
          style: { stroke: isDone ? '#6a8759' : '#4a88c7', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: isDone ? '#6a8759' : '#4a88c7' },
        });
      }

      // Steps vertically below header
      phase.steps.forEach((step, si) => {
        const stepId = `step-${pi}-${si}`;
        const status = getStepStatus(step);
        const team = getAgentTeam(step.agent);
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
              <div className={`${styles.stepNode} ${styles[status]} ${styles[team]} ${status === 'running' ? styles.pulseGlow : ''}`}>
                <div className={styles.stepHeader}>
                  {step.role ? (
                    <span className={`${styles.roleBadgeWrap} ${styles[step.role]}`}>
                      {step.role === 'attacker' ? <IconAttacker /> : step.role === 'judge' ? <IconJudge /> : <IconDefender />}
                    </span>
                  ) : (
                    <span className={styles.stepNumber}>{si + 1}</span>
                  )}
                  <span className={styles.stepName}>{step.name}</span>
                  {status === 'completed' && <IconCheck />}
                  {status === 'failed' && <IconFail />}
                  {status === 'running' && <IconRunning />}
                  {status === 'pending' && <IconPending />}
                </div>
                <div className={styles.stepAgent}>
                  <IconAgent />
                  <span>{step.agent}</span>
                </div>
                {status === 'running' && (
                  <div className={styles.stepProgress}><div className={styles.progressBar}></div></div>
                )}
              </div>
            ),
            step,
          },
          style: { background: 'transparent', border: 'none', padding: 0, width: stepNodeW, cursor: 'pointer' },
          zIndex: 1,
        });

        // Vertical edge: step → step (no edge from header, it's containment)
        if (si > 0) {
          edges.push({
            id: `step-${pi}-${si - 1}-${stepId}`,
            source: `step-${pi}-${si - 1}`, target: stepId,
            type: 'smoothstep',
            animated: status === 'running',
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
  }, [workflow, currentPhase, currentStep, completedSteps, failedSteps, agents, iterationStates]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.data.step) onSelectStep(node.data.step);
    },
    [onSelectStep]
  );

  return (
    <div className={styles.flowContainer}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
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
