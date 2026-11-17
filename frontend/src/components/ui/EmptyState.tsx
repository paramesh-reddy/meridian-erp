import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 bg-white border border-slate-200 rounded-lg">
      <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500 max-w-md mt-1">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
