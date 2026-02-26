'use client';

import { useState, useEffect } from 'react';
import { runsApi } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

export default function DocumentsPanel({ runId }: DocumentsPanelProps) {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<DocFile | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

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

  // Group by stepName to show iterations together
  const grouped: { stepName: string; phaseName: string; files: DocFile[] }[] = [];
  const stepOrder: string[] = [];
  const stepMap: Record<string, DocFile[]> = {};
  for (const f of files) {
    const key = f.stepName;
    if (!stepMap[key]) {
      stepMap[key] = [];
      stepOrder.push(key);
    }
    stepMap[key].push(f);
  }
  for (const key of stepOrder) {
    const group = stepMap[key];
    group.sort((a, b) => (a.iteration || 0) - (b.iteration || 0));
    grouped.push({ stepName: key, phaseName: group[0].phaseName, files: group });
  }

  // Group by phase
  const phaseGroups: Record<string, typeof grouped> = {};
  for (const g of grouped) {
    const phase = g.phaseName || '其他文档';
    if (!phaseGroups[phase]) phaseGroups[phase] = [];
    phaseGroups[phase].push(g);
  }

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
      {/* File list */}
      <div className={`${selectedFile ? 'max-h-[45%]' : 'flex-1'} overflow-y-auto p-3 space-y-3`}>
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-8">加载文档列表...</div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <span className="material-symbols-outlined text-3xl mb-2">folder_open</span>
            <p className="text-sm">暂无产出文档</p>
          </div>
        ) : (
          Object.entries(phaseGroups).map(([phase, stepGroups]) => (
            <div key={phase}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="material-symbols-outlined text-xs text-muted-foreground">folder</span>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{phase}</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                  {stepGroups.reduce((n, g) => n + g.files.length, 0)}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {stepGroups.map((group) => (
                  <div key={group.stepName} className="space-y-0.5">
                    {group.files.map((f) => {
                      const role = f.role || '';
                      const isSelected = selectedFile?.filename === f.filename;
                      return (
                        <button key={f.filename}
                          className={`w-full text-left rounded-md border p-2 transition-colors ${
                            isSelected ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/40'
                          }`}
                          onClick={() => selectFile(f)}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {role && (
                              <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium ${roleBadge[role] || 'bg-muted text-muted-foreground'}`}>
                                <span className="material-symbols-outlined" style={{ fontSize: 10 }}>{roleIcon[role] || 'article'}</span>
                                {role}
                              </span>
                            )}
                            <span className="text-xs font-medium truncate flex-1">{f.baseName}</span>
                            {f.iteration != null && f.iteration > 1 && (
                              <Badge variant="outline" className="text-[9px] h-3.5 px-1">v{f.iteration}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {f.agent && (
                              <span className="flex items-center gap-0.5">
                                <span className="material-symbols-outlined" style={{ fontSize: 10 }}>smart_toy</span>{f.agent}
                              </span>
                            )}
                            <span>{(f.size / 1024).toFixed(1)} KB</span>
                            <span>{new Date(f.modifiedTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={loadFiles} disabled={loading}>
          <span className="material-symbols-outlined text-xs mr-1">refresh</span>刷新
        </Button>
      </div>
      {/* Markdown preview */}
      {selectedFile && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border-t">
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted shrink-0">
            <span className="material-symbols-outlined text-sm">article</span>
            <span className="text-xs font-semibold flex-1 truncate">{selectedFile.baseName}</span>
            <span className="text-[10px] text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setSelectedFile(null); setContent(''); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
            </Button>
          </div>
          <div className={`${styles.markdownContent} flex-1 overflow-y-auto p-4`}>
            {loadingContent ? (
              <div className="text-sm text-muted-foreground text-center py-8">加载中...</div>
            ) : (
              <Markdown>{content}</Markdown>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
