import nodemailer from 'nodemailer';
import type { DatabaseSync } from 'node:sqlite';

export interface EmailPayload {
  recipient: string;
  subject: string;
  templateName: string;
  bodyHtml: string;
  referenceOrderId?: number | null;
}

export interface EmailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<unknown>;
}

function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  return Boolean(
    host &&
      user &&
      pass &&
      user !== 'your_email@example.com' &&
      pass !== 'your_app_password'
  );
}

export class EmailService {
  private db: DatabaseSync;
  private customTransport?: EmailTransport;

  constructor(db: DatabaseSync, customTransport?: EmailTransport) {
    this.db = db;
    this.customTransport = customTransport;
  }

  private getTransport(): EmailTransport | null {
    if (this.customTransport) {
      return this.customTransport;
    }
    if (!isSmtpConfigured()) {
      return null;
    }
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
    return transporter;
  }

  public async sendAndLog(payload: EmailPayload): Promise<{ id: number; status: string; errorMessage: string | null }> {
    const now = new Date().toISOString();
    const fromAddress = `"${process.env.SMTP_FROM_NAME || 'Meridian ERP'}" <${process.env.SMTP_USER || 'noreply@meridian-erp.local'}>`;
    const transport = this.getTransport();

    if (!transport) {
      // No external SMTP credentials configured in env: record cleanly as QUEUED_SIMULATED so approval workflow never blocks
      const res = this.db
        .prepare(
          `INSERT INTO email_logs (recipient, subject, template_name, body_html, reference_order_id, status, error_message, retry_count, created_at, sent_at)
           VALUES (?, ?, ?, ?, ?, 'QUEUED_SIMULATED', NULL, 0, ?, ?)`
        )
        .run(
          payload.recipient,
          payload.subject,
          payload.templateName,
          payload.bodyHtml,
          payload.referenceOrderId ?? null,
          now,
          now
        );
      return { id: Number(res.lastInsertRowid), status: 'QUEUED_SIMULATED', errorMessage: null };
    }

    try {
      await transport.sendMail({
        from: fromAddress,
        to: payload.recipient,
        subject: payload.subject,
        html: payload.bodyHtml,
      });
      const res = this.db
        .prepare(
          `INSERT INTO email_logs (recipient, subject, template_name, body_html, reference_order_id, status, error_message, retry_count, created_at, sent_at)
           VALUES (?, ?, ?, ?, ?, 'SENT', NULL, 0, ?, ?)`
        )
        .run(
          payload.recipient,
          payload.subject,
          payload.templateName,
          payload.bodyHtml,
          payload.referenceOrderId ?? null,
          now,
          now
        );
      return { id: Number(res.lastInsertRowid), status: 'SENT', errorMessage: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown SMTP error';
      console.error('[EmailService] Delivery failed (non-blocking):', errorMessage);
      const res = this.db
        .prepare(
          `INSERT INTO email_logs (recipient, subject, template_name, body_html, reference_order_id, status, error_message, retry_count, created_at, sent_at)
           VALUES (?, ?, ?, ?, ?, 'FAILED', ?, 0, ?, NULL)`
        )
        .run(
          payload.recipient,
          payload.subject,
          payload.templateName,
          payload.bodyHtml,
          payload.referenceOrderId ?? null,
          errorMessage,
          now
        );
      return { id: Number(res.lastInsertRowid), status: 'FAILED', errorMessage };
    }
  }

  public async retryEmail(logId: number): Promise<{ status: string; errorMessage: string | null }> {
    const row = this.db.prepare('SELECT * FROM email_logs WHERE id = ?').get(logId) as
      | {
          id: number;
          recipient: string;
          subject: string;
          body_html: string;
          status: string;
          retry_count: number;
        }
      | undefined;

    if (!row) {
      throw new Error('Email log not found');
    }

    const transport = this.getTransport();
    const now = new Date().toISOString();
    const fromAddress = `"${process.env.SMTP_FROM_NAME || 'Meridian ERP'}" <${process.env.SMTP_USER || 'noreply@meridian-erp.local'}>`;

    if (!transport) {
      this.db
        .prepare(
          `UPDATE email_logs SET status = 'QUEUED_SIMULATED', error_message = NULL, retry_count = retry_count + 1, sent_at = ? WHERE id = ?`
        )
        .run(now, logId);
      return { status: 'QUEUED_SIMULATED', errorMessage: null };
    }

    try {
      await transport.sendMail({
        from: fromAddress,
        to: row.recipient,
        subject: row.subject,
        html: row.body_html,
      });
      this.db
        .prepare(
          `UPDATE email_logs SET status = 'SENT', error_message = NULL, retry_count = retry_count + 1, sent_at = ? WHERE id = ?`
        )
        .run(now, logId);
      return { status: 'SENT', errorMessage: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'SMTP retry failed';
      this.db
        .prepare(
          `UPDATE email_logs SET status = 'FAILED', error_message = ?, retry_count = retry_count + 1 WHERE id = ?`
        )
        .run(errorMessage, logId);
      return { status: 'FAILED', errorMessage };
    }
  }
}

export function renderApprovalRequestHtml(params: {
  orderNumber: string;
  customerName: string;
  employeeName: string;
  orderDate: string;
  grandTotal: string;
  items: Array<{ name: string; quantity: number; subtotal: string }>;
  approvalLink: string;
}): string {
  const rows = params.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(i.name)}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${i.quantity}</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(i.subtotal)}</td></tr>`
    )
    .join('');

  return `<!doctype html>
<html>
<body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
    <h2 style="margin:0 0 8px;color:#0f172a;">Manager Approval Required: ${escapeHtml(params.orderNumber)}</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;">A new sales order exceeds the configured approval threshold and requires your review.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#64748b;">Customer</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(params.customerName)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Sales Representative</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(params.employeeName)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Order Date</td><td style="padding:6px 0;">${escapeHtml(params.orderDate)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Order Total</td><td style="padding:6px 0;font-weight:700;color:#2563eb;">${escapeHtml(params.grandTotal)}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
      <thead><tr style="background:#f1f5f9;"><th style="padding:8px 12px;text-align:left;">Product</th><th style="padding:8px 12px;text-align:right;">Qty</th><th style="padding:8px 12px;text-align:right;">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <a href="${escapeHtml(params.approvalLink)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">Review &amp; Decide Order</a>
  </div>
</body>
</html>`;
}

export function renderOrderDecisionHtml(params: {
  orderNumber: string;
  decision: 'APPROVED' | 'REJECTED';
  managerName: string;
  decisionDate: string;
  grandTotal: string;
  rejectionReason?: string | null;
  orderLink: string;
}): string {
  const isApproved = params.decision === 'APPROVED';
  const badgeColor = isApproved ? '#16a34a' : '#dc2626';
  const statusLabel = isApproved ? 'Confirmed & Approved' : 'Rejected';

  return `<!doctype html>
<html>
<body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
    <h2 style="margin:0 0 8px;color:${badgeColor};">Order ${escapeHtml(params.orderNumber)} — ${statusLabel}</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;">Your sales order has been reviewed by ${escapeHtml(params.managerName)}.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#64748b;">Status</td><td style="padding:6px 0;font-weight:600;color:${badgeColor};">${statusLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Reviewed By</td><td style="padding:6px 0;">${escapeHtml(params.managerName)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Decision Date</td><td style="padding:6px 0;">${escapeHtml(params.decisionDate)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Order Amount</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(params.grandTotal)}</td></tr>
      ${
        !isApproved && params.rejectionReason
          ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top;">Rejection Reason</td><td style="padding:6px 0;color:#991b1b;">${escapeHtml(params.rejectionReason)}</td></tr>`
          : ''
      }
    </table>
    <a href="${escapeHtml(params.orderLink)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">View Order Details</a>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
