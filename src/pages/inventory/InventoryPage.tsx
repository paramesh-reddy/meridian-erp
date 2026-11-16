import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal, AlertTriangle, Boxes } from 'lucide-react';
import { inventoryApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { TableSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';

export function InventoryPage() {
  const { hasRole } = useAuth();
  const canAdjust = hasRole('ADMIN', 'MANAGER');
  const [urlParams] = useSearchParams();

  const [tab, setTab] = useState<'stock' | 'ledger'>('stock');
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(urlParams.get('low_stock') === 'true');

  const { data: stockData, isLoading: loadingStock } = useQuery({
    queryKey: ['inventory', { search, lowStockOnly }],
    queryFn: async () =>
      (
        await inventoryApi.list({
          search: search || undefined,
          low_stock: lowStockOnly ? 'true' : undefined,
        })
      ).data,
  });

  const { data: txData, isLoading: loadingTx } = useQuery({
    queryKey: ['inventory', 'transactions'],
    queryFn: async () => (await inventoryApi.transactions()).data,
    enabled: tab === 'ledger',
  });

  const items = stockData?.items || [];
  const lowCount = items.filter((i) => i.available_quantity <= i.minimum_stock_level).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Inventory &amp; Stock Ledger</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Available Quantity = Quantity On Hand − Reserved Quantity
          </p>
        </div>
        {canAdjust && (
          <Link
            to="/inventory/adjust"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md whitespace-nowrap self-start"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Record Stock Adjustment
          </Link>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('stock')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              tab === 'stock' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Current Stock Levels
          </button>
          <button
            type="button"
            onClick={() => setTab('ledger')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              tab === 'ledger' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Stock Movement History
          </button>
        </div>

        {lowCount > 0 && tab === 'stock' && (
          <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-md">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="font-medium tabular-nums">{lowCount} SKU(s) at or below minimum stock level</span>
          </div>
        )}
      </div>

      {tab === 'stock' ? (
        <>
          <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search inventory by SKU or product name..."
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer px-2">
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(e) => setLowStockOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              Show Low-Stock Only
            </label>
          </div>

          {loadingStock ? (
            <TableSkeleton rows={6} cols={7} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No inventory records match your filter"
              description="Clear the low-stock or search filter to view all warehouse inventory."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-semibold">SKU</th>
                      <th className="py-3 px-4 font-semibold">Product</th>
                      <th className="py-3 px-4 font-semibold">Category</th>
                      <th className="py-3 px-4 font-semibold text-right">On Hand</th>
                      <th className="py-3 px-4 font-semibold text-right">Reserved</th>
                      <th className="py-3 px-4 font-semibold text-right">Available</th>
                      <th className="py-3 px-4 font-semibold text-right">Min Level</th>
                      <th className="py-3 px-4 font-semibold">Stock State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const stockState =
                        item.available_quantity <= 0
                          ? 'OUT_OF_STOCK'
                          : item.available_quantity <= item.minimum_stock_level
                          ? 'LOW_STOCK'
                          : 'IN_STOCK';
                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-mono font-semibold text-slate-900">{item.sku}</td>
                          <td className="py-3 px-4 font-medium text-slate-900">{item.product_name}</td>
                          <td className="py-3 px-4 text-slate-600">{item.category}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-900 tabular-nums">
                            {item.quantity_on_hand}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-amber-700 tabular-nums">
                            {item.reserved_quantity}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                            {item.available_quantity}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums">
                            {item.minimum_stock_level}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={stockState} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : loadingTx ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Timestamp</th>
                  <th className="py-3 px-4 font-semibold">Product</th>
                  <th className="py-3 px-4 font-semibold">Type</th>
                  <th className="py-3 px-4 font-semibold text-right">Qty</th>
                  <th className="py-3 px-4 font-semibold text-right">Prev → New</th>
                  <th className="py-3 px-4 font-semibold">Reference</th>
                  <th className="py-3 px-4 font-semibold">Performed By &amp; Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(txData?.items || []).map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {formatDateTime(tx.created_at)}
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-slate-900">{tx.product_name}</p>
                      <p className="text-[11px] font-mono text-slate-500">{tx.sku}</p>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={tx.transaction_type} />
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {tx.quantity}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-600 tabular-nums">
                      {tx.previous_quantity} → {tx.new_quantity}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-blue-600">
                      {tx.reference_order_id ? (
                        <Link to={`/orders/${tx.reference_order_id}`} className="hover:underline">
                          {tx.reference_order_number || `#${tx.reference_order_id}`}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="text-slate-900 font-medium">{tx.performed_by_name}</p>
                      <p className="text-[11px] text-slate-500">{tx.reason}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
