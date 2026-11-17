import React, { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Package,
  Users,
  Boxes,
  ShoppingCart,
  CheckSquare,
  BarChart3,
  UserCog,
  Settings,
  LogOut,
  Menu,
  X,
  Search,
  Bell,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dashboardApi } from '../api/client';
import { roleLabel } from '../utils/format';

export function DashboardLayout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await dashboardApi.notifications()).data,
    refetchInterval: 30000,
    enabled: Boolean(user),
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    if (q.toUpperCase().startsWith('SO-')) {
      navigate(`/orders?search=${encodeURIComponent(q)}`);
    } else {
      navigate(`/products?search=${encodeURIComponent(q)}`);
    }
    setSearchQuery('');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: true },
    { to: '/products', label: 'Products', icon: Package, visible: true },
    { to: '/customers', label: 'Customers', icon: Users, visible: true },
    { to: '/inventory', label: 'Inventory', icon: Boxes, visible: true },
    { to: '/orders', label: 'Sales Orders', icon: ShoppingCart, visible: true },
    {
      to: '/approvals',
      label: 'Approvals',
      icon: CheckSquare,
      visible: hasRole('ADMIN', 'MANAGER'),
    },
    {
      to: '/reports',
      label: 'Reports',
      icon: BarChart3,
      visible: hasRole('ADMIN', 'MANAGER'),
    },
    {
      to: '/users',
      label: 'User Management',
      icon: UserCog,
      visible: hasRole('ADMIN'),
    },
    {
      to: '/settings',
      label: 'Settings',
      icon: Settings,
      visible: hasRole('ADMIN'),
    },
  ].filter((item) => item.visible);

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const notifications = notifData?.items || [];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200 w-64 select-none">
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800 shrink-0">
        <Link to="/dashboard" className="text-base font-bold tracking-tight text-white whitespace-nowrap">
          Meridian ERP
        </Link>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden p-1 text-slate-400 hover:text-white"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800 space-y-1 shrink-0">
        <NavLink
          to="/profile"
          onClick={() => setSidebarOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`
          }
        >
          <UserIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">My Profile</span>
        </NavLink>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-rose-300 transition-colors whitespace-nowrap"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>

      {/* Mobile Sidebar Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/60"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50 h-full">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            <form onSubmit={handleSearchSubmit} className="relative max-w-md w-full hidden sm:block">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products, SKUs, or order numbers (SO-...)..."
                className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"
              />
            </form>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <span className="hidden md:inline text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
              {todayFormatted}
            </span>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                aria-label="Toggle notifications"
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
              >
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                    {notifications.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-30 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">Action Alerts</span>
                      <span className="text-xs text-slate-500 tabular-nums">{notifications.length} active</span>
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-slate-500">
                          All operational alerts are cleared.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              navigate(n.link);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                          >
                            <p className="text-xs font-semibold text-slate-900 truncate">{n.title}</p>
                            <p className="text-xs text-slate-500 mt-0.5 truncate">{n.subtitle}</p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Profile & Role Indicator */}
            <Link
              to="/profile"
              className="flex items-center gap-2.5 pl-3 border-l border-slate-200 hover:opacity-90"
            >
              <div className="w-8 h-8 rounded-md bg-slate-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                {user?.full_name
                  ?.split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <p className="text-xs font-semibold text-slate-900 whitespace-nowrap">{user?.full_name}</p>
                <p className="text-[11px] text-slate-500 whitespace-nowrap">{roleLabel(user?.role || '')}</p>
              </div>
            </Link>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
