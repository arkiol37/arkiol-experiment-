"use client";
// src/components/dashboard/SettingsView.tsx — v11

import React, { useState, useEffect } from "react";

interface User { id: string; email: string; name?: string; role: string; }

interface BillingData {
  plan: string;
  subscriptionStatus: string;
  monthlyPriceUsd?: number;
  credits: { limit: number; used: number; remaining: number; usagePct: number; balance: number; monthlyLimit: number; dailyBalance?: number; };
  planLimits: { credits: number; members: number; brands: number; priceUsd: number; rolloverPct?: number; maxConcurrency?: number; };
  allPlans: Array<{ plan: string; credits: number; priceUsd: number; members: number; brands: number; currentPlan: boolean; }>;
}

const PLAN_LABELS: Record<string, string> = {
  FREE: "Free", CREATOR: "Creator", PRO: "Pro", STUDIO: "Studio",
};
const PLAN_COLOR: Record<string, string> = {
  FREE: "var(--text-muted)", CREATOR: "var(--accent-light)", PRO: "var(--tertiary)", STUDIO: "var(--secondary)",
};

export function SettingsView({ user }: { user: User }) {
  const [apiKeys,  setApiKeys]  = useState<any[]>([]);
  const [usage,    setUsage]    = useState<any>(null);
  const [billing,  setBilling]  = useState<BillingData | null>(null);
  const [keyName,  setKeyName]  = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey,   setNewKey]   = useState<string | null>(null);
  const [tab,      setTab]      = useState<"account"|"billing"|"api"|"usage">("account");

  useEffect(() => {
    fetch("/api/api-keys").then(r => r.json()).then(d => setApiKeys(d.keys ?? []));
    fetch("/api/usage").then(r => r.json()).then(d => setUsage(d));
    fetch("/api/billing").then(r => r.json()).then(d => { if (!d.error) setBilling(d); });
  }, []);

  const createKey = async () => {
    if (!keyName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/api-keys", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: keyName }),
    });
    const data = await res.json();
    if (data.key) { setNewKey(data.key); setKeyName(""); }
    fetch("/api/api-keys").then(r => r.json()).then(d => setApiKeys(d.keys ?? []));
    setCreating(false);
  };

  const revokeKey = async (id: string) => {
    await fetch(`/api/api-keys?id=${id}`, { method: "DELETE" });
    setApiKeys(k => k.filter(key => key.id !== id));
  };

  const openPortal = async () => {
    const res = await fetch("/api/billing", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "portal" }),
    });
    const data = await res.json();
    if (data.url) window.open(data.url, "_blank");
  };

  const startCheckout = async (plan: string) => {
    const res = await fetch("/api/billing", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "checkout", plan }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  };

  const TABS = [
    { id: "account",  label: "Account"  },
    { id: "billing",  label: "Billing"  },
    { id: "api",      label: "API Keys" },
    { id: "usage",    label: "Usage"    },
  ] as const;

  return (
    <div style={{ padding: "36px 44px", maxWidth: 760, fontFamily: "var(--font-body)" }}>
      <h1 style={{ margin: "0 0 28px", fontSize: 28, fontWeight: 400, color: "var(--text-primary)", letterSpacing: "-0.03em", fontFamily: "var(--font-display)" }}>
        Settings
      </h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 28, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none",
            borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === t.id ? "var(--accent-light)" : "var(--text-muted)",
            padding: "8px 18px", fontSize: 13.5, cursor: "pointer",
            fontWeight: tab === t.id ? 600 : 500, marginBottom: -1,
            fontFamily: "var(--font-body)", letterSpacing: "-0.01em",
            transition: "color var(--transition-fast)",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Account tab */}
      {tab === "account" && (
        <div className="ak-card" style={{ padding: "16px 20px" }}>
          <SettingRow label="Email">
            <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{user?.email ?? ""}</span>
          </SettingRow>
          <SettingRow label="Name">
            <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{user?.name ?? "—"}</span>
          </SettingRow>
          <SettingRow label="Role">
            <span className="ak-badge ak-badge-accent">{user?.role ?? "—"}</span>
          </SettingRow>
        </div>
      )}

      {/* Billing tab */}
      {tab === "billing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Current plan card */}
          {billing && (
            <div className="ak-card" style={{ padding: "22px 24px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1.5, background: "linear-gradient(90deg, var(--accent), #c084fc)" }} />
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 400, letterSpacing: "-0.03em", fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
                      {PLAN_LABELS[billing.plan] ?? billing.plan}
                    </span>
                    <span className="ak-badge ak-badge-accent" style={{ color: PLAN_COLOR[billing.plan] ?? "var(--accent-light)" }}>
                      {billing.subscriptionStatus}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    {billing.planLimits.credits.toLocaleString()} credits / month
                    {billing.monthlyPriceUsd ? ` · $${billing.monthlyPriceUsd}/month` : ""}
                  </div>
                </div>
                <button onClick={openPortal} className="ak-btn ak-btn-secondary ak-btn-sm">
                  Manage Plan
                </button>
              </div>

              {/* Credit usage bar */}
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Credits used this cycle</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                    {(billing.credits.used ?? 0).toLocaleString()} / {(billing.credits.limit ?? billing.credits.monthlyLimit ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="ak-progress">
                  <div className="ak-progress-fill" style={{ width: `${billing.credits.usagePct}%` }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{billing.credits.usagePct}% used</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{(billing.credits.remaining ?? billing.credits.balance ?? 0).toLocaleString()} remaining</span>
                </div>
              </div>
            </div>
          )}

          {/* Plan comparison */}
          {billing && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12 }}>
                Available plans
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {billing.allPlans.map(p => (
                  <div key={p.plan} className={p.currentPlan ? "ak-card" : "ak-card-interactive"}
                    style={{
                      padding: "18px 20px",
                      borderColor: p.currentPlan ? "var(--border-accent)" : undefined,
                      background: p.currentPlan ? "var(--accent-tint)" : "var(--bg-surface)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 400, color: "var(--text-primary)", fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>
                          {PLAN_LABELS[p.plan] ?? p.plan}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 400, color: "var(--text-primary)", letterSpacing: "-0.04em", fontFamily: "var(--font-display)", marginTop: 4 }}>
                          ${p.priceUsd}
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)", letterSpacing: 0 }}>/mo</span>
                        </div>
                      </div>
                      {p.currentPlan && <span className="ak-badge ak-badge-accent" style={{ fontSize: 10 }}>Current</span>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                      <PlanFeature label={`${p.credits.toLocaleString()} credits / month`} />
                      <PlanFeature label={`$${p.priceUsd}/month`} muted />
                      <PlanFeature label={`${p.members} team member${p.members !== 1 ? "s" : ""}`} />
                      <PlanFeature label={`${p.brands} brand kit${p.brands !== 1 ? "s" : ""}`} />
                      {(p.plan === "CREATOR" || p.plan === "PRO" || p.plan === "STUDIO") && <PlanFeature label="GIF motion export" />}
                      {(p.plan === "CREATOR" || p.plan === "PRO" || p.plan === "STUDIO") && <PlanFeature label="Animation Studio (video)" />}
                      {(p.plan === "CREATOR" || p.plan === "PRO" || p.plan === "STUDIO") && <PlanFeature label="ZIP bundle export" />}
                      {(p.plan === "PRO" || p.plan === "STUDIO") && <PlanFeature label="Batch generation" />}
                      {(p.plan === "PRO" || p.plan === "STUDIO") && <PlanFeature label="4K export resolution" />}
                      {p.plan === "STUDIO" && <PlanFeature label="Automation API access" />}
                      {(p.plan === "PRO" || p.plan === "STUDIO") && <PlanFeature label={`${p.plan === "PRO" ? "25" : "50"}% credit rollover`} />}
                    </div>
                    {!p.currentPlan && (
                      <button
                        onClick={() => startCheckout(p.plan)}
                        className="ak-btn ak-btn-primary"
                        style={{ width: "100%", padding: "7px", fontSize: 12.5 }}
                      >
                        Upgrade to {PLAN_LABELS[p.plan]}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                At $0.008 per credit · Billed monthly via Stripe · Cancel anytime
              </div>
            </div>
          )}

          {!billing && (
            <div className="ak-card" style={{ padding: "28px", textAlign: "center" }}>
              <div className="ak-shimmer" style={{ width: "100%", height: 120 }} />
            </div>
          )}
        </div>
      )}

      {/* API Keys tab */}
      {tab === "api" && (
        <div>
          {newKey && (
            <div style={{ background: "var(--success-tint)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: "var(--radius-lg)", padding: "14px 18px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--success)", marginBottom: 8 }}>✓ API key created — copy it now, it won&apos;t be shown again</div>
              <code style={{ fontSize: 12, color: "var(--text-primary)", background: "var(--bg-elevated)", padding: "6px 10px", borderRadius: "var(--radius-sm)", display: "block", wordBreak: "break-all" }}>
                {newKey}
              </code>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createKey()}
              placeholder="Key name (e.g. Production)"
              className="ak-input"
              style={{ flex: 1 }}
            />
            <button onClick={createKey} disabled={creating || !keyName.trim()} className="ak-btn ak-btn-primary">
              {creating ? "Creating…" : "+ Create Key"}
            </button>
          </div>

          {apiKeys.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "28px 0" }}>
              No API keys yet
            </p>
          ) : apiKeys.map(key => (
            <div key={key.id} className="ak-card" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, padding: "13px 18px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{key.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                  Created {new Date(key.createdAt).toLocaleDateString()}
                  {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                </div>
              </div>
              <code style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--accent-tint)", padding: "3px 9px", borderRadius: "var(--radius-xs)" }}>
                {key.keyPrefix}••••
              </code>
              <button onClick={() => revokeKey(key.id)} className="ak-btn ak-btn-danger ak-btn-xs">
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Usage tab */}
      {tab === "usage" && (
        <div className="ak-card" style={{ padding: "16px 20px" }}>
          {usage ? (
            <>
              <SettingRow label="Credits Used">
                <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 600 }}>{(usage.creditsUsed ?? 0).toLocaleString()}</span>
              </SettingRow>
              <SettingRow label="Credits Remaining">
                <span style={{ fontSize: 13.5, color: "var(--success)", fontWeight: 600 }}>{(usage.creditsRemaining ?? 0).toLocaleString()}</span>
              </SettingRow>
              <SettingRow label="Assets Generated">
                <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{(usage.assetsGenerated ?? 0).toLocaleString()}</span>
              </SettingRow>
              <SettingRow label="Current Plan">
                <span className="ak-badge ak-badge-accent">{PLAN_LABELS[usage.plan] ?? usage.plan ?? "Free"}</span>
              </SettingRow>
              {usage.estimatedSpentUSD != null && (
                <SettingRow label="Estimated Spend">
                  <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>${usage.estimatedSpentUSD.toFixed(2)} this cycle</span>
                </SettingRow>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
              {[80, 60, 70].map((w, i) => <div key={i} className="ak-shimmer" style={{ height: 36, width: `${w}%` }} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </div>
  );
}

function PlanFeature({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: muted ? "var(--text-muted)" : "var(--text-secondary)" }}>
      {!muted && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M20 6L9 17l-5-5"/>
      </svg>}
      {muted && <span style={{ width:12, display:"inline-block" }}>·</span>}
      {label}
    </div>
  );
}
