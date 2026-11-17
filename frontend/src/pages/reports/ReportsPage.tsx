import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { dashboardApi, settingsApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatCurrency, formatDateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';

export function ReportsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: async () => (await dashboardApi.reportsSummary()).data,
  });

  const { data: emailData } = useQuery({
    queryKey: ['emails', 'logs'],
    queryFn: async () => (await settingsApi.emailLogs()).data,
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => settingsApi.retryEmail(id),
    onSuccess: (resp) => {
      showToast(
        resp.data.status === 'FAILED' ? 'error' : 'success',
        'Email Retry Attempted',
        `Delivery status: ${resp.data.status}`
      );
      queryClient.invalidateQueries({ queryKey: ['emails'] });
    },
    onError: (err) => showToast('error', 'Retry Failed', extractErrorMessage(err)),
  });

  const exportCsv = () => {
    if (!reportData?.category_sales) return;
    const headers = ['Category', 'Units Sold', 'Gross Revenue', 'Estimated Gross Profit'];
    const rows = reportData.category_sales.map((r: any) => [
      r.category,
      r.total_units,
      r.revenue,
      r.estimated_gross_profit,
    ]);
    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meridian-category-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading || !reportData) {
    return <div className="p-8 text-sm text-slate-500">Generating analytical reports...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sales, Valuation &amp; Email Reports</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Database-computed margin analytics, inventory asset valuation, and SMTP notification audit trail
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 self-start"
        >
          <Download className="w-3.5 h-3.5" />
          Export Category Sales CSV
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Sales & Margin */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Category Revenue &amp; Gross Margin</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Category</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Units</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Revenue</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Est. Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportData.category_sales.map((c: any) => (
                  <tr key={c.category}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{c.category}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{c.total_units}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(c.revenue)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-emerald-700 tabular-nums">
                      {formatCurrency(c.estimated_gross_profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Inventory Valuation */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Inventory Asset Valuation</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Category</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Units On Hand</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Cost Value</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Retail Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reportData.inventory_valuation.map((v: any) => (
                  <tr key={v.category}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{v.category}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{v.total_units}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-700 tabular-nums">
                      {formatCurrency(v.cost_valuation)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(v.retail_valuation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sales Rep Performance */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Sales Representative Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Representative</th>
                <th className="py-2.5 px-4 font-semibold">Email</th>
                <th className="py-2.5 px-4 font-semibold text-right">Total Orders</th>
                <th className="py-2.5 px-4 font-semibold text-right">Confirmed Orders</th>
                <th className="py-2.5 px-4 font-semibold text-right">Confirmed Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reportData.sales_rep_performance.map((rep: any) => (
                <tr key={rep.email}>
                  <td className="py-2.5 px-4 font-medium text-slate-900">{rep.full_name}</td>
                  <td className="py-2.5 px-4 text-slate-600">{rep.email}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{rep.total_orders}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{rep.confirmed_orders}</td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(rep.total_revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Email Notification Audit Log with Retry */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Email Notification Audit Log</h2>
            <p className="text-[11px] text-slate-500">
              Tracks approval request, approved, and rejected emails with retry support on SMTP failure
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                <th className="py-2.5 px-4 font-semibold">Recipient</th>
                <th className="py-2.5 px-4 font-semibold">Subject &amp; Template</th>
                <th className="py-2.5 px-4 font-semibold">Order</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(emailData?.items || []).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                    {formatDateTime(log.created_at)}
                  </td>
                  <td className="py-2.5 px-4 text-slate-800">{log.recipient}</td>
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-slate-900">{log.subject}</p>
                    <p className="text-[11px] font-mono text-slate-500">{log.template_name}</p>
                    {log.error_message && <p className="text-[11px] text-rose-600 mt-0.5">{log.error_message}</p>}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-700">{log.order_number || '—'}</td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={log.status} />
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {log.status === 'FAILED' && (
                      <button
                        type="button"
                        onClick={() => retryMutation.mutate(log.id)}
                        disabled={retryMutation.isPending}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200 rounded hover:bg-blue-50"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
