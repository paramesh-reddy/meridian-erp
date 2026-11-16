import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { inventoryApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage } from '../../utils/format';

const adjustSchema = z.object({
  product_id: z.coerce.number().int().positive('Select a product'),
  transaction_type: z.enum(['STOCK_IN', 'STOCK_ADJUSTMENT']),
  quantity_delta: z.coerce
    .number()
    .int('Quantity must be a whole number')
    .refine((n) => n !== 0, 'Quantity change cannot be zero'),
  reason: z.string().trim().min(3, 'Provide a clear audit reason (min 3 characters)'),
});

type AdjustFormValues = z.infer<typeof adjustSchema>;

export function InventoryAdjustPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data } = useQuery({
    queryKey: ['inventory', 'all'],
    queryFn: async () => (await inventoryApi.list()).data,
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustSchema) as any,
    defaultValues: {
      product_id: 0,
      transaction_type: 'STOCK_IN',
      quantity_delta: 10,
      reason: '',
    },
  });

  const selectedProductId = Number(watch('product_id'));
  const selectedItem = data?.items.find((i) => i.product_id === selectedProductId);

  const mutation = useMutation({
    mutationFn: (values: AdjustFormValues) => inventoryApi.adjust(values),
    onSuccess: () => {
      showToast('success', 'Inventory updated', 'Stock transaction recorded in audit ledger.');
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/inventory');
    },
    onError: (err) => showToast('error', 'Adjustment Rejected', extractErrorMessage(err)),
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link to="/inventory" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Inventory
        </Link>
        <h1 className="text-xl font-bold text-slate-900 mt-2">Record Stock Addition or Adjustment</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          All adjustments are logged with user attribution and prevented from causing negative inventory.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Product SKU *</label>
          <select
            {...register('product_id')}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
          >
            <option value={0}>Select a product...</option>
            {(data?.items || []).map((item) => (
              <option key={item.product_id} value={item.product_id}>
                {item.sku} — {item.product_name} (On Hand: {item.quantity_on_hand}, Reserved: {item.reserved_quantity})
              </option>
            ))}
          </select>
          {errors.product_id && <p className="text-xs text-rose-600 mt-1">{errors.product_id.message}</p>}
        </div>

        {selectedItem && (
          <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs">
            <div>
              <p className="text-slate-500">On Hand</p>
              <p className="font-mono font-semibold text-slate-900 text-sm">{selectedItem.quantity_on_hand}</p>
            </div>
            <div>
              <p className="text-slate-500">Reserved</p>
              <p className="font-mono font-semibold text-amber-700 text-sm">{selectedItem.reserved_quantity}</p>
            </div>
            <div>
              <p className="text-slate-500">Available</p>
              <p className="font-mono font-semibold text-emerald-700 text-sm">{selectedItem.available_quantity}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Transaction Type *</label>
            <select
              {...register('transaction_type')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
            >
              <option value="STOCK_IN">Stock Addition (STOCK_IN)</option>
              <option value="STOCK_ADJUSTMENT">Manual Adjustment (STOCK_ADJUSTMENT)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Quantity Change (use negative for shrinkage) *
            </label>
            <input
              type="number"
              {...register('quantity_delta')}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.quantity_delta && (
              <p className="text-xs text-rose-600 mt-1">{errors.quantity_delta.message}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Audit Reason *</label>
          <textarea
            rows={3}
            {...register('reason')}
            placeholder="e.g., PO-8821 supplier shipment received at Bengaluru warehouse"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
          {errors.reason && <p className="text-xs text-rose-600 mt-1">{errors.reason.message}</p>}
        </div>

        <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <Link
            to="/inventory"
            className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Recording...' : 'Submit Stock Transaction'}
          </button>
        </div>
      </form>
    </div>
  );
}
