import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Check, ChevronDown, ChevronUp,
  Star, Shield, Zap, RefreshCw, X, AlertTriangle,
  Settings2,
} from 'lucide-react';
import { providersApi } from '../lib/api';

// ── Provider metadata ─────────────────────────────────────────────────────────
interface ProviderMeta {
  icon: string;
  name: string;
  desc: string;
  badge?: string;
  badgeColor?: string;
  qualityTier: 'standard' | 'premium' | 'cutting-edge';
  creditsPerScene: string;
}

const PROVIDER_INFO: Record<string, ProviderMeta> = {
  runway: {
    icon: '🏃', name: 'Runway ML', desc: 'High-quality video generation with Gen-3 Alpha Turbo',
    badge: 'Recommended', badgeColor: '#10b981', qualityTier: 'premium', creditsPerScene: '3–5 cr',
  },
  pika: {
    icon: '🎭', name: 'Pika Labs', desc: 'Fast creative video with Pika 1.5 — great for social',
    qualityTier: 'standard', creditsPerScene: '2–3 cr',
  },
  sora: {
    icon: '☀️', name: 'Sora (OpenAI)', desc: 'Next-generation video synthesis — photorealistic output',
    badge: 'New', badgeColor: '#6366f1', qualityTier: 'cutting-edge', creditsPerScene: '8–12 cr',
  },
  custom: {
    icon: '🔌', name: 'Custom Provider', desc: 'Any compatible video generation API endpoint',
    qualityTier: 'standard', creditsPerScene: 'Variable',
  },
};

