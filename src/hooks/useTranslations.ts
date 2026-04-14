'use client';

import { useState, useEffect } from 'react';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh.json';

const messages: Record<string, any> = {
  en: enMessages,
  zh: zhMessages,
};

export function useTranslations() {
  const [locale, setLocale] = useState('zh');

  useEffect(() => {
    const saved = localStorage.getItem('locale') || 'zh';
    setLocale(saved);
  }, []);

  const t = (key: string): string => {
    const keys = key.split('.');
    let value: any = messages[locale];

    for (const k of keys) {
      value = value?.[k];
    }

    return value || key;
  };

  return { t, locale };
}
