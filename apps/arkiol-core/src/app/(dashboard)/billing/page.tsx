"use client";
// src/app/(dashboard)/billing/page.tsx
// Billing & pricing — subscription plans + credit top-ups.
// Top-ups are only shown to paid subscribers (Creator, Pro, Studio).

import { useEffect, useState }  from "react";
import { useCapabilities }      from "../../../hooks/useCapabilities";
import { PaddleCheckout }       from "../../../components/billing/PaddleCheckout";

type PlanKey = "FREE" | "CREATOR" | "PRO" | "STUDIO";

interface OrgBilling {
  plan:               PlanKey;
  subscriptionStatus: string | null;
  creditBalance:      number;
  currentCycleEnd:    string | null;
}

// ── Subscription plans (from packages/shared/src/plans.ts) ───────────────────
const PLANS = [
  {
    key:         "FREE" as PlanKey,
    name:        "Free",
    price:       0,
    credits:     "1 free Ad / day",
    perCredit:   null,
    description: "1 free watermarked Normal Ad per day. No card required.",
    accentColor: "#6B7280",
    color:       "rgba(79,142,247,0.02)",
    borderColor: "#1F2937",
    cta:         "Current plan",
    popular:     false,
  },
  {
    key:         "CREATOR" as PlanKey,
    name:        "Creator",
    price:       25,
    credits:     "500 credits / mo",
    perCredit:   "$0.050 per credit",
    description: "For solo creators who need consistent output.",
    accentColor: "#4f8ef7",
    color:       "rgba(79,142,247,0.04)",
    borderColor: "rgba(79,142,247,0.18)",
    cta:         "Upgrade to Creator",
    popular:     false,
  },
  {
    key:         "PRO" as PlanKey,
    name:        "Pro",
    price:       79,
    credits:     "1,700 credits / mo",
    perCredit:   "$0.047 per credit",
    description: "For teams who ship campaigns at scale.",
    accentColor: "#4f8ef7",
    color:       "rgba(79,142,247,0.06)",
    borderColor: "rgba(79,142,247,0.28)",
    cta:         "Upgrade to Pro",
    popular:     true,
  },
  {
    key:         "STUDIO" as PlanKey,
    name:        "Studio",
    price:       249,
    credits:     "6,000 credits / mo",
    perCredit:   "$0.042 per credit",
    description: "Enterprise-grade AI for large teams.",
    accentColor: "#4f8ef7",
    color:       "rgba(79,142,247,0.04)",
    borderColor: "rgba(79,142,247,0.18)",
    cta:         "Upgrade to Studio",
    popular:     false,
  },
];

const PLAN_ORDER: PlanKey[] = ["FREE", "CREATOR", "PRO", "STUDIO"];

// ── Top-up packs — kept in sync with packages/shared/src/plans.ts ─────────────
// Rates are CHEAPER than subscriptions (not more expensive).
// 200 cr=$0.040, 600 cr=$0.037, 2000 cr=$0.035 vs Creator $0.050/cr cheapest sub.
const TOPUP_PACKS = [
  {
    id:          "pack_200",
    label:       "Boost",
    credits:     200,
    price:       8,
    perCredit:   "$0.040 / credit",
    description: "Quick top-up when you need a little more",
    accentColor: "#4f8ef7",
    highlight:   false,
  },
  {
    id:          "pack_600",
    label:       "Growth",
    credits:     600,
    price:       22,
    perCredit:   "$0.037 / credit",
    description: "Best value for a busy campaign sprint",
    accentColor: "#4f8ef7",
    highlight:   true,
  },
  {
    id:          "pack_2000",
    label:       "Power",
    credits:     2000,
    price:       69,
    perCredit:   "$0.035 / credit",
    description: "Bulk credits at the lowest top-up rate",
    accentColor: "#4f8ef7",
    highlight:   false,
  },
];

const PAID_PLANS: PlanKey[] = ["CREATOR", "PRO", "STUDIO"];

export const dynamic = "force-dynamic";

