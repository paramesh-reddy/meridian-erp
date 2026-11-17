import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, roleLabel } from '../../utils/format';

const changePwdSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(8, 'New password must be at least 8 characters'),
    confirm_password: z.string().min(8, 'Confirm your new password'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'New passwords do not match',
    path: ['confirm_password'],
  });

type ChangePwdValues = z.infer<typeof changePwdSchema>;

export function ProfilePage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePwdValues>({
    resolver: zodResolver(changePwdSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  const mutation = useMutation({
    mutationFn: (v: ChangePwdValues) => authApi.changePassword(v.current_password, v.new_password),
    onSuccess: () => {
      showToast('success', 'Password Updated', 'Your account password has been changed.');
      reset();
    },
    onError: (err) => showToast('error', 'Password Change Failed', extractErrorMessage(err)),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">User Profile &amp; Security</h1>
        <p className="text-xs text-slate-500 mt-0.5">Review your role permissions and update your password</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div>
          <p className="text-slate-500">Full Name</p>
          <p className="text-sm font-semibold text-slate-900 mt-0.5">{user?.full_name}</p>
        </div>
        <div>
          <p className="text-slate-500">Email Address</p>
          <p className="text-sm font-medium text-slate-900 mt-0.5">{user?.email}</p>
        </div>
        <div>
          <p className="text-slate-500">Assigned Role</p>
          <p className="text-sm font-semibold text-blue-700 mt-0.5">{roleLabel(user?.role || '')}</p>
        </div>
        <div>
          <p className="text-slate-500">Account Status</p>
          <p className="text-sm font-semibold text-emerald-700 mt-0.5">
            {user?.is_active ? 'Active' : 'Inactive'}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
      >
        <h2 className="text-sm font-semibold text-slate-900">Change Password</h2>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Current Password *</label>
          <input
            type="password"
            {...register('current_password')}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
          {errors.current_password && (
            <p className="text-xs text-rose-600 mt-1">{errors.current_password.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">New Password *</label>
            <input
              type="password"
              {...register('new_password')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.new_password && (
              <p className="text-xs text-rose-600 mt-1">{errors.new_password.message}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Confirm New Password *</label>
            <input
              type="password"
              {...register('confirm_password')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.confirm_password && (
              <p className="text-xs text-rose-600 mt-1">{errors.confirm_password.message}</p>
            )}
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
          >
            {mutation.isPending ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </form>
    </div>
  );
}
