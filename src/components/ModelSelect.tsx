'use client';

import { MODEL_OPTIONS } from '@/lib/models';

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ModelSelect({ value, onChange, className = '' }: ModelSelectProps) {
  return (
    <select
      className={`w-full h-10 px-3 rounded-md border bg-background ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {MODEL_OPTIONS.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label} ({opt.costMultiplier}x)
        </option>
      ))}
    </select>
  );
}
