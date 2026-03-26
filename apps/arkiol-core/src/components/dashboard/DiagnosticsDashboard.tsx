"use client";
// src/components/dashboard/DiagnosticsDashboard.tsx
// Full Engine Diagnostics Dashboard — Exploration, Platform, Campaign, Queue, Assets

import React, { useState, useEffect, useCallback } from "react";

interface EngineHealth {
  engineName:          string;
  status:              "healthy" | "degraded" | "critical";
  lastUpdatedAt:       string;
  errorRateLast5min:   number;
  avgLatencyMs:        number;
  totalRequestsLast1h: number;
  activeJobs:          number;
  alerts:              string[];
}

interface MetricSample {
  name:      string;
  type:      string;
  value:     number;
  labels:    Record<string, string>;
  timestamp: number;
}

interface DiagnosticsReport {
  timestamp:   string;
  engines:     EngineHealth[];
  metrics:     MetricSample[];
  recentErrors: { level: string; msg: string; ctx: Record<string, unknown>; ts: string }[];
  systemStatus: "healthy" | "degraded" | "critical";
}

interface QueueReport {
  queue: {
    pending:    number;
    running:    number;
    failedLastHour: number;
    recentJobs: { id: string; type: string; status: string; orgId: string; createdAt: string; attempts: number }[];
  };
}

const STATUS_COLOR: Record<string, string> = {
  healthy:  "var(--success)",
  degraded: "var(--warning)",
  critical: "var(--error)",
};

const STATUS_BADGE: Record<string, string> = {
  healthy:  "ak-badge-success",
  degraded: "ak-badge-warning",
  critical: "ak-badge-error",
};

function EngineCard({ engine }: { engine: EngineHealth }) {
  return (
    <div className="ak-card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            {engine.engineName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
            {engine.totalRequestsLast1h} req/h · {Math.round(engine.avgLatencyMs)}ms avg
          </p>
        </div>
        <span className={`ak-badge ${STATUS_BADGE[engine.status] ?? "ak-badge-muted"}`} style={{ fontSize: 9, textTransform: "capitalize" }}>
          {engine.status}
        </span>
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", gap: 12, marginBottom: engine.alerts.length > 0 ? 8 : 0 }}>
        {[
          { label: "Error Rate", value: `${(engine.errorRateLast5min * 100).toFixed(1)}%` },
          { label: "Active Jobs", value: String(engine.activeJobs) },
        ].map(m => (
          <div key={m.label}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.04em" }}>{m.value}</p>
            <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</p>
          </div>
        ))}
      </div>

      {engine.alerts.map((alert, i) => (
        <p key={i} style={{ margin: "2px 0 0", fontSize: 9, color: "var(--warning)", lineHeight: 1.4 }}>⚠ {alert}</p>
      ))}
    </div>
  );
}

function MetricRow({ sample }: { sample: MetricSample }) {
  const labelStr = Object.entries(sample.labels).map(([k, v]) => `${k}=${v}`).join(" ");
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "5px 8px", fontSize: 10, color: "var(--text-primary)", fontFamily: "var(--font-mono, monospace)" }}>
        {sample.name}
        {labelStr && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>{`{${labelStr}}`}</span>}
      </td>
      <td style={{ padding: "5px 8px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>{sample.type}</td>
      <td style={{ padding: "5px 8px", fontSize: 11, fontWeight: 700, textAlign: "right" }}>
        {typeof sample.value === "number" ? sample.value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : sample.value}
      </td>
    </tr>
  );
}

