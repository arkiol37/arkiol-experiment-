import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { billingApi } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

// ── Plan definitions (canonical pricing — do not alter values) ────────────────
const PLANS = [
  {
    key:         'free',
    name:        'Free',
    price:       0,
    credits:     '1 free Ad / day',
    aiLevel:     'Basic AI',
    aiDesc:      '1 free watermarked Normal Ad per day',
    popular:     false,
    accent:      '#9ca3c8',
    border:      'rgba(156,163,200,0.18)',
    cta:         'Get Started',
    icon:        '◇',
  },
  {
    key:         'creator',
    name:        'Creator',
    price:       25,
    credits:     '500 credits / mo',
    aiLevel:     'Creative AI',
    aiDesc:      'Enhanced generation with HQ rendering & GIFs',
    popular:     false,
    accent:      '#22d3ee',
    border:      'rgba(34,211,238,0.22)',
    cta:         'Upgrade to Creator',
    icon:        '◈',
  },
  {
    key:         'pro',
    name:        'Pro',
    price:       79,
    credits:     '1,700 credits / mo',
    aiLevel:     'Advanced AI',
    aiDesc:      'Full-power generation with automation & batch',
    popular:     true,
    accent:      '#f4c048',
    border:      'rgba(244,192,72,0.40)',
    cta:         'Upgrade to Pro',
    icon:        '◆',
  },
  {
    key:         'studio',
    name:        'Studio',
    price:       249,
    credits:     '6,000 credits / mo',
    aiLevel:     'Automation + Team AI',
    aiDesc:      'Enterprise-grade AI, brand kits & team workspace',
    popular:     false,
    accent:      '#a78bfa',
    border:      'rgba(167,139,250,0.28)',
    cta:         'Upgrade to Studio',
    icon:        '⬡',
  },
] as const;

type PlanKey = typeof PLANS[number]['key'];

// ── Feature comparison matrix (ascending: Free → Studio) ─────────────────────
interface Feature {
  label:    string;
  free:     boolean;
  creator:  boolean;
  pro:      boolean;
  studio:   boolean;
  category: string;
}

const FEATURES: Feature[] = [
  { label: 'Basic AI generation',           free: true,  creator: true,  pro: true,  studio: true,  category: 'AI Generation' },
  { label: 'Static design export',          free: true,  creator: true,  pro: true,  studio: true,  category: 'AI Generation' },
  { label: 'Basic templates',               free: true,  creator: true,  pro: true,  studio: true,  category: 'AI Generation' },
  { label: 'HQ rendering',                  free: false, creator: true,  pro: true,  studio: true,  category: 'AI Generation' },
  { label: 'GIF animation export',          free: false, creator: true,  pro: true,  studio: true,  category: 'AI Generation' },
  { label: 'Advanced AI generation',        free: false, creator: false, pro: true,  studio: true,  category: 'AI Generation' },
  { label: 'Advanced templates',            free: false, creator: false, pro: true,  studio: true,  category: 'AI Generation' },
  { label: 'Automation / batch generation', free: false, creator: false, pro: true,  studio: true,  category: 'Automation'    },
  { label: 'Automation AI',                 free: false, creator: false, pro: false, studio: true,  category: 'Automation'    },
  { label: 'API access',                    free: false, creator: false, pro: false, studio: true,  category: 'Automation'    },
  { label: 'Brand kits',                    free: false, creator: false, pro: false, studio: true,  category: 'Team & Brand'  },
  { label: 'Team workspace',                free: false, creator: false, pro: false, studio: true,  category: 'Team & Brand'  },
];

const PLAN_ORDER: PlanKey[] = ['free', 'creator', 'pro', 'studio'];

function getCellValue(f: Feature, key: PlanKey): boolean {
  return ({ free: f.free, creator: f.creator, pro: f.pro, studio: f.studio })[key];
}