export default function BillingPage() {
  const [billing, setBilling]               = useState<OrgBilling | null>(null);
  const [loading, setLoading]               = useState(true);
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);
  const { caps, loading: capsLoading }      = useCapabilities();

  useEffect(() => {
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(data => setBilling(data?.plan ? data : null))
      .catch(() => {})
      .finally(() => setLoading(false));

    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      setUpgradeSuccess(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const currentPlan    = billing?.plan ?? "FREE";
  const isPaidPlan     = PAID_PLANS.includes(currentPlan);
  const billingReady   = !capsLoading && caps.hasBilling;
  const currentIdx     = PLAN_ORDER.indexOf(currentPlan);

  if (loading) {
    return (
      <div style={{ padding: "80px 40px", textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        Loading billing…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: "44px 48px", maxWidth: 1100, margin: "0 auto" }}>
      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .plan-card  { transition: transform .18s ease, box-shadow .18s ease; }
        .plan-card:hover { transform: translateY(-3px); }
        .topup-card { transition: transform .18s ease, border-color .18s ease; }
        .topup-card:hover { transform: translateY(-2px); }
        .btn-plan   { transition: opacity .12s, transform .12s; cursor: pointer; }
        .btn-plan:hover { opacity: .88; transform: translateY(-1px); }
      `}</style>

      {/* Billing not configured */}
      {!billingReady && (
        <div style={{ background: "#1c1200", border: "1px solid rgba(251,191,36,.3)", borderRadius: 10, padding: "13px 18px", marginBottom: 28, color: "var(--warning)", fontSize: 13 }}>
          ⚠️ <strong>Payment processing not configured.</strong> Plan display is for preview only — add billing environment variables to enable checkout.
        </div>
      )}

      {/* Success */}
      {upgradeSuccess && (
        <div style={{ background: "rgba(52,211,153,.08)", border: "1px solid var(--success-border)", borderRadius: "var(--radius-md)", padding: "13px 20px", marginBottom: 32, color: "var(--success)", fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 10, animation: "fadeUp .3s ease" }}>
          ✅ Payment successful! Your plan has been upgraded.
        </div>
      )}

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--accent-tint)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-full)", padding: "5px 14px", marginBottom: 14 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: ".07em", textTransform: "uppercase" }}>Pricing & Plans</span>
        </div>
        <h1 style={{ fontSize: 32, letterSpacing: "-.05em", margin: "0 0 8px", fontFamily: "var(--font-display)" }}>
          Simple, transparent pricing
        </h1>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
          Clear pricing, no commitments. No hidden fees.
          {billing?.creditBalance != null && (
            <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 13 }}>
              You have <strong style={{ color: "var(--accent)" }}>{billing.creditBalance.toLocaleString()} credits</strong> remaining.
            </span>
          )}
        </p>
      </div>

      {/* ── Subscription plans ────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 56, animation: "fadeUp .4s ease" }}>
        {PLANS.map(plan => {
          const isCurrent   = currentPlan === plan.key;
          const planIdx     = PLAN_ORDER.indexOf(plan.key);
          const isDowngrade = planIdx < currentIdx;

          return (
            <div
              key={plan.key}
              className="plan-card"
              style={{
                background:    plan.color,
                border:        `1.5px solid ${isCurrent ? plan.accentColor : plan.borderColor}`,
                borderRadius:  "var(--radius-xl)",
                padding:       plan.popular ? "28px 22px 22px" : "22px",
                position:      "relative",
                display:       "flex",
                flexDirection: "column",
                boxShadow:     isCurrent
                  ? `0 0 0 3px ${plan.accentColor}22, 0 8px 32px rgba(0,0,0,.4)`
                  : plan.popular
                  ? "0 8px 40px rgba(79,142,247,.12), 0 2px 8px rgba(13,17,23,.08)"
                  : "0 2px 10px rgba(0,0,0,.25)",
              }}
            >
              {plan.popular && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#4f8ef7,#2460e8)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 13px", borderRadius: "var(--radius-full)", letterSpacing: ".07em", textTransform: "uppercase", whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(79,142,247,.35)" }}>
                  ★ Most Popular
                </div>
              )}

              {isCurrent && (
                <div style={{ position: "absolute", top: 12, right: 12, background: `${plan.accentColor}22`, border: `1px solid ${plan.accentColor}44`, color: plan.accentColor, fontSize: 9, fontWeight: 700, padding: "2px 9px", borderRadius: "var(--radius-full)", letterSpacing: ".07em", textTransform: "uppercase" }}>
                  Current
                </div>
              )}

              {/* Plan name */}
              <div style={{ fontSize: 11, fontWeight: 700, color: plan.accentColor, letterSpacing: ".09em", textTransform: "uppercase", marginBottom: 10 }}>
                {plan.name}
              </div>

              {/* Price */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, marginBottom: 3 }}>
                {plan.price === 0 ? (
                  <span style={{ fontSize: 36, letterSpacing: "-.05em", fontFamily: "var(--font-display)", lineHeight: 1, color: "var(--text-primary)" }}>Free</span>
                ) : (
                  <>
                    <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text-muted)", marginBottom: 5 }}>$</span>
                    <span style={{ fontSize: 36, letterSpacing: "-.05em", fontFamily: "var(--font-display)", lineHeight: 1, color: "var(--text-primary)" }}>{plan.price}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 5 }}>/mo</span>
                  </>
                )}
              </div>

              {/* Credits */}
              <div style={{ fontSize: 12, color: plan.accentColor, fontWeight: 600, marginBottom: 2 }}>◆ {plan.credits}</div>
              {plan.perCredit && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{plan.perCredit}</div>
              )}

              {/* Description */}
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 20, flex: 1 }}>{plan.description}</div>

              <div style={{ height: 1, background: `${plan.accentColor}18`, marginBottom: 16 }} />

              {/* CTA */}
              {plan.key === "FREE" ? (
                isCurrent ? (
                  <div style={{ textAlign: "center", padding: "10px", fontSize: 12, fontWeight: 500, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                    Your current plan
                  </div>
                ) : (
                  <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)", padding: "10px 0" }}>Contact support to downgrade</div>
                )
              ) : isCurrent ? (
                <div style={{ textAlign: "center", padding: "10px", fontSize: 12, fontWeight: 600, color: plan.accentColor, background: `${plan.accentColor}10`, border: `1px solid ${plan.accentColor}28`, borderRadius: "var(--radius-md)" }}>
                  ✓ Your active plan
                </div>
              ) : isDowngrade ? (
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)", padding: "10px 0" }}>Contact support to downgrade</div>
              ) : billingReady ? (
                <PaddleCheckout
                  planKey={plan.key}
                  label={plan.cta}
                  onSuccess={() => setUpgradeSuccess(true)}
                  className="btn-plan"
                  style={{
                    display: "block", width: "100%", padding: "10px 16px",
                    borderRadius: "var(--radius-md)", border: "none",
                    background: plan.popular
                      ? "linear-gradient(135deg,#4f8ef7,#2460e8)"
                      : `${plan.accentColor}16`,
                    color:      plan.popular ? "#fff" : plan.accentColor,
                    fontSize: 12, fontWeight: 700, textAlign: "center",
                    boxShadow: plan.popular ? "0 4px 14px rgba(79,142,247,.25)" : "none",
                  }}
                />
              ) : (
                <div style={{ textAlign: "center", padding: "10px", fontSize: 12, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                  Billing not configured
                </div>
              )}
            </div>
          );
        })}
      </div>


      {/* ── Full plan feature comparison table ───────────────────────────────── */}
      <div style={{ marginBottom: 52 }}>
        <h2 style={{ fontSize: 20, letterSpacing: "-.04em", fontFamily: "var(--font-display)", margin: "0 0 6px" }}>
          Compare all features
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 22px" }}>Every capability across plans — from credits to concurrency.</p>
        <div style={{ overflowX: "auto", borderRadius: "var(--radius-xl)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-elevated)" }}>
                <th style={{ textAlign: "left", padding: "12px 20px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", width: "38%" }}>Feature</th>
                {(["FREE","CREATOR","PRO","STUDIO"] as const).map((pk, i) => {
                  const labels: Record<string,string> = { FREE:"Free", CREATOR:"Creator", PRO:"Pro", STUDIO:"Studio" };
                  const isCur = currentPlan === pk;
                  return (
                    <th key={pk} style={{ textAlign: "center", padding: "12px 16px", fontSize: 12, fontWeight: 700, borderBottom: "1px solid var(--border)", background: isCur ? "rgba(79,142,247,.06)" : "transparent", color: isCur ? "var(--accent)" : "var(--text-primary)", borderLeft: i > 0 ? "1px solid var(--border)" : "none" }}>
                      {labels[pk]}
                      {isCur && <div style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.06em", marginTop: 2 }}>YOUR PLAN</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {([
                { label: "Monthly credits",            vals: ["1 free ad/day", "500", "1,700", "6,000"],           group: "Allocation" },
                { label: "Monthly price",              vals: ["Free", "$25/mo", "$79/mo", "$249/mo"],              group: "Allocation" },
                { label: "Credit rollover",            vals: ["—", "—", "25%", "50%"],                            group: "Allocation" },
                { label: "Watermark-free exports",     vals: ["✗", "✓", "✓", "✓"],                               group: "Export" },
                { label: "GIF motion export",          vals: ["✗", "✓", "✓", "✓"],                               group: "Export" },
                { label: "ZIP bundle export",          vals: ["✗", "✓", "✓", "✓"],                               group: "Export" },
                { label: "Max export resolution",      vals: ["1080p", "1080p", "4K", "4K"],                      group: "Export" },
                { label: "Animation Studio (video)",   vals: ["✗", "✓", "✓", "✓"],                               group: "Create" },
                { label: "Batch generation",           vals: ["✗", "✗", "✓", "✓"],                               group: "Create" },
                { label: "Automation API",             vals: ["✗", "✗", "✗", "✓"],                               group: "Create" },
                { label: "Formats per run",            vals: ["1", "3", "8", "20"],                               group: "Limits" },
                { label: "Variations per run",         vals: ["1", "3", "5", "10"],                               group: "Limits" },
                { label: "Concurrent jobs",            vals: ["1", "2", "5", "15"],                               group: "Limits" },
                { label: "Daily video jobs",           vals: ["1 (watermarked)", "10", "10", "50"],               group: "Limits" },
                { label: "Team members",               vals: ["1", "3", "10", "50"],                              group: "Team" },
                { label: "Brand kits",                 vals: ["1", "2", "5", "20"],                               group: "Team" },
                { label: "Queue priority",             vals: ["Low", "Normal", "Normal", "High"],                 group: "Team" },
              ] as { label: string; vals: string[]; group: string }[]).map((row, ri) => (
                <tr key={row.label} style={{ borderBottom: "1px solid var(--border)", background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "10px 20px", color: "var(--text-secondary)", fontWeight: 500, fontSize: 13 }}>{row.label}</td>
                  {row.vals.map((v, vi) => {
                    const pk = ["FREE","CREATOR","PRO","STUDIO"][vi];
                    const isCur = currentPlan === pk;
                    const isY = v === "✓", isN = v === "✗";
                    return (
                      <td key={vi} style={{ textAlign: "center", padding: "10px 16px", borderLeft: vi > 0 ? "1px solid var(--border)" : "none", background: isCur ? "rgba(79,142,247,.04)" : "transparent", fontSize: isY || isN ? 15 : 12, fontFamily: isY || isN ? "inherit" : "var(--font-mono)", fontWeight: isCur ? 700 : 400, color: isY ? "var(--success)" : isN ? "var(--border-strong)" : isCur ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Credit Top-ups (paid subscribers only) ────────────────────────── */}
      {isPaidPlan ? (
        <div style={{ animation: "fadeUp .5s ease" }}>
          {/* Section header */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <h2 style={{ fontSize: 20, letterSpacing: "-.04em", fontFamily: "var(--font-display)", margin: 0 }}>
                Credit Top-ups
              </h2>
              <span style={{ background: "var(--success-tint)", border: "1px solid var(--success-border)", color: "var(--success)", fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: "var(--radius-full)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                Subscribers only
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              One-time purchases that stack on top of your subscription. Credits expire at end of your billing cycle.
              <br />
              <span style={{ color: "var(--success)", fontSize: 12 }}>
                Top-up rates are cheaper per credit than any subscription — buy more for less without changing your plan.
              </span>
            </p>
          </div>

          {/* Rate comparison bar */}
          <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 18px", marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", alignSelf: "center" }}>Per-credit rate</span>
            {[
              { label: `${currentPlan} sub`, rate: currentPlan === "CREATOR" ? "$0.050" : currentPlan === "PRO" ? "$0.047" : "$0.042", color: "var(--text-muted)", note: "your plan" },
              { label: "200 top-up",  rate: "$0.040", color: "var(--success)", note: "cheaper" },
              { label: "600 top-up",  rate: "$0.037", color: "var(--success)", note: "best value" },
              { label: "2000 top-up", rate: "$0.035", color: "var(--success)", note: "lowest rate" },
            ].map(({ label, rate, color, note }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 400, fontFamily: "var(--font-display)", color, letterSpacing: "-.02em" }}>{rate}</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}{note && <> · <span style={{ color: "var(--accent)" }}>{note}</span></>}</span>
              </div>
            ))}
          </div>

          {/* Pack cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {TOPUP_PACKS.map(pack => (
              <div
                key={pack.id}
                className="topup-card"
                style={{
                  background:   `${pack.accentColor}06`,
                  border:       `1.5px solid ${pack.highlight ? pack.accentColor : `${pack.accentColor}28`}`,
                  borderRadius: "var(--radius-xl)",
                  padding:      "24px",
                  position:     "relative",
                  boxShadow:    pack.highlight
                    ? `0 0 0 1px ${pack.accentColor}22, 0 6px 28px rgba(0,0,0,.35)`
                    : "0 2px 10px rgba(0,0,0,.25)",
                }}
              >
                {pack.highlight && (
                  <div style={{ position: "absolute", top: -11, right: 16, background: `linear-gradient(90deg,${pack.accentColor}cc,${pack.accentColor})`, color: "#fff", fontSize: 9, fontWeight: 700, padding: "3px 11px", borderRadius: "var(--radius-full)", letterSpacing: ".07em", textTransform: "uppercase" }}>
                    Best value
                  </div>
                )}

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: pack.accentColor, marginBottom: 12 }}>
                  {pack.label} Pack
                </div>

                {/* Credit amount */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 38, letterSpacing: "-.05em", fontFamily: "var(--font-display)", lineHeight: 1, color: "var(--text-primary)" }}>
                    {pack.credits.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>credits</span>
                </div>

                {/* Price */}
                <div style={{ fontSize: 24, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-.04em", color: pack.accentColor, marginBottom: 4 }}>
                  ${pack.price}
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginLeft: 4 }}>one-time</span>
                </div>

                {/* Per-credit rate */}
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{pack.perCredit}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 20 }}>{pack.description}</div>

                <div style={{ height: 1, background: `${pack.accentColor}16`, marginBottom: 16 }} />

                {billingReady ? (
                  <button
                    className="btn-plan"
                    style={{
                      width: "100%", padding: "10px", border: "none",
                      borderRadius: "var(--radius-md)",
                      background: pack.highlight
                        ? `linear-gradient(135deg,${pack.accentColor}cc,${pack.accentColor})`
                        : `${pack.accentColor}16`,
                      color:      pack.highlight ? "#fff" : pack.accentColor,
                      fontSize: 12, fontWeight: 700,
                      fontFamily: "var(--font-body)",
                      boxShadow: pack.highlight ? `0 4px 14px ${pack.accentColor}33` : "none",
                    }}
                  >
                    Buy {pack.credits.toLocaleString()} Credits — ${pack.price}
                  </button>
                ) : (
                  <div style={{ textAlign: "center", padding: "10px", fontSize: 12, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                    Billing not configured
                  </div>
                )}
              </div>
            ))}
          </div>

          <p style={{ marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>
            Top-up credits stack with your subscription balance and expire at the end of your current billing cycle.
          </p>
        </div>
      ) : (
        /* Teaser for free users */
        <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "28px 32px", display: "flex", alignItems: "center", gap: 24, animation: "fadeUp .5s ease" }}>
          <div style={{ fontSize: 36 }}>◆</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16, fontWeight: 400, fontFamily: "var(--font-display)", margin: "0 0 6px" }}>Need more credits?</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Credit top-ups are available on Creator, Pro, and Studio plans. Upgrade your subscription to unlock one-time credit packs starting at $8.
            </p>
          </div>
          <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, whiteSpace: "nowrap" }}>
            Available from Creator ↑
          </div>
        </div>
      )}

      {/* Footer */}
      <p style={{ marginTop: 40, fontSize: 12, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.7 }}>
        Payments secured by Paddle · Cancel anytime · No contracts ·{" "}
        <a href="mailto:support@arkiol.com" style={{ color: "var(--accent)", textDecoration: "none" }}>support@arkiol.com</a>
      </p>
    </div>
  );
}
