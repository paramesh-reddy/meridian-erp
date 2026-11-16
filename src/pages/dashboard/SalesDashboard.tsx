import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { dashboardApi } from '../../api/client';
import { formatCompactCurrency, formatCurrency, formatDate } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { KpiGridSkeleton } from '../../components/ui/LoadingSkeleton';

export function SalesDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'sales'],
    queryFn: async () => (await dashboardApi.sales()).data,
  });

  if (isLoading || !data) {
    return <KpiGridSkeleton count={5} />;
  }

  const { kpis, recent_orders, monthly_sales } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My Sales Workspace</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Track your sales orders, manager approval decisions, and confirmed revenue
          </p>
        </div>
        <Link
          to="/orders/new"
          className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap self-start"
        >
          Create Sales Order
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">My Total Orders</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{kpis.total_orders ?? 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Confirmed / Fulfilled</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">{kpis.confirmed_orders ?? 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Pending Approval</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">{kpis.pending_approvals ?? 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Rejected Orders</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-rose-700 mt-1">{kpis.rejected_orders ?? 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">My Sales Value</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1">
            {formatCurrency(kpis.sales_value)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">My Recent Orders &amp; Approval Decisions</h2>
            <Link to="/orders" className="text-xs font-medium text-blue-600 hover:underline">
              All my orders
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Order #</th>
                  <th className="py-2.5 px-4 font-semibold">Customer</th>
                  <th className="py-2.5 px-4 font-semibold">Date</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Total</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent_orders.map((o: any) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">
                      <Link to={`/orders/${o.id}`} className="hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4 text-slate-800">
                      <p>{o.customer_company || o.customer_name}</p>
                      {o.rejection_reason && (
                        <p className="text-[11px] text-rose-700 mt-0.5 truncate max-w-xs">
                          Note: {o.rejection_reason}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">{formatDate(o.order_date)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(o.grand_total)}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900">Monthly Confirmed Value</h2>
          <p className="text-xs text-slate-500 mb-4">Your approved and auto-confirmed bookings</p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly_sales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => formatCompactCurrency(v)}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  width={55}
                />
                <Tooltip
                  formatter={(v) => [formatCurrency(Number(v ?? 0)), 'Sales Value']}
                  contentStyle={{ borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
