'use client';

import { useRouter } from 'next/navigation';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface UserMenuProps {
  user: {
    username: string;
    email: string;
    role: 'admin' | 'user';
    avatar?: string;
  } | null;
}

export default function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();

  const handleLogout = async () => {
    const token = localStorage.getItem('auth-token');
    if (token) {
      await fetch('/api/auth/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('auth-token');
    localStorage.removeItem('auth-user');
    router.push('/login');
  };

  if (!user) return null;

  const initials = user.username?.charAt(0)?.toUpperCase() || '?';

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full hover:opacity-80 transition-opacity focus:outline-none">
          <Avatar className="h-8 w-8">
            {user.avatar ? (
              <AvatarImage src={`/avatar/${user.avatar}`} alt={user.username} />
            ) : null}
            <AvatarFallback className="text-xs bg-primary/20 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium hidden sm:inline">{user.username}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.username}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/account')}>
          <span className="material-symbols-outlined text-sm mr-2">person</span>
          账户设置
        </DropdownMenuItem>
        {user.role === 'admin' && (
          <DropdownMenuItem onClick={() => router.push('/users')}>
            <span className="material-symbols-outlined text-sm mr-2">group</span>
            用户管理
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <span className="material-symbols-outlined text-sm mr-2">logout</span>
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
