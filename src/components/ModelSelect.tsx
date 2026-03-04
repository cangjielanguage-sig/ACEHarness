'use client';

import { useState, useEffect } from 'react';
import { ModelOption } from '@/lib/models';

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ModelSelect({ value, onChange, className = '' }: ModelSelectProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        setModels(data.models || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <select
      className={`w-full h-10 px-3 rounded-md border bg-background ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
    >
      {models.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label} ({opt.costMultiplier}x)
        </option>
      ))}
    </select>
  );
}
