'use client';

import { ReactNode, useState, useCallback, useEffect } from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ResizableThreePanelsProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
}

export default function ResizablePanels({
  leftPanel,
  centerPanel,
  rightPanel,
}: ResizableThreePanelsProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'three-panels',
  });
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  // Sync collapsed state on mount (for restored layouts)
  useEffect(() => {
    setLeftCollapsed(leftPanelRef.current?.isCollapsed() ?? false);
    setRightCollapsed(rightPanelRef.current?.isCollapsed() ?? false);
  }, [leftPanelRef, rightPanelRef]);

  const toggleLeft = useCallback(() => {
    const panel = leftPanelRef.current;
    if (!panel) return;
    panel.isCollapsed() ? panel.expand() : panel.collapse();
  }, [leftPanelRef]);

  const toggleRight = useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    panel.isCollapsed() ? panel.expand() : panel.collapse();
  }, [rightPanelRef]);

  return (
    <ResizablePanelGroup
      id="three-panels"
      orientation="horizontal"
      className="h-full"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="left-panel"
        panelRef={leftPanelRef}
        defaultSize="20%"
        minSize="12%"
        maxSize="35%"
        collapsible
        collapsedSize="0%"
        onResize={() => setLeftCollapsed(leftPanelRef.current?.isCollapsed() ?? false)}
      >
        {leftPanel}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        collapsed={leftCollapsed}
        onClickHandle={toggleLeft}
        handleIcon={leftCollapsed
          ? <ChevronRight className="h-2.5 w-2.5" />
          : <ChevronLeft className="h-2.5 w-2.5" />
        }
      />
      <ResizablePanel id="center-panel" defaultSize="50%" minSize="30%">
        {centerPanel}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        collapsed={rightCollapsed}
        onClickHandle={toggleRight}
        handleIcon={rightCollapsed
          ? <ChevronLeft className="h-2.5 w-2.5" />
          : <ChevronRight className="h-2.5 w-2.5" />
        }
      />
      <ResizablePanel
        id="right-panel"
        panelRef={rightPanelRef}
        defaultSize="30%"
        minSize="15%"
        maxSize="50%"
        collapsible
        collapsedSize="0%"
        onResize={() => setRightCollapsed(rightPanelRef.current?.isCollapsed() ?? false)}
      >
        {rightPanel}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
