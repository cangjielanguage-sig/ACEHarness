'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { GitBranch, BarChart3, Activity, Clock } from 'lucide-react';
import StateTransitionTimeline from './StateTransitionTimeline';
import StateFlowVisualizer from './StateFlowVisualizer';
import StateMachineRuntimePanel from './StateMachineRuntimePanel';
import StateMachineDiagram from './StateMachineDiagram';
import type { StateTransitionRecord, Issue, StateMachineState } from '@/lib/schemas';

interface StateMachineExecutionViewProps {
  // 配置数据
  states: StateMachineState[];

  // 运行时数据
  currentState: string | null;
  currentStep?: string | null;
  completedSteps?: string[];
  stateHistory: StateTransitionRecord[];
  issueTracker: Issue[];
  transitionCount: number;
  maxTransitions: number;
  status: 'idle' | 'running' | 'completed' | 'failed';
  isRunning?: boolean;
  focusedState?: string | null; // 新增：用于视图跳转

  // 回调
  onStateClick?: (stateName: string) => void;
  onStepClick?: (step: any) => void;
  onForceTransition?: (targetState: string) => void;
}

export default function StateMachineExecutionView({
  states,
  currentState,
  currentStep,
  completedSteps = [],
  stateHistory,
  issueTracker,
  transitionCount,
  maxTransitions,
  status,
  isRunning = false,
  focusedState,
  onStateClick,
  onStepClick,
  onForceTransition,
}: StateMachineExecutionViewProps) {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span>总览</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>时序图</span>
          </TabsTrigger>
          <TabsTrigger value="flow" className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            <span>流转图</span>
          </TabsTrigger>
          <TabsTrigger value="diagram" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            <span>状态图</span>
          </TabsTrigger>
        </TabsList>

        {/* 总览视图 */}
        <TabsContent value="overview" className="flex-1 overflow-auto">
          <div className="space-y-6">
            {/* 实时统计面板 */}
            <StateMachineRuntimePanel
              currentState={currentState}
              stateHistory={stateHistory}
              issueTracker={issueTracker}
              transitionCount={transitionCount}
              maxTransitions={maxTransitions}
              status={status}
            />

            {/* 快速流转预览 */}
            {stateHistory.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold mb-4">最近流转</h3>
                <StateFlowVisualizer
                  stateHistory={stateHistory.slice(-10)}
                  currentState={currentState}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* 时序图视图 */}
        <TabsContent value="timeline" className="flex-1 overflow-auto">
          <StateTransitionTimeline
            stateHistory={stateHistory}
            currentState={currentState}
            status={status}
          />
        </TabsContent>

        {/* 流转图视图 */}
        <TabsContent value="flow" className="flex-1 overflow-auto">
          <StateFlowVisualizer
            stateHistory={stateHistory}
            currentState={currentState}
          />
        </TabsContent>

        {/* 状态图视图 */}
        <TabsContent value="diagram" className="flex-1 overflow-hidden">
          <div className="h-full">
            <StateMachineDiagram
              states={states}
              currentState={currentState}
              currentStep={currentStep}
              completedSteps={completedSteps}
              stateHistory={stateHistory}
              isRunning={isRunning}
              focusedState={focusedState}
              onStateClick={onStateClick}
              onStepClick={onStepClick}
              onForceTransition={onForceTransition}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
