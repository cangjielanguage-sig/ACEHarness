'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { Button } from '@/components/ui/button';

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
  storageKeyLeft = 'resizable-left-panel-width',
  storageKeyRight = 'resizable-right-panel-width',
}: ResizableThreePanelsProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [rightWidth, setRightWidth] = useState(defaultRightWidth);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load saved widths from localStorage
  useEffect(() => {
    const savedLeft = localStorage.getItem(storageKeyLeft);
    if (savedLeft) {
      const width = parseInt(savedLeft, 10);
      if (width >= minLeftWidth && width <= maxLeftWidth) {
        setLeftWidth(width);
      }
    }
    const savedRight = localStorage.getItem(storageKeyRight);
    if (savedRight) {
      const width = parseInt(savedRight, 10);
      if (width >= minRightWidth && width <= maxRightWidth) {
        setRightWidth(width);
      }
    }
  }, [storageKeyLeft, storageKeyRight, minLeftWidth, maxLeftWidth, minRightWidth, maxRightWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      if (isResizingLeft) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;

        if (newWidth >= minLeftWidth && newWidth <= maxLeftWidth) {
          setLeftWidth(newWidth);
          localStorage.setItem(storageKeyLeft, newWidth.toString());
        }
      }

      if (isResizingRight) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidth = containerRect.right - e.clientX;

        if (newWidth >= minRightWidth && newWidth <= maxRightWidth) {
          setRightWidth(newWidth);
          localStorage.setItem(storageKeyRight, newWidth.toString());
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    if (isResizingLeft || isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft, isResizingRight, minLeftWidth, maxLeftWidth, minRightWidth, maxRightWidth, storageKeyLeft, storageKeyRight]);

  return (
    <div ref={containerRef} className="flex-1 flex gap-0 overflow-hidden">
      {/* Left Panel */}
      <div
        className={`bg-card border-r flex flex-col transition-all duration-300 overflow-hidden ${
          leftCollapsed ? 'w-12' : ''
        }`}
        style={{ width: leftCollapsed ? '48px' : `${leftWidth}px` }}
      >
        {leftCollapsed ? (
          <div className="h-full flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeftCollapsed(false)}
              className="h-6 w-6"
            >
              <span className="material-symbols-outlined text-base">chevron_right</span>
            </Button>
          </div>
        ) : (
          leftPanel
        )}
      </div>

      {/* Left Resizer with collapse button */}
      {!leftCollapsed && (
        <div className="relative flex-shrink-0">
          <div
            className={`w-1 h-full hover:w-2 bg-border hover:bg-primary transition-all cursor-col-resize ${
              isResizingLeft ? 'bg-primary w-2' : ''
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingLeft(true);
            }}
          />
          <div className="absolute top-1/2 -translate-y-1/2 -right-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeftCollapsed(true)}
              className="h-6 w-6 bg-background/80 hover:bg-background border shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </Button>
          </div>
        </div>
      )}

      {/* Collapsed left button */}
      {leftCollapsed && (
        <div className="relative flex-shrink-0 w-0">
          <div className="absolute top-1/2 -translate-y-1/2 left-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeftCollapsed(false)}
              className="h-6 w-6 bg-background/80 hover:bg-background border shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </Button>
          </div>
        </div>
      )}

      {/* Center Panel */}
      <div className="flex-1 flex flex-col border-r overflow-hidden">
        {centerPanel}
      </div>

      {/* Right Resizer with collapse button */}
      {!rightCollapsed && (
        <div className="relative flex-shrink-0">
          <div
            className={`w-1 h-full hover:w-2 bg-border hover:bg-primary transition-all cursor-col-resize ${
              isResizingRight ? 'bg-primary w-2' : ''
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingRight(true);
            }}
          />
          <div className="absolute top-1/2 -translate-y-1/2 -left-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRightCollapsed(true)}
              className="h-6 w-6 bg-background/80 hover:bg-background border shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </Button>
          </div>
        </div>
      )}

      {/* Collapsed right button */}
      {rightCollapsed && (
        <div className="relative flex-shrink-0 w-0">
          <div className="absolute top-1/2 -translate-y-1/2 -left-7">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRightCollapsed(false)}
              className="h-6 w-6 bg-background/80 hover:bg-background border shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </Button>
          </div>
        </div>
      )}

      {/* Right Panel */}
      <div
        className={`flex flex-col transition-all duration-300 overflow-hidden ${
          rightCollapsed ? 'w-0' : ''
        }`}
        style={{ width: rightCollapsed ? '0px' : `${rightWidth}px` }}
      >
        {!rightCollapsed && rightPanel}
      </div>
    </div>
  );
}
