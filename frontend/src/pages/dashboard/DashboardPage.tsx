import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { AdminDashboard } from './AdminDashboard';
import { ManagerDashboard } from './ManagerDashboard';
import { SalesDashboard } from './SalesDashboard';

export function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === 'MANAGER') {
    return <ManagerDashboard />;
  }
  if (user?.role === 'SALES_EMPLOYEE') {
    return <SalesDashboard />;
  }
  return <AdminDashboard />;
}
