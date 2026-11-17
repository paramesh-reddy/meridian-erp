import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, Lock, Mail, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { extractErrorMessage } from '../../utils/format';

const loginSchema = z.object({
  email: z.string().email('Enter a valid work email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@example.com', password: 'Password123!', name: 'Arjun Mehta' },
  { label: 'Manager', email: 'manager@example.com', password: 'Password123!', name: 'Priya Nair' },
  { label: 'Sales Rep', email: 'sales@example.com', password: 'Password123!', name: 'Rohan Sharma' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setServerError(extractErrorMessage(err, 'Invalid credentials. Please try again.'));
    }
  };

  const fillDemo = (email: string, password: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', password, { shouldValidate: true });
    setServerError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Enterprise Overview Panel */}
      <div className="lg:w-5/12 bg-slate-900 text-white p-8 lg:p-12 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Meridian ERP</span>
          </div>

          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight mt-10 leading-tight max-w-md">
            Sales &amp; Inventory Operations Console
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed mt-4 max-w-md">
            Unified product catalog, real-time stock reservation, configurable approval thresholds, and verifiable audit trails for B2B distribution teams.
          </p>
        </div>

        <div className="mt-10 pt-8 border-t border-slate-800 space-y-3 text-xs text-slate-400">
          <div className="flex items-center justify-between">
            <span>Transactional Stock Control</span>
            <span className="text-slate-200 font-mono">ACID Verified</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Approval Routing</span>
            <span className="text-slate-200 font-mono">Threshold &amp; SMTP</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Access Control</span>
            <span className="text-slate-200 font-mono">JWT · RBAC (3 Roles)</span>
          </div>
        </div>
      </div>

      {/* Right Sign-In Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-7">
          <h2 className="text-xl font-bold text-slate-900">Sign in to your workspace</h2>
          <p className="text-xs text-slate-500 mt-1">
            Enter your corporate credentials to access Meridian ERP.
          </p>

          {serverError && (
            <div className="mt-4 p-3 rounded-md bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>
              {errors.email && <p className="text-xs text-rose-600 mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...register('password')}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>
              {errors.password && <p className="text-xs text-rose-600 mt-1">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Seeded Development Accounts Helper */}
          <div className="mt-7 pt-5 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-700">Development Seed Accounts</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Click any role below to autofill credentials (dev password: <span className="font-mono text-slate-700">Password123!</span>).
            </p>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => fillDemo(acc.email, acc.password)}
                  className="px-2.5 py-2 text-left border border-slate-200 rounded-md hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                >
                  <p className="text-xs font-semibold text-slate-900">{acc.label}</p>
                  <p className="text-[11px] text-slate-500 truncate">{acc.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
