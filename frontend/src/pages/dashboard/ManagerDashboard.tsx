import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalsApi, dashboardApi } from '../../api/client';
import { extractErrorMessage, formatCurrency, formatDateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { KpiGridSkeleton } from '../../components/ui/LoadingSkeleton';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../context/ToastContext';

export function ManagerDashboard() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [rejectTarget, setRejectTarget] = useState<{ id: number; orderNumber: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'manager'],
    queryFn: async () => (await dashboardApi.manager()).data,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvalsApi.approve(id),
    onSuccess: () => {
      showToast('success', 'Order approved', 'Reserved inventory has been deducted and the sales rep notified.');
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => showToast('error', 'Approval failed', extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => approvalsApi.reject(id, reason),
    onSuccess: () => {
      showToast('info', 'Order rejected', 'Reserved stock has been released back to available inventory.');
      setRejectTarget(null);
      setRejectionReason('');
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => showToast('error', 'Rejection failed', extractErrorMessage(err)),
  });

  if (isLoading || !data) {
    return <KpiGridSkeleton count={4} />;
  }

  const { kpis, pending_approvals, recent_history } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Manager Approval Console</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Review high-value sales orders exceeding threshold and manage inventory commitments
          </p>
        </div>
        <Link
          to="/approvals"
          className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 whitespace-nowrap self-start"
        >
          Full Approval Queue
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Pending Requests</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
            {kpis.pending_requests ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Value Awaiting Review</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatCurrency(kpis.awaiting_value)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Approved Orders</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {kpis.approved_orders ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Rejected Orders</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-rose-700 mt-1">
            {kpis.rejected_orders ?? 0}
          </p>
        </div>
      </div>

      {/* Pending Approvals Table with Quick Actions */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Orders Awaiting Decision</h2>
          <span className="text-xs text-slate-500 tabular-nums">{pending_approvals.length} pending</span>
        </div>
        {pending_approvals.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            All pending approval requests have been reviewed.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Order #</th>
                  <th className="py-2.5 px-4 font-semibold">Customer</th>
                  <th className="py-2.5 px-4 font-semibold">Requested By</th>
                  <th className="py-2.5 px-4 font-semibold">Requested At</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending_approvals.map((a: any) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                      <Link to={`/approvals/${a.id}`} className="hover:underline">
                        {a.order_number}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-slate-800">{a.customer_company || a.customer_name}</td>
                    <td className="py-3 px-4 text-slate-600">{a.requested_by_name}</td>
                    <td className="py-3 px-4 font-mono text-slate-500 tabular-nums">
                      {formatDateTime(a.requested_at)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(a.order_amount)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          to={`/approvals/${a.id}`}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-100"
                        >
                          Review
                        </Link>
                        <button
                          type="button"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(a.id)}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectTarget({ id: a.id, orderNumber: a.order_number })}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-rose-600 rounded hover:bg-rose-700"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Decisions */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Recent Approval Decisions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Order #</th>
                <th className="py-2.5 px-4 font-semibold">Customer</th>
                <th className="py-2.5 px-4 font-semibold">Sales Rep</th>
                <th className="py-2.5 px-4 font-semibold">Reviewed By</th>
                <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                <th className="py-2.5 px-4 font-semibold">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent_history.map((h: any) => (
                <tr key={h.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">
                    <Link to={`/approvals/${h.id}`} className="hover:underline">
                      {h.order_number}
                    </Link>
                  </td>
                  <td className="py-2.5 px-4 text-slate-800">{h.customer_company || h.customer_name}</td>
                  <td className="py-2.5 px-4 text-slate-600">{h.requested_by_name}</td>
                  <td className="py-2.5 px-4 text-slate-600">{h.reviewed_by_name || '—'}</td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(h.order_amount)}
                  </td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={h.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Reason Modal */}
      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => {
          setRejectTarget(null);
          setRejectionReason('');
        }}
        title={`Reject Order ${rejectTarget?.orderNumber || ''}`}
        subtitle="Provide a clear reason for the sales representative. Reserved inventory will be released."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!rejectTarget || rejectionReason.trim().length < 3) return;
            rejectMutation.mutate({ id: rejectTarget.id, reason: rejectionReason.trim() });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Rejection Reason (Mandatory)
            </label>
            <textarea
              required
              minLength={3}
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g., Discount exceeds policy margin limits. Please re-quote at standard enterprise tier."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectTarget(null)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={rejectMutation.isPending || rejectionReason.trim().length < 3}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-md hover:bg-rose-700 disabled:opacity-50"
            >
              {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
