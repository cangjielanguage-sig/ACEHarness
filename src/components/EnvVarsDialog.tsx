'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

export default function EnvVarsDialog({ onClose }: { onClose: () => void }) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/env').then(r => r.json()).then(data => {
      setVars(data.vars || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/env', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: vars.filter(v => v.key.trim()) }),
      });
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const addRow = () => setVars(prev => [...prev, { key: '', value: '', enabled: true }]);

  const updateVar = (index: number, patch: Partial<EnvVar>) => {
    setVars(prev => prev.map((v, i) => i === index ? { ...v, ...patch } : v));
  };

  const removeVar = (index: number) => {
    setVars(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">key</span>
            <h2 className="text-base font-semibold">环境变量管理</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-8">加载中...</div>
          ) : (
            <div className="space-y-2">
              {/* CangjieMagic 环境变量提示 */}
              <div className="bg-muted/50 border border-border/50 rounded-lg p-3 mb-3">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">🔮 CangjieMagic 所需环境变量</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <code className="font-mono text-primary/80">CANGJIE_HOME</code>
                  <span>仓颉 SDK 根目录</span>
                  <code className="font-mono text-primary/80">CANGJIE_MAGIC_PATH</code>
                  <span>CangjieMagic 项目路径</span>
                  <code className="font-mono text-primary/80">OPENSSL_PATH</code>
                  <span>OpenSSL 动态库路径</span>
                  <code className="font-mono text-primary/80">CANGJIE_STDX_PATH</code>
                  <span>stdx 动态库路径</span>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_1fr_48px_32px] gap-2 text-xs text-muted-foreground font-medium px-1">
                <span>Key</span>
                <span>Value</span>
                <span className="text-center">启用</span>
                <span></span>
              </div>
              {vars.map((v, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_48px_32px] gap-2 items-center">
                  <Input
                    value={v.key}
                    onChange={e => updateVar(i, { key: e.target.value })}
                    placeholder="KEY"
                    className="h-8 text-xs font-mono"
                  />
                  <Input
                    value={v.value}
                    onChange={e => updateVar(i, { value: e.target.value })}
                    placeholder="value"
                    className="h-8 text-xs font-mono"
                  />
                  <div className="flex justify-center">
                    <Switch
                      checked={v.enabled}
                      onCheckedChange={checked => updateVar(i, { enabled: checked })}
                      className="scale-75"
                    />
                  </div>
                  <button
                    onClick={() => removeVar(i)}
                    className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                  </button>
                </div>
              ))}
              {vars.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4">暂无环境变量</div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t">
          <Button variant="outline" size="sm" onClick={addRow}>
            <span className="material-symbols-outlined mr-1" style={{ fontSize: '14px' }}>add</span>
            添加
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
