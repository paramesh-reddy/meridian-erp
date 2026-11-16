import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ArrowRight } from 'lucide-react';
import { dashboardApi } from '../../api/client';
import { formatCompactCurrency, formatCurrency, formatDate } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { KpiGridSkeleton } from '../../components/ui/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: '#2563eb',
  CONFIRMED: '#16a34a',
  PROCESSING: '#4f46e5',
  PENDING_APPROVAL: '#d97706',
  REJECTED: '#dc2626',
  CANCELLED: '#64748b',
  DRAFT: '#94a3b8',
};

export function AdminDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: async () => (await dashboardApi.admin()).data,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <KpiGridSkeleton count={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
        Failed to load executive dashboard metrics.
      </div>
    );
  }

  const { kpis, charts, tables } = data;

  const kpiCards = [
    { label: 'Total Revenue', value: formatCurrency(kpis.total_revenue), sub: 'Confirmed & fulfilled orders', link: '/orders' },
    { label: 'Total Orders', value: String(kpis.total_orders), sub: 'All lifecycle states', link: '/orders' },
    { label: 'Active Products', value: String(kpis.total_products), sub: 'Catalog SKUs', link: '/products' },
    { label: 'Active Customers', value: String(kpis.total_customers), sub: 'B2B accounts', link: '/customers' },
    { label: 'Pending Approvals', value: String(kpis.pending_approvals), sub: 'Awaiting manager decision', link: '/approvals', alert: kpis.pending_approvals > 0 },
    { label: 'Low Stock Alerts', value: String(kpis.low_stock_products), sub: 'At or below reorder point', link: '/inventory?low_stock=true', alert: kpis.low_stock_products > 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Executive Operations Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Live database metrics across sales orders, inventory levels, and approval queues
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            to="/orders/new"
            className="px-3.5 py-2 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap"
          >
            New Sales Order
          </Link>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((card) => (
          <Link
            key={card.label}
            to={card.link}
            className="bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors"
          >
            <p className="text-xs font-medium text-slate-500">{card.label}</p>
            <p
              className={`text-xl font-bold font-mono tabular-nums mt-1.5 ${
                card.alert ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {card.value}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">{card.sub}</p>
          </Link>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Monthly Sales Revenue</h2>
              <p className="text-xs text-slate-500">Confirmed, processing, and completed orders</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.monthly_revenue}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={(v) => formatCompactCurrency(v)}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value ?? 0)), 'Revenue']}
                  contentStyle={{ borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} fill="url(#revGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900">Order Status Distribution</h2>
          <p className="text-xs text-slate-500 mb-3">Breakdown across current order pipeline</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={charts.status_distribution}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {charts.status_distribution.map((entry: { status: string }) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val, name) => [`${val ?? 0} orders`, String(name ?? '').replaceAll('_', ' ')]}
                  contentStyle={{ borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-2">
            {charts.status_distribution.map((s: { status: string; count: number }) => (
              <div key={s.status} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: STATUS_COLORS[s.status] || '#94a3b8' }}
                  />
                  <span className="text-slate-600">{s.status.replaceAll('_', ' ')}</span>
                </div>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900">Top-Selling Products by Revenue</h2>
          <p className="text-xs text-slate-500 mb-4">Confirmed and completed order volume</p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.top_products} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v) => formatCompactCurrency(v)}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="sku"
                  width={95}
                  tick={{ fontSize: 11, fill: '#334155' }}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value ?? 0)), 'Revenue']}
                  contentStyle={{ borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
                <Bar dataKey="revenue" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900">Inventory Distribution by Category</h2>
          <p className="text-xs text-slate-500 mb-4">Available vs. reserved units across warehouse</p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.inventory_by_category}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                <Bar dataKey="available" name="Available" stackId="a" fill="#0f172a" barSize={28} />
                <Bar dataKey="reserved" name="Reserved" stackId="a" fill="#d97706" radius={[4, 4, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Operational Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Orders */}
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recent Sales Orders</h2>
            <Link to="/orders" className="text-xs font-medium text-blue-600 hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Order #</th>
                  <th className="py-2.5 px-4 font-semibold">Customer</th>
                  <th className="py-2.5 px-4 font-semibold">Date</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tables.recent_orders.map((o: any) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">
                      <Link to={`/orders/${o.id}`} className="hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4 text-slate-800">{o.customer_company || o.customer_name}</td>
                    <td className="py-2.5 px-4 text-slate-500 font-mono tabular-nums">{formatDate(o.order_date)}</td>
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

        {/* Pending Approvals & Low Stock */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Pending Approvals</h2>
              <Link to="/approvals" className="text-xs font-medium text-blue-600 hover:underline">
                Queue
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {tables.pending_approvals.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">No orders awaiting approval.</p>
              ) : (
                tables.pending_approvals.map((a: any) => (
                  <Link
                    key={a.id}
                    to={`/approvals/${a.id}`}
                    className="block px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-semibold text-slate-900">{a.order_number}</span>
                      <span className="text-xs font-mono font-semibold text-amber-700 tabular-nums">
                        {formatCurrency(a.order_amount)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {a.customer_company || a.customer_name} · {a.requested_by_name}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Low Stock Products</h2>
              <Link to="/inventory" className="text-xs font-medium text-blue-600 hover:underline">
                Inventory
              </Link>
            </div>
            <div className="divide-y divide-slate-100">
              {tables.low_stock_products.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">All active SKUs are above minimum stock levels.</p>
              ) : (
                tables.low_stock_products.map((p: any) => (
                  <div key={p.product_id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">{p.name}</p>
                      <p className="text-[11px] font-mono text-slate-500">{p.sku}</p>
                    </div>
                    <span className="text-xs font-mono font-semibold text-rose-700 tabular-nums whitespace-nowrap">
                      {p.available_quantity} / {p.minimum_stock_level}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
