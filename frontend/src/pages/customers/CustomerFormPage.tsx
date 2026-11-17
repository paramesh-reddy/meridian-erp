import React, { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { customersApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { extractErrorMessage } from '../../utils/format';

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Contact name is required'),
  company_name: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d\s()-]{7,30}$/, 'Enter a valid phone number (min 7 digits)'),
  billing_address: z.string().trim().optional(),
  shipping_address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postal_code: z.string().trim().optional(),
  is_active: z.boolean(),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

export function CustomerFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: existing, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await customersApi.get(Number(id))).data,
    enabled: isEdit,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: '',
      company_name: '',
      email: '',
      phone: '',
      billing_address: '',
      shipping_address: '',
      city: '',
      state: '',
      postal_code: '',
      is_active: true,
    },
  });

  useEffect(() => {
    if (existing) {
      reset({
        name: existing.name,
        company_name: existing.company_name,
        email: existing.email,
        phone: existing.phone,
        billing_address: existing.billing_address,
        shipping_address: existing.shipping_address,
        city: existing.city,
        state: existing.state,
        postal_code: existing.postal_code,
        is_active: existing.is_active,
      });
    }
  }, [existing, reset]);

  const mutation = useMutation({
    mutationFn: (values: CustomerFormValues) =>
      isEdit ? customersApi.update(Number(id), values) : customersApi.create(values),
    onSuccess: () => {
      showToast('success', isEdit ? 'Customer updated' : 'Customer created');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate('/customers');
    },
    onError: (err) => showToast('error', 'Save failed', extractErrorMessage(err)),
  });

  if (isEdit && isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading customer details...</div>;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link to="/customers" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Customers
        </Link>
        <h1 className="text-xl font-bold text-slate-900 mt-2">
          {isEdit ? `Edit Customer — ${existing?.company_name || existing?.name}` : 'Add New Customer'}
        </h1>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Contact Name *</label>
            <input
              {...register('name')}
              placeholder="Vikramaditya Rao"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Company Name</label>
            <input
              {...register('company_name')}
              placeholder="TechNova Solutions Pvt. Ltd."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address *</label>
            <input
              type="email"
              {...register('email')}
              placeholder="procurement@technova.in"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.email && <p className="text-xs text-rose-600 mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Phone Number *</label>
            <input
              {...register('phone')}
              placeholder="+91-9845011223"
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
            {errors.phone && <p className="text-xs text-rose-600 mt-1">{errors.phone.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Billing Address</label>
            <textarea
              rows={2}
              {...register('billing_address')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Shipping Address</label>
            <textarea
              rows={2}
              {...register('shipping_address')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">City</label>
            <input
              {...register('city')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">State</label>
            <input
              {...register('state')}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Postal Code</label>
            <input
              {...register('postal_code')}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
          <input type="checkbox" {...register('is_active')} className="rounded border-slate-300 text-blue-600" />
          Account Active (eligible for new sales orders)
        </label>

        <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <Link
            to="/customers"
            className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : isEdit ? 'Update Customer' : 'Create Customer'}
          </button>
        </div>
      </form>
    </div>
  );
}
