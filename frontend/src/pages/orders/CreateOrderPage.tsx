import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Info } from 'lucide-react';
import { customersApi, ordersApi, productsApi, settingsApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatCurrency } from '../../utils/format';

const orderItemSchema = z.object({
  product_id: z.coerce.number().int().positive('Select a product'),
  quantity: z.coerce.number().int().positive('Quantity must be >= 1'),
});

const createOrderSchema = z.object({
  customer_id: z.coerce.number().int().positive('Select a customer'),
  order_date: z.string().min(1, 'Order date is required'),
  expected_delivery_date: z.string().optional(),
  discount_amount: z.coerce.number().min(0, 'Discount cannot be negative'),
  tax_amount: z.coerce.number().min(0, 'Tax cannot be negative'),
  notes: z.string().max(1000).optional(),
  items: z.array(orderItemSchema).min(1, 'Add at least one product line item'),
});

type CreateOrderFormValues = z.infer<typeof createOrderSchema>;

export function CreateOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: customersData } = useQuery({
    queryKey: ['customers', 'active-all'],
    queryFn: async () => (await customersApi.list({ status: 'ACTIVE', page_size: 100 })).data,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', 'active-all'],
    queryFn: async () => (await productsApi.list({ status: 'ACTIVE', page_size: 100 })).data,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.get()).data,
  });

  const today = new Date().toISOString().slice(0, 10);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrderFormValues>({
    resolver: zodResolver(createOrderSchema) as any,
    defaultValues: {
      customer_id: 0,
      order_date: today,
      expected_delivery_date: '',
      discount_amount: 0,
      tax_amount: 0,
      notes: '',
      items: [{ product_id: 0, quantity: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const watchedItems = watch('items');
  const watchedDiscount = Number(watch('discount_amount') || 0);
  const watchedTax = Number(watch('tax_amount') || 0);

  const products = productsData?.items || [];
  const productMap = new Map(products.map((p) => [p.id, p]));

  const subtotal = watchedItems.reduce((sum, item) => {
    const prod = productMap.get(Number(item.product_id));
    if (!prod) return sum;
    return sum + prod.unit_price * (Number(item.quantity) || 0);
  }, 0);

  const grandTotal = Math.max(0, subtotal - watchedDiscount + watchedTax);
  const threshold = settingsData?.approval_threshold ?? 50000;
  const requiresApproval = grandTotal > threshold;

  const mutation = useMutation({
    mutationFn: (values: CreateOrderFormValues) =>
      ordersApi.create({
        customer_id: values.customer_id,
        order_date: values.order_date,
        expected_delivery_date: values.expected_delivery_date || null,
        discount_amount: values.discount_amount,
        tax_amount: values.tax_amount,
        notes: values.notes || '',
        items: values.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
      }),
    onSuccess: (resp) => {
      const order = resp.data;
      showToast(
        order.status === 'PENDING_APPROVAL' ? 'info' : 'success',
        `Order ${order.order_number} Created`,
        order.status === 'PENDING_APPROVAL'
          ? 'Exceeds threshold — stock reserved and manager notified for approval.'
          : 'Auto-confirmed within threshold and stock deducted.'
      );
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      navigate(`/orders/${order.id}`);
    },
    onError: (err) => showToast('error', 'Order Validation Failed', extractErrorMessage(err)),
  });

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link to="/orders" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Sales Orders
        </Link>
        <h1 className="text-xl font-bold text-slate-900 mt-2">Create Sales Order</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Authoritative pricing, stock checks, and financial totals are verified on the server.
        </p>
      </div>

      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Customer &amp; Schedule</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Customer *</label>
              <select
                {...register('customer_id')}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
              >
                <option value={0}>Select active customer...</option>
                {(customersData?.items || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name ? `${c.company_name} (${c.name})` : c.name}
                  </option>
                ))}
              </select>
              {errors.customer_id && <p className="text-xs text-rose-600 mt-1">{errors.customer_id.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Order Date *</label>
              <input
                type="date"
                {...register('order_date')}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
              {errors.order_date && <p className="text-xs text-rose-600 mt-1">{errors.order_date.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Expected Delivery</label>
              <input
                type="date"
                {...register('expected_delivery_date')}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Order Line Items</h2>
            <button
              type="button"
              onClick={() => append({ product_id: 0, quantity: 1 })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Line Item
            </button>
          </div>

          <div className="space-y-3">
            {fields.map((field, idx) => {
              const currentItem = watchedItems[idx];
              const prod = productMap.get(Number(currentItem?.product_id));
              const qty = Number(currentItem?.quantity || 0);
              const lineSubtotal = prod ? prod.unit_price * qty : 0;
              const stockWarning = prod && qty > prod.available_quantity;

              return (
                <div
                  key={field.id}
                  className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start p-3.5 bg-slate-50 border border-slate-200 rounded-md"
                >
                  <div className="md:col-span-5">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Product</label>
                    <select
                      {...register(`items.${idx}.product_id`)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
                    >
                      <option value={0}>Select SKU...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name} (Avail: {p.available_quantity})
                        </option>
                      ))}
                    </select>
                    {errors.items?.[idx]?.product_id && (
                      <p className="text-[11px] text-rose-600 mt-1">{errors.items[idx]?.product_id?.message}</p>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Unit Price</label>
                    <div className="px-2.5 py-1.5 text-xs font-mono bg-slate-100 border border-slate-200 rounded-md text-slate-700 tabular-nums">
                      {prod ? formatCurrency(prod.unit_price) : '—'}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      {...register(`items.${idx}.quantity`)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
                    />
                    {stockWarning && (
                      <p className="text-[11px] text-rose-600 mt-1">
                        Only {prod?.available_quantity} available
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Line Subtotal</label>
                    <div className="px-2.5 py-1.5 text-xs font-mono font-semibold bg-white border border-slate-200 rounded-md text-slate-900 tabular-nums">
                      {formatCurrency(lineSubtotal)}
                    </div>
                  </div>

                  <div className="md:col-span-1 flex md:justify-end pt-5">
                    {fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => remove(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Summary & Totals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Adjustments &amp; Notes</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Discount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  {...register('discount_amount')}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tax / GST (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  {...register('tax_amount')}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Order Notes</label>
              <textarea
                rows={3}
                {...register('notes')}
                placeholder="Delivery instructions, PO reference, or discount justification..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between space-y-4">
            <div className="space-y-2.5 text-sm">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Order Financial Summary</h2>
              <div className="flex justify-between text-slate-600">
                <span>Items Subtotal</span>
                <span className="font-mono tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Discount</span>
                <span className="font-mono tabular-nums">− {formatCurrency(watchedDiscount)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Tax</span>
                <span className="font-mono tabular-nums">+ {formatCurrency(watchedTax)}</span>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-between text-base font-bold text-slate-900">
                <span>Estimated Grand Total</span>
                <span className="font-mono tabular-nums text-blue-700">{formatCurrency(grandTotal)}</span>
              </div>
            </div>

            <div
              className={`p-3 rounded-md border text-xs flex items-start gap-2.5 ${
                requiresApproval
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {requiresApproval ? 'Manager Approval Required' : 'Eligible for Auto-Confirmation'}
                </p>
                <p className="mt-0.5 opacity-90">
                  {requiresApproval
                    ? `Order total exceeds the ${formatCurrency(threshold)} threshold. Stock will be reserved and routed to a Manager.`
                    : `Order total is within the ${formatCurrency(threshold)} threshold and will confirm immediately.`}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Link
                to="/orders"
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={isSubmitting || mutation.isPending}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {mutation.isPending ? 'Submitting Order...' : 'Submit Sales Order'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
