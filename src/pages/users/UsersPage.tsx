import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { usersApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage, formatDate, roleLabel } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import type { User, UserRole } from '../../types';

const createUserSchema = z.object({
  email: z.string().email('Enter a valid email'),
  full_name: z.string().min(2, 'Full name is required'),
  password: z.string().min(8, 'Minimum 8 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'SALES_EMPLOYEE']),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('SALES_EMPLOYEE');
  const [editActive, setEditActive] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.list()).data,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', full_name: '', password: '', role: 'SALES_EMPLOYEE' },
  });

  const createMutation = useMutation({
    mutationFn: (v: CreateUserValues) => usersApi.create(v),
    onSuccess: () => {
      showToast('success', 'User created');
      setCreateOpen(false);
      reset();
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => showToast('error', 'Creation failed', extractErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { full_name: string; role: UserRole; is_active: boolean } }) =>
      usersApi.update(id, payload),
    onSuccess: () => {
      showToast('success', 'User updated');
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => showToast('error', 'Update failed', extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: (resp) => {
      showToast('info', resp.data.deactivated ? 'User Deactivated' : 'User Deleted', resp.data.message);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => showToast('error', 'Action failed', extractErrorMessage(err)),
  });

  const openEdit = (u: User) => {
    setEditTarget(u);
    setEditName(u.full_name);
    setEditRole(u.role);
    setEditActive(u.is_active);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">User &amp; Role Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Provision user accounts and assign Admin, Manager, or Sales Employee permissions
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md self-start"
        >
          <Plus className="w-4 h-4" />
          Provision User
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-sm text-slate-500">Loading users...</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold">Full Name</th>
                  <th className="py-3 px-4 font-semibold">Email</th>
                  <th className="py-3 px-4 font-semibold">Assigned Role</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Created</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.items || []).map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {u.full_name}
                      {u.id === currentUser?.id && (
                        <span className="ml-2 text-[11px] font-normal text-blue-600">(You)</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{u.email}</td>
                    <td className="py-3 px-4 font-medium text-slate-800">{roleLabel(u.role)}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 tabular-nums">{formatDate(u.created_at)}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                          title="Edit User"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 rounded hover:bg-rose-50"
                            title="Delete or Deactivate"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Provision New User">
        <form onSubmit={handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
            <input
              {...register('full_name')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.full_name && <p className="text-xs text-rose-600 mt-1">{errors.full_name.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Work Email *</label>
            <input
              type="email"
              {...register('email')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.email && <p className="text-xs text-rose-600 mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Role *</label>
            <select
              {...register('role')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
            >
              <option value="SALES_EMPLOYEE">Sales Employee</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Temporary Password *</label>
            <input
              type="password"
              {...register('password')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.password && <p className="text-xs text-rose-600 mt-1">{errors.password.message}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              {createMutation.isPending ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={`Edit User — ${editTarget?.email || ''}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!editTarget) return;
            updateMutation.mutate({
              id: editTarget.id,
              payload: { full_name: editName, role: editRole, is_active: editActive },
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
            <input
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="SALES_EMPLOYEE">Sales Employee</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={editActive}
              onChange={(e) => setEditActive(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Account Active
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Remove User Account"
        message={`Remove "${deleteTarget?.full_name}" (${deleteTarget?.email})? Users who have created historical orders will be deactivated instead of permanently deleted.`}
        confirmLabel="Proceed"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
