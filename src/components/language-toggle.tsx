'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

type Locale = 'zh' | 'en';

const LOCALE_STORAGE_KEY = 'locale';

function normalizeLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh';
}

function applyLocale(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
}

export function LanguageToggle() {
  const [locale, setLocale] = useState<Locale>('zh');

  useEffect(() => {
    const saved = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY) || document.documentElement.lang || 'zh');
    applyLocale(saved);
    setLocale(saved);
  }, []);

  const toggleLocale = async () => {
    const newLocale: Locale = locale === 'zh' ? 'en' : 'zh';
    setLocale(newLocale);
    applyLocale(newLocale);

    try {
      await fetch('/api/system-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locale: newLocale }),
      });
    } catch {
      // ignore persistence failures in the client toggle
    }

    window.location.reload();
  };

  return (
    <Button variant="outline" size="sm" onClick={toggleLocale}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>
        language
      </span>
      {locale === 'zh' ? 'EN' : '中文'}
    </Button>
  );
}
