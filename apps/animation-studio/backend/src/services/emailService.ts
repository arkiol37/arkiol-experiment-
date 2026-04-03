import sgMail from '@sendgrid/mail';
import { config } from '../config/env';
import { logger } from '../config/logger';

if (config.SENDGRID_API_KEY) sgMail.setApiKey(config.SENDGRID_API_KEY);

const TEMPLATES: Record<string, { subject?: string; html: (data: any) => string }> = {
  'verify-email': {
    html: (d) => `
      <h1>Welcome to Animation Studio, ${d.name}!</h1>
      <p>Click below to verify your email:</p>
      <a href="${config.FRONTEND_URL}/verify-email?token=${d.token}" style="background:#e8a820;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Verify Email</a>
      <p style="color:#666;font-size:12px">This link expires in 24 hours.</p>
    `,
  },
  'reset-password': {
    html: (d) => `
      <h1>Reset your Animation Studio password</h1>
      <p>Hi ${d.name}, click below to reset your password:</p>
      <a href="${config.FRONTEND_URL}/reset-password?token=${d.token}" style="background:#e8a820;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Reset Password</a>
      <p style="color:#666;font-size:12px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `,
  },
  'render-complete': {
    html: (d) => `
      <h1>Your video is ready! 🎬</h1>
      <p>Hi ${d.name}, your campaign "${d.projectName}" has been rendered successfully.</p>
      <a href="${config.FRONTEND_URL}/projects/${d.projectId}" style="background:#e8a820;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">View Your Video</a>
    `,
  },
  'payment-failed': {
    html: (d) => `
      <h1>Payment failed</h1>
      <p>Hi ${d.name}, your payment of $${d.amount} failed. Please update your payment method.</p>
      <a href="${config.FRONTEND_URL}/settings/billing" style="background:#e8a820;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Update Payment</a>
    `,
  },
};

export async function sendEmail(params: {
  to: string;
  subject: string;
  template: string;
  data?: any;
}) {
  if (!config.SENDGRID_API_KEY) {
    logger.info(`[Email dev] To: ${params.to} | Subject: ${params.subject}`);
    return;
  }

  const tmpl = TEMPLATES[params.template];
  if (!tmpl) {
    logger.warn(`Email template not found: ${params.template}`);
    return;
  }

  const html = tmpl.html(params.data || {});
  const wrappedHtml = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:system-ui,sans-serif;background:#0a0a0f;color:#f0f0f8;padding:40px 20px">
    <div style="max-width:500px;margin:0 auto;background:#14141f;border-radius:16px;padding:40px;border:1px solid rgba(255,255,255,0.07)">
      <div style="font-size:24px;font-weight:800;color:#e8a820;margin-bottom:24px">Animation Studio ✦</div>
      ${html}
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.07);margin:32px 0">
      <p style="color:#5a5a80;font-size:12px">Animation Studio AI Brand Ad Director. <a href="${config.FRONTEND_URL}/unsubscribe" style="color:#8b6914">Unsubscribe</a></p>
    </div>
    </body>
    </html>
  `;

  await sgMail.send({
    to: params.to,
    from: { email: config.EMAIL_FROM, name: 'Animation Studio' },
    subject: params.subject,
    html: wrappedHtml,
  });

  logger.info(`Email sent: ${params.template} → ${params.to}`);
}
