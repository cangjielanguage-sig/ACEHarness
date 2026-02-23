'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

export function LanguageToggle() {
  const [locale, setLocale] = useState('zh');

  useEffect(() => {
    const saved = localStorage.getItem('locale') || 'zh';
    setLocale(saved);
  }, []);

  const toggleLocale = () => {
    const newLocale = locale === 'zh' ? 'en' : 'zh';
    setLocale(newLocale);
    localStorage.setItem('locale', newLocale);
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