const CATEGORY_ICONS: Record<string, string> = {
  'AI Generation': '✦',
  'Automation':    '⚙',
  'Team & Brand':  '◉',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function PricingPage() {
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const { workspace } = useAuthStore();

  const checkoutMutation = useMutation({
    mutationFn: (params: { plan: string; period: string }) =>
      billingApi.createCheckout(params),
    onSuccess: (data) => { if (data.url) window.location.href = data.url; },
  });

  const currentPlanKey = workspace?.plan ?? 'free';

  const grouped = FEATURES.reduce<Record<string, Feature[]>>((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {});

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-10 max-w-6xl mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-12 animate-fade-up">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 mb-5 rounded-full border"
          style={{
            background:  'rgba(244,192,72,0.08)',
            borderColor: 'rgba(244,192,72,0.22)',
            color:       '#f4c048',
            fontSize:    11,
            fontWeight:  800,
            letterSpacing: '0.13em',
            textTransform: 'uppercase',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" style={{ animation: 'pulse 2s infinite' }} />
          Pricing &amp; Plans
        </div>

        <h1
          className="text-3xl sm:text-4xl font-black tracking-tight mb-3"
          style={{ fontFamily: '"Instrument Serif", Georgia, serif', color: '#f5f5fa' }}
        >
          Simple, transparent pricing
        </h1>
        <p style={{ color: '#888aa8', fontSize: 14, lineHeight: 1.6 }}>
          Start free, scale as you grow. No hidden fees, no surprises.
        </p>
      </div>

      {/* ── Pricing Cards ────────────────────────────────────────────────── */}
      <div
        style={{
          display:              'grid',
          gridTemplateColumns:  'repeat(auto-fit, minmax(210px, 1fr))',
          gap:                  16,
          marginBottom:         56,
          alignItems:           'stretch',
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent   = currentPlanKey === plan.key;
          const planIdx     = PLAN_ORDER.indexOf(plan.key);
          const curIdx      = PLAN_ORDER.indexOf(currentPlanKey as PlanKey);
          const isDowngrade = planIdx < curIdx;
          const isLoading   = checkoutMutation.isPending && checkoutPlan === plan.key;

          return (
            <div
              key={plan.key}
              className="pricing-card"
              style={{
                position:      'relative',
                display:       'flex',
                flexDirection: 'column',
                borderRadius:  18,
                padding:       plan.popular ? '32px 20px 20px' : '24px 20px 20px',
                background:    plan.popular
                  ? 'radial-gradient(ellipse at top, rgba(244,192,72,0.10) 0%, rgba(10,10,15,0.95) 65%)'
                  : 'rgba(10,10,15,0.70)',
                border:        `1.5px solid ${
                  isCurrent
                    ? plan.accent
                    : plan.popular
                    ? 'rgba(244,192,72,0.42)'
                    : plan.border
                }`,
                boxShadow:     plan.popular
                  ? '0 0 0 1px rgba(244,192,72,0.07), 0 12px 48px rgba(244,192,72,0.10), 0 2px 8px rgba(0,0,0,0.5)'
                  : isCurrent
                  ? `0 0 0 3px ${plan.accent}22, 0 8px 32px rgba(0,0,0,0.4)`
                  : '0 2px 16px rgba(0,0,0,0.35)',
                transition:    'transform 180ms ease, box-shadow 180ms ease',
                cursor:        'default',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
            >
              {/* Most Popular badge */}
              {plan.popular && (
                <div
                  style={{
                    position:      'absolute',
                    top:           -14,
                    left:          '50%',
                    transform:     'translateX(-50%)',
                    whiteSpace:    'nowrap',
                    background:    'linear-gradient(90deg, #c9930a 0%, #f4c048 55%, #ffe08a 100%)',
                    color:         '#0a0a0f',
                    fontSize:      10,
                    fontWeight:    900,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    padding:       '5px 14px',
                    borderRadius:  20,
                    boxShadow:     '0 2px 14px rgba(244,192,72,0.45)',
                  }}
                >
                  ★ Most Popular
                </div>
              )}

              {/* Current badge */}
              {isCurrent && (
                <span
                  style={{
                    position:      'absolute',
                    top:           12,
                    right:         12,
                    fontSize:      10,
                    fontWeight:    700,
                    letterSpacing: '0.10em',
                    textTransform: 'uppercase',
                    background:    `${plan.accent}1a`,
                    border:        `1px solid ${plan.accent}40`,
                    color:         plan.accent,
                    padding:       '3px 9px',
                    borderRadius:  20,
                  }}
                >
                  Current
                </span>
              )}

              {/* Icon + plan name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span
                  style={{
                    width:           30,
                    height:          30,
                    borderRadius:    8,
                    display:         'flex',
                    alignItems:      'center',
                    justifyContent:  'center',
                    fontSize:        14,
                    background:      `${plan.accent}18`,
                    color:           plan.accent,
                    border:          `1px solid ${plan.accent}28`,
                    flexShrink:      0,
                  }}
                >
                  {plan.icon}
                </span>
                <span
                  style={{
                    fontSize:      11,
                    fontWeight:    800,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color:         plan.accent,
                  }}
                >
                  {plan.name}
                </span>
              </div>

              {/* Price */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginBottom: 6 }}>
                {plan.price === 0 ? (
                  <span style={{ fontSize: 38, fontWeight: 900, color: '#f5f5fa', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    Free
                  </span>
                ) : (
                  <>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#8888aa', marginBottom: 6 }}>$</span>
                    <span style={{ fontSize: 38, fontWeight: 900, color: '#f5f5fa', lineHeight: 1, letterSpacing: '-0.02em' }}>
                      {plan.price}
                    </span>
                    <span style={{ fontSize: 12, color: '#66668a', marginBottom: 5 }}>/mo</span>
                  </>
                )}
              </div>

              {/* Credits */}
              <div
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                  marginBottom: 8,
                  fontSize:     12,
                  fontWeight:   600,
                  color:        plan.accent,
                }}
              >
                <span
                  style={{
                    width:           18,
                    height:          18,
                    borderRadius:    5,
                    background:      `${plan.accent}20`,
                    display:         'flex',
                    alignItems:      'center',
                    justifyContent:  'center',
                    fontSize:        8,
                    flexShrink:      0,
                  }}
                >
                  ◆
                </span>
                {plan.credits}
              </div>

              {/* AI level */}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0f0', marginBottom: 4 }}>
                {plan.aiLevel}
              </div>
              <div style={{ fontSize: 12, color: '#777799', lineHeight: 1.5, flex: 1, marginBottom: 18 }}>
                {plan.aiDesc}
              </div>

              {/* Divider */}
              <div
                style={{
                  height:       1,
                  background:   `linear-gradient(90deg, transparent, ${plan.accent}28, transparent)`,
                  marginBottom: 16,
                }}
              />

              {/* CTA */}
              {isCurrent ? (
                <div
                  style={{
                    textAlign:    'center',
                    padding:      '10px 0',
                    fontSize:     12,
                    fontWeight:   700,
                    color:        plan.accent,
                    background:   `${plan.accent}12`,
                    border:       `1px solid ${plan.accent}28`,
                    borderRadius: 12,
                  }}
                >
                  ✓ Your active plan
                </div>
              ) : isDowngrade || plan.key === 'free' ? (
                <div style={{ textAlign: 'center', fontSize: 12, color: '#555577', padding: '10px 0' }}>
                  Contact support to downgrade
                </div>
              ) : (
                <button
                  onClick={() => {
                    setCheckoutPlan(plan.key);
                    checkoutMutation.mutate({ plan: plan.key, period: 'monthly' });
                  }}
                  disabled={isLoading}
                  style={{
                    width:         '100%',
                    padding:       '11px 0',
                    borderRadius:  12,
                    fontSize:      12,
                    fontWeight:    800,
                    letterSpacing: '0.04em',
                    cursor:        isLoading ? 'wait' : 'pointer',
                    opacity:       isLoading ? 0.6 : 1,
                    border:        plan.popular ? 'none' : `1.5px solid ${plan.accent}40`,
                    background:    plan.popular
                      ? 'linear-gradient(135deg, #c9930a 0%, #f4c048 55%, #ffe08a 100%)'
                      : `${plan.accent}18`,
                    color:         plan.popular ? '#0a0a0f' : plan.accent,
                    boxShadow:     plan.popular ? '0 4px 18px rgba(244,192,72,0.28)' : 'none',
                    transition:    'opacity 150ms',
                  }}
                >
                  {isLoading ? 'Redirecting…' : plan.cta}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Feature Comparison Table ─────────────────────────────────────── */}
      <div>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#f5f5fa', letterSpacing: '-0.01em', marginBottom: 6 }}>
            Feature comparison
          </h2>
          <p style={{ fontSize: 13, color: '#66668a' }}>
            Everything included at every tier — see exactly what scales with your plan.
          </p>
        </div>

        <div
          style={{
            overflowX:    'auto',
            borderRadius: 18,
            border:       '1px solid rgba(255,255,255,0.07)',
            background:   'rgba(10,10,15,0.75)',
          }}
        >
          <div style={{ minWidth: 560 }}>

            {/* Header */}
            <div
              style={{
                display:             'grid',
                gridTemplateColumns: '1fr repeat(4, 110px)',
                borderBottom:        '1px solid rgba(255,255,255,0.08)',
                background:          'rgba(10,10,15,0.90)',
                borderRadius:        '17px 17px 0 0',
                overflow:            'hidden',
              }}
            >
              <div
                style={{
                  padding:       '14px 20px',
                  fontSize:      10,
                  fontWeight:    800,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color:         '#555577',
                }}
              >
                Features
              </div>
              {PLANS.map((plan) => {
                const isActive = plan.key === currentPlanKey;
                return (
                  <div
                    key={plan.key}
                    style={{
                      padding:    '14px 0',
                      textAlign:  'center',
                      borderLeft: '1px solid rgba(255,255,255,0.05)',
                      background: plan.popular ? 'rgba(244,192,72,0.05)' : 'transparent',
                    }}
                  >
                    <div
                      style={{
                        fontSize:      12,
                        fontWeight:    800,
                        letterSpacing: '0.04em',
                        color:         isActive ? plan.accent : plan.popular ? '#f4c048' : '#8888aa',
                      }}
                    >
                      {plan.name}
                    </div>
                    {isActive && (
                      <div style={{ fontSize: 9, fontWeight: 700, color: plan.accent, opacity: 0.6, marginTop: 2, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        active
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Category + feature rows */}
            {Object.entries(grouped).map(([category, features], catIdx) => (
              <div key={category}>
                {/* Category header */}
                <div
                  style={{
                    display:             'grid',
                    gridTemplateColumns: '1fr repeat(4, 110px)',
                    background:          'rgba(255,255,255,0.022)',
                    borderTop:           catIdx > 0 ? '1px solid rgba(255,255,255,0.055)' : 'none',
                  }}
                >
                  <div
                    style={{
                      padding:       '8px 20px',
                      fontSize:      10,
                      fontWeight:    800,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color:         '#f4c048',
                      display:       'flex',
                      alignItems:    'center',
                      gap:           6,
                    }}
                  >
                    <span style={{ opacity: 0.8 }}>{CATEGORY_ICONS[category] ?? '·'}</span>
                    {category}
                  </div>
                  {PLANS.map((plan) => (
                    <div
                      key={plan.key}
                      style={{
                        borderLeft: '1px solid rgba(255,255,255,0.04)',
                        background: plan.popular ? 'rgba(244,192,72,0.03)' : 'transparent',
                      }}
                    />
                  ))}
                </div>

                {/* Feature rows */}
                {features.map((feature) => (
                  <div
                    key={feature.label}
                    style={{
                      display:             'grid',
                      gridTemplateColumns: '1fr repeat(4, 110px)',
                      borderTop:           '1px solid rgba(255,255,255,0.04)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.022)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div
                      style={{
                        padding:    '11px 20px',
                        fontSize:   13,
                        color:      '#aaaacc',
                        display:    'flex',
                        alignItems: 'center',
                      }}
                    >
                      {feature.label}
                    </div>
                    {PLAN_ORDER.map((key) => {
                      const has  = getCellValue(feature, key);
                      const plan = PLANS.find(p => p.key === key)!;
                      return (
                        <div
                          key={key}
                          style={{
                            display:        'flex',
                            alignItems:     'center',
                            justifyContent: 'center',
                            borderLeft:     '1px solid rgba(255,255,255,0.04)',
                            padding:        '11px 0',
                            background:     plan.popular ? 'rgba(244,192,72,0.025)' : 'transparent',
                          }}
                        >
                          {has ? (
                            <span style={{ fontSize: 15, lineHeight: 1, filter: 'drop-shadow(0 0 4px rgba(74,222,128,0.4))' }}>✅</span>
                          ) : (
                            <span style={{ fontSize: 15, lineHeight: 1, opacity: 0.22 }}>❌</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}

            {/* Footer CTA row */}
            <div
              style={{
                display:             'grid',
                gridTemplateColumns: '1fr repeat(4, 110px)',
                borderTop:           '1px solid rgba(255,255,255,0.07)',
                background:          'rgba(10,10,15,0.60)',
                borderRadius:        '0 0 17px 17px',
                overflow:            'hidden',
              }}
            >
              <div style={{ padding: '14px 20px' }} />
              {PLANS.map((plan) => {
                const isCurrent = currentPlanKey === plan.key;
                const planIdx   = PLAN_ORDER.indexOf(plan.key);
                const curIdx    = PLAN_ORDER.indexOf(currentPlanKey as PlanKey);
                const isDown    = planIdx < curIdx;
                const isLoading = checkoutMutation.isPending && checkoutPlan === plan.key;
                return (
                  <div
                    key={plan.key}
                    style={{
                      borderLeft:     '1px solid rgba(255,255,255,0.04)',
                      padding:        '12px 8px',
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'center',
                      background:     plan.popular ? 'rgba(244,192,72,0.03)' : 'transparent',
                    }}
                  >
                    {isCurrent ? (
                      <span style={{ fontSize: 10, color: plan.accent, fontWeight: 700 }}>✓ Active</span>
                    ) : isDown || plan.key === 'free' ? (
                      <span style={{ fontSize: 10, color: '#44445a' }}>—</span>
                    ) : (
                      <button
                        onClick={() => {
                          setCheckoutPlan(plan.key);
                          checkoutMutation.mutate({ plan: plan.key, period: 'monthly' });
                        }}
                        disabled={isLoading}
                        style={{
                          fontSize:      10,
                          fontWeight:    800,
                          letterSpacing: '0.06em',
                          padding:       '6px 10px',
                          borderRadius:  8,
                          border:        plan.popular ? 'none' : `1px solid ${plan.accent}38`,
                          background:    plan.popular ? 'linear-gradient(135deg, #c9930a, #f4c048)' : `${plan.accent}16`,
                          color:         plan.popular ? '#0a0a0f' : plan.accent,
                          cursor:        'pointer',
                          whiteSpace:    'nowrap',
                          opacity:       isLoading ? 0.6 : 1,
                        }}
                      >
                        {isLoading ? '…' : 'Select'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <p style={{ marginTop: 40, textAlign: 'center', fontSize: 12, color: '#555577', lineHeight: 1.6 }}>
        Payments secured by Paddle &middot; Cancel anytime &middot; No contracts &middot;{' '}
        <a href="mailto:support@arkiol.com" style={{ color: '#f4c048', textDecoration: 'none' }}>
          Questions? support@arkiol.com
        </a>
      </p>
    </div>
  );
}
