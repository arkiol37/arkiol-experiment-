// packages/shared/src/auditLogger.ts
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG SERVICE — Task #9
//
// Centralized audit logging for:
//   • Plan changes (upgrades, downgrades, cancellations)
//   • Credit events (top-ups, admin adjustments, refunds, expirations)
//   • Job events (cancellations, failures, refunds)
//   • Billing events (invoice.paid, subscription updates, payment failures)
//   • Webhook events (registration, deletion, delivery failures)
//   • Admin actions (role changes, org modifications)
//
// Writes to the AuditLog table in the shared database.
// Never throws — audit failures must not break business logic.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { toJsonValue } from './typeUtils';

// ── Audit action types ─────────────────────────────────────────────────────

export type AuditAction =
  // Plan changes
  | 'plan.upgraded'
  | 'plan.downgraded'
  | 'plan.canceled'
  | 'plan.trial_started'
  | 'plan.grace_period_started'
  // Credit events
  | 'credit.topup'
  | 'credit.admin_adjustment'
  | 'credit.refund'
  | 'credit.grant_cycle'
  | 'credit.rollover'
  | 'credit.expired'
  | 'credit.auto_refill_triggered'
  // Job events
  | 'job.created'
  | 'job.canceled'
  | 'job.failed'
  | 'job.credit_refunded'
  | 'job.concurrency_blocked'
  // Billing events
  | 'billing.invoice_paid'
  | 'billing.payment_failed'
  | 'billing.subscription_updated'
  | 'billing.cost_protection_blocked'
  | 'billing.cost_protection_reset'
  | 'billing.plan_provisioned.stripe'
  | 'billing.plan_provisioned.paddle'
  | 'billing.subscription_cancelled.stripe'
  | 'billing.subscription_cancelled.paddle'
  | 'billing.topup_granted.paddle'
  | 'billing.payment_failed.paddle'
  // Webhook events
  | 'webhook.created'
  | 'webhook.deleted'
  | 'webhook.delivery_failed'
  | 'webhook.disabled_too_many_failures'
  // Admin events
  | 'admin.role_changed'
  | 'admin.org_modified'
  | 'admin.member_removed'
  | 'admin.api_key_revoked'
  // Security events
  | 'security.ssrf_blocked'
  | 'security.rate_limit_exceeded'
  | 'security.suspicious_activity';

export interface AuditEntry {
  orgId: string;
  actorId: string;           // user ID who triggered the action (use 'system' for automated)
  action: AuditAction;
  targetId?: string;         // ID of the affected entity (jobId, webhookId, etc.)
  targetType?: string;       // 'job' | 'webhook' | 'org' | 'user' | 'credit'
  metadata?: Record<string, unknown>;
}

// ── Service factory ────────────────────────────────────────────────────────

