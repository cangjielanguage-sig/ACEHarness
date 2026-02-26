'use client';

import { useState, useEffect, useMemo } from 'react';
import { runsApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
type GroupBy = 'none' | 'phase' | 'step' | 'role';

const roleBadge: Record<string, string> = {
  attacker: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  defender: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  judge: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
};

const roleIcon: Record<string, string> = {
  attacker: 'swords',
  defender: 'shield',
  judge: 'gavel',
};

const roleLabel: Record<string, string> = {
  attacker: '攻击方',
  defender: '防守方',
  judge: '裁判',
};

export default function DocumentsPanel({ runId }: DocumentsPanelProps) {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<DocFile | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  // Filters and sorting
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [groupBy, setGroupBy] = useState<GroupBy>('phase');
  const [filterPhase, setFilterPhase] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');

  useEffect(() => {
    if (!runId) return;
    loadFiles();
  }, [runId]);

  const loadFiles = async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await runsApi.listDocuments(runId);
      setFiles(data.files || []);
    } catch {
      setFiles([]);
    }
    setLoading(false);
  };

  const selectFile = async (file: DocFile) => {
    if (!runId) return;
    setSelectedFile(file);
    setLoadingContent(true);
    try {
      const { content: c } = await runsApi.getDocumentContent(runId, file.filename);
      setContent(c);
    } catch {
      setContent('(无法加载文档内容)');
    }
    setLoadingContent(false);
  };

  // Get unique phases and roles for filters
  const phases = useMemo(() => {
    const uniquePhases = Array.from(new Set(files.map(f => f.phaseName).filter(Boolean)));
    return uniquePhases.sort();
  }, [files]);

  const roles = useMemo(() => {
    return Array.from(new Set(files.map(f => f.role).filter(Boolean)));
  }, [files]);

  // Filter and sort files
  const processedFiles = useMemo(() => {
    let filtered = [...files];

    // Apply filters
    if (filterPhase !== 'all') {
      filtered = filtered.filter(f => f.phaseName === filterPhase);
    }
    if (filterRole !== 'all') {
      filtered = filtered.filter(f => f.role === filterRole);
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.baseName.localeCompare(b.baseName);
          break;
        case 'time':
          comparison = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'phase':
          comparison = (a.phaseName || '').localeCompare(b.phaseName || '');
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [files, filterPhase, filterRole, sortField, sortOrder]);

  // Group files
  const groupedFiles = useMemo(() => {
    if (groupBy === 'none') {
      return { '所有文档': processedFiles };
    }

    const groups: Record<string, DocFile[]> = {};
    processedFiles.forEach(file => {
      let key = '';
      switch (groupBy) {
        case 'phase':
          key = file.phaseName || '其他';
          break;
        case 'step':
          key = file.stepName;
          break;
        case 'role':
          key = roleLabel[file.role] || file.role || '未知';
          break;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(file);
    });

    return groups;
  }, [processedFiles, groupBy]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <span className="material-symbols-outlined text-5xl mb-4">description</span>
        <p>启动工作流后查看产出文档</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="h-8 text-xs w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不分组</SelectItem>
              <SelectItem value="phase">按阶段</SelectItem>
              <SelectItem value="step">按步骤</SelectItem>
              <SelectItem value="role">按角色</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterPhase} onValueChange={setFilterPhase}>
            <SelectTrigger className="h-8 text-xs w-[110px]">
              <SelectValue placeholder="筛选阶段" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有阶段</SelectItem>
              {phases.map(phase => (
                <SelectItem key={phase} value={phase}>{phase}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="h-8 text-xs w-[100px]">
              <SelectValue placeholder="筛选角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有角色</SelectItem>
              {roles.map(role => (
                <SelectItem key={role} value={role}>{roleLabel[role] || role}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={loadFiles} disabled={loading}>
            <span className="material-symbols-outlined text-sm mr-1">refresh</span>刷新
          </Button>
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-8">加载文档列表...</div>
        ) : processedFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <span className="material-symbols-outlined text-3xl mb-2">folder_open</span>
            <p className="text-sm">暂无产出文档</p>
          </div>
        ) : (
          <div className="p-3 space-y-4">
            {Object.entries(groupedFiles).map(([groupName, groupFiles]) => (
              <div key={groupName}>
                {groupBy !== 'none' && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-sm text-muted-foreground">folder</span>
                    <span className="text-sm font-semibold">{groupName}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {groupFiles.length}
                    </Badge>
                  </div>
                )}

                {/* Table */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium cursor-pointer hover:bg-muted/70" onClick={() => toggleSort('name')}>
                          <div className="flex items-center gap-1">
                            文档名称
                            {sortField === 'name' && (
                              <span className="material-symbols-outlined text-xs">
                                {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                              </span>
                            )}
                          </div>
                        </th>
                        {groupBy !== 'phase' && (
                          <th className="text-left p-2 font-medium cursor-pointer hover:bg-muted/70 w-24" onClick={() => toggleSort('phase')}>
                            <div className="flex items-center gap-1">
                              阶段
                              {sortField === 'phase' && (
                                <span className="material-symbols-outlined text-xs">
                                  {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                                </span>
                              )}
                            </div>
                          </th>
                        )}
                        {groupBy !== 'role' && (
                          <th className="text-left p-2 font-medium w-20">角色</th>
                        )}
                        <th className="text-left p-2 font-medium w-16">迭代</th>
                        <th className="text-right p-2 font-medium cursor-pointer hover:bg-muted/70 w-20" onClick={() => toggleSort('size')}>
                          <div className="flex items-center justify-end gap-1">
                            大小
                            {sortField === 'size' && (
                              <span className="material-symbols-outlined text-xs">
                                {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                              </span>
                            )}
                          </div>
                        </th>
                        <th className="text-right p-2 font-medium cursor-pointer hover:bg-muted/70 w-32" onClick={() => toggleSort('time')}>
                          <div className="flex items-center justify-end gap-1">
                            修改时间
                            {sortField === 'time' && (
                              <span className="material-symbols-outlined text-xs">
                                {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                              </span>
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupFiles.map((file) => (
                        <tr
                          key={file.filename}
                          className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => selectFile(file)}
                        >
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-sm text-muted-foreground">description</span>
                              <span className="truncate">{file.baseName}</span>
                            </div>
                          </td>
                          {groupBy !== 'phase' && (
                            <td className="p-2">
                              <span className="text-muted-foreground">{file.phaseName || '-'}</span>
                            </td>
                          )}
                          {groupBy !== 'role' && (
                            <td className="p-2">
                              {file.role && (
                                <Badge variant="secondary" className={`text-[10px] h-5 px-1.5 ${roleBadge[file.role]}`}>
                                  <span className="material-symbols-outlined text-[10px] mr-0.5">{roleIcon[file.role]}</span>
                                  {roleLabel[file.role]}
                                </Badge>
                              )}
                            </td>
                          )}
                          <td className="p-2 text-center">
                            {file.iteration ? (
                              <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                                #{file.iteration}
                              </Badge>
                            ) : '-'}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {new Date(file.modifiedTime).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal for document content */}
      <Dialog open={!!selectedFile} onOpenChange={(open) => { if (!open) { setSelectedFile(null); setContent(''); } }}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base">article</span>
              <span className="flex-1 truncate">{selectedFile?.baseName}</span>
              <span className="text-xs text-muted-foreground font-normal">{selectedFile ? (selectedFile.size / 1024).toFixed(1) : 0} KB</span>
            </DialogTitle>
          </DialogHeader>
          <div className={`${styles.markdownContent} flex-1 overflow-y-auto pr-2`}>
            {loadingContent ? (
              <div className="text-sm text-muted-foreground text-center py-8">加载中...</div>
            ) : (
              <Markdown>{content}</Markdown>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

