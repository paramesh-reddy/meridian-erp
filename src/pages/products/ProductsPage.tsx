import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Eye, Pencil, Trash2, Package } from 'lucide-react';
import { productsApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatCurrency, formatDateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { TableSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import type { Product } from '../../types';

export function ProductsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [urlParams] = useSearchParams();

  const [search, setSearch] = useState(urlParams.get('search') || '');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  useEffect(() => {
    const q = urlParams.get('search');
    if (q !== null) setSearch(q);
  }, [urlParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, category, status, sortBy, sortOrder, page }],
    queryFn: async () =>
      (
        await productsApi.list({
          search: search || undefined,
          category: category || undefined,
          status: status || undefined,
          sort_by: sortBy,
          sort_order: sortOrder,
          page,
          page_size: 10,
        })
      ).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => productsApi.delete(id),
    onSuccess: (resp) => {
      showToast(
        'info',
        resp.data.deactivated ? 'Product Deactivated' : 'Product Deleted',
        resp.data.message
      );
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err) => showToast('error', 'Action Failed', extractErrorMessage(err)),
  });

  const products = data?.items || [];
  const categories = data?.categories || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product Catalog</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage SKUs, pricing tiers, minimum reorder thresholds, and active catalog status
          </p>
        </div>
        {isAdmin && (
          <Link
            to="/products/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md whitespace-nowrap self-start"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </Link>
        )}
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by product name or SKU..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>

        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-600"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-600"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>

        <select
          value={`${sortBy}:${sortOrder}`}
          onChange={(e) => {
            const [sb, so] = e.target.value.split(':');
            setSortBy(sb);
            setSortOrder(so as 'asc' | 'desc');
          }}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-600"
        >
          <option value="created_at:desc">Newest First</option>
          <option value="unit_price:desc">Price: High to Low</option>
          <option value="unit_price:asc">Price: Low to High</option>
          <option value="stock:asc">Available Stock: Low to High</option>
          <option value="stock:desc">Available Stock: High to Low</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No matching products found"
          description="Try clearing your filters or add a new SKU to the product catalog."
          action={
            isAdmin ? (
              <Link
                to="/products/new"
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700"
              >
                Add First Product
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">SKU</th>
                  <th className="py-3 px-4 font-semibold">Product Name</th>
                  <th className="py-3 px-4 font-semibold">Category</th>
                  <th className="py-3 px-4 font-semibold text-right">Unit Price</th>
                  <th className="py-3 px-4 font-semibold text-right">Available</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => {
                  const isLow = p.available_quantity <= p.minimum_stock_level;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900">{p.sku}</td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="text-[11px] text-slate-500 truncate max-w-xs">{p.description}</p>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{p.category}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(p.unit_price)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <span className={isLow ? 'font-semibold text-amber-700' : 'text-slate-800'}>
                          {p.available_quantity}
                        </span>
                        <span className="text-slate-400"> / {p.quantity_on_hand}</span>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedProduct(p)}
                            title="View Details"
                            className="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-slate-100"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {isAdmin && (
                            <>
                              <Link
                                to={`/products/${p.id}/edit`}
                                title="Edit Product"
                                className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                              >
                                <Pencil className="w-4 h-4" />
                              </Link>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                title="Delete or Deactivate"
                                className="p-1.5 text-slate-500 hover:text-rose-600 rounded hover:bg-rose-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data && (
            <Pagination
              page={data.page}
              totalPages={data.total_pages}
              total={data.total}
              pageSize={data.page_size}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {/* Product Details Modal */}
      <Modal
        open={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        title={selectedProduct?.name || ''}
        subtitle={selectedProduct ? `SKU: ${selectedProduct.sku} · ${selectedProduct.category}` : undefined}
      >
        {selectedProduct && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600 leading-relaxed">{selectedProduct.description || 'No description provided.'}</p>
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200 text-xs">
              <div>
                <p className="text-slate-500">Unit Price</p>
                <p className="font-mono font-semibold text-slate-900 text-sm mt-0.5">
                  {formatCurrency(selectedProduct.unit_price)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Cost Price</p>
                <p className="font-mono font-semibold text-slate-900 text-sm mt-0.5">
                  {formatCurrency(selectedProduct.cost_price)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Quantity On Hand</p>
                <p className="font-mono font-semibold text-slate-900 mt-0.5">{selectedProduct.quantity_on_hand}</p>
              </div>
              <div>
                <p className="text-slate-500">Reserved / Available</p>
                <p className="font-mono font-semibold text-slate-900 mt-0.5">
                  {selectedProduct.reserved_quantity} reserved · {selectedProduct.available_quantity} available
                </p>
              </div>
              <div>
                <p className="text-slate-500">Minimum Stock Level</p>
                <p className="font-mono text-slate-900 mt-0.5">{selectedProduct.minimum_stock_level}</p>
              </div>
              <div>
                <p className="text-slate-500">Last Updated</p>
                <p className="font-mono text-slate-700 mt-0.5">{formatDateTime(selectedProduct.updated_at)}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete or Deactivate Product"
        message={`Are you sure you want to remove "${deleteTarget?.name}" (${deleteTarget?.sku})? If this product is referenced by existing sales orders, it will be safely deactivated instead of deleted.`}
        confirmLabel="Proceed"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
