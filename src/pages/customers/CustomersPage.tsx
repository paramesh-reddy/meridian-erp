import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Eye, Pencil, Trash2, Users } from 'lucide-react';
import { customersApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatCurrency } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { TableSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/Modal';
import type { Customer } from '../../types';

export function CustomersPage() {
  const { hasRole } = useAuth();
  const canDelete = hasRole('ADMIN', 'MANAGER');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', { search, status, page }],
    queryFn: async () =>
      (
        await customersApi.list({
          search: search || undefined,
          status: status || undefined,
          page,
          page_size: 10,
        })
      ).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customersApi.delete(id),
    onSuccess: (resp) => {
      showToast(
        'info',
        resp.data.deactivated ? 'Customer Deactivated' : 'Customer Deleted',
        resp.data.message
      );
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => showToast('error', 'Action Failed', extractErrorMessage(err)),
  });

  const customers = data?.items || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Customer Directory</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            B2B client accounts, billing addresses, and historical order value
          </p>
        </div>
        <Link
          to="/customers/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by customer name, company, email, or phone..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-600"
        >
          <option value="">All Accounts</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers found"
          description="Add a corporate customer account to begin creating sales orders."
          action={
            <Link
              to="/customers/new"
              className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700"
            >
              Add Customer
            </Link>
          }
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Contact &amp; Company</th>
                  <th className="py-3 px-4 font-semibold">Email &amp; Phone</th>
                  <th className="py-3 px-4 font-semibold">City / State</th>
                  <th className="py-3 px-4 font-semibold text-right">Orders</th>
                  <th className="py-3 px-4 font-semibold text-right">Total Spend</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <Link to={`/customers/${c.id}`} className="font-semibold text-blue-600 hover:underline">
                        {c.company_name || c.name}
                      </Link>
                      <p className="text-[11px] text-slate-500">{c.name}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-slate-800">{c.email}</p>
                      <p className="text-[11px] font-mono text-slate-500">{c.phone}</p>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-900 tabular-nums">
                      {c.order_count ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(c.total_spend)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={c.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          to={`/customers/${c.id}`}
                          title="View Profile & Orders"
                          className="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-slate-100"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <Link
                          to={`/customers/${c.id}/edit`}
                          title="Edit Customer"
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(c)}
                            title="Delete or Deactivate"
                            className="p-1.5 text-slate-500 hover:text-rose-600 rounded hover:bg-rose-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete or Deactivate Customer"
        message={`Proceed with removing "${deleteTarget?.company_name || deleteTarget?.name}"? Customers with historical orders will be deactivated to preserve ledger integrity.`}
        confirmLabel="Confirm"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
