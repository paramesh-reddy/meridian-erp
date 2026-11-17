import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, ArrowRight } from 'lucide-react';
import { approvalsApi } from '../../api/client';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { TableSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';

export function ApprovalsPage() {
  const [tab, setTab] = useState<'pending' | 'history'>('pending');

  const { data: pendingData, isLoading: loadingPending } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: async () => (await approvalsApi.pending()).data,
  });

  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ['approvals', 'history'],
    queryFn: async () => (await approvalsApi.history()).data,
    enabled: tab === 'history',
  });

  const pendingItems = pendingData?.items || [];
  const historyItems = historyData?.items || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Order Approval Workflow</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Review sales orders exceeding the configured threshold and inspect past approval decisions
        </p>
      </div>

      <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg">
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            tab === 'pending' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Pending Queue ({pendingItems.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            tab === 'history' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Approval History
        </button>
      </div>

      {tab === 'pending' ? (
        loadingPending ? (
          <TableSkeleton rows={5} cols={6} />
        ) : pendingItems.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="No pending approval requests"
            description="Orders exceeding the threshold will appear here with reserved inventory awaiting your review."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Order #</th>
                    <th className="py-3 px-4 font-semibold">Customer</th>
                    <th className="py-3 px-4 font-semibold">Sales Rep</th>
                    <th className="py-3 px-4 font-semibold">Requested At</th>
                    <th className="py-3 px-4 font-semibold text-right">Order Amount</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingItems.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                        <Link to={`/approvals/${a.id}`} className="hover:underline">
                          {a.order_number}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-slate-900 font-medium">{a.customer_company || a.customer_name}</td>
                      <td className="py-3 px-4 text-slate-600">{a.requested_by_name}</td>
                      <td className="py-3 px-4 font-mono text-slate-500 tabular-nums">
                        {formatDateTime(a.requested_at)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {formatCurrency(a.order_amount)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link
                          to={`/approvals/${a.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                        >
                          Review
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : loadingHistory ? (
        <TableSkeleton rows={5} cols={7} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Order #</th>
                  <th className="py-3 px-4 font-semibold">Customer</th>
                  <th className="py-3 px-4 font-semibold">Sales Rep</th>
                  <th className="py-3 px-4 font-semibold">Reviewed By</th>
                  <th className="py-3 px-4 font-semibold">Reviewed At</th>
                  <th className="py-3 px-4 font-semibold text-right">Amount</th>
                  <th className="py-3 px-4 font-semibold">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historyItems.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                      <Link to={`/approvals/${h.id}`} className="hover:underline">
                        {h.order_number}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-slate-900">{h.customer_company || h.customer_name}</td>
                    <td className="py-3 px-4 text-slate-600">{h.requested_by_name}</td>
                    <td className="py-3 px-4 text-slate-600">{h.reviewed_by_name || '—'}</td>
                    <td className="py-3 px-4 font-mono text-slate-500 tabular-nums">
                      {formatDateTime(h.reviewed_at)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(h.order_amount)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={h.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
