// src/components/dashboard/AdminOpsDashboard.tsx
// Admin/Ops dashboard — uses Arkiol design system (ak-* classes, CSS vars).
'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface MonitoringData {
  timestamp:    string;
  system:       { totalUsers: number; totalOrgs: number };
  jobs24h:      { byStatus: Record<string, number>; errorRate: string; total: number };
  assets24h:    { count: number; totalSizeMb: number };
  credits24h:   { spent: number; operations: number };
  queues:       { generation: { waiting: number; active: number; failed: number }; webhooks: { waiting: number; active: number } };
  recentErrors: Array<{ jobId: string; type: string; failedAt: string; reason: string }>;
}
interface DiagnosticsStage {
  stage:       string;
  enteredAt:   number;
  durationMs:  number | null;
}
interface FailureDiagnostics {
  failStage:   string;
  workerMode:  string;
  elapsedMs:   number;
  stages:      DiagnosticsStage[];
  openaiFailures:  { count: number; lastMessage: string | null };
  renderFailures:  { count: number; lastMessage: string | null };
  storageFailures: { count: number; lastMessage: string | null };
  staleDiagnostic?: { reason: string; heartbeatGapMs: number; runningMs: number; expectedMs: number } | null;
  attempt?:      number;
  maxAttempts?:  number;
  capabilitySnapshot?: Record<string, boolean>;
}
interface FailureEntry {
  id:          string;
  type:        string;
  userId:      string;
  orgId:       string;
  createdAt:   string;
  startedAt:   string | null;
  failedAt:    string;
  attempts:    number;
  maxAttempts: number;
  error:       string | null;
  failReason:  string;
  failStage:   string;
  elapsedMs:   number;
  workerMode:  string;
  diagnostics: FailureDiagnostics | null;
}
interface FailuresResponse {
  failures: FailureEntry[];
  totals:   { byStage: Record<string, number>; byReason: Record<string, number>; byWorkerMode: Record<string, number> };
  window:   { since: string; failuresInWindow: number };
}
interface AuditEntry {
  id: string; orgId: string; actorId: string; action: string;
  targetId?: string; targetType?: string; metadata: Record<string, any>; createdAt: string;
}
interface DlqEntry {
  id: string; originalQueue?: string; jobId?: string;
  orgId?: string; error?: string; attempts?: number; failedAt?: string; addedAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  FAILED: 'ak-badge-error', SUCCEEDED: 'ak-badge-success', COMPLETED: 'ak-badge-success',
  RUNNING: 'ak-badge-warning', PENDING: 'ak-badge-muted', QUEUED: 'ak-badge-muted',
};
const ACTION_BADGE: Record<string, string> = {
  'plan.': 'ak-badge-accent', 'security.': 'ak-badge-error',
  'billing.': 'ak-badge-warning', 'credit.': 'ak-badge-success',
};
function actionBadge(action: string) {
  for (const [prefix, cls] of Object.entries(ACTION_BADGE)) {
    if (action.startsWith(prefix)) return cls;
  }
  return 'ak-badge-muted';
}

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="ak-card" style={{ padding: '18px 20px' }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.04em', color: color ?? 'var(--text-primary)', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

export function AdminOpsDashboard() {
  const [monitoring, setMonitoring] = useState<MonitoringData | null>(null);
  const [auditLogs,  setAuditLogs]  = useState<AuditEntry[]>([]);
  const [dlq,        setDlq]        = useState<{ counts: Record<string, number>; jobs: DlqEntry[] } | null>(null);
  const [failures,   setFailures]   = useState<FailuresResponse | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<'overview' | 'audit' | 'dlq' | 'failures'>('overview');
  const [auditFilter,setAuditFilter]= useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [dlqAction,  setDlqAction]  = useState<Record<string, 'replaying' | 'discarding'>>({});
  const [expandedFailure, setExpandedFailure] = useState<string | null>(null);
  const [failureStageFilter,  setFailureStageFilter]  = useState<string>('');
  const [failureWorkerFilter, setFailureWorkerFilter] = useState<string>('');

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const failuresQuery = new URLSearchParams();
      failuresQuery.set('limit', '50');
      if (failureStageFilter)  failuresQuery.set('stage',      failureStageFilter);
      if (failureWorkerFilter) failuresQuery.set('workerMode', failureWorkerFilter);
      const [monRes, auditRes, dlqRes, failRes] = await Promise.all([
        fetch('/api/monitoring'),
        fetch('/api/audit-logs?limit=50'),
        fetch('/api/monitoring/dlq'),
        fetch(`/api/admin/failures?${failuresQuery.toString()}`),
      ]);
      if (monRes.ok)   setMonitoring(await monRes.json());
      if (auditRes.ok) setAuditLogs((await auditRes.json()).logs ?? []);
      if (dlqRes.ok)   setDlq(await dlqRes.json());
      if (failRes.ok)  setFailures(await failRes.json());
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [failureStageFilter, failureWorkerFilter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { const t = setInterval(fetchAll, 30_000); return () => clearInterval(t); }, [fetchAll]);

  async function handleDlqAction(jobId: string, action: 'replay' | 'discard') {
    setDlqAction(prev => ({ ...prev, [jobId]: action === 'replay' ? 'replaying' : 'discarding' }));
    try {
      const res = await fetch('/api/monitoring/dlq', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dlqJobId: jobId, action }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchAll();
    } catch (e: any) { alert(`DLQ ${action} failed: ${e.message}`); }
    finally { setDlqAction(prev => { const n = { ...prev }; delete n[jobId]; return n; }); }
  }

  const filteredAudit = auditLogs.filter(a =>
    !auditFilter || a.action.includes(auditFilter) || a.actorId.includes(auditFilter) || a.orgId.includes(auditFilter)
  );
  const errorRate = monitoring ? parseFloat(monitoring.jobs24h.errorRate) : 0;
  const hasAlerts = errorRate > 5 || (dlq?.counts?.waiting ?? 0) > 0 || (monitoring?.queues?.generation?.failed ?? 0) > 3;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 280, color: 'var(--text-muted)', fontSize: 14 }}>
      <span className="ak-spin" style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)', borderRadius: '50%', marginRight: 10 }} />
      Loading ops data…
    </div>
  );

  if (error) return (
    <div className="ak-toast ak-toast-error" style={{ margin: 24 }}>
      <span>⚠</span>
      <span>{error} — <button onClick={fetchAll} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button></span>
    </div>
  );

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'failures', label: 'Failures', badge: failures?.window?.failuresInWindow ?? 0 },
    { id: 'audit',    label: 'Audit Log' },
    { id: 'dlq',      label: 'DLQ', badge: dlq?.counts?.waiting ?? 0 },
  ] as const;

  const row: React.CSSProperties = { display: 'grid', gap: 12 };
  const tbl: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
  const th: React.CSSProperties  = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' };
  const td: React.CSSProperties  = { padding: '9px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };

  return (
    <div className="ak-fade-in" style={{ padding: '36px 44px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.04em' }}>Ops Dashboard</h1>
          {monitoring && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Last updated {new Date(monitoring.timestamp).toLocaleTimeString()}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {hasAlerts && <span className="ak-badge ak-badge-error">⚠ Alerts active</span>}
          <button onClick={fetchAll} disabled={refreshing} className="ak-btn ak-btn-secondary ak-btn-sm">
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 28 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px', fontSize: 13.5,
            fontWeight: activeTab === tab.id ? 600 : 400, fontFamily: 'var(--font-body)',
            color: activeTab === tab.id ? 'var(--accent-light)' : 'var(--text-muted)',
            borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
            marginBottom: -1, transition: 'all var(--transition-fast)', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {tab.label}
            {'badge' in tab && (tab.badge ?? 0) > 0 && (
              <span style={{ background: 'var(--error)', color: '#fff', borderRadius: 999, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && monitoring && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ ...row, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            <Stat label="Total Users"   value={monitoring.system.totalUsers.toLocaleString()} />
            <Stat label="Total Orgs"    value={monitoring.system.totalOrgs.toLocaleString()} />
            <Stat label="Jobs (24h)"    value={monitoring.jobs24h.total.toLocaleString()} sub={`Error rate: ${monitoring.jobs24h.errorRate}`} color={errorRate > 5 ? 'var(--error)' : 'var(--text-primary)'} />
            <Stat label="Credits Spent" value={monitoring.credits24h.spent.toLocaleString()} sub={`${monitoring.credits24h.operations} ops`} />
          </div>

          <div className="ak-card" style={{ padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 14 }}>Job Status (Last 24h)</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {Object.entries(monitoring.jobs24h.byStatus).map(([status, count]) => (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`ak-badge ${STATUS_BADGE[status] ?? 'ak-badge-muted'}`} style={{ fontSize: 11 }}>{status}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {errorRate > 5 && <div className="ak-toast ak-toast-error" style={{ marginTop: 12, fontSize: 12 }}>⚠ Error rate {monitoring.jobs24h.errorRate} exceeds 5% threshold</div>}
          </div>

          <div className="ak-card" style={{ padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 14 }}>Queue Depths</p>
            <div style={{ ...row, gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <Stat label="Gen: Waiting" value={monitoring.queues.generation.waiting} color={monitoring.queues.generation.waiting > 50 ? 'var(--warning)' : undefined} />
              <Stat label="Gen: Active"  value={monitoring.queues.generation.active} />
              <Stat label="Gen: Failed"  value={monitoring.queues.generation.failed} color={monitoring.queues.generation.failed > 0 ? 'var(--error)' : undefined} />
              <Stat label="Webhooks"     value={monitoring.queues.webhooks.active} />
            </div>
          </div>

          {monitoring.recentErrors.length > 0 && (
            <div className="ak-card" style={{ padding: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 14 }}>Recent Failures</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {monitoring.recentErrors.slice(0, 10).map(err => (
                  <div key={err.jobId} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--error-tint)', border: '1px solid rgba(248,113,113,0.12)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <code style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{err.jobId.slice(0, 12)}…</code>
                        <span className="ak-badge ak-badge-muted" style={{ fontSize: 10 }}>{err.type}</span>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--error)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500 }}>{err.reason}</p>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 16 }}>{new Date(err.failedAt).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ ...row, gridTemplateColumns: '1fr 1fr' }}>
            <Stat label="Assets Generated (24h)" value={monitoring.assets24h.count.toLocaleString()} />
            <Stat label="Total Asset Size (24h)"  value={`${monitoring.assets24h.totalSizeMb} MB`} />
          </div>
        </div>
      )}

      {/* Audit Tab */}
      {activeTab === 'audit' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <input type="text" placeholder="Filter by action, actor, or org…" value={auditFilter}
              onChange={e => setAuditFilter(e.target.value)} className="ak-input" style={{ maxWidth: 340 }} />
          </div>
          {filteredAudit.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>No audit entries found</div>
          ) : (
            <div className="ak-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={tbl}>
                  <thead>
                    <tr>
                      {['When', 'Action', 'Actor', 'Org', 'Details'].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudit.map(entry => (
                      <tr key={entry.id} style={{ transition: 'background var(--transition-fast)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ ...td, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', fontSize: 11.5 }}>{new Date(entry.createdAt).toLocaleString()}</td>
                        <td style={td}><span className={`ak-badge ${actionBadge(entry.action)}`} style={{ fontSize: 10.5 }}>{entry.action}</span></td>
                        <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>{entry.actorId.slice(0, 12)}…</td>
                        <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>{entry.orgId.slice(0, 8)}…</td>
                        <td style={{ ...td, color: 'var(--text-muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5 }}>{JSON.stringify(entry.metadata)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Failures Tab — structured diagnostics for every recent FAILED job */}
      {activeTab === 'failures' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ ...row, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Stat
              label="Failures (24h)"
              value={failures?.window?.failuresInWindow ?? 0}
              color={(failures?.window?.failuresInWindow ?? 0) > 10 ? 'var(--error)' : undefined}
              sub={`Since ${failures ? new Date(failures.window.since).toLocaleString() : '—'}`}
            />
            <Stat
              label="Top fail stage"
              value={failures ? (Object.entries(failures.totals.byStage).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—') : '—'}
              sub={failures ? `${Object.entries(failures.totals.byStage).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0} of ${failures.window.failuresInWindow}` : undefined}
            />
            <Stat
              label="Top worker mode"
              value={failures ? (Object.entries(failures.totals.byWorkerMode).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—') : '—'}
            />
          </div>

          {/* Filters */}
          <div className="ak-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)' }}>Filter</span>
            <select
              value={failureStageFilter}
              onChange={e => setFailureStageFilter(e.target.value)}
              className="ak-input ak-select"
              style={{ fontSize: 12, padding: '6px 10px' }}>
              <option value="">All stages</option>
              {failures && Object.keys(failures.totals.byStage).map(s => (
                <option key={s} value={s}>{s} ({failures.totals.byStage[s]})</option>
              ))}
            </select>
            <select
              value={failureWorkerFilter}
              onChange={e => setFailureWorkerFilter(e.target.value)}
              className="ak-input ak-select"
              style={{ fontSize: 12, padding: '6px 10px' }}>
              <option value="">All worker modes</option>
              {failures && Object.keys(failures.totals.byWorkerMode).map(w => (
                <option key={w} value={w}>{w} ({failures.totals.byWorkerMode[w]})</option>
              ))}
            </select>
            {(failureStageFilter || failureWorkerFilter) && (
              <button onClick={() => { setFailureStageFilter(''); setFailureWorkerFilter(''); }} className="ak-btn ak-btn-ghost ak-btn-sm">Clear</button>
            )}
          </div>

          {/* Reason / stage / worker histograms */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {(['byStage', 'byReason', 'byWorkerMode'] as const).map(k => (
              <div key={k} className="ak-card" style={{ padding: 16 }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 10 }}>
                  {k === 'byStage' ? 'By stage' : k === 'byReason' ? 'By reason' : 'By worker mode'}
                </p>
                {failures && Object.keys(failures.totals[k]).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Object.entries(failures.totals[k]).sort((a, b) => b[1] - a[1]).map(([label, count]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{count}</span>
                      </div>
                    ))}
                  </div>
                ) : <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>No failures in window</p>}
              </div>
            ))}
          </div>

          {/* Per-failure cards */}
          <div className="ak-card" style={{ padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 14 }}>
              Recent Failures · full diagnostics
            </p>
            {failures && failures.failures.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {failures.failures.map(f => {
                  const isOpen = expandedFailure === f.id;
                  return (
                    <div key={f.id} className="ak-card" style={{ padding: '14px 16px', cursor: 'pointer' }}
                      onClick={() => setExpandedFailure(isOpen ? null : f.id)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                            <code style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{f.id.slice(0, 14)}…</code>
                            <span className="ak-badge ak-badge-error" style={{ fontSize: 10 }}>{f.failReason}</span>
                            <span className="ak-badge ak-badge-warning" style={{ fontSize: 10 }}>stage:{f.failStage}</span>
                            <span className="ak-badge ak-badge-accent" style={{ fontSize: 10 }}>{f.workerMode}</span>
                            <span className="ak-badge ak-badge-muted" style={{ fontSize: 10 }}>
                              {(f.elapsedMs / 1000).toFixed(1)}s
                            </span>
                            <span className="ak-badge ak-badge-muted" style={{ fontSize: 10 }}>
                              attempt {f.attempts}/{f.maxAttempts}
                            </span>
                          </div>
                          <p style={{ fontSize: 12, color: 'var(--error)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isOpen ? 'normal' : 'nowrap' }}>
                            {f.error ?? 'Unknown error'}
                          </p>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                            Failed: {new Date(f.failedAt).toLocaleString()}
                            {f.startedAt && ` · Started: ${new Date(f.startedAt).toLocaleString()}`}
                          </p>
                        </div>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>{isOpen ? '▼' : '▶'}</span>
                      </div>

                      {isOpen && f.diagnostics && (
                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                            <FailureCounter label="OpenAI failures" data={f.diagnostics.openaiFailures} />
                            <FailureCounter label="Render failures" data={f.diagnostics.renderFailures} />
                            <FailureCounter label="Storage failures" data={f.diagnostics.storageFailures} />
                          </div>

                          {f.diagnostics.staleDiagnostic && (
                            <div style={{ marginBottom: 14, padding: 12, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 'var(--radius-md)' }}>
                              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--error)', marginBottom: 6 }}>Stale watchdog</p>
                              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                                Reason <code>{f.diagnostics.staleDiagnostic.reason}</code> · heartbeat gap {Math.round(f.diagnostics.staleDiagnostic.heartbeatGapMs / 1000)}s · running {Math.round(f.diagnostics.staleDiagnostic.runningMs / 1000)}s · expected {Math.round(f.diagnostics.staleDiagnostic.expectedMs / 1000)}s
                              </p>
                            </div>
                          )}

                          <div style={{ marginBottom: 10 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 6 }}>Stage breakdown</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {f.diagnostics.stages.map((s, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                  <span style={{ color: s.stage === f.diagnostics!.failStage ? 'var(--error)' : 'var(--text-secondary)', fontWeight: s.stage === f.diagnostics!.failStage ? 700 : 400 }}>
                                    {s.stage === f.diagnostics!.failStage && '▸ '}{s.stage}
                                  </span>
                                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    {s.durationMs != null ? `${s.durationMs}ms` : '…'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {f.diagnostics.capabilitySnapshot && (
                            <div>
                              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 6 }}>Capabilities at failure</p>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {Object.entries(f.diagnostics.capabilitySnapshot).map(([cap, on]) => (
                                  <span key={cap} className={`ak-badge ${on ? 'ak-badge-success' : 'ak-badge-muted'}`} style={{ fontSize: 10 }}>
                                    {cap}: {on ? 'yes' : 'no'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No failures in the current window</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DLQ Tab */}
      {activeTab === 'dlq' && dlq && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ ...row, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Stat label="Waiting"   value={dlq.counts.waiting ?? 0}   color={(dlq.counts.waiting ?? 0) > 0 ? 'var(--error)' : undefined} />
            <Stat label="Failed"    value={dlq.counts.failed ?? 0}    color={(dlq.counts.failed ?? 0) > 0 ? 'var(--warning)' : undefined} />
            <Stat label="Completed" value={dlq.counts.completed ?? 0} color="var(--success)" />
          </div>
          <div className="ak-card" style={{ padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 14 }}>Dead-Letter Queue</p>
            {dlq.jobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>DLQ is empty — no failed jobs</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dlq.jobs.map(job => (
                  <div key={job.id} className="ak-card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                          <code style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{job.id.slice(0, 14)}…</code>
                          {job.originalQueue && <span className="ak-badge ak-badge-accent" style={{ fontSize: 10 }}>{job.originalQueue}</span>}
                          {job.attempts && <span className="ak-badge ak-badge-warning" style={{ fontSize: 10 }}>{job.attempts} attempts</span>}
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--error)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.error ?? 'Unknown error'}</p>
                        {job.orgId && <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 2px' }}>Org: {job.orgId}</p>}
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                          Failed: {job.failedAt ? new Date(job.failedAt).toLocaleString() : 'unknown'}
                          {' · '}Added: {new Date(job.addedAt).toLocaleString()}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button onClick={() => handleDlqAction(job.id, 'replay')} disabled={!!dlqAction[job.id]} className="ak-btn ak-btn-primary ak-btn-sm">
                          {dlqAction[job.id] === 'replaying' ? '…' : 'Replay'}
                        </button>
                        <button onClick={() => handleDlqAction(job.id, 'discard')} disabled={!!dlqAction[job.id]} className="ak-btn ak-btn-danger ak-btn-sm">
                          {dlqAction[job.id] === 'discarding' ? '…' : 'Discard'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FailureCounter({ label, data }: { label: string; data: { count: number; lastMessage: string | null } }) {
  const tone = data.count > 0 ? 'var(--error)' : 'var(--text-muted)';
  return (
    <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: data.count > 0 ? 'rgba(248,113,113,0.05)' : 'transparent' }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 700, color: tone, margin: '0 0 4px' }}>{data.count}</p>
      {data.lastMessage && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.lastMessage}>
          {data.lastMessage}
        </p>
      )}
    </div>
  );
}

export default AdminOpsDashboard;
