"use client";
// src/components/dashboard/DashboardHome.tsx — v19
// Fully unified with homepage: blue-to-teal gradients, Instrument Serif headings, glass cards

import { useEffect, useState } from "react";
import { GeneratePanel } from "../generate/GeneratePanel";

interface BillingInfo {
  plan: string;
  credits: { remaining: number; used: number; limit: number; usagePct: number; balance: number; monthlyLimit: number };
  currentCycleEnd?: string;
  cycleEndsAt?: string;
  features?: { canUseStudioVideo: boolean; };
  canUseStudioVideo?: boolean;
  autoRefillEnabled?: boolean;
  subscriptionStatus: string;
  creditBalance?: number;
}
interface RecentJob {
  id:         string;
  type:       string;
  status:     string;
  result?:    any; // enriched by /api/jobs: on FAILED includes { title, message, error, failReason, retryable }
  error?:     string | null;
  failReason?: string | null;
  createdAt:  string;
}

const STATUS_DOT: Record<string, string> = {
  COMPLETED: "#10b981", SUCCEEDED: "#10b981",
  RUNNING: "#f59e0b", PENDING: "#94a3b8",
  QUEUED: "#94a3b8", FAILED: "#ef4444",
};
const STATUS_BG: Record<string, string> = {
  COMPLETED: "rgba(16,185,129,0.10)", SUCCEEDED: "rgba(16,185,129,0.10)",
  RUNNING: "rgba(245,158,11,0.10)", PENDING: "rgba(148,163,184,0.10)",
  QUEUED: "rgba(148,163,184,0.10)", FAILED: "rgba(239,68,68,0.10)",
};

const PLAN_LABEL: Record<string, string> = { FREE: "Free", CREATOR: "Creator", PRO: "Pro", STUDIO: "Studio" };
const PLAN_ACCENT: Record<string, string> = { FREE: "#737a96", CREATOR: "#4f8ef7", PRO: "#60a5fa", STUDIO: "#93c5fd" };