export function createAuditLogger(prisma: PrismaClient) {
  /**
   * Write an audit log entry.
   * Never throws — failures are logged to stderr but do not propagate.
   */
  async function log(entry: AuditEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          orgId:      entry.orgId,
          actorId:    entry.actorId,
          action:     entry.action,
          targetId:   entry.targetId,
          targetType: entry.targetType,
          metadata:   toJsonValue(entry.metadata ?? {}),
        },
      });
    } catch (err) {
      // Audit log failures must never break business logic
      console.error('[AuditLogger] Failed to write audit log entry:', {
        action: entry.action,
        orgId:  entry.orgId,
        error:  err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err),
      });
    }
  }

  // ── Convenience helpers ──────────────────────────────────────────────────

  async function logPlanChange(params: {
    orgId: string;
    actorId: string;
    action: 'plan.upgraded' | 'plan.downgraded' | 'plan.canceled' | 'plan.trial_started' | 'plan.grace_period_started';
    fromPlan?: string;
    toPlan?: string;
    stripeEventId?: string;
    stripeSubscriptionId?: string;
  }): Promise<void> {
    return log({
      orgId:      params.orgId,
      actorId:    params.actorId,
      action:     params.action,
      targetType: 'org',
      targetId:   params.orgId,
      metadata: {
        fromPlan:              params.fromPlan,
        toPlan:                params.toPlan,
        stripeEventId:         params.stripeEventId,
        stripeSubscriptionId:  params.stripeSubscriptionId,
        timestamp:             new Date().toISOString(),
      },
    });
  }

  async function logCreditEvent(params: {
    orgId: string;
    actorId: string;
    action: Extract<AuditAction, `credit.${string}`>;
    amount: number;
    newBalance?: number;
    reason?: string;
    jobId?: string;
    stripePaymentId?: string;
    idempotencyKey?: string;
  }): Promise<void> {
    return log({
      orgId:      params.orgId,
      actorId:    params.actorId,
      action:     params.action,
      targetType: 'credit',
      targetId:   params.jobId ?? params.stripePaymentId,
      metadata: {
        amount:          params.amount,
        newBalance:      params.newBalance,
        reason:          params.reason,
        jobId:           params.jobId,
        stripePaymentId: params.stripePaymentId,
        idempotencyKey:  params.idempotencyKey,
        timestamp:       new Date().toISOString(),
      },
    });
  }

  async function logJobEvent(params: {
    orgId: string;
    actorId: string;
    action: Extract<AuditAction, `job.${string}`>;
    jobId: string;
    jobType?: string;
    errorMessage?: string;
    creditsRefunded?: number;
    reason?: string;
  }): Promise<void> {
    return log({
      orgId:      params.orgId,
      actorId:    params.actorId,
      action:     params.action,
      targetType: 'job',
      targetId:   params.jobId,
      metadata: {
        jobType:         params.jobType,
        errorMessage:    params.errorMessage,
        creditsRefunded: params.creditsRefunded,
        reason:          params.reason,
        timestamp:       new Date().toISOString(),
      },
    });
  }

  async function logBillingEvent(params: {
    orgId: string;
    actorId: string;
    action: Extract<AuditAction, `billing.${string}`>;
    stripeEventId?: string;
    amount?: number;
    currency?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    return log({
      orgId:      params.orgId,
      actorId:    params.actorId,
      action:     params.action,
      targetType: 'billing',
      targetId:   params.stripeEventId,
      metadata: {
        stripeEventId: params.stripeEventId,
        amount:        params.amount,
        currency:      params.currency,
        timestamp:     new Date().toISOString(),
        ...params.metadata,
      },
    });
  }

  async function logWebhookEvent(params: {
    orgId: string;
    actorId: string;
    action: Extract<AuditAction, `webhook.${string}`>;
    webhookId: string;
    url?: string;
    failCount?: number;
    reason?: string;
  }): Promise<void> {
    // Redact URL credentials if present
    let safeUrl: string | undefined;
    if (params.url) {
      try {
        const u = new URL(params.url);
        u.password = '';
        u.username = '';
        safeUrl = u.toString();
      } catch {
        safeUrl = '[invalid URL]';
      }
    }

    return log({
      orgId:      params.orgId,
      actorId:    params.actorId,
      action:     params.action,
      targetType: 'webhook',
      targetId:   params.webhookId,
      metadata: {
        url:       safeUrl,
        failCount: params.failCount,
        reason:    params.reason,
        timestamp: new Date().toISOString(),
      },
    });
  }

  async function logSecurityEvent(params: {
    orgId: string;
    actorId: string;
    action: Extract<AuditAction, `security.${string}`>;
    detail: string;
    ip?: string;
    blockedUrl?: string;
  }): Promise<void> {
    return log({
      orgId:      params.orgId,
      actorId:    params.actorId,
      action:     params.action,
      targetType: 'security',
      metadata: {
        detail:     params.detail,
        ip:         params.ip,
        blockedUrl: params.blockedUrl,
        timestamp:  new Date().toISOString(),
      },
    });
  }

  /**
   * Query recent audit log entries for an org.
   * Useful for admin dashboards and compliance exports.
   */
  async function query(params: {
    orgId: string;
    actions?: AuditAction[];
    actorId?: string;
    targetId?: string;
    limit?: number;
    after?: Date;
    before?: Date;
  }) {
    return prisma.auditLog.findMany({
      where: {
        orgId:    params.orgId,
        ...(params.actions   ? { action: { in: params.actions } } : {}),
        ...(params.actorId   ? { actorId: params.actorId }        : {}),
        ...(params.targetId  ? { targetId: params.targetId }      : {}),
        ...(params.after || params.before ? {
          createdAt: {
            ...(params.after  ? { gte: params.after }  : {}),
            ...(params.before ? { lte: params.before } : {}),
          },
        } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take:    params.limit ?? 100,
    });
  }

  return {
    log,
    logPlanChange,
    logCreditEvent,
    logJobEvent,
    logBillingEvent,
    logWebhookEvent,
    logSecurityEvent,
    query,
  };
}

export type AuditLoggerService = ReturnType<typeof createAuditLogger>;
