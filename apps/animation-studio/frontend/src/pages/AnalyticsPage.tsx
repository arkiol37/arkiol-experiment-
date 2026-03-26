import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, Video, Zap, CheckCircle2, AlertCircle,
  Clock, BarChart3, Film, Target, Award,
} from 'lucide-react';
import { analyticsApi } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

const PERIODS = [
  { value: '7d',  label: 'Last 7 days'  },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

// Chart tooltip style
const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#14141f',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    color: '#f0f0f8',
    fontSize: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
};

// Platform colours
const PLATFORM_COLORS: Record<string, string> = {
  tiktok:    '#ff2d55',
  instagram: '#c026d3',
  youtube:   '#ef4444',
  facebook:  '#3b82f6',
  linkedin:  '#0ea5e9',
  twitter:   '#38bdf8',
  other:     '#94a3b8',
};

const HOOK_COLORS = ['#6366f1','#f59e0b','#10b981','#ec4899','#14b8a6','#f97316'];
const DURATION_COLORS = { short: '#10b981', mid: '#f59e0b', long: '#6366f1' };

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, icon: Icon, change, changePositive }: any) {
  return (
    <div className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div className={`stat-card-accent bg-gradient-to-r ${accent}`} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div className="text-xs font-semibold text-ink-200 uppercase tracking-wide">{label}</div>
        {Icon && <Icon size={14} className="text-ink-400" />}
      </div>
      <div className="text-3xl font-black text-ink-50 font-mono leading-none mb-1">{value}</div>
      {sub  && <div className="text-[10px] text-ink-400 mt-1">{sub}</div>}
      {change && (
        <div className={`text-xs font-semibold mt-1 ${changePositive ? 'text-green-400' : 'text-red-400'}`}>
          {change}
        </div>
      )}
    </div>
  );
}

