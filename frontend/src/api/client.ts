import axios from 'axios';
import type {
  ApprovalRecord,
  Customer,
  EmailLog,
  InventoryItem,
  InventoryTransaction,
  NotificationItem,
  Product,
  SalesOrder,
  SystemSettings,
  User,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const ACCESS_KEY = 'meridian_access_token';
const REFRESH_KEY = 'meridian_refresh_token';

export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setTokens: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccess();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      const refreshToken = tokenStorage.getRefresh();
      if (!refreshToken) {
        tokenStorage.clear();
        return Promise.reject(error);
      }

      originalRequest._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
            .then((resp) => {
              tokenStorage.setTokens(resp.data.access_token, resp.data.refresh_token);
              return resp.data.access_token as string;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }
        const newAccess = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return api(originalRequest);
      } catch (refreshError) {
        tokenStorage.clear();
        window.dispatchEvent(new Event('auth:session-expired'));
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ access_token: string; refresh_token: string; user: User }>('/auth/login', { email, password }),
  logout: (refreshToken: string | null) =>
    api.post('/auth/logout', { refresh_token: refreshToken }),
  me: () => api.get<User>('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),
};

export const usersApi = {
  list: () => api.get<{ items: User[]; total: number }>('/users'),
  create: (data: { email: string; full_name: string; password: string; role: string; is_active?: boolean }) =>
    api.post<User>('/users', data),
  update: (id: number, data: Partial<{ full_name: string; role: string; is_active: boolean; password: string }>) =>
    api.put<User>(`/users/${id}`, data),
  delete: (id: number) => api.delete<{ message: string; deactivated: boolean }>(`/users/${id}`),
};

export const productsApi = {
  list: (params?: Record<string, string | number | undefined>) =>
    api.get<{
      items: Product[];
      total: number;
      page: number;
      page_size: number;
      total_pages: number;
      categories: string[];
    }>('/products', { params }),
  get: (id: number) => api.get<Product>(`/products/${id}`),
  create: (data: Record<string, unknown>) => api.post<Product>('/products', data),
  update: (id: number, data: Record<string, unknown>) => api.put<Product>(`/products/${id}`, data),
  delete: (id: number) => api.delete<{ message: string; deactivated: boolean }>(`/products/${id}`),
};

export const customersApi = {
  list: (params?: Record<string, string | number | undefined>) =>
    api.get<{ items: Customer[]; total: number; page: number; page_size: number; total_pages: number }>('/customers', {
      params,
    }),
  get: (id: number) =>
    api.get<
      Customer & {
        orders: Array<{
          id: number;
          order_number: string;
          order_date: string;
          grand_total: number;
          status: string;
          sales_rep: string;
        }>;
      }
    >(`/customers/${id}`),
  create: (data: Record<string, unknown>) => api.post<Customer>('/customers', data),
  update: (id: number, data: Record<string, unknown>) => api.put<Customer>(`/customers/${id}`, data),
  delete: (id: number) => api.delete<{ message: string; deactivated: boolean }>(`/customers/${id}`),
};

export const inventoryApi = {
  list: (params?: { search?: string; low_stock?: string }) =>
    api.get<{ items: InventoryItem[]; total: number }>('/inventory', { params }),
  lowStock: () => api.get<{ items: InventoryItem[]; total: number }>('/inventory/low-stock'),
  transactions: (productId?: number) =>
    api.get<{ items: InventoryTransaction[]; total: number }>('/inventory/transactions', {
      params: productId ? { product_id: productId } : undefined,
    }),
  adjust: (data: {
    product_id: number;
    transaction_type: 'STOCK_IN' | 'STOCK_ADJUSTMENT';
    quantity_delta: number;
    reason: string;
  }) => api.post('/inventory/adjustments', data),
};

export const ordersApi = {
  list: (params?: Record<string, string | number | undefined>) =>
    api.get<{ items: SalesOrder[]; total: number; page: number; page_size: number; total_pages: number }>('/orders', {
      params,
    }),
  get: (id: number) => api.get<SalesOrder>(`/orders/${id}`),
  create: (data: {
    customer_id: number;
    order_date: string;
    expected_delivery_date?: string | null;
    discount_amount: number;
    tax_amount: number;
    notes: string;
    items: Array<{ product_id: number; quantity: number }>;
  }) => api.post<SalesOrder>('/orders', data),
  updateStatus: (id: number, status: string) => api.put(`/orders/${id}`, { status }),
  cancel: (id: number) => api.post(`/orders/${id}/cancel`),
};

export const approvalsApi = {
  pending: () => api.get<{ items: ApprovalRecord[]; total: number }>('/approvals/pending'),
  history: () => api.get<{ items: ApprovalRecord[]; total: number }>('/approvals/history'),
  get: (id: number) => api.get<ApprovalRecord>(`/approvals/${id}`),
  approve: (id: number) => api.post(`/approvals/${id}/approve`),
  reject: (id: number, rejection_reason: string) => api.post(`/approvals/${id}/reject`, { rejection_reason }),
};

export const dashboardApi = {
  admin: () => api.get('/dashboard/admin'),
  sales: () => api.get('/dashboard/sales'),
  manager: () => api.get('/dashboard/manager'),
  notifications: () => api.get<{ items: NotificationItem[]; count: number }>('/dashboard/notifications'),
  reportsSummary: () => api.get('/reports/summary'),
};

export const settingsApi = {
  get: () => api.get<SystemSettings>('/settings'),
  updateThreshold: (data: { approval_threshold: number; company_name?: string; currency_symbol?: string }) =>
    api.put<SystemSettings>('/settings/approval-threshold', data),
  emailLogs: () => api.get<{ items: EmailLog[]; total: number }>('/emails'),
  retryEmail: (id: number) => api.post<{ status: string; errorMessage: string | null }>(`/emails/${id}/retry`),
};
