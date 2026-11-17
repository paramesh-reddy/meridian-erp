export function formatCurrency(amount: number | undefined | null, symbol = '₹'): string {
  const val = Number(amount ?? 0);
  return `${symbol}${val.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCompactCurrency(amount: number | undefined | null, symbol = '₹'): string {
  const val = Number(amount ?? 0);
  if (val >= 10000000) return `${symbol}${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `${symbol}${(val / 100000).toFixed(2)} L`;
  if (val >= 1000) return `${symbol}${(val / 1000).toFixed(1)}K`;
  return `${symbol}${val.toFixed(0)}`;
}

export function formatDate(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '—';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return isoOrDate;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'MANAGER':
      return 'Approvals Manager';
    case 'SALES_EMPLOYEE':
      return 'Sales Representative';
    default:
      return role;
  }
}

export function extractErrorMessage(err: unknown, fallback = 'Operation failed. Please try again.'): string {
  if (typeof err === 'object' && err !== null) {
    const maybeAxios = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
    if (maybeAxios.response?.data?.detail) return maybeAxios.response.data.detail;
    if (maybeAxios.response?.data?.message) return maybeAxios.response.data.message;
    if (maybeAxios.message) return maybeAxios.message;
  }
  return fallback;
}
