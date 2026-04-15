'use client';

import { useCallback, useMemo } from 'react';
import { workspaceApi, type TreeNode } from '@/lib/api';
import DirectoryTreePicker from '@/components/common/DirectoryTreePicker';

interface WorkspaceDirectoryPickerProps {
  workspaceRoot?: string;
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  className?: string;
}

function normalizeRoot(root: string): string {
  if (!root) return '/';
  return root.endsWith('/') && root !== '/' ? root.slice(0, -1) : root;
}

function toAbsolute(root: string, relative: string): string {
  if (!relative) return root;
  if (root === '/') return `/${relative}`;
  return `${root}/${relative}`;
}

function toRelative(root: string, absolute: string): string {
  const normalizedAbsolute = absolute.trim();
  if (!normalizedAbsolute || normalizedAbsolute === root) return '';
  if (root === '/') return normalizedAbsolute.replace(/^\/+/, '');
  if (normalizedAbsolute.startsWith(`${root}/`)) return normalizedAbsolute.slice(root.length + 1);
  return '';
}

export default function WorkspaceDirectoryPicker({
  workspaceRoot = '/',
  value,
  onChange,
  disabled = false,
  className,
}: WorkspaceDirectoryPickerProps) {
  const root = useMemo(() => normalizeRoot(workspaceRoot), [workspaceRoot]);
  const relativeValue = useMemo(() => toRelative(root, value), [root, value]);

  const loadRoot = useCallback(async (): Promise<TreeNode[]> => {
    const result = await workspaceApi.getTree(root, 2);
    return result.tree || [];
  }, [root]);

  const loadChildren = useCallback(async (path: string): Promise<TreeNode[]> => {
    const result = await workspaceApi.getSubTree(root, path, 2);
    return result.tree || [];
  }, [root]);

  return (
    <DirectoryTreePicker
      value={relativeValue}
      onChange={(relativePath) => onChange(toAbsolute(root, relativePath))}
      loadRoot={loadRoot}
      loadChildren={loadChildren}
      rootLabel={root === '/' ? '/' : `${root} /`}
      disabled={disabled}
      className={className}
    />
  );
}