export function DashboardHome({ user }: { user?: any }) {
  const [billing,    setBilling]    = useState<BillingInfo | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showGen,    setShowGen]    = useState(false);
  const [canStudio,  setCanStudio]  = useState(false);
  // Per-job in-flight flag for the inline Retry button. Keyed by jobId
  // so two failed jobs in the list can be retried independently.
  const [retrying,   setRetrying]   = useState<Record<string, boolean>>({});

  // Fire the explicit retry endpoint and optimistically flip the row to
  // PENDING so the dot + badge update immediately. The /api/jobs poll
  // on the next page navigation will reconcile the real status.
  const handleRetry = async (jobId: string) => {
    if (retrying[jobId]) return;
    setRetrying(s => ({ ...s, [jobId]: true }));
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      if (res.ok) {
        setRecentJobs(prev => prev.map(j =>
          j.id === jobId ? { ...j, status: "PENDING", result: { ...(j.result ?? {}), retried: true } } : j,
        ));
      }
    } catch { /* swallow — UI keeps the FAILED state and the user can try again */ }
    finally {
      setRetrying(s => ({ ...s, [jobId]: false }));
    }
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/billing").then(r => r.json()).catch(() => null),
      fetch("/api/jobs?limit=6").then(r => r.json()).catch(() => ({})),
    ]).then(([bil, jobs]) => {
      if (bil && !bil.error) {
        setBilling(bil);
        setCanStudio(bil.canUseStudioVideo === true);
      }
      setRecentJobs(jobs?.jobs ?? []);
      setLoading(false);
    });
  }, []);

  const creditPct  = billing ? Math.max(0, 100 - (billing.credits.usagePct ?? 0)) : 0;
  const isPastDue  = billing && ["PAST_DUE", "UNPAID"].includes(billing.subscriptionStatus);
  const firstName  = user?.name ? user.name.split(" ")[0] : null;
  const plan       = billing?.plan ?? "FREE";
  const planAccent = PLAN_ACCENT[plan] ?? "#4f8ef7";
  const weekJobs   = recentJobs.filter(j => new Date(j.createdAt) > new Date(Date.now() - 7*86400*1000)).length;
  const doneJobs   = recentJobs.filter(j => ["COMPLETED","SUCCEEDED"].includes(j.status)).length;

  const quickActions = [
    { label: "AI Generator",    icon: "✦", href: null,   action: () => setShowGen(true), desc: "Prompt to design",       primary: true },
    { label: "Open Canvas",     icon: "✏", href: "/canvas",                               desc: "Manual editor",         primary: false },
    { label: "Create Video Ad", icon: "🎬", href: canStudio ? "/animation-studio" : "/animation-studio/upgrade", desc: canStudio ? "Animation Studio" : "Creator plan and above", primary: false },
    { label: "Browse Gallery",  icon: "◫", href: "/gallery",                              desc: "Your creations",        primary: false },
    { label: "View Campaigns",  icon: "⊡", href: "/campaigns",                            desc: "Track performance",     primary: false },
    { label: "Brand Kit",       icon: "◈", href: "/brand",                                desc: "Manage identity",       primary: false },
    { label: "GIF Studio",      icon: "⬡", href: "/gif-studio",                           desc: "Animated exports",      primary: false },
    { label: "Buy Credits",     icon: "⊕", href: "/billing",                              desc: "Top up balance",        primary: false },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "transparent", fontFamily: "var(--font-body)", color: "#eaedf5" }}>
      <style>{`
        @keyframes dh-fade { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes dh-shimmer { 0%{background-position:-600px 0} 100%{background-position:600px 0} }

        .dh-card {
          background: rgba(255,255,255,0.034);
          border: 1px solid rgba(255,255,255,0.068);
          border-radius: 14px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.05) inset;
          transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
        }
        .dh-card:hover {
          border-color: rgba(79,142,247,0.28);
          box-shadow: 0 0 0 1px rgba(79,142,247,0.10), 0 8px 32px rgba(0,0,0,0.45);
          transform: translateY(-2px);
        }
        .dh-action {
          background: rgba(255,255,255,0.034);
          border: 1px solid rgba(255,255,255,0.068);
          border-radius: 12px; cursor: pointer; text-decoration: none;
          display: flex; flex-direction: column; gap: 10px; padding: 18px 16px;
          transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
        }
        .dh-action:hover {
          border-color: rgba(79,142,247,0.35);
          box-shadow: 0 0 0 1px rgba(79,142,247,0.10), 0 6px 24px rgba(0,0,0,0.4);
          transform: translateY(-2px);
        }
        .dh-action-primary {
          background: rgba(79,142,247,0.07) !important;
          border-color: rgba(79,142,247,0.25) !important;
        }
        .dh-action-primary:hover {
          border-color: rgba(79,142,247,0.45) !important;
          box-shadow: 0 0 0 1px rgba(79,142,247,0.14), 0 8px 28px rgba(79,142,247,0.18) !important;
        }
        .dh-job {
          display: flex; align-items: center; gap: 14px; padding: 13px 16px;
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.068);
          border-radius: 10px;
          transition: border-color 150ms ease, background 150ms ease;
          margin-bottom: 6px;
        }
        .dh-job:hover { border-color: rgba(79,142,247,0.25); background: rgba(79,142,247,0.04); }
        .dh-shimmer {
          background: linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 100%);
          background-size: 1200px 100%; animation: dh-shimmer 1.8s ease-in-out infinite; border-radius: 14px;
        }
        .dh-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          background: linear-gradient(135deg,#4f8ef7,#2460e8);
          color: #fff; border: none; border-radius: 10px;
          padding: 11px 22px; font-size: 14px; font-weight: 600;
          cursor: pointer; font-family: var(--font-body);
          box-shadow: 0 4px 16px rgba(79,142,247,0.32);
          transition: transform 140ms ease, box-shadow 140ms ease;
          text-decoration: none;
        }
        .dh-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(79,142,247,0.48); color: #fff; }
        .dh-btn-secondary {
          display: inline-flex; align-items: center; gap: 8px;
          background: rgba(255,255,255,0.06); color: #737a96;
          border: 1px solid rgba(255,255,255,0.10); border-radius: 10px;
          padding: 11px 22px; font-size: 14px; font-weight: 500;
          cursor: pointer; font-family: var(--font-body); text-decoration: none;
          transition: background 140ms ease, border-color 140ms ease, transform 140ms ease, color 140ms ease;
        }
        .dh-btn-secondary:hover { background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.18); transform: translateY(-1px); color: #eaedf5; }
        .dh-progress { height: 4px; background: rgba(255,255,255,0.06); border-radius: 99px; overflow: hidden; }
        .dh-progress-fill { height: 100%; border-radius: 99px; transition: width 0.5s ease; }

        .dh-container { max-width: 1160px; margin: 0 auto; padding: 0 32px 64px; }
        .dh-hero { padding: 56px 0 44px; }
        .dh-hero-headline { font-size: 48px; }
        .dh-stat-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 40px; }
        .dh-steps-grid { display: grid; grid-template-columns: repeat(4,1fr); border-top: 1px solid rgba(255,255,255,0.068); }
        .dh-stat-value { font-size: 42px; }

        @media (max-width: 900px) {
          .dh-container { padding: 0 20px 48px; }
          .dh-hero { padding: 36px 0 28px; }
          .dh-hero-headline { font-size: 36px; }
          .dh-stat-grid { grid-template-columns: repeat(2,1fr); gap: 12px; margin-bottom: 28px; }
          .dh-stat-value { font-size: 34px; }
          .dh-steps-grid { grid-template-columns: repeat(2,1fr); }
          .dh-steps-grid > * { border-right: none !important; border-top: 1px solid rgba(255,255,255,0.068); }
          .dh-steps-grid > *:nth-child(odd) { border-right: 1px solid rgba(255,255,255,0.068) !important; }
        }
        @media (max-width: 520px) {
          .dh-container { padding: 0 14px 40px; }
          .dh-hero { padding: 28px 0 22px; }
          .dh-hero-headline { font-size: 28px; }
          .dh-stat-grid { grid-template-columns: 1fr; gap: 10px; }
          .dh-stat-value { font-size: 30px; }
          .dh-steps-grid { grid-template-columns: 1fr; }
          .dh-steps-grid > * { border-right: none !important; border-top: 1px solid rgba(255,255,255,0.068); }
          .dh-steps-grid > *:first-child { border-top: none; }
          .dh-action { padding: 14px 12px !important; }
          .dh-job { padding: 11px 12px !important; gap: 10px !important; }
        }
      `}</style>

      <div className="dh-container">

        {/* ── Past-due alert ── */}
        {isPastDue && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 10, padding: "13px 18px", margin: "24px 0 0", color: "#fca5a5", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            <span>Payment failed. <a href="/billing" style={{ color: "#f87171", textDecoration: "underline" }}>Update billing details</a> to keep your account active.</span>
          </div>
        )}

        {/* ── Hero ── */}
        <div className="dh-hero" style={{ animation: "dh-fade 340ms ease both" }}>
          {/* Greeting */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg,${planAccent},${planAccent}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0, boxShadow: `0 0 0 3px ${planAccent}22` }}>
              {(user?.name ?? user?.email ?? "U").slice(0,1).toUpperCase()}
            </div>
            <span style={{ fontSize: 13, color: "#3e4358", fontWeight: 500 }}>
              {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
            </span>
            {billing && (
              <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: planAccent, background: `${planAccent}18`, border: `1px solid ${planAccent}30`, borderRadius: 99, padding: "2px 9px" }}>
                {PLAN_LABEL[plan] ?? plan}
              </span>
            )}
          </div>

          {/* Headline — Instrument Serif matching homepage */}
          <h1 className="dh-hero-headline" style={{ fontFamily: "var(--font-display)", fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 1.06, margin: "0 0 16px", color: "#eaedf5" }}>
            Create designs that<br />
            <em style={{ background: "linear-gradient(90deg,#4f8ef7,#60a5fa,#2DD4BF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", fontStyle: "italic" }}>
              actually convert.
            </em>
          </h1>
          <p style={{ fontSize: 16, color: "#737a96", lineHeight: 1.68, maxWidth: 520, margin: "0 0 32px", fontWeight: 400 }}>
            One prompt. Every format. Ads, thumbnails, social posts, and video — generated in seconds, ready to ship.
          </p>

          {/* Primary CTAs */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={() => setShowGen(true)} className="dh-btn-primary">
              <span style={{ fontSize: 15 }}>✦</span> Generate with AI
            </button>
            <a href={canStudio ? "/animation-studio" : "/animation-studio/upgrade"} className="dh-btn-secondary">
              <span style={{ fontSize: 15 }}>🎬</span> Create Video Ad
            </a>
            <a href="/canvas" className="dh-btn-secondary">
              <span style={{ fontSize: 15 }}>✏</span> Open Canvas
            </a>
          </div>
        </div>

        {/* ── Stat cards ── */}
        {loading ? (
          <div className="dh-stat-grid">
            {[0,1,2].map(i => <div key={i} className="dh-shimmer" style={{ height: 118 }} />)}
          </div>
        ) : billing ? (
          <div className="dh-stat-grid" style={{ animation: "dh-fade 380ms 60ms ease both" }}>

            {/* Credits */}
            <div className="dh-card" style={{ padding: "22px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#3e4358" }}>Credits</span>
                <span style={{ fontSize: 11, color: creditPct < 15 ? "#ef4444" : creditPct < 40 ? "#f59e0b" : "#10b981", fontWeight: 600 }}>
                  {creditPct < 15 ? "⚠ Low" : creditPct < 40 ? "Moderate" : "Healthy"}
                </span>
              </div>
              <div className="dh-stat-value" style={{ fontFamily: "var(--font-display)", fontWeight: 400, letterSpacing: "-0.03em", color: "#eaedf5", lineHeight: 1, marginBottom: 12 }}>
                {billing.credits.remaining.toLocaleString()}
              </div>
              <div className="dh-progress" style={{ marginBottom: 8 }}>
                <div className="dh-progress-fill" style={{ width: `${creditPct}%`, background: creditPct < 15 ? "#ef4444" : creditPct < 40 ? "#f59e0b" : "linear-gradient(90deg,#4f8ef7,#2460e8)" }} />
              </div>
              <div style={{ fontSize: 12, color: "#3e4358" }}>{billing.credits.used.toLocaleString()} / {billing.credits.limit.toLocaleString()} used · <a href="/billing" style={{ color: "#4f8ef7", textDecoration: "none", fontWeight: 500 }}>Top up →</a></div>
            </div>

            {/* Plan */}
            <div className="dh-card" style={{ padding: "22px 24px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#3e4358", marginBottom: 14 }}>Current Plan</div>
              <div className="dh-stat-value" style={{ fontFamily: "var(--font-display)", fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 12, color: planAccent }}>
                {PLAN_LABEL[plan] ?? plan}
              </div>
              <div style={{ fontSize: 12, color: "#3e4358" }}>
                {["FREE","CREATOR"].includes(plan)
                  ? <><a href="/billing" style={{ color: "#4f8ef7", textDecoration: "none", fontWeight: 500 }}>Upgrade for more →</a></>
                  : <><a href="/billing" style={{ color: "#4f8ef7", textDecoration: "none", fontWeight: 500 }}>Manage subscription →</a></>
                }
              </div>
            </div>

            {/* Activity */}
            <div className="dh-card" style={{ padding: "22px 24px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#3e4358", marginBottom: 14 }}>This Week</div>
              <div className="dh-stat-value" style={{ fontFamily: "var(--font-display)", fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 12, color: "#eaedf5" }}>
                {weekJobs}
                <span style={{ fontSize: 14, fontWeight: 400, color: "#3e4358", marginLeft: 8, fontFamily: "var(--font-body)" }}>jobs</span>
              </div>
              <div style={{ fontSize: 12, color: "#3e4358" }}>{doneJobs} completed · <a href="/campaigns" style={{ color: "#4f8ef7", textDecoration: "none", fontWeight: 500 }}>View all →</a></div>
            </div>
          </div>
        ) : null}

        {/* ── Quick Actions ── */}
        <div style={{ marginBottom: 44, animation: "dh-fade 400ms 100ms ease both" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ height: "1px", width: 24, background: "linear-gradient(90deg,transparent,rgba(79,142,247,0.4))" }} />
              <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#4f8ef7", margin: 0, opacity: 0.75 }}>Quick Actions</h2>
              <div style={{ height: "1px", width: 24, background: "linear-gradient(90deg,rgba(79,142,247,0.4),transparent)" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(152px,1fr))", gap: 10 }}>
            {quickActions.map((item, i) => {
              const inner = (
                <>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: item.primary ? "rgba(79,142,247,0.15)" : "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: item.primary ? "#4f8ef7" : "#eaedf5", letterSpacing: "-0.01em", marginBottom: 3 }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "#3e4358", lineHeight: 1.4 }}>{item.desc}</div>
                  </div>
                </>
              );
              return item.action
                ? <button key={i} onClick={item.action} className={`dh-action${item.primary ? " dh-action-primary" : ""}`}>{inner}</button>
                : <a key={i} href={item.href!} className={`dh-action${item.primary ? " dh-action-primary" : ""}`}>{inner}</a>;
            })}
          </div>
        </div>

        {/* ── Recent Jobs ── */}
        {recentJobs.length > 0 && (
          <div style={{ animation: "dh-fade 420ms 140ms ease both" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ height: "1px", width: 24, background: "linear-gradient(90deg,transparent,rgba(79,142,247,0.4))" }} />
                <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#4f8ef7", margin: 0, opacity: 0.75 }}>Recent Activity</h2>
                <div style={{ height: "1px", width: 24, background: "linear-gradient(90deg,rgba(79,142,247,0.4),transparent)" }} />
              </div>
              <a href="/campaigns" style={{ fontSize: 12.5, color: "#4f8ef7", textDecoration: "none", fontWeight: 500 }}>View all →</a>
            </div>
            <div>
              {recentJobs.map(job => {
                // The jobs API pre-populates result.title + result.message
                // for FAILED rows (see /api/jobs/route.ts). Surface those
                // inline so the Recent Activity tile doesn't just show
                // "FAILED" with no explanation.
                const isFailed  = job.status === "FAILED";
                const failTitle = isFailed ? (job.result?.title   ?? "Generation failed") : null;
                const failMsg   = isFailed ? (job.result?.message ?? job.result?.error ?? null) : null;
                // Surface the Retry button only when the backend says
                // the failure class is actually retryable. Hard errors
                // (missing_asset, cancelled) skip the button so users
                // don't loop on something that can't recover.
                const canRetry  = isFailed && job.result?.retryable === true;
                const isRetrying = !!retrying[job.id];
                return (
                <div key={job.id} className="dh-job" title={failMsg ?? undefined}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[job.status] ?? "#737a96", flexShrink: 0, boxShadow: `0 0 6px ${STATUS_DOT[job.status] ?? "#737a96"}88` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#eaedf5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {job.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                    </div>
                    {isFailed && failMsg ? (
                      <div style={{ fontSize: 11.5, color: "#fca5a5", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }}>{failTitle}:</span> {failMsg}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: "#3e4358", marginTop: 2 }}>{new Date(job.createdAt).toLocaleString()}</div>
                    )}
                  </div>
                  {job.result?.assetCount != null && !isFailed && (
                    <span style={{ fontSize: 12, color: "#737a96" }}>{job.result.assetCount} assets</span>
                  )}
                  {canRetry && (
                    <button
                      onClick={() => handleRetry(job.id)}
                      disabled={isRetrying}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "4px 10px",
                        borderRadius: 8, border: "1px solid rgba(79,142,247,0.35)",
                        background: isRetrying ? "rgba(79,142,247,0.10)" : "rgba(79,142,247,0.18)",
                        color: "#4f8ef7", cursor: isRetrying ? "default" : "pointer",
                        letterSpacing: "0.02em",
                      }}>
                      {isRetrying ? "Retrying…" : "↻ Retry"}
                    </button>
                  )}
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 99, background: STATUS_BG[job.status] ?? "rgba(148,163,184,0.10)", color: STATUS_DOT[job.status] ?? "#94a3b8", border: `1px solid ${STATUS_DOT[job.status] ?? "#94a3b8"}30` }}>
                    {job.status}
                  </span>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && recentJobs.length === 0 && (
          <div style={{ animation: "dh-fade 420ms 140ms ease both" }}>
            <div style={{ background: "rgba(255,255,255,0.025)", border: "1px dashed rgba(255,255,255,0.10)", borderRadius: 20, overflow: "hidden" }}>
              <div style={{ textAlign: "center", padding: "56px 24px 36px" }}>
                <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(79,142,247,0.10)", border: "1px solid rgba(79,142,247,0.22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 22px", boxShadow: "0 0 40px rgba(79,142,247,0.15)" }}>✦</div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 400, margin: "0 0 12px", letterSpacing: "-0.025em", color: "#eaedf5" }}>
                  Your workspace is ready
                </h3>
                <p style={{ color: "#737a96", fontSize: 14, maxWidth: 400, margin: "0 auto 32px", lineHeight: 1.72 }}>
                  Generate your first design from a single prompt — thumbnails, social posts, ads, and more in seconds.
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={() => setShowGen(true)} className="dh-btn-primary">
                    ✦ Generate with AI
                  </button>
                  <a href="/canvas" className="dh-btn-secondary">✏ Open Canvas</a>
                </div>
              </div>
              <div className="dh-steps-grid">
                {[
                  { n: "01", label: "Enter your prompt",   icon: "◎", color: "#4f8ef7" },
                  { n: "02", label: "Generate designs",    icon: "✦", color: "#60a5fa" },
                  { n: "03", label: "Pick your favourite", icon: "◈", color: "#93c5fd" },
                  { n: "04", label: "Export or refine",    icon: "◉", color: "#2DD4BF" },
                ].map((s, i) => (
                  <div key={s.n} style={{ padding: "22px 18px", textAlign: "center", borderRight: i < 3 ? "1px solid rgba(255,255,255,0.068)" : "none" }}>
                    <div style={{ fontSize: 22, marginBottom: 10, color: s.color }}>{s.icon}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#3e4358", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{s.n}</div>
                    <div style={{ fontSize: 12.5, color: "#737a96", fontWeight: 500 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {showGen && <GeneratePanel onClose={() => setShowGen(false)} onComplete={() => { setShowGen(false); window.location.href = "/gallery"; }} />}
    </div>
  );
}