const QUALITY_COLORS = {
  'standard':     '#94a3b8',
  'premium':      '#f59e0b',
  'cutting-edge': '#a78bfa',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newProvider, setNewProvider] = useState({
    provider: 'runway', apiKey: '', apiUrl: '', isPrimary: false, autoFallback: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: providersApi.list,
  });

  const addMutation = useMutation({
    mutationFn: providersApi.add,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      setAdding(false);
      setNewProvider({ provider: 'runway', apiKey: '', apiUrl: '', isPrimary: false, autoFallback: true });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...updates }: any) => providersApi.update(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: providersApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      setConfirmDeleteId(null);
    },
  });

  const providers = data?.providers ?? [];
  const hasProviders = providers.length > 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-title">AI Providers</h1>
          <p className="page-subtitle">
            Multi-provider adapter layer — switch engines without changing your workflow
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn btn-ghost">
          <Plus size={14} /> Add Provider
        </button>
      </div>

      {/* Active providers */}
      <div className="card mb-6">
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-ink-50">Configured Video Engines</h2>
          {hasProviders && (
            <span className="text-xs text-ink-400">{providers.length} provider{providers.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {isLoading ? (
          <div className="p-5 grid grid-cols-3 gap-3">
            {[1,2,3].map(i => <div key={i} className="h-28 bg-ink-800 rounded-xl animate-pulse" />)}
          </div>
        ) : !hasProviders ? (
          <div className="p-10 text-center">
            <div className="text-4xl mb-3">🔌</div>
            <h3 className="text-sm font-bold text-ink-300 mb-1">No providers configured</h3>
            <p className="text-xs text-ink-500 mb-4">Add an AI video engine to start generating content</p>
            <button onClick={() => setAdding(true)} className="btn btn-primary text-xs">
              <Plus size={13} /> Add Your First Provider
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            {providers.map((p: any) => {
              const info = PROVIDER_INFO[p.provider] || PROVIDER_INFO.custom;
              const isExpanded = expandedId === p.id;
              return (
                <motion.div
                  key={p.id}
                  layout
                  style={{
                    borderRadius: 14,
                    border: `1px solid ${p.is_primary ? 'rgba(232,168,32,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    background: p.is_primary ? 'rgba(232,168,32,0.04)' : 'rgba(255,255,255,0.025)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Main row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
                    {/* Icon */}
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      background: 'rgba(255,255,255,0.06)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                    }}>
                      {info.icon}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {info.name}
                        </span>
                        {p.is_primary && (
                          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: 'rgba(232,168,32,0.2)', color: '#e8a820', border: '1px solid rgba(232,168,32,0.3)' }}>
                            PRIMARY
                          </span>
                        )}
                        {info.badge && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: `${info.badgeColor}20`, color: info.badgeColor, border: `1px solid ${info.badgeColor}30` }}>
                            {info.badge}
                          </span>
                        )}
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: `${QUALITY_COLORS[info.qualityTier]}15`, color: QUALITY_COLORS[info.qualityTier], border: `1px solid ${QUALITY_COLORS[info.qualityTier]}25` }}>
                          {info.qualityTier}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {info.desc}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Zap size={9} color="#f59e0b" /> {info.creditsPerScene}
                        </span>
                        {p.auto_fallback && (
                          <span style={{ fontSize: 10.5, color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Shield size={9} /> Auto-fallback
                          </span>
                        )}
                        {p.cost_optimize && (
                          <span style={{ fontSize: 10.5, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Star size={9} /> Cost-optimized
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        onClick={() => updateMutation.mutate({ id: p.id, enabled: !p.enabled })}
                        disabled={updateMutation.isPending}
                        className={`toggle-track ${p.enabled ? 'on' : ''}`}
                        title={p.enabled ? 'Disable provider' : 'Enable provider'}
                      >
                        <div className="toggle-thumb" />
                      </button>

                      <button
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                      >
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded controls */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{
                          padding: '14px 16px',
                          borderTop: '1px solid rgba(255,255,255,0.06)',
                          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
                        }}>
                          {/* Set as primary */}
                          {!p.is_primary && (
                            <button
                              onClick={() => updateMutation.mutate({ id: p.id, isPrimary: true })}
                              disabled={updateMutation.isPending}
                              className="btn btn-ghost text-xs"
                              style={{ color: '#e8a820', borderColor: 'rgba(232,168,32,0.25)' }}
                            >
                              <Star size={11} /> Set as Primary
                            </button>
                          )}

                          {/* Toggle auto-fallback */}
                          <button
                            onClick={() => updateMutation.mutate({ id: p.id, autoFallback: !p.auto_fallback })}
                            disabled={updateMutation.isPending}
                            className="btn btn-ghost text-xs"
                            style={{ color: p.auto_fallback ? '#6ee7b7' : 'var(--text-muted)' }}
                          >
                            <Shield size={11} /> {p.auto_fallback ? 'Fallback: On' : 'Fallback: Off'}
                          </button>

                          {/* Toggle cost-optimize */}
                          <button
                            onClick={() => updateMutation.mutate({ id: p.id, costOptimize: !p.cost_optimize })}
                            disabled={updateMutation.isPending}
                            className="btn btn-ghost text-xs"
                            style={{ color: p.cost_optimize ? '#a78bfa' : 'var(--text-muted)' }}
                          >
                            <Zap size={11} /> {p.cost_optimize ? 'Cost-opt: On' : 'Cost-opt: Off'}
                          </button>

                          <span style={{ flex: 1 }} />

                          {/* Delete */}
                          {confirmDeleteId === p.id ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: '#fca5a5' }}>Remove provider?</span>
                              <button
                                onClick={() => deleteMutation.mutate(p.id)}
                                disabled={deleteMutation.isPending}
                                className="btn text-xs"
                                style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '3px 10px' }}
                              >
                                {deleteMutation.isPending ? <RefreshCw size={11} className="animate-spin" /> : 'Confirm'}
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} className="btn btn-ghost text-xs p-1.5">
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(p.id)}
                              className="btn btn-ghost text-xs"
                              style={{ color: '#ef4444' }}
                            >
                              <Trash2 size={11} /> Remove
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}

            {/* Add new card */}
            <button
              onClick={() => setAdding(true)}
              style={{
                width: '100%', padding: '14px', borderRadius: 14,
                border: '2px dashed rgba(255,255,255,0.08)',
                background: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(232,168,32,0.3)'; (e.currentTarget as HTMLElement).style.color = '#e8a820'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              <Plus size={16} /> Add another provider
            </button>
          </div>
        )}
      </div>

      {/* Routing logic explanation */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 size={14} className="text-gold-400" />
          <h2 className="text-sm font-bold text-ink-50">Routing Logic</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: '1️⃣', title: 'Primary Provider', desc: 'All new renders are sent to the primary provider first. Only one provider can be primary at a time.' },
            { icon: '🔄', title: 'Auto-fallback', desc: 'If the primary provider fails or times out, requests are automatically retried on fallback providers in order.' },
            { icon: '💸', title: 'Cost Optimization', desc: 'When enabled, shorter or simpler scenes may be routed to lower-cost providers to conserve credits.' },
          ].map(item => (
            <div key={item.title} style={{
              padding: '14px 16px', borderRadius: 12,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>{item.icon}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{item.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Add provider modal */}
      <AnimatePresence>
        {adding && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
            onClick={e => { if (e.target === e.currentTarget) setAdding(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="card p-6 w-full mx-4"
              style={{ maxWidth: 460 }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-ink-50">Add AI Provider</h3>
                <button onClick={() => setAdding(false)} className="btn btn-ghost p-1.5">
                  <X size={14} />
                </button>
              </div>

              {/* Provider picker */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                {Object.entries(PROVIDER_INFO).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setNewProvider(p => ({ ...p, provider: k }))}
                    style={{
                      padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                      background: newProvider.provider === k ? 'rgba(232,168,32,0.1)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${newProvider.provider === k ? 'rgba(232,168,32,0.4)' : 'rgba(255,255,255,0.08)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{v.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{v.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{v.creditsPerScene}</div>
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="form-label">API Key <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    className="form-input font-mono"
                    type="password"
                    placeholder="Enter your API key..."
                    value={newProvider.apiKey}
                    onChange={e => setNewProvider(p => ({ ...p, apiKey: e.target.value }))}
                  />
                  <p className="text-[10px] text-ink-500 mt-1">Encrypted at rest. Never logged or transmitted in plain text.</p>
                </div>

                {newProvider.provider === 'custom' && (
                  <div>
                    <label className="form-label">API URL</label>
                    <input
                      className="form-input font-mono text-xs"
                      type="url"
                      placeholder="https://your-api.example.com/generate"
                      value={newProvider.apiUrl}
                      onChange={e => setNewProvider(p => ({ ...p, apiUrl: e.target.value }))}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { key: 'isPrimary', label: 'Set as primary provider', desc: 'Route all new renders here first' },
                    { key: 'autoFallback', label: 'Enable auto-fallback', desc: 'Use as fallback if primary fails' },
                  ].map(item => (
                    <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button
                        onClick={() => setNewProvider(p => ({ ...p, [item.key]: !(p as any)[item.key] }))}
                        className={`toggle-track flex-shrink-0 ${(newProvider as any)[item.key] ? 'on' : ''}`}
                      >
                        <div className="toggle-thumb" />
                      </button>
                      <div>
                        <div className="text-xs font-semibold text-ink-100">{item.label}</div>
                        <div className="text-[10px] text-ink-400">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {addMutation.isError && (
                <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertTriangle size={13} color="#fca5a5" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11.5, color: '#fca5a5' }}>Failed to add provider. Check your API key and try again.</span>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button onClick={() => setAdding(false)} className="btn btn-ghost flex-1 justify-center">Cancel</button>
                <button
                  onClick={() => addMutation.mutate(newProvider)}
                  disabled={!newProvider.apiKey || addMutation.isPending}
                  className="btn btn-primary flex-1 justify-center"
                >
                  {addMutation.isPending
                    ? <><RefreshCw size={13} className="animate-spin" /> Adding...</>
                    : <><Check size={13} /> Save Provider</>
                  }
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
