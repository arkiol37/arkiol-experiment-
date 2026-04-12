// src/lib/email.ts
// Safe email — silently no-ops when SMTP not configured.
import 'server-only';

interface EmailOptions {
  to: string | string[]; subject: string; text: string; html?: string; from?: string; replyTo?: string;
}

function createTransporter() {
  const env = process.env;
  const nodemailer = require('nodemailer');
  if (env.SMTP_HOST) {
    return nodemailer.createTransport({ host: env.SMTP_HOST, port: parseInt(env.SMTP_PORT ?? '587'), secure: env.SMTP_SECURE === 'true', auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  }
  if (env.NODE_ENV === 'development' && env.ETHEREAL_USER) {
    return nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, auth: { user: env.ETHEREAL_USER, pass: env.ETHEREAL_PASS } });
  }
  // No-op transporter
  return { sendMail: async (opts: any) => { console.log(`[email:noop] Would send to ${opts.to}: ${opts.subject}`); return { messageId: 'noop' }; } };
}

export async function sendEmail(opts: EmailOptions): Promise<void> {
  try {
    const transporter = createTransporter();
    const env = process.env;
    await transporter.sendMail({
      from:    opts.from ?? env.EMAIL_FROM ?? 'noreply@arkiol.ai',
      to:      Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
      subject: opts.subject,
      text:    opts.text,
      html:    opts.html,
      replyTo: opts.replyTo,
    });
  } catch (err) {
    console.error('[email] Failed to send email:', err);
    // Non-fatal — email failure never crashes the app
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail({
    to, subject: 'Reset your Arkiol password',
    text: `Click this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`,
  });
}

export async function sendWelcomeEmail(to: string, name: string, appUrl: string): Promise<void> {
  await sendEmail({
    to, subject: 'Welcome to Arkiol!',
    text: `Hi ${name},\n\nWelcome to Arkiol! Get started: ${appUrl}/dashboard`,
    html: `<p>Hi ${name},</p><p>Welcome to Arkiol! <a href="${appUrl}/dashboard">Get started</a></p>`,
  });
}

export async function sendTeamInviteEmail(to: string, inviterName: string, orgName: string, inviteUrl: string): Promise<void> {
  await sendEmail({
    to, subject: `${inviterName} invited you to join ${orgName} on Arkiol`,
    text: `You've been invited to join ${orgName}. Accept here: ${inviteUrl}`,
    html: `<p>${inviterName} invited you to join <strong>${orgName}</strong>. <a href="${inviteUrl}">Accept invitation</a></p>`,
  });
}