// ── Section Title ─────────────────────────────────────────────────────────────
function SectionTitle({ icon: Icon, title, sub }: { icon: any; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 p-5 border-b border-white/[0.06]">
      <Icon size={14} className="text-gold-400" />
      <div>
        <h2 className="text-sm font-bold text-ink-50">{title}</h2>
        {sub && <p className="text-[10px] text-ink-400">{sub}</p>}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [period, setPeriod] = useState('30d');
  const { workspace } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', period],
    queryFn: () => analyticsApi.overview(period),
  });

  // ── Data transforms ──────────────────────────────────────────────────────
  const monthlyChart = (data?.monthlyOutput ?? []).map((d: any) => ({
    month: new Date(d.month).toLocaleDateString('en', { month: 'short', year: '2-digit' }),
    renders: Number(d.count),
  }));

  const dailySpendChart = (data?.dailyCreditSpend ?? []).map((d: any) => ({
    day: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    credits: Number(d.credits),
  }));

  const platformChart = (data?.platformBreakdown ?? []).map((p: any) => ({
    name: p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
    value: Number(p.count),
    color: PLATFORM_COLORS[p.platform] ?? PLATFORM_COLORS.other,
  }));

  const hookChart = (data?.hookTypeBreakdown ?? []).map((h: any, i: number) => ({
    name: h.hook_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    count: Number(h.count),
    color: HOOK_COLORS[i % HOOK_COLORS.length],
  }));

  const durationMap = Object.fromEntries(
    (data?.durationBreakdown ?? []).map((d: any) => [d.bucket, Number(d.count)])
  );
  const durationTotal = Object.values(durationMap).reduce((a: any, b: any) => a + b, 0) as number;
  const durationChart = [
    { label: '≤15s (Short)', key: 'short', color: DURATION_COLORS.short },
    { label: '16–30s (Mid)',  key: 'mid',   color: DURATION_COLORS.mid   },
    { label: '31s+ (Long)',   key: 'long',  color: DURATION_COLORS.long  },
  ].map(d => ({
    ...d,
    count: durationMap[d.key] ?? 0,
    pct: durationTotal > 0 ? Math.round(((durationMap[d.key] ?? 0) / durationTotal) * 100) : 0,
  }));

  const topHooks = (data?.topHookTypes ?? []).map((h: any) => ({
    hook: h.hook_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    successRate: h.total > 0 ? Math.round((Number(h.complete) / Number(h.total)) * 100) : 0,
    total: Number(h.total),
  }));

  const providerTotal = (data?.providerStats ?? []).reduce((s: number, p: any) => s + Number(p.count), 0);

  // ── Computed stats ──────────────────────────────────────────────────────
  const total     = Number(data?.renderStats?.total ?? 0);
  const complete  = Number(data?.renderStats?.complete ?? 0);
  const failed    = Number(data?.renderStats?.failed ?? 0);
  const successRate = total > 0 ? Math.round((complete / total) * 100) : 0;
  const consumed  = Math.abs(Number(data?.creditStats?.consumed ?? 0));
  const avgDur    = Number(data?.renderStats?.avg_duration_sec ?? 0).toFixed(0);
  const avgScenes = Number(data?.renderStats?.avg_scenes ?? 0).toFixed(1);

  const Skeleton = ({ h = 'h-48' }: { h?: string }) => (
    <div className={`${h} bg-ink-800 rounded-xl animate-pulse`} />
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Render performance, credit usage and platform intelligence</p>
        </div>
        <select
          className="form-select w-40"
          value={period}
          onChange={e => setPeriod(e.target.value)}
        >
          {PERIODS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {isLoading ? Array(5).fill(0).map((_, i) => (
          <div key={i} className="h-28 bg-ink-800 rounded-2xl animate-pulse" />
        )) : [
          {
            label: 'Credits Balance',
            value: workspace?.creditsBalance?.toLocaleString() ?? '—',
            accent: 'from-gold-600 to-gold-400',
            icon: Zap,
            sub: `${consumed.toLocaleString()} consumed`,
          },
          {
            label: 'Total Renders',
            value: total.toLocaleString(),
            accent: 'from-indigo-600 to-indigo-400',
            icon: Film,
          },
          {
            label: 'Success Rate',
            value: `${successRate}%`,
            accent: successRate >= 80 ? 'from-green-600 to-green-400' : 'from-amber-600 to-amber-400',
            icon: CheckCircle2,
            sub: `${failed} failed`,
            change: successRate >= 80 ? '✓ Healthy' : '⚠ Review failures',
            changePositive: successRate >= 80,
          },
          {
            label: 'Avg Duration',
            value: `${avgDur}s`,
            accent: 'from-purple-600 to-purple-400',
            icon: Clock,
          },
          {
            label: 'Avg Scenes',
            value: avgScenes,
            accent: 'from-pink-600 to-pink-400',
            icon: BarChart3,
          },
        ].map((s, i) => (
          <StatCard key={i} {...s} />
        ))}
      </div>

      {/* ── Row 1: Monthly output + daily credits ── */}
      <div className="grid grid-cols-2 gap-5 mb-5">
        {/* Monthly output */}
        <div className="card">
          <SectionTitle icon={Film} title="Monthly Video Output" sub="Completed renders per month" />
          <div className="p-5 h-52">
            {isLoading ? <Skeleton /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChart} barCategoryGap="35%">
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#5a5a80', fontSize: 11 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#5a5a80', fontSize: 11 }} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="renders" name="Renders" fill="#e8a820" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Daily credit spend */}
        <div className="card">
          <SectionTitle icon={Zap} title="Daily Credit Spend" sub={`Credits consumed per day · ${period}`} />
          <div className="p-5 h-52">
            {isLoading ? <Skeleton /> : dailySpendChart.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-ink-500">No credit spend in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySpendChart}>
                  <defs>
                    <linearGradient id="creditGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#5a5a80', fontSize: 10 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#5a5a80', fontSize: 11 }} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="credits" name="Credits" stroke="#6366f1" strokeWidth={2} fill="url(#creditGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2: Platform + Hook breakdown ── */}
      <div className="grid grid-cols-3 gap-5 mb-5">
        {/* Platform pie */}
        <div className="card">
          <SectionTitle icon={Target} title="Platform Distribution" />
          <div className="p-5">
            {isLoading ? <Skeleton h="h-40" /> : platformChart.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-sm text-ink-500 text-center">
                No platform data yet.<br />
                <span className="text-xs">Platform is set during Studio step 1.</span>
              </div>
            ) : (
              <>
                <div style={{ height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={platformChart}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={55}
                        innerRadius={30}
                        paddingAngle={3}
                      >
                        {platformChart.map((entry: any, i: number) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip {...TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 space-y-1.5">
                  {platformChart.map((p: any) => (
                    <div key={p.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />
                        <span className="text-ink-300">{p.name}</span>
                      </div>
                      <span className="font-mono font-bold text-ink-100">{p.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Hook types */}
        <div className="card">
          <SectionTitle icon={Award} title="Hook Psychology" sub="How your ads open" />
          <div className="p-5">
            {isLoading ? <Skeleton h="h-52" /> : hookChart.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-sm text-ink-500 text-center">
                No hook data yet.
              </div>
            ) : (
              <div className="space-y-3">
                {hookChart.map((h: any) => {
                  const max = Math.max(...hookChart.map((x: any) => x.count));
                  const pct = max > 0 ? Math.round((h.count / max) * 100) : 0;
                  return (
                    <div key={h.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-ink-300 truncate max-w-[140px]">{h.name}</span>
                        <span className="font-mono font-bold text-ink-100">{h.count}</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)' }}>
                        <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: h.color, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Duration breakdown */}
        <div className="card">
          <SectionTitle icon={Clock} title="Ad Length Mix" sub="Short ≤15s · Mid 16–30s · Long 31s+" />
          <div className="p-5">
            {isLoading ? <Skeleton h="h-52" /> : (
              <>
                <div className="space-y-4 mb-5">
                  {durationChart.map(d => (
                    <div key={d.key}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-ink-300">{d.label}</span>
                        <span className="font-mono font-bold text-ink-100">{d.count} <span className="text-ink-400 font-normal">({d.pct}%)</span></span>
                      </div>
                      <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.07)' }}>
                        <div style={{ height: '100%', borderRadius: 99, width: `${d.pct}%`, background: d.color, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Best-practice signal */}
                {durationTotal > 0 && (
                  <div style={{
                    padding: '10px 12px', borderRadius: 10,
                    background: durationMap.short > durationMap.long
                      ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                    border: `1px solid ${durationMap.short > durationMap.long
                      ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
                    fontSize: 11, lineHeight: 1.5,
                    color: durationMap.short > durationMap.long ? '#6ee7b7' : '#fcd34d',
                  }}>
                    {durationMap.short > durationMap.long
                      ? '✓ Good mix — short-form dominates, ideal for social'
                      : '→ Consider more short-form (≤15s) for higher CTR on mobile'}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 3: Hook success rates + Provider + Preferences ── */}
      <div className="grid grid-cols-3 gap-5">
        {/* Top hook success rates */}
        <div className="card">
          <SectionTitle icon={TrendingUp} title="Hook Success Rates" sub="% of renders that completed" />
          <div className="p-5">
            {isLoading ? <Skeleton h="h-40" /> : topHooks.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-sm text-ink-500">No data yet</div>
            ) : (
              <div className="space-y-3">
                {topHooks.map((h: any, i: number) => (
                  <div key={h.hook} className="flex items-center gap-3">
                    <span style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                      background: `${HOOK_COLORS[i % HOOK_COLORS.length]}20`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800, color: HOOK_COLORS[i % HOOK_COLORS.length],
                    }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-xs font-semibold text-ink-100 truncate mb-0.5">{h.hook}</div>
                      <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.07)' }}>
                        <div style={{
                          height: '100%', borderRadius: 99,
                          width: `${h.successRate}%`,
                          background: h.successRate >= 80 ? '#10b981' : h.successRate >= 60 ? '#f59e0b' : '#ef4444',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-ink-200 flex-shrink-0">
                      {h.successRate}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Provider usage */}
        <div className="card">
          <SectionTitle icon={BarChart3} title="Provider Usage" sub="Which AI engine ran your renders" />
          <div className="p-5">
            {isLoading ? <Skeleton h="h-40" /> : (data?.providerStats ?? []).length === 0 ? (
              <div className="h-40 flex items-center justify-center text-sm text-ink-500">No provider data yet</div>
            ) : (
              <div className="space-y-3">
                {(data?.providerStats ?? []).map((p: any, i: number) => {
                  const pct = providerTotal > 0 ? Math.round((Number(p.count) / providerTotal) * 100) : 0;
                  return (
                    <div key={p.provider} className="flex items-center gap-3">
                      <span className="text-xs text-ink-300 w-14 truncate capitalize">{p.provider}</span>
                      <div className="flex-1 h-1.5 bg-ink-600 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${HOOK_COLORS[i % HOOK_COLORS.length]}, ${HOOK_COLORS[(i + 1) % HOOK_COLORS.length]})`,
                            transition: 'width 0.5s ease',
                          }}
                        />
                      </div>
                      <span className="text-xs font-mono text-ink-300 w-8 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Preferences summary */}
        <div className="card">
          <SectionTitle icon={Video} title="Preference Profile" sub="Your default workspace settings" />
          <div className="p-5">
            {isLoading ? <Skeleton h="h-40" /> : (
              <div className="space-y-0">
                {[
                  ['Default Mood',     data?.preferences?.default_mood           ?? 'Cinematic'],
                  ['Render Mode',      data?.preferences?.default_render_mode     ?? '2D Standard'],
                  ['Voice',            data?.preferences?.default_voice_gender    ?? 'Female'],
                  ['Aspect Ratio',     data?.preferences?.default_aspect_ratio    ?? '9:16'],
                  ['Resolution',       data?.preferences?.default_resolution      ?? '1080p'],
                  ['Beat Sync',        data?.preferences?.beat_sync_default ? 'On' : 'Off'],
                ].map(([k, v]) => (
                  <div key={k as string}
                    className="flex justify-between text-sm py-2.5"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <span className="text-ink-400 text-xs">{k}</span>
                    <span className="font-bold text-gold-300 text-xs">{v}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Quality score */}
            {!isLoading && data?.qualityStats?.avg_quality != null && (
              <div className="mt-4 p-3 rounded-xl bg-ink-800 border border-white/[0.06]">
                <div className="text-[10px] font-semibold text-ink-300 uppercase tracking-wide mb-1">
                  Avg Quality Score
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-black font-mono text-ink-50">
                    {(Number(data.qualityStats.avg_quality) * 100).toFixed(0)}
                  </span>
                  <span className="text-xs text-ink-400 mb-0.5">/ 100</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
