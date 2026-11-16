import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatCurrency, formatDateTime } from '../../utils/format';

const settingsSchema = z.object({
  approval_threshold: z.coerce.number().min(0, 'Threshold must be 0 or greater'),
  company_name: z.string().trim().min(2, 'Company name is required'),
  currency_symbol: z.string().trim().min(1).max(4),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.get()).data,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema) as any,
    defaultValues: {
      approval_threshold: 50000,
      company_name: 'Meridian Industrial Supply Pvt. Ltd.',
      currency_symbol: '₹',
    },
  });

  useEffect(() => {
    if (settings) {
      reset({
        approval_threshold: settings.approval_threshold,
        company_name: settings.company_name,
        currency_symbol: settings.currency_symbol,
      });
    }
  }, [settings, reset]);

  const mutation = useMutation({
    mutationFn: (values: SettingsFormValues) => settingsApi.updateThreshold(values),
    onSuccess: () => {
      showToast('success', 'Settings Saved', 'Approval threshold and organization preferences updated.');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => showToast('error', 'Update Failed', extractErrorMessage(err)),
  });

  const previewThreshold = Number(watch('approval_threshold') || 0);
  const previewSymbol = watch('currency_symbol') || '₹';

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading system settings...</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">System Configuration</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure order approval thresholds, organization metadata, and SMTP notification status
        </p>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Order Approval Workflow Rule</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Orders up to {formatCurrency(previewThreshold, previewSymbol)} confirm automatically. Orders above{' '}
            {formatCurrency(previewThreshold, previewSymbol)} reserve stock and require manager approval.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Approval Threshold Amount *
            </label>
            <input
              type="number"
              step="100"
              min={0}
              {...register('approval_threshold')}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.approval_threshold && (
              <p className="text-xs text-rose-600 mt-1">{errors.approval_threshold.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Currency Symbol *</label>
            <input
              {...register('currency_symbol')}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Organization Name *</label>
          <input
            {...register('company_name')}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
          {errors.company_name && <p className="text-xs text-rose-600 mt-1">{errors.company_name.message}</p>}
        </div>

        <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-500 font-mono">
            Last updated: {formatDateTime(settings?.updated_at)}
          </span>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>

      {/* SMTP Configuration Status (Non-secret) */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">SMTP Email Integration Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <p className="text-slate-500">Delivery Mode</p>
            <p className="font-semibold text-slate-900 mt-0.5">
              {settings?.smtp_configured ? 'Live SMTP Transport' : 'Logged Queue (Env Unconfigured)'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">SMTP Host</p>
            <p className="font-mono text-slate-900 mt-0.5">{settings?.smtp_host || 'smtp.gmail.com'}</p>
          </div>
          <div>
            <p className="text-slate-500">Default Manager Recipient</p>
            <p className="font-mono text-slate-900 mt-0.5">{settings?.manager_email || 'manager@example.com'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
