'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { runsApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import ConfirmDialog from '@/components/ConfirmDialog';
import Markdown from '@/components/Markdown';
import styles from '@/app/workbench/[config]/page.module.css';

interface DocFile {
  filename: string;
  stepName: string;
  baseName: string;
  iteration: number | null;
  agent: string;
  phaseName: string;
  role: string;
  size: number;
  modifiedTime: string;
}

interface DocumentsPanelProps {
  runId: string | null;
}

type SortField = 'name' | 'time' | 'size' | 'phase';
type SortOrder = 'asc' | 'desc';
type GroupBy = 'none' | 'phase' | 'role';

const roleBadge: Record<string, string> = {
  attacker: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  defender: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  judge: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
};
const roleIcon: Record<string, string> = { attacker: 'swords', defender: 'shield', judge: 'gavel' };
const roleLabel: Record<string, string> = { attacker: '攻击方', defender: '防守方', judge: '裁判' };

export default function DocumentsPanel({ runId }: DocumentsPanelProps) {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Sorting / filtering
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [groupBy, setGroupBy] = useState<GroupBy>('phase');
  const [filterPhase, setFilterPhase] = useState('all');
  const [filterRole, setFilterRole] = useState('all');

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Preview
  const [previewFile, setPreviewFile] = useState<DocFile | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Rename
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);

  const loadFiles = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await runsApi.listDocuments(runId);
      setFiles(data.files || []);
    } catch { setFiles([]); }
    setLoading(false);
  }, [runId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const phases = useMemo(() => Array.from(new Set(files.map(f => f.phaseName).filter(Boolean))).sort(), [files]);
  const roles = useMemo(() => Array.from(new Set(files.map(f => f.role).filter(Boolean))), [files]);

  const processedFiles = useMemo(() => {
    let filtered = [...files];
    if (filterPhase !== 'all') filtered = filtered.filter(f => f.phaseName === filterPhase);
    if (filterRole !== 'all') filtered = filtered.filter(f => f.role === filterRole);
    filtered.sort((a, b) => {
      let c = 0;
      if (sortField === 'name') c = a.baseName.localeCompare(b.baseName);
      else if (sortField === 'time') c = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
      else if (sortField === 'size') c = a.size - b.size;
      else if (sortField === 'phase') c = (a.phaseName || '').localeCompare(b.phaseName || '');
      return sortOrder === 'asc' ? c : -c;
    });
    return filtered;
  }, [files, filterPhase, filterRole, sortField, sortOrder]);

  const groupedFiles = useMemo(() => {
    if (groupBy === 'none') return { '所有文档': processedFiles };
    const groups: Record<string, DocFile[]> = {};
    processedFiles.forEach(f => {
      const key = groupBy === 'phase' ? (f.phaseName || '其他') : (roleLabel[f.role] || f.role || '未知');
      (groups[key] ||= []).push(f);
    });
    return groups;
  }, [processedFiles, groupBy]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const selectFile = async (file: DocFile) => {
    if (!runId) return;
    setPreviewFile(file);
    setLoadingPreview(true);
    try {
      const { content } = await runsApi.getDocumentContent(runId, file.filename);
      setPreviewContent(content);
    } catch { setPreviewContent('(无法加载)'); }
    setLoadingPreview(false);
  };

  const toggleSelect = (filename: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(filename) ? next.delete(filename) : next.add(filename);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selected.size === processedFiles.length) setSelected(new Set());
    else setSelected(new Set(processedFiles.map(f => f.filename)));
  };

  const handleRename = async (file: string) => {
    if (!runId || !renameValue.trim()) return;
    try {
      await runsApi.renameDocument(runId, file, renameValue.trim());
      setRenamingFile(null);
      loadFiles();
    } catch { /* toast? */ }
  };

  const handleDelete = async (filenames: string[]) => {
    if (!runId) return;
    try {
      await runsApi.deleteDocuments(runId, filenames);
      setDeleteTarget(null);
      setSelected(prev => { const n = new Set(prev); filenames.forEach(f => n.delete(f)); return n; });
      if (previewFile && filenames.includes(previewFile.filename)) { setPreviewFile(null); setPreviewContent(''); }
      loadFiles();
    } catch { /* toast? */ }
  };

  const downloadFile = (file: DocFile) => {
    const blob = new Blob([previewContent || ''], { type: 'text/markdown;charset=utf-8' });
    // If we don't have content loaded, fetch it first
    if (!previewContent || previewFile?.filename !== file.filename) {
      runsApi.getDocumentContent(runId!, file.filename).then(({ content }) => {
        const b = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        triggerDownload(b, file.filename);
      });
    } else {
      triggerDownload(blob, file.filename);
    }
  };

  const triggerDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <span className="material-symbols-outlined text-5xl mb-4">description</span>
        <p>启动工作流后查看产出文档</p>
      </div>
    );
  }

  const toolbar = (compact?: boolean) => (
    <div className={`flex items-center gap-2 flex-wrap ${compact ? 'p-2' : 'p-3'}`}>
      <Select value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
        <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">不分组</SelectItem>
          <SelectItem value="phase">按阶段</SelectItem>
          <SelectItem value="role">按角色</SelectItem>
        </SelectContent>
      </Select>
      {phases.length > 1 && (
        <Select value={filterPhase} onValueChange={setFilterPhase}>
          <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue placeholder="筛选阶段" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有阶段</SelectItem>
            {phases.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <div className="flex-1" />
      {selected.size > 0 && (
        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => setDeleteTarget(Array.from(selected))}>
          <span className="material-symbols-outlined text-sm mr-1">delete</span>删除 ({selected.size})
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadFiles} disabled={loading}>
        <span className="material-symbols-outlined text-sm">refresh</span>
      </Button>
      {compact && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setModalOpen(true)} title="弹出文件管理器">
          <span className="material-symbols-outlined text-sm">open_in_new</span>
        </Button>
      )}
      {!compact && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFullscreen(f => !f)} title={fullscreen ? '退出全屏' : '全屏'}>
          <span className="material-symbols-outlined text-sm">{fullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
        </Button>
      )}
    </div>
  );

  const fileRow = (file: DocFile, compact: boolean) => {
    const isRenaming = renamingFile === file.filename;
    const isSelected = selected.has(file.filename);
    const isActive = previewFile?.filename === file.filename;

    if (compact) {
      // Embedded mode: just show name, click opens modal with preview
      return (
        <div
          key={file.filename}
          className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 border-b border-border/30"
          onClick={() => { setModalOpen(true); selectFile(file); }}
        >
          <span className="material-symbols-outlined text-sm text-muted-foreground shrink-0">description</span>
          <span className="truncate flex-1" title={file.filename}>{file.baseName}</span>
        </div>
      );
    }

    // Full mode (inside modal)
    return (
      <div
        key={file.filename}
        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 border-b border-border/30 ${isActive ? 'bg-accent' : ''}`}
        onClick={() => !isRenaming && selectFile(file)}
      >
        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(file.filename)} onClick={e => e.stopPropagation()} className="h-3.5 w-3.5" />
        <span className="material-symbols-outlined text-sm text-muted-foreground shrink-0">description</span>
        {isRenaming ? (
          <Input
            autoFocus
            className="h-6 text-xs flex-1 min-w-0"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(file.filename); if (e.key === 'Escape') setRenamingFile(null); }}
            onBlur={() => setRenamingFile(null)}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 min-w-0" title={file.filename}>{file.baseName}</span>
        )}
        {file.role && (
          <Badge variant="secondary" className={`text-[9px] h-4 px-1 shrink-0 ${roleBadge[file.role] || ''}`}>
            <span className="material-symbols-outlined text-[9px] mr-0.5">{roleIcon[file.role]}</span>
            {roleLabel[file.role]}
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">{(file.size / 1024).toFixed(1)}K</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0"><span className="material-symbols-outlined text-sm">more_vert</span></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={e => { e.stopPropagation(); setRenamingFile(file.filename); setRenameValue(file.baseName); }}>
              <span className="material-symbols-outlined text-sm mr-2">edit</span>重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => { e.stopPropagation(); downloadFile(file); }}>
              <span className="material-symbols-outlined text-sm mr-2">download</span>下载
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); setDeleteTarget([file.filename]); }}>
              <span className="material-symbols-outlined text-sm mr-2">delete</span>删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const fileList = (compact: boolean) => (
    <div className="flex-1 overflow-y-auto">
      {loading && <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>}
      {!loading && processedFiles.length === 0 && (
        <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>
      )}
      {!loading && Object.entries(groupedFiles).map(([group, gFiles]) => (
        <div key={group}>
          {groupBy !== 'none' && (
            <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/30 border-b border-border/30 sticky top-0 z-10">
              {group} ({gFiles.length})
            </div>
          )}
          {!compact && groupBy === 'none' && processedFiles.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground border-b border-border/30">
              <Checkbox checked={selected.size === processedFiles.length && processedFiles.length > 0} onCheckedChange={toggleSelectAll} className="h-3 w-3" />
              <span>全选</span>
            </div>
          )}
          {gFiles.map(f => fileRow(f, compact))}
        </div>
      ))}
    </div>
  );

  const previewPane = () => (
    <div className="flex-1 flex flex-col overflow-hidden border-l border-border">
      {previewFile ? (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20 shrink-0">
            <span className="material-symbols-outlined text-sm">description</span>
            <span className="text-xs font-medium truncate flex-1">{previewFile.filename}</span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => downloadFile(previewFile)}>
              <span className="material-symbols-outlined text-sm">download</span>
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setPreviewFile(null); setPreviewContent(''); }}>
              <span className="material-symbols-outlined text-sm">close</span>
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loadingPreview ? (
              <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>
            ) : (
              <div className={styles.markdownBody}><Markdown>{previewContent}</Markdown></div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <span className="material-symbols-outlined text-4xl mb-2">preview</span>
          <p className="text-xs">点击文件预览内容</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Embedded compact mode */}
      <div className="flex flex-col h-full">
        {toolbar(true)}
        {fileList(true)}
      </div>

      {/* Popup modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => { setModalOpen(open); if (!open) setFullscreen(false); }}>
        <DialogContent className={`p-0 flex flex-col gap-0 ${fullscreen ? 'max-w-none w-screen h-screen rounded-none' : 'max-w-5xl w-[90vw] h-[80vh]'}`}>
          <div className="border-b border-border">
            {toolbar(false)}
          </div>
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[420px] shrink-0 flex flex-col overflow-hidden border-r border-border">
              {fileList(false)}
            </div>
            {previewPane()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={deleteTarget?.length === 1 ? `确定要删除 "${deleteTarget[0]}" 吗？` : `确定要删除选中的 ${deleteTarget?.length || 0} 个文件吗？`}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
