import React from 'react';

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  ACTIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Active' },
  INACTIVE: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', label: 'Inactive' },
  CONFIRMED: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Confirmed' },
  APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Approved' },
  COMPLETED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Completed' },
  PROCESSING: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', label: 'Processing' },
  PENDING_APPROVAL: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Pending Approval' },
  PENDING: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Pending' },
  DRAFT: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', label: 'Draft' },
  REJECTED: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', label: 'Rejected' },
  CANCELLED: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300', label: 'Cancelled' },
  SENT: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Sent' },
  QUEUED_SIMULATED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Logged (Dev)' },
  FAILED: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', label: 'Failed' },
  LOW_STOCK: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Low Stock' },
  OUT_OF_STOCK: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', label: 'Out of Stock' },
  IN_STOCK: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Nominal' },
  STOCK_IN: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Stock In' },
  STOCK_ADJUSTMENT: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', label: 'Adjustment' },
  STOCK_RESERVED: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Reserved' },
  STOCK_RELEASED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Released' },
  STOCK_DEDUCTED: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', label: 'Deducted' },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_STYLES[status] || {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
    label: status.replaceAll('_', ' '),
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border whitespace-nowrap ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}