export function DiagnosticsDashboard() {
  const [report,    setReport]    = useState<DiagnosticsReport | null>(null);
  const [queue,     setQueue]     = useState<QueueReport | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"engines" | "metrics" | "errors" | "queue">("engines");
  const [refreshing,setRefreshing]= useState(false);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/admin/diagnostics").then(r => r.json()),
        fetch("/api/admin/diagnostics?section=queue").then(r => r.json()),
      ]);
      setReport(r1);
      setQueue(r2);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to load diagnostics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15_000);
    return () => clearInterval(interval);
  }, []);

  const TABS = [
    { id: "engines", label: "Engines" },
    { id: "queue",   label: "Queue" },
    { id: "metrics", label: "Metrics" },
    { id: "errors",  label: "Recent Errors" },
  ] as const;

  return (
    <div className="ak-fade-in" style={{ padding: "32px 40px", maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, fontFamily: "var(--font-display)", letterSpacing: "-0.045em" }}>
            Engine Diagnostics
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            {report ? `Updated ${new Date(report.timestamp).toLocaleTimeString()}` : "Loading…"}
            {refreshing && " · Refreshing…"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {report && (
            <span className={`ak-badge ${STATUS_BADGE[report.systemStatus] ?? "ak-badge-muted"}`} style={{ fontSize: 11, padding: "4px 10px" }}>
              System: {report.systemStatus}
            </span>
          )}
          <button onClick={fetchAll} disabled={refreshing} className="ak-btn ak-btn-secondary" style={{ fontSize: 11 }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 20, padding: "12px 16px", background: "color-mix(in srgb, var(--error) 10%, var(--surface))", borderRadius: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: "var(--error)" }}>⚠ {error}</p>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "7px 14px", border: "none", cursor: "pointer", background: "none",
              fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700,
              letterSpacing: "-0.01em",
              color:       activeTab === tab.id ? "var(--accent)" : "var(--text-muted)",
              borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              transition:  "all 0.15s",
            }}
          >
            {tab.label}
            {tab.id === "errors" && report?.recentErrors?.length
              ? <span className="ak-badge ak-badge-error" style={{ marginLeft: 6, fontSize: 9 }}>{report.recentErrors.length}</span>
              : null}
          </button>
        ))}
      </div>

      {/* Engines tab */}
      {activeTab === "engines" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {loading && !report ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ height: 110, borderRadius: 10, background: "var(--surface-raised)", animation: "ak-pulse 1.5s infinite" }} />
            ))
          ) : (
            report?.engines.map(engine => <EngineCard key={engine.engineName} engine={engine} />)
          )}
        </div>
      )}

      {/* Queue tab */}
      {activeTab === "queue" && queue && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Pending",       value: queue.queue.pending,       color: "var(--text-muted)" },
              { label: "Running",       value: queue.queue.running,       color: "var(--warning)" },
              { label: "Failed / Hour", value: queue.queue.failedLastHour,color: "var(--error)" },
            ].map(s => (
              <div key={s.label} className="ak-card" style={{ padding: "14px 16px" }}>
                <p style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "var(--font-display)", letterSpacing: "-0.05em", color: s.color }}>{s.value}</p>
                <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 4 }}>{s.label}</p>
              </div>
            ))}
          </div>
          <div className="ak-card" style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["ID", "Type", "Status", "Attempts", "Org", "Created"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", textAlign: "left", fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queue.queue.recentJobs.map(job => (
                  <tr key={job.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 10, fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted)" }}>{job.id.slice(0, 12)}…</td>
                    <td style={{ padding: "6px 10px", fontSize: 10 }}>{job.type}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span className={`ak-badge ${job.status === "RUNNING" ? "ak-badge-warning" : job.status === "PENDING" ? "ak-badge-muted" : "ak-badge-success"}`} style={{ fontSize: 9 }}>
                        {job.status}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: 10, textAlign: "center" }}>{job.attempts}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10, color: "var(--text-muted)" }}>{job.orgId.slice(0, 8)}…</td>
                    <td style={{ padding: "6px 10px", fontSize: 10, color: "var(--text-muted)" }}>{new Date(job.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Metrics tab */}
      {activeTab === "metrics" && report && (
        <div className="ak-card" style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Metric", "Type", "Value"].map(h => (
                  <th key={h} style={{ padding: "8px 10px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", textAlign: h === "Value" ? "right" : "left", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.metrics.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>No metrics recorded yet.</td></tr>
              ) : (
                report.metrics.map((m, i) => <MetricRow key={i} sample={m} />)
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors tab */}
      {activeTab === "errors" && report && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {report.recentErrors.length === 0 ? (
            <div className="ak-card" style={{ padding: "24px", textAlign: "center", color: "var(--success)" }}>
              ✓ No recent errors
            </div>
          ) : (
            report.recentErrors.map((entry, i) => (
              <div key={i} className="ak-card" style={{ padding: "10px 14px", borderLeft: "3px solid var(--error)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--error)", fontWeight: 700, textTransform: "uppercase" }}>{entry.level}</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{new Date(entry.ts).toLocaleTimeString()}</span>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--text-primary)" }}>{entry.msg}</p>
                {entry.ctx.stage && (
                  <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)" }}>Stage: {String(entry.ctx.stage)}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
