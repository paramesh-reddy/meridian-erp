import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { ordersApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatCurrency, formatDate, formatDateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ConfirmDialog } from '../../components/ui/Modal';

export function OrderDetailsPage() {
  const { id } = useParams();
  const { hasRole } = useAuth();
  const canFulfill = hasRole('ADMIN', 'MANAGER');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await ordersApi.get(Number(id))).data,
  });

  const statusMutation = useMutation({
    mutationFn: (nextStatus: string) => ordersApi.updateStatus(Number(id), nextStatus),
    onSuccess: (_res, nextStatus) => {
      showToast('success', 'Order Status Updated', `Order transitioned to ${nextStatus}.`);
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => showToast('error', 'Transition Failed', extractErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => ordersApi.cancel(Number(id)),
    onSuccess: () => {
      showToast('info', 'Order Cancelled', 'Reserved or confirmed inventory has been restored.');
      setConfirmCancel(false);
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => showToast('error', 'Cancellation Failed', extractErrorMessage(err)),
  });

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading order record...</div>;
  }
  if (!order) {
    return <div className="p-8 text-sm text-rose-600">Sales order not found.</div>;
  }

  const canCancel = ['PENDING_APPROVAL', 'CONFIRMED', 'PROCESSING'].includes(order.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link to="/orders" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Sales Orders
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-xl font-bold font-mono text-slate-900">{order.order_number}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Created by {order.created_by_name} on {formatDateTime(order.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {order.status === 'PENDING_APPROVAL' && canFulfill && order.approval_id && (
            <Link
              to={`/approvals/${order.approval_id}`}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md"
            >
              Review Approval Request
            </Link>
          )}
          {order.status === 'CONFIRMED' && canFulfill && (
            <button
              type="button"
              onClick={() => statusMutation.mutate('PROCESSING')}
              disabled={statusMutation.isPending}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              Mark Processing
            </button>
          )}
          {(order.status === 'CONFIRMED' || order.status === 'PROCESSING') && canFulfill && (
            <button
              type="button"
              onClick={() => statusMutation.mutate('COMPLETED')}
              disabled={statusMutation.isPending}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md"
            >
              Mark Completed
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 rounded-md"
            >
              Cancel Order
            </button>
          )}
        </div>
      </div>

      {/* Approval Decision Banner */}
      {order.approval_status && (
        <div
          className={`p-4 rounded-lg border text-xs ${
            order.approval_status === 'APPROVED'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : order.approval_status === 'REJECTED'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <p className="font-semibold">
            Manager Approval Status: {order.approval_status}
            {order.reviewed_by_name ? ` · Reviewed by ${order.reviewed_by_name} on ${formatDateTime(order.reviewed_at)}` : ''}
          </p>
          {order.rejection_reason && (
            <p className="mt-1">Rejection Reason: {order.rejection_reason}</p>
          )}
        </div>
      )}

      {/* Metadata Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Customer</h2>
          <p className="font-semibold text-slate-900">{order.customer_company || order.customer_name}</p>
          <p className="text-slate-600">{order.customer_name}</p>
          <p className="text-slate-500">{order.customer_email}</p>
          <p className="font-mono text-slate-500">{order.customer_phone}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Shipping &amp; Dates</h2>
          <p className="text-slate-600">
            Order Date: <span className="font-mono text-slate-900">{formatDate(order.order_date)}</span>
          </p>
          <p className="text-slate-600">
            Expected Delivery:{' '}
            <span className="font-mono text-slate-900">{formatDate(order.expected_delivery_date)}</span>
          </p>
          <p className="text-slate-600 mt-1">
            Address: {order.customer_shipping_address || '—'}
            {order.customer_city ? `, ${order.customer_city}` : ''}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Financial Totals</h2>
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">{formatCurrency(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Discount</span>
            <span className="font-mono tabular-nums">− {formatCurrency(order.discount_amount)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Tax</span>
            <span className="font-mono tabular-nums">+ {formatCurrency(order.tax_amount)}</span>
          </div>
          <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-slate-900 text-sm">
            <span>Grand Total</span>
            <span className="font-mono tabular-nums">{formatCurrency(order.grand_total)}</span>
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Order Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">SKU</th>
                <th className="py-2.5 px-4 font-semibold">Product</th>
                <th className="py-2.5 px-4 font-semibold text-right">Quantity</th>
                <th className="py-2.5 px-4 font-semibold text-right">Unit Price</th>
                <th className="py-2.5 px-4 font-semibold text-right">Line Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(order.items || []).map((item) => (
                <tr key={item.id}>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">{item.sku}</td>
                  <td className="py-3 px-4 text-slate-800">{item.product_name}</td>
                  <td className="py-3 px-4 text-right font-mono text-slate-900 tabular-nums">{item.quantity}</td>
                  <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums">
                    {formatCurrency(item.unit_price)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(item.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.notes && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Notes:</span> {order.notes}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancelMutation.mutate()}
        title={`Cancel Order ${order.order_number}`}
        message="Cancelling this order will reverse stock reservations or restore deducted inventory back to available stock. This action is atomic and cannot be undone."
        confirmLabel="Cancel Order & Restore Stock"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
