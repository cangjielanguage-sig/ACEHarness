'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Copy, Download, Loader2, Save } from 'lucide-react';
import { workspaceApi, type NotebookScope } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

const RichNotebookEditor = dynamic(() => import('./RichNotebookEditor').then((mod) => mod.RichNotebookEditor), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full text-muted-foreground">加载 Notebook 编辑器...</div>,
});

interface NotebookEditorProps {
  filePath: string;
  content: string;
  onSave: (content: string) => Promise<void>;
  scope?: NotebookScope;
  shareToken?: string;
  permission?: 'read' | 'write';
  tocOpen?: boolean;
  onTocOpenChange?: (open: boolean) => void;
  dependencyGraphOpen?: boolean;
  onDependencyGraphOpenChange?: (open: boolean) => void;
}

export function NotebookEditor({
  filePath,
  content,
  onSave,
  scope = 'personal',
  shareToken,
  permission = 'write',
  tocOpen: tocOpenProp,
  onTocOpenChange,
  dependencyGraphOpen: dependencyGraphOpenProp,
  onDependencyGraphOpenChange,
}: NotebookEditorProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [editorContent, setEditorContent] = useState(content);
  const [savedContent, setSavedContent] = useState(content);
  const [tocOpenInner, setTocOpenInner] = useState(false);
  const [dependencyGraphOpenInner, setDependencyGraphOpenInner] = useState(false);
  const tocOpen = tocOpenProp ?? tocOpenInner;
  const dependencyGraphOpen = dependencyGraphOpenProp ?? dependencyGraphOpenInner;
  const handleTocOpenChange = onTocOpenChange ?? setTocOpenInner;
  const handleDependencyGraphOpenChange = onDependencyGraphOpenChange ?? setDependencyGraphOpenInner;

  useEffect(() => {
    setEditorContent(content);
    setSavedContent(content);
  }, [content]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(editorContent);
      setSavedContent(editorContent);
      toast('success', 'Notebook 已保存');
    } catch (error: any) {
      toast('error', error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [editorContent, onSave, saving, toast]);

  const handleRunCell = useCallback(async ({ code, cellId }: { pos: number; cellId: string; language: string; code: string }) => {
    try {
      const result = await workspaceApi.runCangjie(code, `${filePath.split('/').pop() || 'snippet'}.${cellId}.cj`, 'markdown');
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n') || '无输出';
      toast(result.success ? 'success' : 'error', result.success ? '运行完成' : '运行失败');
      return { output, success: result.success };
    } catch (error: any) {
      toast('error', error?.message || '运行失败');
      return { output: null, success: false };
    }
  }, [filePath, toast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([editorContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filePath.split('/').pop() || 'notebook.cj.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast('success', '文件已下载');
  }, [editorContent, filePath, toast]);

  const handleCopyShareLink = useCallback(async () => {
    if (scope !== 'global') {
      toast('warning', '个人 Notebook 不支持分享链接');
      return;
    }
    const path = '/notebook';
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    params.set('notebook', '1');
    params.set('notebookScope', scope);
    const shared = shareToken
      ? { token: shareToken, permission }
      : await workspaceApi.createNotebookShare(filePath, permission === 'read' ? 'read' : 'write', 'global');
    params.set('notebookFile', filePath);
    params.set('notebookShare', shared.token);
    params.set('notebookPermission', shared.permission);
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}${path}?${params.toString()}`;
    await navigator.clipboard.writeText(url);
    toast('success', 'Notebook 分享链接已复制');
  }, [filePath, permission, scope, shareToken, toast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const isDirty = editorContent !== savedContent;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-xs text-muted-foreground">
          <span className={isDirty ? 'text-amber-500' : 'text-emerald-500'}>{isDirty ? '未保存' : '已保存'}</span>
        </div>
        <div className="flex items-center gap-2">
          {scope === 'global' && (
            <Button size="sm" variant="outline" onClick={() => { void handleCopyShareLink(); }}>
              <Copy className="mr-1 h-4 w-4" />
              复制链接
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="mr-1 h-4 w-4" />
            下载
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {saving ? '保存中' : isDirty ? '保存' : '已保存'}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <RichNotebookEditor
          filePath={filePath}
          content={editorContent}
          onChange={setEditorContent}
          onRunCell={handleRunCell}
          scope={scope}
          shareToken={shareToken}
          permission={permission}
          tocOpen={tocOpen}
          onTocOpenChange={handleTocOpenChange}
          dependencyGraphOpen={dependencyGraphOpen}
          onDependencyGraphOpenChange={handleDependencyGraphOpenChange}
        />
      </div>
    </div>
  );
}
