'use client';

import { ReactNode, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { usePanelRef, useDefaultLayout } from 'react-resizable-panels';

interface ResizableThreePanelsProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;
  storageKeyLeft?: string;
  storageKeyRight?: string;
}

export default function ResizablePanels({
  leftPanel,
  centerPanel,
  rightPanel,
  defaultLeftWidth = 280,
  defaultRightWidth = 400,
  minLeftWidth = 200,
  maxLeftWidth = 500,
  minRightWidth = 300,
  maxRightWidth = 800,
}: ResizableThreePanelsProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();

  // Convert pixel defaults to approximate percentages (assume ~1400px viewport)
  const totalEstimate = 1400;
  const leftDefault = `${Math.round((defaultLeftWidth / totalEstimate) * 100)}%`;
  const rightDefault = `${Math.round((defaultRightWidth / totalEstimate) * 100)}%`;
  const centerDefault = `${100 - Math.round((defaultLeftWidth / totalEstimate) * 100) - Math.round((defaultRightWidth / totalEstimate) * 100)}%`;

  const leftMin = `${Math.round((minLeftWidth / totalEstimate) * 100)}%`;
  const leftMax = `${Math.round((maxLeftWidth / totalEstimate) * 100)}%`;
  const rightMin = `${Math.round((minRightWidth / totalEstimate) * 100)}%`;
  const rightMax = `${Math.round((maxRightWidth / totalEstimate) * 100)}%`;

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "workbench-panels",
  });

  const toggleLeftCollapse = useCallback(() => {
    if (leftCollapsed) {
      leftPanelRef.current?.expand();
    } else {
      leftPanelRef.current?.collapse();
    }
  }, [leftCollapsed, leftPanelRef]);

  const toggleRightCollapse = useCallback(() => {
    if (rightCollapsed) {
      rightPanelRef.current?.expand();
    } else {
      rightPanelRef.current?.collapse();
    }
  }, [rightCollapsed, rightPanelRef]);

  const handleLeftResize = useCallback(() => {
    setLeftCollapsed(leftPanelRef.current?.isCollapsed() ?? false);
  }, [leftPanelRef]);

  const handleRightResize = useCallback(() => {
    setRightCollapsed(rightPanelRef.current?.isCollapsed() ?? false);
  }, [rightPanelRef]);

  return (
    <ResizablePanelGroup id="workbench-panels" orientation="horizontal" className="flex-1" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel
        id="wb-left"
        panelRef={leftPanelRef}
        defaultSize={leftDefault}
        minSize={leftMin}
        maxSize={leftMax}
        collapsible
        collapsedSize="3%"
        onResize={handleLeftResize}
        className="bg-card"
      >
        {leftCollapsed ? (
          <div className="h-full flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLeftCollapse}
              className="h-6 w-6"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>chevron_right</span>
            </Button>
          </div>
        ) : (
          leftPanel
        )}
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel id="wb-center" defaultSize={centerDefault} minSize="20%">
        <div className="flex flex-col h-full overflow-hidden">
          {centerPanel}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel
        id="wb-right"
        panelRef={rightPanelRef}
        defaultSize={rightDefault}
        minSize={rightMin}
        maxSize={rightMax}
        collapsible
        collapsedSize="0%"
        onResize={handleRightResize}
      >
        {rightCollapsed ? (
          <div className="h-full flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleRightCollapse}
              className="h-6 w-6"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>chevron_left</span>
            </Button>
          </div>
        ) : (
          rightPanel
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
