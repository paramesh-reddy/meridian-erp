import React from 'react';

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="h-10 bg-slate-50 border-b border-slate-200" />
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div key={rIdx} className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
            {Array.from({ length: cols }).map((__, cIdx) => (
              <div
                key={cIdx}
                className="h-3.5 bg-slate-200 rounded flex-1"
                style={{ maxWidth: cIdx === 0 ? '110px' : undefined }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${count > 4 ? 3 : count} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-lg p-5 animate-pulse">
          <div className="h-3 w-24 bg-slate-200 rounded mb-3" />
          <div className="h-7 w-32 bg-slate-200 rounded" />
        </div>
      ))}
    </div>
  );
}
