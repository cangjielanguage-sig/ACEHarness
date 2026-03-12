'use client';

import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface SessionSummaryItem {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
}

export default function ChatSidebar() {
  const { sessions, activeSessionId, setActiveSessionId, createSession, deleteSession, renameSession, skillSettings, discoveredSkills, toggleSkill } = useChat();

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <span className="text-sm font-semibold">会话</span>
        <Button size="sm" variant="ghost" onClick={() => createSession()} title="新建会话">
          <span className="material-symbols-outlined text-sm">add</span>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">暂无会话</div>
        )}
        {sessions.map(session => (
          <SessionItem
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            onClick={() => setActiveSessionId(session.id)}
            onDelete={() => deleteSession(session.id)}
            onRename={(title) => renameSession(session.id, title)}
          />
        ))}
      </div>
      {/* Skills 开关区域 */}
      {discoveredSkills.length > 0 && (
        <div className="border-t p-3">
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="material-symbols-outlined text-sm text-muted-foreground">extension</span>
            <span className="text-xs font-semibold text-muted-foreground">Skills</span>
          </div>
          <div className="space-y-2.5">
            {discoveredSkills.map(skill => (
              <div key={skill.name} className="flex items-center justify-between" title={skill.description}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-sm text-blue-400">extension</span>
                  <span className="text-xs truncate">{skill.label}</span>
                </div>
                <Switch
                  checked={!!skillSettings[skill.name]}
                  onCheckedChange={() => toggleSkill(skill.name)}
                  className="scale-75"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionItem({ session, active, onClick, onDelete, onRename }: {
  session: SessionSummaryItem;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const summary = session.lastMessage?.slice(0, 40) || '空会话';

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-border/30 hover:bg-muted/50 transition-colors ${active ? 'bg-muted' : ''}`}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{session.title}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">{summary}</div>
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
          {new Date(session.updatedAt).toLocaleString()}
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="删除会话"
      >
        <span className="material-symbols-outlined text-xs">delete</span>
      </Button>
    </div>
  );
}
