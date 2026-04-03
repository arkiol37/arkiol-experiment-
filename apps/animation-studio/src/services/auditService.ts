import { db } from '../config/database';
import { logger } from '../config/logger';

interface AuditParams {
  userId?: string;
  workspaceId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  before?: any;
  after?: any;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  success?: boolean;
  errorMessage?: string;
}

export async function auditLog(params: AuditParams, trx?: any) {
  const conn = trx || db;
  try {
    await conn('audit_logs').insert({
      user_id: params.userId,
      workspace_id: params.workspaceId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      before: JSON.stringify(params.before || {}),
      after: JSON.stringify(params.after || {}),
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
      request_id: params.requestId,
      success: params.success !== false,
      error_message: params.errorMessage,
    });
  } catch (err) {
    // Never let audit logging break the main flow
    logger.error('Audit log failed:', err);
  }
}

export async function trackAnalytics(params: {
  workspaceId?: string;
  userId?: string;
  event: string;
  entityType?: string;
  entityId?: string;
  properties?: any;
  ipHash?: string;
  userAgent?: string;
}) {
  try {
    await db('analytics_events').insert({
      workspace_id: params.workspaceId,
      user_id: params.userId,
      event: params.event,
      entity_type: params.entityType,
      entity_id: params.entityId,
      properties: JSON.stringify(params.properties || {}),
      ip_hash: params.ipHash,
      user_agent: params.userAgent,
    });
  } catch (err) {
    logger.error('Analytics track failed:', err);
  }
}
