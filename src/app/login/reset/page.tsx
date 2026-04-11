'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RobotLogo } from '@/components/chat/ChatMessage';
import { ArrowLeft } from 'lucide-react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'answer'>('email');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGetQuestion = async () => {
    setError('');
    if (!email) { setError('请输入邮箱'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, step: 'question' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setQuestion(data.question);
      setStep('answer');
    } catch { setError('请求失败'); } finally { setLoading(false); }
  };

  const handleReset = async () => {
    setError(''); setSuccess('');
    if (!answer) { setError('请输入密保答案'); return; }
    if (newPassword.length < 6) { setError('密码至少6个字符'); return; }
    if (newPassword !== confirmPassword) { setError('两次密码不一致'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, answer, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setSuccess('密码重置成功，即将跳转登录页...');
      setTimeout(() => router.push('/login'), 2000);
    } catch { setError('请求失败'); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <RobotLogo size={48} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold">找回密码</h1>
          <p className="text-sm text-muted-foreground mt-1">通过密保问题重置密码</p>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-4">
          {step === 'email' ? (
            <>
              <Input placeholder="请输入注册邮箱" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleGetQuestion} disabled={loading}>
                {loading ? '查询中...' : '下一步'}
              </Button>
            </>
          ) : (
            <>
              <div className="p-3 rounded-lg bg-muted text-sm">
                <span className="text-muted-foreground">密保问题：</span>{question}
              </div>
              <Input placeholder="密保答案" value={answer} onChange={e => setAnswer(e.target.value)} />
              <Input placeholder="新密码（至少6位）" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              <Input placeholder="确认新密码" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              {error && <p className="text-sm text-destructive">{error}</p>}
              {success && <p className="text-sm text-green-500">{success}</p>}
              <Button className="w-full" onClick={handleReset} disabled={loading}>
                {loading ? '重置中...' : '重置密码'}
              </Button>
            </>
          )}
        </div>

        <div className="text-center">
          <Button variant="link" onClick={() => router.push('/login')}>
            <ArrowLeft className="w-4 h-4 mr-1" />返回登录
          </Button>
        </div>
      </div>
    </div>
  );
}
