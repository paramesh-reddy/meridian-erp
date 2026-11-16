import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { customersApi } from '../../api/client';
import { formatCurrency, formatDate } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';

export function CustomerDetailsPage() {
  const { id } = useParams();
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await customersApi.get(Number(id))).data,
  });

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading customer profile...</div>;
  }
  if (!customer) {
    return <div className="p-8 text-sm text-rose-600">Customer not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/customers" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Customers
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-xl font-bold text-slate-900">{customer.company_name || customer.name}</h1>
            <StatusBadge status={customer.is_active ? 'ACTIVE' : 'INACTIVE'} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Primary Contact: {customer.name}</p>
        </div>
        <Link
          to={`/customers/${customer.id}/edit`}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 self-start"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit Customer
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-2">
          <h2 className="font-semibold text-slate-900 text-sm">Contact Details</h2>
          <p className="text-slate-600">
            Email: <span className="text-slate-900 font-medium">{customer.email}</span>
          </p>
          <p className="text-slate-600">
            Phone: <span className="text-slate-900 font-mono">{customer.phone}</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="font-semibold text-slate-900 text-sm">Billing Address</h2>
          <p className="text-slate-600">{customer.billing_address || '—'}</p>
          <p className="text-slate-600">
            {[customer.city, customer.state, customer.postal_code].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5 text-xs space-y-1.5">
          <h2 className="font-semibold text-slate-900 text-sm">Shipping Address</h2>
          <p className="text-slate-600">{customer.shipping_address || customer.billing_address || '—'}</p>
          <p className="text-slate-600">
            {[customer.city, customer.state, customer.postal_code].filter(Boolean).join(', ')}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Customer Order History</h2>
          <span className="text-xs text-slate-500 tabular-nums">{customer.orders.length} orders</span>
        </div>
        {customer.orders.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 text-center">No sales orders recorded for this customer yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Order #</th>
                  <th className="py-2.5 px-4 font-semibold">Order Date</th>
                  <th className="py-2.5 px-4 font-semibold">Sales Representative</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Grand Total</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customer.orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">
                      <Link to={`/orders/${o.id}`} className="hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 tabular-nums">{formatDate(o.order_date)}</td>
                    <td className="py-2.5 px-4 text-slate-700">{o.sales_rep}</td>
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
        )}
      </div>
    </div>
  );
}
