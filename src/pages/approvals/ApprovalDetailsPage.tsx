import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { approvalsApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatCurrency, formatDate, formatDateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Modal } from '../../components/ui/Modal';

export function ApprovalDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const { data: approval, isLoading } = useQuery({
    queryKey: ['approval', id],
    queryFn: async () => (await approvalsApi.get(Number(id))).data,
  });

  const approveMutation = useMutation({
    mutationFn: () => approvalsApi.approve(Number(id)),
    onSuccess: () => {
      showToast(
        'success',
        'Order Approved & Confirmed',
        'Reserved inventory deducted and decision email triggered to the sales representative.'
      );
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      navigate('/approvals');
    },
    onError: (err) => showToast('error', 'Approval Error', extractErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => approvalsApi.reject(Number(id), reason),
    onSuccess: () => {
      showToast(
        'info',
        'Order Rejected',
        'Reserved stock released back to inventory and sales representative notified.'
      );
      setRejectOpen(false);
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      navigate('/approvals');
    },
    onError: (err) => showToast('error', 'Rejection Error', extractErrorMessage(err)),
  });

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading approval dossier...</div>;
  }
  if (!approval) {
    return <div className="p-8 text-sm text-rose-600">Approval request not found.</div>;
  }

  const isPending = approval.status === 'PENDING';
  const isSelfCreated = approval.requested_by === user?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link to="/approvals" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Approval Queue
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-xl font-bold font-mono text-slate-900">{approval.order_number}</h1>
            <StatusBadge status={approval.status} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Submitted by {approval.requested_by_name} ({approval.requested_by_email}) ·{' '}
            {formatDateTime(approval.requested_at)}
          </p>
        </div>

        {isPending && (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isSelfCreated || rejectMutation.isPending || approveMutation.isPending}
              onClick={() => setRejectOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 rounded-md disabled:opacity-40"
            >
              <XCircle className="w-4 h-4" />
              Reject Order
            </button>
            <button
              type="button"
              disabled={isSelfCreated || approveMutation.isPending || rejectMutation.isPending}
              onClick={() => approveMutation.mutate()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-40"
            >
              <CheckCircle2 className="w-4 h-4" />
              {approveMutation.isPending ? 'Approving...' : 'Approve & Deduct Stock'}
            </button>
          </div>
        )}
      </div>

      {isSelfCreated && isPending && (
        <div className="p-3.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
          Separation of duties policy: You created this order and cannot approve or reject your own request. Another Manager or Admin must review it.
        </div>
      )}

      {!isPending && (
        <div
          className={`p-4 rounded-lg border text-xs ${
            approval.status === 'APPROVED'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <p className="font-semibold">
            Decision: {approval.status} by {approval.reviewed_by_name} on {formatDateTime(approval.reviewed_at)}
          </p>
          {approval.rejection_reason && <p className="mt-1">Reason: {approval.rejection_reason}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Customer Information</h2>
          <p className="font-semibold text-slate-900">{approval.customer_company || approval.customer_name}</p>
          <p className="text-slate-600">{approval.customer_name}</p>
          <p className="text-slate-500">{approval.customer_email}</p>
          <p className="font-mono text-slate-500">{approval.customer_phone}</p>
          <p className="text-slate-500">{approval.customer_city}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Order Schedule &amp; Notes</h2>
          <p className="text-slate-600">
            Order Date: <span className="font-mono text-slate-900">{formatDate(approval.order_date)}</span>
          </p>
          <p className="text-slate-600">
            Expected Delivery:{' '}
            <span className="font-mono text-slate-900">{formatDate(approval.expected_delivery_date)}</span>
          </p>
          <p className="text-slate-600 mt-2">{approval.notes || 'No order notes attached.'}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Financial Summary</h2>
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">{formatCurrency(approval.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Discount</span>
            <span className="font-mono tabular-nums">− {formatCurrency(approval.discount_amount)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Tax</span>
            <span className="font-mono tabular-nums">+ {formatCurrency(approval.tax_amount)}</span>
          </div>
          <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900 text-sm">
            <span>Grand Total</span>
            <span className="font-mono tabular-nums text-blue-700">{formatCurrency(approval.grand_total)}</span>
          </div>
        </div>
      </div>

      {/* Items & Stock Reservation Verification */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Line Items &amp; Warehouse Stock Check</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">SKU</th>
                <th className="py-2.5 px-4 font-semibold">Product</th>
                <th className="py-2.5 px-4 font-semibold text-right">Order Qty</th>
                <th className="py-2.5 px-4 font-semibold text-right">Unit Price</th>
                <th className="py-2.5 px-4 font-semibold text-right">Line Subtotal</th>
                <th className="py-2.5 px-4 font-semibold text-right">On Hand / Reserved / Avail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(approval.items || []).map((item) => (
                <tr key={item.id}>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">{item.sku}</td>
                  <td className="py-3 px-4 text-slate-800">{item.product_name}</td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {item.quantity}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums">
                    {formatCurrency(item.unit_price)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(item.subtotal)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-600 tabular-nums">
                    {item.quantity_on_hand} / {item.reserved_quantity} / {item.available_quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject Order ${approval.order_number}`}
        subtitle="A detailed rejection reason is mandatory and will be emailed to the sales representative."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rejectionReason.trim().length < 3) return;
            rejectMutation.mutate(rejectionReason.trim());
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Rejection Reason *</label>
            <textarea
              required
              minLength={3}
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Explain why this order is being rejected..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={rejectMutation.isPending || rejectionReason.trim().length < 3}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-md hover:bg-rose-700 disabled:opacity-50"
            >
              {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection & Release Stock'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
