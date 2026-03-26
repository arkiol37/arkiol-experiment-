/**
 * BrandAssetLibraryPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Full Brand Asset Library UI:
 *   - Drag-and-drop upload zone
 *   - AI processing status with stage-by-stage progress
 *   - Asset grid with type classification badges
 *   - Color palette display per asset
 *   - Usage role assignment (override AI)
 *   - Scene placement preview
 *   - Multi-asset selection for ad generation
 *   - Extracted brand palette merger
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload, X, RefreshCw, CheckCircle2, Clock, AlertCircle,
  Zap, Eye, Trash2, MoreVertical, ImageIcon, Package,
  Monitor, Box, Grid, Layers, Wand2, Palette, ChevronRight,
  Play, Filter, Search, Plus, ArrowRight,
} from 'lucide-react';
import { brandAssetsApi } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

type AssetType = 'logo' | 'product' | 'screenshot' | 'packaging' | 'pattern' | 'icon' | 'other';
type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';
type UsageRole = 'logo_slot' | 'product_slot' | 'screenshot_slot' | 'brand_reveal_slot' | 'background_slot' | 'accent_slot';

interface BrandAsset {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  cdnUrl: string | null;
  thumbnailUrl: string | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  assetType: AssetType;
  usageRole: UsageRole | null;
  classificationConfidence: number;
  aiAnalysis: Record<string, any>;
  cutoutUrl: string | null;
  vectorUrl: string | null;
  enhancedUrl: string | null;
  extractedPalette: Array<{ hex: string; label: string; weight: number }>;
  primaryColor: string | null;
  hasAlpha: boolean;
  recommendedMotion: string;
  recommendedTransition: string;
  placementHints: Record<string, any>;
  brandId: string | null;
  createdAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ASSET_TYPE_CONFIG: Record<AssetType, { label: string; icon: React.FC<any>; color: string; bg: string }> = {
  logo:        { label: 'Logo',        icon: Layers,    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  product:     { label: 'Product',     icon: Package,   color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  screenshot:  { label: 'Screenshot',  icon: Monitor,   color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  packaging:   { label: 'Packaging',   icon: Box,       color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  pattern:     { label: 'Pattern',     icon: Grid,      color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  icon:        { label: 'Icon',        icon: Zap,       color: '#facc15', bg: 'rgba(250,204,21,0.12)' },
  other:       { label: 'Other',       icon: ImageIcon, color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

const ROLE_LABELS: Record<UsageRole, string> = {
  logo_slot:         'Logo Slot',
  product_slot:      'Product Slot',
  screenshot_slot:   'Screenshot Slot',
  brand_reveal_slot: 'Brand Reveal',
  background_slot:   'Background',
  accent_slot:       'Accent',
};

const STATUS_CONFIG: Record<ProcessingStatus, { label: string; color: string; icon: React.FC<any> }> = {
  pending:    { label: 'Queued',      color: '#94a3b8', icon: Clock },
  processing: { label: 'Processing',  color: '#f59e0b', icon: RefreshCw },
  ready:      { label: 'Ready',       color: '#10b981', icon: CheckCircle2 },
  failed:     { label: 'Failed',      color: '#ef4444', icon: AlertCircle },
};

const PROCESSING_STAGES = [
  'classify', 'bg_remove', 'color_extract', 'enhance', 'vectorize', 'motion_intel',
];
const STAGE_LABELS: Record<string, string> = {
  classify:      'Classifying',
  bg_remove:     'Removing Background',
  color_extract: 'Extracting Colors',
  enhance:       'Enhancing',
  vectorize:     'Vectorizing',
  motion_intel:  'Motion Analysis',
};

// ── Upload Progress Item ───────────────────────────────────────────────────

interface UploadItem {
  id: string;
  file: File;
  status: 'uploading' | 'processing' | 'done' | 'error';
  progress: number;
  assetId?: string;
  error?: string;
}

// ── Main Component ─────────────────────────────────────────────────────────

export function BrandAssetLibraryPage() {
  const qc = useQueryClient();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [previewAsset, setPreviewAsset] = useState<BrandAsset | null>(null);
  const [roleMenuAsset, setRoleMenuAsset] = useState<string | null>(null);
  const [paletteResult, setPaletteResult] = useState<string[] | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data, refetch } = useQuery({
    queryKey: ['brand-assets', filterType, filterStatus, search],
    queryFn: () => brandAssetsApi.list({ type: filterType, status: filterStatus, search }),
    refetchInterval: (data: any) => {
      // Auto-refresh while any assets are processing
      const hasProcessing = data?.assets?.some((a: BrandAsset) =>
        a.processingStatus === 'processing' || a.processingStatus === 'pending'
      );
      return hasProcessing ? 3000 : false;
    },
  });

  const assets: BrandAsset[] = data?.assets || [];
  const hasProcessing = assets.some(a => a.processingStatus === 'processing' || a.processingStatus === 'pending');

  // ── Mutations ─────────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: brandAssetsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-assets'] }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UsageRole }) =>
      brandAssetsApi.updateRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brand-assets'] });
      setRoleMenuAsset(null);
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: brandAssetsApi.reprocess,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-assets'] }),
  });

  // ── Upload Handler ─────────────────────────────────────────────────────

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newUploads: UploadItem[] = acceptedFiles.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      status: 'uploading',
      progress: 0,
    }));

    setUploads(prev => [...prev, ...newUploads]);

    for (const item of newUploads) {
      try {
        setUploads(prev => prev.map(u => u.id === item.id ? { ...u, progress: 30 } : u));
        const fd = new FormData();
        fd.append('file', item.file);
        fd.append('name', item.file.name);

        setUploads(prev => prev.map(u => u.id === item.id ? { ...u, progress: 60 } : u));
        const result = await brandAssetsApi.upload(fd);
        setUploads(prev => prev.map(u => u.id === item.id ? {
          ...u, status: 'processing', progress: 100, assetId: result.asset.id,
        } : u));

        qc.invalidateQueries({ queryKey: ['brand-assets'] });

        // Auto-dismiss after a delay
        setTimeout(() => {
          setUploads(prev => prev.filter(u => u.id !== item.id));
        }, 4000);
      } catch (err: any) {
        setUploads(prev => prev.map(u => u.id === item.id ? {
          ...u, status: 'error', error: err.message,
        } : u));
      }
    }
  }, [qc]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': [], 'image/png': [], 'image/webp': [],
      'image/svg+xml': [], 'image/gif': [], 'image/avif': [],
    },
    maxSize: 50 * 1024 * 1024,
    multiple: true,
  });

  // ── Selection ──────────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleGetPalette = async () => {
    if (!selectedIds.size) return;
    try {
      const result = await brandAssetsApi.getPalette(Array.from(selectedIds));
      setPaletteResult(result.palette);
    } catch (err) { /* noop */ }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const allTypes: AssetType[] = ['logo', 'product', 'screenshot', 'packaging', 'pattern', 'icon', 'other'];

  return (
    <div style={{ padding: '36px 44px', maxWidth: 1400, fontFamily: 'var(--font-body)' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 36 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Wand2 size={18} color="#fff" />
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.04em' }}>
              Brand Asset Library
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: 480 }}>
            Upload brand assets — logos, products, screenshots, packaging — and AI transforms them into animation-ready 2D ad elements.
          </p>
        </div>

        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{selectedIds.size} selected</span>
            <button onClick={handleGetPalette} className="ak-btn ak-btn-secondary" style={{ fontSize: 12 }}>
              <Palette size={13} /> Extract Palette
            </button>
            <button
              onClick={() => {
                // Navigate to Studio with pre-selected assets
                window.dispatchEvent(new CustomEvent('open-studio-with-assets', {
                  detail: { assetIds: Array.from(selectedIds) }
                }));
              }}
              className="ak-btn ak-btn-primary" style={{ fontSize: 12 }}
            >
              <Play size={13} /> Generate Ad
              <ArrowRight size={13} />
            </button>
          </motion.div>
        )}
      </div>

      {/* ── Extracted Palette Banner ── */}
      <AnimatePresence>
        {paletteResult && (
          <motion.div
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 16, padding: '16px 20px', marginBottom: 24,
              display: 'flex', alignItems: 'center', gap: 16,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', minWidth: 100 }}>
              Brand Palette
            </div>
            <div style={{ display: 'flex', gap: 8, flex: 1 }}>
              {paletteResult.map(hex => (
                <div key={hex} title={hex} style={{
                  width: 36, height: 36, borderRadius: 10, background: hex,
                  border: '2px solid rgba(255,255,255,0.15)',
                  boxShadow: `0 4px 12px ${hex}40`,
                  cursor: 'pointer', flexShrink: 0,
                }} onClick={() => navigator.clipboard?.writeText(hex)} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Click to copy</div>
            <button onClick={() => setPaletteResult(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Upload Zone ── */}
      <motion.div
        {...getRootProps()}
        animate={{ scale: isDragActive ? 1.01 : 1 }}
        style={{
          border: `2px dashed ${isDragActive ? '#6366f1' : 'var(--border-strong)'}`,
          borderRadius: 20, padding: '32px 24px', textAlign: 'center',
          cursor: 'pointer', marginBottom: 28, transition: 'all 0.2s ease',
          background: isDragActive ? 'rgba(99,102,241,0.06)' : 'var(--bg-elevated)',
          position: 'relative', overflow: 'hidden',
        }}
      >
        <input {...getInputProps()} />
        {isDragActive && (
          <div style={{
            position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
            borderRadius: 18,
          }} />
        )}
        <div style={{ position: 'relative' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16,
            background: isDragActive ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px', border: '1px solid var(--border)',
          }}>
            <Upload size={22} color={isDragActive ? '#6366f1' : 'var(--text-muted)'} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '-0.025em' }}>
            {isDragActive ? 'Drop brand assets here' : 'Upload brand assets'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 16 }}>
            Logos, product photos, screenshots, packaging — AI processes everything automatically
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['PNG', 'JPG', 'WebP', 'SVG', 'GIF', 'AVIF'].map(ext => (
              <span key={ext} style={{
                padding: '3px 10px', borderRadius: 99, fontSize: 11,
                background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}>{ext}</span>
            ))}
            <span style={{
              padding: '3px 10px', borderRadius: 99, fontSize: 11,
              background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}>Up to 50 MB</span>
          </div>
        </div>
      </motion.div>

      {/* ── Upload Queue ── */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ marginBottom: 24, overflow: 'hidden' }}
          >
            {uploads.map(item => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 12, marginBottom: 8,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: item.status === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.status === 'error' ? <AlertCircle size={16} color="#ef4444" /> :
                   item.status === 'done' ? <CheckCircle2 size={16} color="#10b981" /> :
                   <motion.div animate={{ rotate: item.status === 'processing' ? 360 : 0 }}
                     transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                     <RefreshCw size={16} color="#6366f1" />
                   </motion.div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.file.name}
                  </div>
                  {item.status === 'error' ? (
                    <div style={{ fontSize: 11, color: '#ef4444' }}>{item.error}</div>
                  ) : item.status === 'processing' ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>AI processing...</div>
                  ) : item.status === 'done' ? (
                    <div style={{ fontSize: 11, color: '#10b981' }}>Ready</div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 99 }}>
                        <motion.div
                          style={{ height: '100%', background: '#6366f1', borderRadius: 99 }}
                          animate={{ width: `${item.progress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 30 }}>{item.progress}%</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setUploads(prev => prev.filter(u => u.id !== item.id))}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                >
                  <X size={14} />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filter Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Type filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterType('')}
            style={{
              padding: '5px 14px', borderRadius: 99, border: '1px solid',
              borderColor: filterType === '' ? 'var(--border-accent)' : 'var(--border-strong)',
              background: filterType === '' ? 'var(--accent-tint-md)' : 'transparent',
              color: filterType === '' ? 'var(--accent-light)' : 'var(--text-secondary)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >All</button>
          {allTypes.map(type => {
            const cfg = ASSET_TYPE_CONFIG[type];
            const Icon = cfg.icon;
            return (
              <button
                key={type}
                onClick={() => setFilterType(prev => prev === type ? '' : type)}
                style={{
                  padding: '5px 12px', borderRadius: 99, border: '1px solid',
                  borderColor: filterType === type ? cfg.color : 'var(--border-strong)',
                  background: filterType === type ? cfg.bg : 'transparent',
                  color: filterType === type ? cfg.color : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <Icon size={11} />
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{
            padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border-strong)',
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="">All Status</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>

        {/* Search */}
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search assets..."
            style={{
              padding: '6px 12px 6px 30px', borderRadius: 8, border: '1px solid var(--border-strong)',
              background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, width: 180,
            }}
          />
        </div>

        {hasProcessing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#f59e0b' }}>
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
              <RefreshCw size={12} />
            </motion.div>
            Processing assets...
          </div>
        )}
      </div>

      {/* ── Asset Grid ── */}
      {assets.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '80px 24px',
          background: 'var(--bg-elevated)', borderRadius: 24,
          border: '1px dashed var(--border-strong)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎨</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', margin: '0 0 8px', letterSpacing: '-0.04em' }}>
            No brand assets yet
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 320, margin: '0 auto 24px' }}>
            Upload your logos, product photos, and other brand visuals to get started.
          </p>
          <button {...getRootProps()} className="ak-btn ak-btn-primary">
            <input {...getInputProps()} />
            <Plus size={14} /> Upload First Asset
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {assets.map(asset => (
            <AssetCard
              key={asset.id}
              asset={asset}
              isSelected={selectedIds.has(asset.id)}
              onSelect={() => toggleSelect(asset.id)}
              onPreview={() => setPreviewAsset(asset)}
              onDelete={() => deleteMutation.mutate(asset.id)}
              onReprocess={() => reprocessMutation.mutate(asset.id)}
              onRoleChange={role => roleMutation.mutate({ id: asset.id, role })}
              roleMenuOpen={roleMenuAsset === asset.id}
              onToggleRoleMenu={() => setRoleMenuAsset(prev => prev === asset.id ? null : asset.id)}
            />
          ))}
        </div>
      )}

      {/* ── Asset Preview Modal ── */}
      <AnimatePresence>
        {previewAsset && (
          <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Asset Card ─────────────────────────────────────────────────────────────

interface AssetCardProps {
  asset: BrandAsset;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onReprocess: () => void;
  onRoleChange: (role: UsageRole) => void;
  roleMenuOpen: boolean;
  onToggleRoleMenu: () => void;
}

function AssetCard({
  asset, isSelected, onSelect, onPreview, onDelete, onReprocess, onRoleChange, roleMenuOpen, onToggleRoleMenu,
}: AssetCardProps) {
  const typeCfg = ASSET_TYPE_CONFIG[asset.assetType] || ASSET_TYPE_CONFIG.other;
  const TypeIcon = typeCfg.icon;
  const statusCfg = STATUS_CONFIG[asset.processingStatus];
  const StatusIcon = statusCfg.icon;
  const displayUrl = asset.cutoutUrl || asset.thumbnailUrl || asset.cdnUrl;
  const isReady = asset.processingStatus === 'ready';
  const isProcessing = asset.processingStatus === 'processing' || asset.processingStatus === 'pending';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        background: 'var(--bg-elevated)',
        border: `1px solid ${isSelected ? '#6366f1' : 'var(--border)'}`,
        borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
        boxShadow: isSelected ? '0 0 0 2px rgba(99,102,241,0.3)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        position: 'relative',
      }}
    >
      {/* Selection indicator */}
      <div
        onClick={onSelect}
        style={{
          position: 'absolute', top: 10, left: 10, zIndex: 10,
          width: 20, height: 20, borderRadius: 6,
          border: `2px solid ${isSelected ? '#6366f1' : 'rgba(255,255,255,0.3)'}`,
          background: isSelected ? '#6366f1' : 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}
      >
        {isSelected && <CheckCircle2 size={12} color="#fff" />}
      </div>

      {/* Actions */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: 4 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          style={{
            width: 26, height: 26, borderRadius: 7, border: 'none',
            background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        ><Eye size={12} /></button>
        <div style={{ position: 'relative' }}>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleRoleMenu(); }}
            style={{
              width: 26, height: 26, borderRadius: 7, border: 'none',
              background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(4px)',
            }}
          ><MoreVertical size={12} /></button>
          <AnimatePresence>
            {roleMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -8 }}
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute', top: 30, right: 0, zIndex: 100,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: 6, minWidth: 160,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 8px 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Set Role
                </div>
                {(Object.keys(ROLE_LABELS) as UsageRole[]).map(role => (
                  <button
                    key={role}
                    onClick={() => onRoleChange(role)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)',
                      background: asset.usageRole === role ? 'var(--accent-tint-md)' : 'none',
                      border: 'none', borderRadius: 8, cursor: 'pointer',
                    }}
                  >{ROLE_LABELS[role]}</button>
                ))}
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <button
                  onClick={() => { onReprocess(); onToggleRoleMenu(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '7px 10px', fontSize: 12, color: 'var(--text-secondary)',
                    background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={11} /> Reprocess
                </button>
                <button
                  onClick={() => { onDelete(); onToggleRoleMenu(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '7px 10px', fontSize: 12, color: '#ef4444',
                    background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  <Trash2 size={11} /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Image Preview */}
      <div
        onClick={onPreview}
        style={{
          height: 160, position: 'relative', overflow: 'hidden',
          background: displayUrl ? 'transparent' : 'var(--bg-input)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* Checkerboard for transparent assets */}
        {asset.hasAlpha && displayUrl && (
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'linear-gradient(45deg, #3a3a4a 25%, transparent 25%), linear-gradient(-45deg, #3a3a4a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a4a 75%), linear-gradient(-45deg, transparent 75%, #3a3a4a 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            opacity: 0.4,
          }} />
        )}

        {displayUrl ? (
          <img
            src={displayUrl}
            alt={asset.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 16, position: 'relative' }}
          />
        ) : (
          <div style={{ opacity: 0.3 }}>
            <TypeIcon size={40} color="var(--text-muted)" />
          </div>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
            backdropFilter: 'blur(4px)',
          }}>
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
              <RefreshCw size={24} color="#f59e0b" />
            </motion.div>
            <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>AI Processing</div>
            <ProcessingPipeline asset={asset} />
          </div>
        )}
      </div>

      {/* Card Footer */}
      <div style={{ padding: '10px 12px' }}>
        {/* Name + Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {asset.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: statusCfg.color, flexShrink: 0 }}>
            <StatusIcon size={10} />
            {statusCfg.label}
          </div>
        </div>

        {/* Type badge + Role */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <span style={{
            padding: '2px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 600,
            background: typeCfg.bg, color: typeCfg.color,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <TypeIcon size={9} />
            {typeCfg.label}
            {asset.classificationConfidence > 0 && (
              <span style={{ opacity: 0.7 }}>{Math.round(asset.classificationConfidence * 100)}%</span>
            )}
          </span>
          {asset.usageRole && (
            <span style={{
              padding: '2px 8px', borderRadius: 99, fontSize: 10.5,
              background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
            }}>
              {ROLE_LABELS[asset.usageRole]}
            </span>
          )}
        </div>

        {/* Color palette dots */}
        {isReady && asset.extractedPalette?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8, alignItems: 'center' }}>
            {asset.extractedPalette.slice(0, 5).map((c, i) => (
              <div
                key={i}
                title={c.hex}
                style={{
                  width: 14, height: 14, borderRadius: 4, background: c.hex,
                  border: '1px solid rgba(255,255,255,0.15)',
                  flexShrink: 0,
                }}
              />
            ))}
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 2 }}>
              {asset.extractedPalette.length} colors
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Processing Pipeline Indicator ──────────────────────────────────────────

function ProcessingPipeline({ asset }: { asset: BrandAsset }) {
  const stages: Record<string, any> = typeof asset.aiAnalysis === 'string'
    ? {} : (asset.aiAnalysis || {});

  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {PROCESSING_STAGES.map((stage, i) => {
        const done = stages[stage]?.status === 'done';
        const failed = stages[stage]?.status === 'failed';
        return (
          <div
            key={stage}
            title={STAGE_LABELS[stage]}
            style={{
              width: 6, height: 6, borderRadius: 99,
              background: done ? '#10b981' : failed ? '#ef4444' : 'rgba(255,255,255,0.3)',
            }}
          />
        );
      })}
    </div>
  );
}

// ── Asset Preview Modal ────────────────────────────────────────────────────

function AssetPreviewModal({ asset, onClose }: { asset: BrandAsset; onClose: () => void }) {
  const typeCfg = ASSET_TYPE_CONFIG[asset.assetType] || ASSET_TYPE_CONFIG.other;
  const TypeIcon = typeCfg.icon;
  const displayUrl = asset.cutoutUrl || asset.enhancedUrl || asset.cdnUrl;

  const MOTION_LABELS: Record<string, string> = {
    float: 'Float', spin: 'Spin', scale_in: 'Scale In', slide_in: 'Slide In',
    parallax: 'Parallax', reveal: 'Reveal', bounce: 'Bounce', fade_in: 'Fade In', none: 'Static',
  };

  const sceneRoles: string[] = asset.placementHints?.suitableSceneRoles || [];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 24, width: '100%', maxWidth: 800, maxHeight: '90vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--border)', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: typeCfg.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TypeIcon size={16} color={typeCfg.color} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{asset.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {typeCfg.label} · {asset.width}×{asset.height}px · {(asset.sizeBytes / 1024).toFixed(0)}KB
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Image Panel */}
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32, background: 'var(--bg-input)', position: 'relative', overflow: 'hidden',
          }}>
            {asset.hasAlpha && (
              <div style={{
                position: 'absolute', inset: 0,
                backgroundImage: 'linear-gradient(45deg, #3a3a4a 25%, transparent 25%), linear-gradient(-45deg, #3a3a4a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a4a 75%), linear-gradient(-45deg, transparent 75%, #3a3a4a 75%)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                opacity: 0.3,
              }} />
            )}
            {displayUrl && (
              <img src={displayUrl} alt={asset.name} style={{ maxWidth: '100%', maxHeight: 340, objectFit: 'contain', position: 'relative', borderRadius: 8 }} />
            )}
          </div>

          {/* Info Panel */}
          <div style={{ width: 280, borderLeft: '1px solid var(--border)', padding: 20, overflow: 'auto' }}>
            {/* AI Analysis */}
            {asset.aiAnalysis?.subjectDescription && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  AI Analysis
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {asset.aiAnalysis.subjectDescription}
                </div>
                {asset.aiAnalysis.reasoning && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                    {asset.aiAnalysis.reasoning}
                  </div>
                )}
              </div>
            )}

            {/* Color Palette */}
            {asset.extractedPalette?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Brand Colors
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {asset.extractedPalette.slice(0, 6).map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: c.hex, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />
                      <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{c.hex}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Motion Intelligence */}
            {asset.recommendedMotion && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Motion Intelligence
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, background: 'rgba(99,102,241,0.15)', color: '#a78bfa' }}>
                    ✦ {MOTION_LABELS[asset.recommendedMotion] || asset.recommendedMotion}
                  </span>
                  <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                    → {asset.recommendedTransition}
                  </span>
                </div>
              </div>
            )}

            {/* Scene Placement */}
            {sceneRoles.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Scene Placement
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {sceneRoles.map((role: string) => (
                    <span key={role} style={{ padding: '3px 8px', borderRadius: 99, fontSize: 10.5, background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                      {role.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Variants */}
            <div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Generated Variants
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'Original', url: asset.cdnUrl },
                  { label: 'Cutout (no BG)', url: asset.cutoutUrl },
                  { label: 'Enhanced', url: asset.enhancedUrl },
                  { label: 'Vector SVG', url: asset.vectorUrl },
                ].map(({ label, url }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {url ? (
                      <CheckCircle2 size={12} color="#10b981" />
                    ) : (
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--border)' }} />
                    )}
                    <span style={{ fontSize: 12, color: url ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 10, color: '#6366f1', textDecoration: 'none' }}>
                        View
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
