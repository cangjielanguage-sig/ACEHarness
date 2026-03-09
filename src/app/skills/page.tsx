'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Search, ArrowLeft, RefreshCw, ExternalLink, FileText, Tag, Calendar, User } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import Markdown from '@/components/Markdown';

interface Skill {
  name: string;
  path: string;
  description: string;
  tags: string[];
  platforms?: string[];
  version?: string;
  updatedAt?: string;
  contributors?: string[];
  detailedDescription?: string;
}

export default function SkillsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const { toast } = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/skills');
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSkills(data.skills || []);
      }
    } catch (err) {
      setError('加载 skills 失败');
    } finally {
      setLoading(false);
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

  const filteredSkills = skills.filter(skill =>
    skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回首页
              </Button>
              <div className="h-6 w-px bg-border" />
              <div>
                <h1 className="text-2xl font-bold">Skills 管理</h1>
                <p className="text-xs text-muted-foreground">管理和查看可用的 Skills</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
              <Button variant="outline" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? '同步中...' : '同步'}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索 skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Skills Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-muted-foreground">加载中...</div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={loadSkills}>重试</Button>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? '没有找到匹配的 skills' : '暂无 skills，请确保 skills 仓库已克隆'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSkills.map((skill, index) => (
              <motion.div
                key={skill.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => setSelectedSkill(skill)}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold">{skill.name}</h3>
                  {skill.version && (
                    <Badge variant="secondary">v{skill.version}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{skill.description}</p>

                {skill.tags && skill.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {skill.tags.map((tag) => (
                      <span key={tag} className="text-xs px-2 py-1 bg-secondary rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {skill.updatedAt && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {skill.updatedAt}
                    </span>
                  )}
                  {skill.contributors && skill.contributors.length > 0 && (
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {skill.contributors.join(', ')}
                    </span>
                  )}
                </div>
              </motion.div>
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
                </h3>
                <p className="text-sm text-muted-foreground mt-1">{selectedSkill.description}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedSkill(null)}>✕</Button>
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