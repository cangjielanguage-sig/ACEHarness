'use client';

import { Button } from '@/components/ui/button';

interface Suggestion {
  label: string;
  prompt: string;
  icon: string;
}

interface FollowUpSuggestionsProps {
  suggestions: Suggestion[];
  onAction?: (prompt: string) => void;
}

export default function FollowUpSuggestions({ suggestions, onAction }: FollowUpSuggestionsProps) {
  if (!onAction || suggestions.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-dashed">
      <div className="text-[10px] text-muted-foreground mb-1.5">你可能想要：</div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s, i) => (
          <Button
            key={i}
            size="sm"
            variant="outline"
            className="text-xs h-7 gap-1 hover:bg-primary/5 hover:border-primary/40"
            onClick={(e) => { e.stopPropagation(); onAction(s.prompt); }}
          >
            <span className="material-symbols-outlined text-xs">{s.icon}</span>
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
