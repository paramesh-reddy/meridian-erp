import React, { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { productsApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage } from '../../utils/format';

const productFormSchema = z.object({
  sku: z.string().trim().min(2, 'SKU must be at least 2 characters').max(64),
  name: z.string().trim().min(2, 'Product name is required').max(180),
  description: z.string().max(2000).optional(),
  category: z.string().trim().min(2, 'Category is required').max(80),
  unit_price: z.coerce.number().positive('Unit price must be greater than 0'),
  cost_price: z.coerce.number().min(0, 'Cost price cannot be negative'),
  initial_stock: z.coerce.number().int().min(0, 'Initial stock cannot be negative').optional(),
  minimum_stock_level: z.coerce.number().int().min(0, 'Minimum stock level cannot be negative'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

export function ProductFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: existingProduct, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await productsApi.get(Number(id))).data,
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema) as any,
    defaultValues: {
      sku: '',
      name: '',
      description: '',
      category: 'Networking',
      unit_price: 0,
      cost_price: 0,
      initial_stock: 0,
      minimum_stock_level: 10,
      status: 'ACTIVE',
    },
  });

  useEffect(() => {
    if (existingProduct) {
      reset({
        sku: existingProduct.sku,
        name: existingProduct.name,
        description: existingProduct.description,
        category: existingProduct.category,
        unit_price: existingProduct.unit_price,
        cost_price: existingProduct.cost_price,
        minimum_stock_level: existingProduct.minimum_stock_level,
        status: existingProduct.status,
      });
    }
  }, [existingProduct, reset]);

  const mutation = useMutation({
    mutationFn: (values: ProductFormValues) =>
      isEdit ? productsApi.update(Number(id), values) : productsApi.create(values),
    onSuccess: () => {
      showToast('success', isEdit ? 'Product updated' : 'Product created');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      navigate('/products');
    },
    onError: (err) => showToast('error', 'Save failed', extractErrorMessage(err)),
  });

  if (isEdit && isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading product record...</div>;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link to="/products" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Products
        </Link>
        <h1 className="text-xl font-bold text-slate-900 mt-2">
          {isEdit ? `Edit Product — ${existingProduct?.sku}` : 'Add New Product'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">SKU *</label>
            <input
              {...register('sku')}
              placeholder="NET-SW-48P"
              className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.sku && <p className="text-xs text-rose-600 mt-1">{errors.sku.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category *</label>
            <input
              {...register('category')}
              placeholder="Networking"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.category && <p className="text-xs text-rose-600 mt-1">{errors.category.message}</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Product Name *</label>
          <input
            {...register('name')}
            placeholder="Meridian 48-Port Gigabit PoE+ Switch"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
          {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label>
          <textarea
            {...register('description')}
            rows={3}
            placeholder="Technical specifications and commercial summary..."
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Unit Price (₹) *</label>
            <input
              type="number"
              step="0.01"
              {...register('unit_price')}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.unit_price && <p className="text-xs text-rose-600 mt-1">{errors.unit_price.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Cost Price (₹) *</label>
            <input
              type="number"
              step="0.01"
              {...register('cost_price')}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.cost_price && <p className="text-xs text-rose-600 mt-1">{errors.cost_price.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Minimum Stock Level *</label>
            <input
              type="number"
              {...register('minimum_stock_level')}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.minimum_stock_level && (
              <p className="text-xs text-rose-600 mt-1">{errors.minimum_stock_level.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {!isEdit && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Initial Stock Quantity *</label>
              <input
                type="number"
                {...register('initial_stock')}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
              {errors.initial_stock && (
                <p className="text-xs text-rose-600 mt-1">{errors.initial_stock.message}</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Catalog Status *</label>
            <select
              {...register('status')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <Link
            to="/products"
            className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : isEdit ? 'Update Product' : 'Create Product'}
          </button>
        </div>
      </form>
    </div>
  );
}
