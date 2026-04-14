'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface ToastContextValue {
  toast: (type: Toast['type'], message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((type: Toast['type'], message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const iconMap = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
  const colorMap = {
    success: 'bg-green-600 text-white',
    error: 'bg-destructive text-destructive-foreground',
    info: 'bg-primary text-primary-foreground',
    warning: 'bg-yellow-600 text-white',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div key={t.id}
            className={`${colorMap[t.type]} rounded-lg px-4 py-3 shadow-lg flex items-start gap-2 animate-in slide-in-from-right-5 text-sm cursor-pointer`}
            onClick={() => dismiss(t.id)}>
            <span className="material-symbols-outlined text-base mt-0.5">{iconMap[t.type]}</span>
            <span className="flex-1 leading-relaxed">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
