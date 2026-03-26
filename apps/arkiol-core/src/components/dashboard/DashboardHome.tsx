"use client";
// src/components/dashboard/DashboardHome.tsx — v11
// Refined: deduplicated CTAs, clear "Open Canvas" + "Create Video Ad" entry points,
// removed redundant AI Generator/New Generation duplication.

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
interface RecentJob { id: string; type: string; status: string; result?: any; createdAt: string; }

const PLAN_COLOR: Record<string, string> = {
  FREE: "var(--text-muted)", CREATOR: "var(--accent)",
  PRO: "var(--accent)", STUDIO: "var(--accent)",
};
const STATUS_DOT: Record<string, string> = {
  COMPLETED: "var(--success)", SUCCEEDED: "var(--success)",
  RUNNING: "var(--warning)", PENDING: "var(--text-muted)",
  QUEUED: "var(--text-muted)", FAILED: "var(--error)",
};

export function DashboardHome({ user }: { user?: any }) {
  const [billing,    setBilling]    = useState<BillingInfo | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showGen,    setShowGen]    = useState(false);
  const [canStudio,  setCanStudio]  = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/billing").then(r => r.json()).catch(() => null),
      fetch("/api/jobs?limit=6").then(r => r.json()).catch(() => ({})),
      fetch("/api/capabilities").then(r => r.json()).catch(() => ({})),
    ]).then(([bil, jobs, caps]) => {
      if (bil && !bil.error) setBilling(bil);
      setRecentJobs(jobs?.jobs ?? []);
      setCanStudio(caps?.canUseStudioVideo === true);
      setLoading(false);
    });
  }, []);

  const creditPct = billing ? Math.max(0, 100 - (billing.credits.usagePct ?? 0)) : 0;
  const isPastDue = billing && ["PAST_DUE", "UNPAID"].includes(billing.subscriptionStatus);

  // Quick actions — deduplicated and clearly named
  // "New Design" (AI Generator) appears once, prominently.
  // "Open Canvas" routes to full-page canvas editor.
  // "Create Video Ad" routes to Animation Studio (or upgrade if not eligible).
  const quickActions = [
    { label: "AI Generator",     icon: "✦", primary: true,  action: () => setShowGen(true),                      desc: "Generate from prompt" },
    { label: "Open Canvas",      icon: "✏", primary: false, href: "/canvas",                                      desc: "Manual editor" },
    { label: "Create Video Ad",  icon: "🎬", primary: false, href: canStudio ? "/animation-studio" : "/animation-studio/upgrade", desc: canStudio ? "Animation Studio" : "Upgrade required" },
    { label: "Browse Gallery",   icon: "◫", primary: false, href: "/gallery",                                     desc: "Your assets" },
    { label: "View Campaigns",   icon: "⊡", primary: false, href: "/campaigns",                                   desc: "Track results" },
    { label: "Brand Kit",        icon: "◈", primary: false, href: "/brand",                                       desc: "Manage identity" },
    { label: "GIF Studio",       icon: "⬡", primary: false, href: "/gif-studio",                                  desc: "Animated GIFs" },
    { label: "Buy Credits",      icon: "⊕", primary: false, href: "/billing",                                     desc: "Top up" },
  ];

  return (
    <div className="ak-fade-in" style={{ padding: "32px 40px", maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}>
            {user?.name ? `Hello, ${user.name.split(" ")[0]} 👋` : "Dashboard"}
          </h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-muted)", letterSpacing: "-0.01em" }}>
            Here&apos;s your workspace.
          </p>
        </div>
        {/* Single primary header CTA */}
        <button onClick={() => setShowGen(true)} className="ak-btn ak-btn-primary" style={{ padding: "10px 24px", fontSize: 14 }}>
          ✦ New Design
        </button>
      </div>

      {isPastDue && (
        <div className="ak-toast ak-toast-error" style={{ marginBottom: 24, fontSize: 13 }}>
          <span>⚠</span>
          <span>Payment failed. <a href="/billing" style={{ color: "var(--error)", textDecoration: "underline" }}>Update billing details</a> to keep your account active.</span>
        </div>
      )}

      {/* Stat cards */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14, marginBottom: 32 }}>
          {[0,1,2,3].map(i => <div key={i} className="ak-shimmer" style={{ height: 120, borderRadius: "var(--radius-xl)" }} />)}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14, marginBottom: 32 }}>
          {[
            {
              label: "Credits Remaining",
              value: billing?.credits.remaining.toLocaleString() ?? "—",
              sub: <><div className="ak-progress" style={{ marginBottom: 5 }}><div className="ak-progress-fill" style={{ width: `${creditPct}%` }} /></div>{billing?.credits.used} / {billing?.credits.limit} used</>,
              accent: creditPct < 15 ? "var(--error)" : creditPct < 40 ? "var(--warning)" : "var(--success)",
            },
            {
              label: "Current Plan",
              value: <span style={{ color: PLAN_COLOR[billing?.plan ?? "FREE"] }}>{(billing?.plan ?? "FREE").charAt(0) + (billing?.plan ?? "free").slice(1).toLowerCase()}</span>,
              sub: <a href="/billing" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>{["FREE","CREATOR"].includes(billing?.plan ?? "") ? "Upgrade plan →" : "Manage →"}</a>,
              accent: undefined,
            },
            {
              label: "Jobs This Week",
              value: recentJobs.filter(j => new Date(j.createdAt) > new Date(Date.now() - 7*86400*1000)).length.toString(),
              sub: `${recentJobs.filter(j => ["COMPLETED","SUCCEEDED"].includes(j.status)).length} completed total`,
              accent: "var(--accent)",
            },
          ].map((s, i) => (
            <div key={i} className="ak-card ak-stat-card" style={{ padding: "22px 24px" }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 10 }}>{s.label}</p>
              <div style={{ fontSize: 32, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.03em", color: (s as any).accent ?? "var(--text-primary)", lineHeight: 1 }}>{s.value}</div>
              {s.sub && <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions — clear, non-redundant */}
      <div style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Quick Actions</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 10 }}>
          {quickActions.map((item, i) => {
            const tileStyle: React.CSSProperties = {
              display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
              padding: "16px", background: item.primary ? "var(--accent-tint-md)" : "var(--bg-elevated)",
              border: `1px solid ${item.primary ? "var(--border-accent)" : "var(--border)"}`,
              borderRadius: "var(--radius-lg)", cursor: "pointer", textDecoration: "none",
              transition: "all var(--transition-base)", fontFamily: "var(--font-body)",
            };
            const onEnter = (e: React.MouseEvent) => {
              (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)";
            };
            const onLeave = (e: React.MouseEvent) => {
              (e.currentTarget as HTMLElement).style.transform = "";
              (e.currentTarget as HTMLElement).style.borderColor = item.primary ? "var(--border-accent)" : "var(--border)";
            };
            const content = (
              <>
                <span style={{ fontSize: 20, color: item.primary ? "var(--accent-light)" : "var(--text-secondary)" }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: item.primary ? "var(--accent-light)" : "var(--text-primary)", letterSpacing: "-0.01em" }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{item.desc}</div>
                </div>
              </>
            );
            return (item as any).action
              ? <button key={i} onClick={(item as any).action} style={tileStyle} onMouseEnter={onEnter} onMouseLeave={onLeave}>{content}</button>
              : <a key={i} href={(item as any).href} style={tileStyle} onMouseEnter={onEnter} onMouseLeave={onLeave}>{content}</a>;
          })}
        </div>
      </div>

      {/* Recent Jobs */}
      {recentJobs.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Recent Jobs</h2>
            <a href="/campaigns" style={{ fontSize: 12.5, color: "var(--accent-light)", textDecoration: "none" }}>View all →</a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentJobs.map(job => (
              <div key={job.id} className="ak-job-row">
                <div className="ak-status-dot" style={{ background: STATUS_DOT[job.status] ?? "var(--text-muted)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {job.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{new Date(job.createdAt).toLocaleString()}</div>
                </div>
                {job.result?.assetCount != null && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{job.result.assetCount} assets</span>}
                <span className={`ak-badge ak-badge-${["COMPLETED","SUCCEEDED"].includes(job.status) ? "success" : job.status === "FAILED" ? "error" : job.status === "RUNNING" ? "warning" : "muted"}`} style={{ fontSize: 10.5 }}>
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && recentJobs.length === 0 && (
        <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-2xl)", border: "1px dashed var(--border-strong)", overflow: "hidden" }}>
          <div style={{ textAlign: "center", padding: "44px 24px 28px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "var(--radius-2xl)", background: "var(--accent-tint)", border: "1px solid var(--border-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 18px" }}>✦</div>
            <h3 style={{ fontSize: 22, fontWeight: 400, fontFamily: "var(--font-display)", margin: "0 0 10px", letterSpacing: "-0.01em" }}>
              Create your first design
            </h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13.5, maxWidth: 380, margin: "0 auto 28px", lineHeight: 1.65 }}>
              Arkiol turns a single prompt into multiple formats simultaneously — thumbnails, posts, ads, and more.
            </p>
            {/* Two primary entry points clearly presented */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => setShowGen(true)} className="ak-btn ak-btn-primary" style={{ padding: "12px 28px", fontSize: 14 }}>
                ✦ Generate with AI
              </button>
              <a href="/canvas" className="ak-btn ak-btn-secondary" style={{ padding: "12px 28px", fontSize: 14, textDecoration: "none" }}>
                ✏ Open Canvas
              </a>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid var(--border)" }}>
            {[
              { n: "1", label: "Enter prompt",     icon: "◎", color: "var(--accent)" },
              { n: "2", label: "Generate designs", icon: "✦", color: "var(--accent)" },
              { n: "3", label: "Select result",    icon: "◈", color: "var(--accent)" },
              { n: "4", label: "Export or edit",   icon: "◉", color: "var(--accent)" },
            ].map((s, i) => (
              <div key={s.n} style={{ padding: "18px 16px", textAlign: "center", borderRight: i < 3 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontSize: 20, color: s.color, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Step {s.n}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3, fontWeight: 500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showGen && <GeneratePanel onClose={() => setShowGen(false)} onComplete={() => { setShowGen(false); window.location.href = "/gallery"; }} />}
    </div>
  );
}
