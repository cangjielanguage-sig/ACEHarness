'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Search, ArrowLeft, RefreshCw, FileText, Tag, Calendar, User, Download, Puzzle, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import Markdown from '@/components/Markdown';

interface Skill {
  name: string;
  path: string;
  description: string;
  descriptionZh?: string;
  tags: string[];
  platforms?: string[];
  version?: string;
  updatedAt?: string;
  contributors?: string[];
  detailedDescription?: string;
  source?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  cangjie: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  anthropics: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

export default function SkillsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const { toast } = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingAnthropic, setSyncingAnthropic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [autoCloning, setAutoCloning] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/skills');
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else if (!data.isCloned) {
        await autoCloneSkills();
      } else {
        setSkills(data.skills || []);
      }
    } catch (err) {
      setError('加载 skills 失败');
    } finally {
      setLoading(false);
    }
  };

  const autoCloneSkills = async () => {
    setAutoCloning(true);
    try {
      const response = await fetch('/api/skills', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        const reloadResponse = await fetch('/api/skills');
        const reloadData = await reloadResponse.json();
        if (reloadData.error) {
          setError(reloadData.error);
        } else {
          setSkills(reloadData.skills || []);
        }
      } else {
        setError(data.error || '自动拉取 Skills 仓库失败');
      }
    } catch (err) {
      setError('自动拉取 Skills 仓库失败');
    } finally {
      setAutoCloning(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/skills', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        toast('success', 'Skills 仓库已同步');
        await loadSkills();
      } else {
        toast('error', data.error || '更新失败');
      }
    } catch (err) {
      toast('error', '更新失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAnthropic = async () => {
    setSyncingAnthropic(true);
    try {
      const response = await fetch('/api/skills', { method: 'PUT' });
      const data = await response.json();
      if (data.success) {
        toast('success', data.message || 'Anthropics Skills 已更新');
        await loadSkills();
      } else {
        toast('error', data.error || '更新失败');
      }
    } catch (err) {
      toast('error', '从 Anthropics 更新失败');
    } finally {
      setSyncingAnthropic(false);
    }
  };

  // Get all unique tags
  const allTags = useMemo(() =>
    Array.from(new Set(skills.flatMap(s => s.tags || []))).sort(),
    [skills]
  );

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  // Filter skills
  const filteredSkills = useMemo(() => {
    return skills.filter(skill => {
      if (selectedSource !== 'all' && (skill.source || 'cangjie') !== selectedSource) return false;
      if (selectedTags.length > 0 && !selectedTags.some(tag => skill.tags?.includes(tag))) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          skill.name.toLowerCase().includes(q) ||
          skill.description.toLowerCase().includes(q) ||
          (skill.descriptionZh || '').toLowerCase().includes(q) ||
          skill.tags?.some(tag => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [skills, selectedSource, selectedTags, searchQuery]);

  // Group by source
  const groupedSkills = useMemo(() => ({
    cangjie: filteredSkills.filter(s => (s.source || 'cangjie') === 'cangjie'),
    anthropics: filteredSkills.filter(s => s.source === 'anthropics'),
  }), [filteredSkills]);

  const sourceLabels: Record<string, string> = { cangjie: 'Cangjie', anthropics: 'Anthropics' };
  const sourceIcons: Record<string, string> = { cangjie: '🔧', anthropics: '✨' };

  const getDisplayDescription = (skill: Skill) => {
    return skill.descriptionZh || skill.description;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="h-14 border-b bg-card flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => {
            if (window.history.length > 1) {
              router.back();
            } else {
              router.push('/');
            }
          }}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回
          </Button>
          <h1 className="text-lg font-semibold">Skills 管理</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleSyncAnthropic} disabled={syncingAnthropic}>
            <Download className={`w-4 h-4 mr-1 ${syncingAnthropic ? 'animate-bounce' : ''}`} />
            {syncingAnthropic ? '更新中...' : '从官方更新'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同步中...' : '同步仓库'}
          </Button>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* Filters */}
      <div className="border-b bg-card p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="搜索 Skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />

          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground">来源:</span>
            <Button
              size="sm"
              variant={selectedSource === 'all' ? 'default' : 'outline'}
              onClick={() => setSelectedSource('all')}
            >
              全部 ({skills.length})
            </Button>
            <Button
              size="sm"
              variant={selectedSource === 'cangjie' ? 'default' : 'outline'}
              onClick={() => setSelectedSource('cangjie')}
              className={selectedSource === 'cangjie' ? SOURCE_COLORS.cangjie : ''}
            >
              Cangjie ({skills.filter(s => (s.source || 'cangjie') === 'cangjie').length})
            </Button>
            <Button
              size="sm"
              variant={selectedSource === 'anthropics' ? 'default' : 'outline'}
              onClick={() => setSelectedSource('anthropics')}
              className={selectedSource === 'anthropics' ? SOURCE_COLORS.anthropics : ''}
            >
              Anthropics ({skills.filter(s => s.source === 'anthropics').length})
            </Button>
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="flex gap-2 items-center mt-3 flex-wrap">
            <span className="text-sm text-muted-foreground shrink-0">标签:</span>
            <div className="flex flex-wrap gap-1">
              {allTags.map(tag => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading || autoCloning ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">
              {autoCloning ? '正在拉取 Skills 仓库，请稍候...' : '加载中...'}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={loadSkills}>重试</Button>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <span className="material-symbols-outlined text-5xl mb-4">extension</span>
            <p>{searchQuery ? '没有找到匹配的 Skills' : '暂无 Skills'}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {(['cangjie', 'anthropics'] as const).map(source => (
              groupedSkills[source].length > 0 && (
                <div key={source}>
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <span>{sourceIcons[source]}</span>
                    {sourceLabels[source]}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({groupedSkills[source].length})
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {groupedSkills[source].map((skill, index) => (
                      <motion.div
                        key={skill.name}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className={`bg-card border rounded-lg p-4 hover:shadow-lg transition-all cursor-pointer border-l-4 ${
                          source === 'anthropics' ? 'border-l-orange-500 bg-orange-500/5' : 'border-l-blue-500 bg-blue-500/5'
                        }`}
                        onClick={() => setSelectedSkill(skill)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-semibold text-sm">{skill.name}</h3>
                          {skill.version && (
                            <Badge variant="secondary" className="text-[10px] shrink-0">v{skill.version}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                          {getDisplayDescription(skill)}
                        </p>

                        {skill.tags && skill.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {skill.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-secondary rounded">
                                {tag}
                              </span>
                            ))}
                            {skill.tags.length > 3 && (
                              <span className="text-[10px] text-muted-foreground">+{skill.tags.length - 3}</span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          {skill.updatedAt && (
                            <span className="flex items-center gap-0.5">
                              <Calendar className="w-3 h-3" />
                              {skill.updatedAt}
                            </span>
                          )}
                          {skill.contributors && skill.contributors.length > 0 && (
                            <span className="flex items-center gap-0.5">
                              <User className="w-3 h-3" />
                              {skill.contributors.join(', ')}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </div>

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setSelectedSkill(null)}>
          <div className="bg-card rounded-lg w-[800px] max-w-[90%] max-h-[80vh] overflow-hidden border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  {selectedSkill.name}
                  {selectedSkill.version && <Badge variant="secondary">v{selectedSkill.version}</Badge>}
                  {selectedSkill.source && (
                    <Badge variant="outline" className={SOURCE_COLORS[selectedSkill.source] || ''}>
                      {selectedSkill.source}
                    </Badge>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">{getDisplayDescription(selectedSkill)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedSkill(null)}>
                <span className="material-symbols-outlined text-sm">close</span>
              </Button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[60vh]">
              {/* Meta info */}
              <div className="flex flex-wrap gap-4 mb-6 text-sm">
                {selectedSkill.updatedAt && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    更新于 {selectedSkill.updatedAt}
                  </span>
                )}
                {selectedSkill.contributors && selectedSkill.contributors.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <User className="w-4 h-4" />
                    贡献者: {selectedSkill.contributors.join(', ')}
                  </span>
                )}
              </div>

              {/* Tags */}
              {selectedSkill.tags && selectedSkill.tags.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <Tag className="w-4 h-4" />
                    标签
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedSkill.tags.map((tag) => (
                      <span key={tag} className="text-xs px-3 py-1 bg-secondary rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Platforms */}
              {selectedSkill.platforms && selectedSkill.platforms.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium mb-2">支持平台</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedSkill.platforms.map((platform) => (
                      <span key={platform} className="text-xs px-3 py-1 bg-muted rounded">
                        {platform}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Detailed description */}
              {selectedSkill.detailedDescription && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    详细说明
                  </h4>
                  <div className="p-4 bg-muted rounded-lg text-sm">
                    <Markdown>{selectedSkill.detailedDescription}</Markdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
