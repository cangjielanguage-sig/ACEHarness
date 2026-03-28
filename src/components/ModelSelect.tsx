'use client';

import { useState, useEffect } from 'react';
import { ModelOption } from '@/lib/models';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ModelSelect({ value, onChange, className = '' }: ModelSelectProps) {
  const [models, setModels] = useState< ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        setModels(data.models || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleChange = (newValue: string) => {
    const selectedModel = models.find(m => m.value === newValue);
    onChange(newValue);
    if (selectedModel) {
      toast('info', `模型已切换: ${selectedModel.label} (${selectedModel.costMultiplier}x)`);
    }
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={loading}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent>
        {models.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label} ({opt.costMultiplier}x)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
