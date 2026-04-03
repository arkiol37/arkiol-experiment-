"use client";
// src/components/dashboard/CampaignsView.tsx — v13 ULTIMATE

import React, { useState, useEffect, useRef } from "react";
import { CATEGORY_LABELS, ArkiolCategory } from "../../lib/types";

interface Job {
  id: string; type: string; status: string; progress: number;
  attempts: number; maxAttempts: number;
  result?: { assetCount: number; creditCost: number } | null;
  error?: string | null;
  campaign?: { id: string; name: string } | null;
  createdAt: string; startedAt?: string; completedAt?: string;
}

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "var(--success)", SUCCEEDED: "var(--success)", RUNNING: "var(--warning)",
  FAILED: "var(--error)", PENDING: "var(--text-muted)", QUEUED: "var(--text-muted)",
};

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: "ak-badge-success", SUCCEEDED: "ak-badge-success", RUNNING: "ak-badge-warning",
  FAILED: "ak-badge-error", PENDING: "ak-badge-muted", QUEUED: "ak-badge-muted",
};

export function CampaignsView() {
  const [jobs,    setJobs]    = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<string>("all");
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const fetchJobs = async () => {
    const params = new URLSearchParams({ limit: "50" });
    if (filter !== "all") params.set("status", filter);
    const res  = await fetch(`/api/jobs?${params}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setJobs(data.jobs ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchJobs();
    pollRef.current = setInterval(fetchJobs, 3000);
    return () => clearInterval(pollRef.current);
  }, [filter]);

  const hasRunning = jobs.some(j => j.status === "RUNNING" || j.status === "PENDING");
  useEffect(() => { if (!hasRunning) clearInterval(pollRef.current); }, [hasRunning]);

  const filtered = filter === "all" ? jobs : jobs.filter(j => j.status === filter);

  return (
    <div className="ak-fade-in" style={{ padding: "36px 44px", maxWidth: 1200 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.045em" }}>
          Campaigns & Jobs
        </h1>
        <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-muted)", letterSpacing: "-0.01em" }}>
          {hasRunning ? "⟳ Auto-refreshing…" : `${jobs.length} jobs total`}
        </p>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {["all","PENDING","RUNNING","COMPLETED","FAILED"].map(s => (
          <button key={s} className={`ak-pill${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>
            {s === "all" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            {s !== "all" && (
              <span style={{ marginLeft: 5, opacity: 0.7 }}>
                {jobs.filter(j => j.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Job list */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[0,1,2,3,4].map(i => <div key={i} className="ak-shimmer" style={{ height: 64, borderRadius: "var(--radius-lg)" }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "52px 24px", background: "var(--bg-elevated)", borderRadius: "var(--radius-2xl)", border: "1px dashed var(--border-strong)" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⊡</div>
          <h3 style={{ fontSize: 16, fontWeight: 400, fontFamily: "var(--font-display)", margin: "0 0 6px" }}>No jobs found</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Generate some assets to see jobs here.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(job => (
            <div key={job.id} className="ak-job-row">
              <div className="ak-status-dot" style={{ background: STATUS_COLOR[job.status] ?? "var(--text-muted)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                  {job.campaign?.name ?? job.type.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}
                </div>
                {job.status === "RUNNING" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <div className="ak-progress" style={{ flex: 1, height: 3 }}>
                      <div className="ak-progress-fill ak-pulse" style={{ width: `${job.progress}%` }} />
                    </div>
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent-light)", flexShrink: 0 }}>{job.progress}%</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                    {new Date(job.createdAt).toLocaleString()}
                    {job.completedAt && ` · ${Math.round((new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000)}s`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {job.result?.assetCount != null && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{job.result.assetCount} assets</span>
                )}
                {job.result?.creditCost != null && (
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    −{job.result.creditCost} cr
                  </span>
                )}
                <span className={`ak-badge ${STATUS_BADGE[job.status] ?? "ak-badge-muted"}`} style={{ fontSize: 10.5 }}>
                  {job.status.charAt(0) + job.status.slice(1).toLowerCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
