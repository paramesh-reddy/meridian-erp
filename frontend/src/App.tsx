import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './layouts/DashboardLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { ProductFormPage } from './pages/products/ProductFormPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { CustomerFormPage } from './pages/customers/CustomerFormPage';
import { CustomerDetailsPage } from './pages/customers/CustomerDetailsPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { InventoryAdjustPage } from './pages/inventory/InventoryAdjustPage';
import { OrdersPage } from './pages/orders/OrdersPage';
import { CreateOrderPage } from './pages/orders/CreateOrderPage';
import { OrderDetailsPage } from './pages/orders/OrderDetailsPage';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage';
import { ApprovalDetailsPage } from './pages/approvals/ApprovalDetailsPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { UsersPage } from './pages/users/UsersPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { ProfilePage } from './pages/profile/ProfilePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<RootRedirect />} />

              <Route
                element={
                  <ProtectedRoute>
                    <DashboardLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<DashboardPage />} />

                {/* Products */}
                <Route path="/products" element={<ProductsPage />} />
                <Route
                  path="/products/new"
                  element={
                    <ProtectedRoute roles={['ADMIN']}>
                      <ProductFormPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/products/:id/edit"
                  element={
                    <ProtectedRoute roles={['ADMIN']}>
                      <ProductFormPage />
                    </ProtectedRoute>
                  }
                />

                {/* Customers */}
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/new" element={<CustomerFormPage />} />
                <Route path="/customers/:id" element={<CustomerDetailsPage />} />
                <Route path="/customers/:id/edit" element={<CustomerFormPage />} />

                {/* Inventory */}
                <Route path="/inventory" element={<InventoryPage />} />
                <Route
                  path="/inventory/adjust"
                  element={
                    <ProtectedRoute roles={['ADMIN', 'MANAGER']}>
                      <InventoryAdjustPage />
                    </ProtectedRoute>
                  }
                />

                {/* Sales Orders */}
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/orders/new" element={<CreateOrderPage />} />
                <Route path="/orders/:id" element={<OrderDetailsPage />} />

                {/* Manager Approvals */}
                <Route
                  path="/approvals"
                  element={
                    <ProtectedRoute roles={['ADMIN', 'MANAGER']}>
                      <ApprovalsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/approvals/:id"
                  element={
                    <ProtectedRoute roles={['ADMIN', 'MANAGER']}>
                      <ApprovalDetailsPage />
                    </ProtectedRoute>
                  }
                />

                {/* Reports */}
                <Route
                  path="/reports"
                  element={
                    <ProtectedRoute roles={['ADMIN', 'MANAGER']}>
                      <ReportsPage />
                    </ProtectedRoute>
                  }
                />

                {/* User Management & Settings */}
                <Route
                  path="/users"
                  element={
                    <ProtectedRoute roles={['ADMIN']}>
                      <UsersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute roles={['ADMIN']}>
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />

                {/* Profile */}
                <Route path="/profile" element={<ProfilePage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
