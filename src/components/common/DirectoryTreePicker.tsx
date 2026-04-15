'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder, Loader2 } from 'lucide-react';
import type { TreeNode } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DirectoryTreePickerProps {
  value: string;
  onChange: (path: string) => void;
  loadRoot: () => Promise<TreeNode[]>;
  loadChildren: (path: string) => Promise<TreeNode[]>;
  rootLabel?: string;
  disabled?: boolean;
  className?: string;
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  const dirs = nodes
    .filter((node) => node.type === 'directory')
    .map((node) => ({
      ...node,
      children: node.children ? sortTree(node.children) : node.children,
    }));
  return dirs.sort((a, b) => a.name.localeCompare(b.name));
}

function replaceNodeChildren(nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.type !== 'directory') return node;
    if (node.path === targetPath) {
      return { ...node, children: sortTree(children) };
    }
    if (!node.children) return node;
    return { ...node, children: replaceNodeChildren(node.children, targetPath, children) };
  });
}

export default function DirectoryTreePicker({
  value,
  onChange,
  loadRoot,
  loadChildren,
  rootLabel = '根目录 /',
  disabled = false,
  className,
}: DirectoryTreePickerProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [pathInput, setPathInput] = useState(value);

  const refreshRoot = useCallback(async () => {
    setLoadingRoot(true);
    try {
      const nodes = await loadRoot();
      setTree(sortTree(nodes || []));
      setExpanded(new Set(['']));
    } finally {
      setLoadingRoot(false);
    }
  }, [loadRoot]);

  useEffect(() => {
    void refreshRoot();
  }, [refreshRoot]);

  useEffect(() => {
    setPathInput(value);
  }, [value]);

  const hasNodeInTree = useMemo(() => {
    if (!value) return true;
    const queue: TreeNode[] = [...tree];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || node.type !== 'directory') continue;
      if (node.path === value) return true;
      if (node.children?.length) queue.push(...node.children);
    }
    return false;
  }, [tree, value]);

  useEffect(() => {
    if (!value || hasNodeInTree) return;
    const segments = value.split('/').filter(Boolean);
    const next = new Set<string>(['']);
    let current = '';
    segments.forEach((seg) => {
      current = current ? `${current}/${seg}` : seg;
      next.add(current);
    });
    setExpanded(next);
  }, [hasNodeInTree, value]);

  const handleLoadChildren = useCallback(async (path: string) => {
    setLoadingPaths((prev) => new Set(prev).add(path));
    try {
      const children = await loadChildren(path);
      setTree((prev) => replaceNodeChildren(prev, path, children || []));
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [loadChildren]);

  const expandAndSelectPath = useCallback(async (rawPath: string) => {
    const normalized = rawPath.replace(/^\/+|\/+$/g, '');
    if (!normalized) {
      onChange('');
      setExpanded(new Set(['']));
      return;
    }
    const segments = normalized.split('/').filter(Boolean);
    let current = '';
    const nextExpanded = new Set<string>(['']);
    for (const seg of segments) {
      current = current ? `${current}/${seg}` : seg;
      nextExpanded.add(current);
      await handleLoadChildren(current);
    }
    setExpanded(nextExpanded);
    onChange(normalized);
  }, [handleLoadChildren, onChange]);

  const toggleExpand = useCallback((path: string, hasLoadedChildren: boolean | undefined) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (path && !hasLoadedChildren) {
          void handleLoadChildren(path);
        }
      }
      return next;
    });
  }, [handleLoadChildren]);

  const renderTree = useCallback((nodes: TreeNode[], depth: number): React.ReactNode => {
    return nodes
      .filter((node) => node.type === 'directory')
      .map((node) => {
        const isExpanded = expanded.has(node.path);
        const isSelected = value === node.path;
        const isLoading = loadingPaths.has(node.path);
        const hasLoadedChildren = Array.isArray(node.children);
        const children: TreeNode[] = Array.isArray(node.children) ? node.children : [];
        const canExpand = isLoading || (hasLoadedChildren ? children.length > 0 : true);

        return (
          <div key={node.path}>
            <button
              type="button"
              className={cn(
                'inline-flex h-7 w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1 text-left text-sm hover:bg-accent',
                isSelected && 'bg-accent text-accent-foreground'
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              disabled={disabled}
              onClick={() => onChange(node.path)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!canExpand) return;
                toggleExpand(node.path, hasLoadedChildren);
              }}
            >
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!canExpand) return;
                  toggleExpand(node.path, hasLoadedChildren);
                }}
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : hasLoadedChildren && children.length === 0 ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                ) : (
                  <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
                )}
              </span>
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
            </button>
            {isExpanded && hasLoadedChildren && children.length > 0 ? (
              <div>{renderTree(children, depth + 1)}</div>
            ) : null}
          </div>
        );
      });
  }, [disabled, expanded, loadingPaths, onChange, toggleExpand, value]);

  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-md border bg-background', className)}>
      <div className="flex items-center gap-2 border-b p-2">
        <input
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void expandAndSelectPath(pathInput);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          placeholder="输入目录路径并回车定位"
          disabled={disabled}
        />
        <button
          type="button"
          className="h-7 shrink-0 rounded border px-2 text-xs hover:bg-accent disabled:opacity-50"
          disabled={disabled}
          onClick={() => void expandAndSelectPath(pathInput)}
        >
          定位
        </button>
      </div>
      <button
        type="button"
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-1 overflow-hidden px-2 text-left text-sm hover:bg-accent',
          value === '' && 'bg-accent text-accent-foreground'
        )}
        disabled={disabled}
        onClick={() => onChange('')}
      >
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{rootLabel}</span>
      </button>
      <div className="min-h-0 flex-1 overflow-auto border-t p-1">
        {loadingRoot ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在加载目录...
          </div>
        ) : (
          renderTree(tree, 0)
        )}
      </div>
    </div>
  );
}
