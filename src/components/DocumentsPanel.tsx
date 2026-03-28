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
import { useTranslations } from '@/hooks/useTranslations';
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

type SortField = 'name' | 'time' | 'size';
type SortOrder = 'asc' | 'desc';

const roleBadge: Record<string, string> = {
  attacker: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  defender: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  judge: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
};
const roleIcon: Record<string, string> = { attacker: 'swords', defender: 'shield', judge: 'gavel' };
const roleLabel: Record<string, string> = { attacker: '攻击方', defender: '防守方', judge: '裁判' };

/** Extract group name from filename: "根因定位-定位空指针路径.md" → "根因定位" */
function getFileGroup(filename: string): string {
  const base = filename.replace(/\.md$/i, '');
  // Strip ISO timestamp prefix like "2026-03-20T14-30-00-" from conclusion files
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, '');
  const idx = stripped.indexOf('-');
  if (idx > 0) return stripped.substring(0, idx);
  return stripped || '其他';
}

export default function DocumentsPanel({ runId }: DocumentsPanelProps) {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Sorting / filtering
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null); // null = all

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

  // Build groups from filenames
  const groups = useMemo(() => {
    const map: Record<string, DocFile[]> = {};
    files.forEach(f => {
      const g = getFileGroup(f.filename);
      (map[g] ||= []).push(f);
    });
    return map;
  }, [files]);

  const groupNames = useMemo(() => Object.keys(groups).sort(), [groups]);

  // Filtered + sorted files
  const processedFiles = useMemo(() => {
    let filtered = activeGroup ? (groups[activeGroup] || []) : [...files];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.filename.toLowerCase().includes(q) || f.baseName.toLowerCase().includes(q));
    }
    filtered.sort((a, b) => {
      let c = 0;
      if (sortField === 'name') c = a.baseName.localeCompare(b.baseName);
      else if (sortField === 'time') c = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
      else if (sortField === 'size') c = a.size - b.size;
      return sortOrder === 'asc' ? c : -c;
    });
    return filtered;
  }, [files, groups, activeGroup, searchQuery, sortField, sortOrder]);

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

  // --- Left sidebar: folder tree ---
  const folderTree = () => (
    <div className="w-48 shrink-0 border-r border-border bg-muted/20 flex flex-col overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border/50">文件夹</div>
      <div className="flex-1 overflow-y-auto">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 ${activeGroup === null ? 'bg-accent text-accent-foreground font-medium' : ''}`}
          onClick={() => setActiveGroup(null)}
        >
          <span className="material-symbols-outlined text-sm">folder</span>
          <span className="flex-1">全部文件</span>
          <span className="text-[10px] text-muted-foreground">{files.length}</span>
        </div>
        {groupNames.map(g => (
          <div
            key={g}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 ${activeGroup === g ? 'bg-accent text-accent-foreground font-medium' : ''}`}
            onClick={() => setActiveGroup(g)}
          >
            <span className="material-symbols-outlined text-sm">folder</span>
            <span className="flex-1 truncate">{g}</span>
            <span className="text-[10px] text-muted-foreground">{groups[g]?.length || 0}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // --- Toolbar ---
  const toolbar = (compact?: boolean) => (
    <div className={`flex items-center gap-2 flex-wrap ${compact ? 'p-2' : 'p-3'}`}>
      {!compact && (
        <Input
          placeholder="搜索文件..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-7 text-xs w-40"
        />
      )}
      {!compact && (
        <Select value={sortField} onValueChange={v => { setSortField(v as SortField); }}>
          <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">按名称</SelectItem>
            <SelectItem value="time">按时间</SelectItem>
            <SelectItem value="size">按大小</SelectItem>
          </SelectContent>
        </Select>
      )}
      {!compact && (
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} title={sortOrder === 'asc' ? '升序' : '降序'}>
          <span className="material-symbols-outlined text-sm">{sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
        </Button>
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

  // --- File row ---
  const fileRow = (file: DocFile, compact: boolean) => {
    const isRenaming = renamingFile === file.filename;
    const isSelected = selected.has(file.filename);
    const isActive = previewFile?.filename === file.filename;

    if (compact) {
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
        <span className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">{new Date(file.modifiedTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
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

  // --- File list ---
  const fileList = (compact: boolean) => (
    <div className="flex-1 overflow-y-auto">
      {loading && <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>}
      {!loading && processedFiles.length === 0 && (
        <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>
      )}
      {!loading && !compact && processedFiles.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground border-b border-border/30 bg-muted/20">
          <Checkbox checked={selected.size === processedFiles.length && processedFiles.length > 0} onCheckedChange={toggleSelectAll} className="h-3 w-3" />
          <span className="flex-1 cursor-pointer" onClick={() => toggleSort('name')}>
            文件名 {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-14 text-right cursor-pointer" onClick={() => toggleSort('size')}>
            大小 {sortField === 'size' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-20 text-right cursor-pointer" onClick={() => toggleSort('time')}>
            时间 {sortField === 'time' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-5" />
        </div>
      )}
      {!loading && processedFiles.map(f => fileRow(f, compact))}
    </div>
  );

  // --- Compact embedded: show folder groups + files ---
  const compactView = () => (
    <div className="flex-1 overflow-y-auto">
      {loading && <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>}
      {!loading && files.length === 0 && (
        <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>
      )}
      {!loading && groupNames.map(g => (
        <div key={g}>
          <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/30 border-b border-border/30 sticky top-0 z-10">
            <span className="material-symbols-outlined text-xs">folder</span>
            {g} ({groups[g]?.length || 0})
          </div>
          {(groups[g] || []).map(f => fileRow(f, true))}
        </div>
      ))}
    </div>
  );

  // --- Preview pane ---
  const previewPane = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
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
        <div className="flex items-center gap-2 p-2">
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadFiles} disabled={loading}>
            <span className="material-symbols-outlined text-sm">refresh</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setModalOpen(true)} title="弹出文件管理器">
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </Button>
        </div>
        {compactView()}
      </div>

      {/* Popup modal — Explorer style */}
      <Dialog open={modalOpen} onOpenChange={(open) => { setModalOpen(open); if (!open) setFullscreen(false); }}>
        <DialogContent className={`p-0 flex flex-col gap-0 ${fullscreen ? 'max-w-none w-screen h-screen rounded-none' : 'max-w-5xl w-[90vw] h-[80vh]'}`}>
          <div className="border-b border-border">
            {toolbar(false)}
          </div>
          <div className="flex flex-1 overflow-hidden">
            {!fullscreen && folderTree()}
            {!fullscreen && (
              <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
                {fileList(false)}
              </div>
            )}
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
