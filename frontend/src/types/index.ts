export type UserRole = 'ADMIN' | 'MANAGER' | 'SALES_EMPLOYEE';

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  category: string;
  unit_price: number;
  cost_price: number;
  minimum_stock_level: number;
  status: 'ACTIVE' | 'INACTIVE';
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  company_name: string;
  email: string;
  phone: string;
  billing_address: string;
  shipping_address: string;
  city: string;
  state: string;
  postal_code: string;
  is_active: boolean;
  order_count?: number;
  total_spend?: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  unit_price?: number;
  product_status?: 'ACTIVE' | 'INACTIVE';
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  minimum_stock_level: number;
  updated_at: string;
}

export interface InventoryTransaction {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  transaction_type: 'STOCK_IN' | 'STOCK_ADJUSTMENT' | 'STOCK_RESERVED' | 'STOCK_RELEASED' | 'STOCK_DEDUCTED';
  quantity: number;
  reference_order_id: number | null;
  reference_order_number: string | null;
  previous_quantity: number;
  new_quantity: number;
  performed_by: number;
  performed_by_name: string;
  reason: string;
  created_at: string;
}

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface SalesOrderItem {
  id: number;
  order_id: number;
  product_id: number;
  sku: string;
  product_name: string;
  category?: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  current_available_stock?: number;
  quantity_on_hand?: number;
  reserved_quantity?: number;
  available_quantity?: number;
}

export interface SalesOrder {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_company: string;
  customer_email?: string;
  customer_phone?: string;
  customer_shipping_address?: string;
  customer_city?: string;
  customer_state?: string;
  created_by: number;
  created_by_name: string;
  created_by_email?: string;
  order_date: string;
  expected_delivery_date: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  grand_total: number;
  status: OrderStatus;
  notes: string;
  approval_id: number | null;
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  rejection_reason?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  items?: SalesOrderItem[];
}

export interface ApprovalRecord {
  id: number;
  order_id: number;
  order_number: string;
  order_date: string;
  expected_delivery_date?: string | null;
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  grand_total: number;
  order_status?: OrderStatus;
  notes?: string;
  requested_by: number;
  requested_by_name: string;
  requested_by_email?: string;
  reviewed_by: number | null;
  reviewed_by_name?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejection_reason: string | null;
  order_amount: number;
  requested_at: string;
  reviewed_at: string | null;
  customer_name: string;
  customer_company: string;
  customer_email?: string;
  customer_phone?: string;
  customer_city?: string;
  items?: SalesOrderItem[];
}

export interface SystemSettings {
  id: number;
  approval_threshold: number;
  currency_symbol: string;
  company_name: string;
  updated_at: string;
  smtp_configured?: boolean;
  smtp_host?: string;
  manager_email?: string;
}

export interface EmailLog {
  id: number;
  recipient: string;
  subject: string;
  template_name: string;
  body_html: string;
  reference_order_id: number | null;
  order_number: string | null;
  status: 'SENT' | 'QUEUED_SIMULATED' | 'FAILED';
  error_message: string | null;
  retry_count: number;
  created_at: string;
  sent_at: string | null;
}

export interface NotificationItem {
  id: string;
  type: 'APPROVAL' | 'ORDER' | 'LOW_STOCK';
  title: string;
  subtitle: string;
  link: string;
}
