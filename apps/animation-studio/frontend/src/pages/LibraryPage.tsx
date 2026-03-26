import React, { useCallback, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CloudUpload, Trash2, Search, X, CheckSquare, Square,
  ZoomIn, Download, Tag, Image, Film, Music, Package,
  MoreHorizontal, CheckCircle2, AlertCircle, Loader2,
  RefreshCw, Copy,
} from 'lucide-react';
import { assetsApi } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────
interface Asset {
  id: string;
  name: string;
  cdn_url?: string;
  mime_type: string;
  type: string;
  size_bytes?: number;
  created_at: string;
}

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const TYPES = [
  { value: '',          label: 'All',       icon: <Package size={11} /> },
  { value: 'logo',      label: 'Logos',     icon: <Tag size={11} /> },
  { value: 'product',   label: 'Products',  icon: <Image size={11} /> },
  { value: 'video',     label: 'Videos',    icon: <Film size={11} /> },
  { value: 'audio',     label: 'Audio',     icon: <Music size={11} /> },
  { value: 'pattern',   label: 'Patterns',  icon: <Image size={11} /> },
  { value: 'reference', label: 'Reference', icon: <Image size={11} /> },
  { value: 'other',     label: 'Other',     icon: <MoreHorizontal size={11} /> },
];

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function assetIcon(type: string, mime: string) {
  if (mime?.startsWith('video/')) return '🎬';
  if (mime?.startsWith('audio/')) return '🎵';
  if (type === 'logo')    return '🏷️';
  if (type === 'product') return '📦';
  if (type === 'pattern') return '🎨';
  return '🖼️';
}

function typeColor(type: string) {
  const colors: Record<string, string> = {
    logo: '#f59e0b', product: '#6366f1', video: '#ef4444',
    audio: '#10b981', pattern: '#ec4899', reference: '#0ea5e9', other: '#94a3b8',
  };
  return colors[type] ?? '#94a3b8';
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function LibraryPage() {
  const qc = useQueryClient();
  const [filter, setFilter]     = useState('');
  const [type, setType]         = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview]   = useState<Asset | null>(null);
  const [uploads, setUploads]   = useState<UploadItem[]>([]);
  const [copied, setCopied]     = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['assets', type, filter],
    queryFn:  () => assetsApi.list({ type, search: filter }),
  });

  const deleteMutation = useMutation({
    mutationFn: assetsApi.delete,
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['assets'] }); setSelected(new Set()); },
  });

  const onDrop = useCallback(async (accepted: File[]) => {
    const newUploads: UploadItem[] = accepted.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      name: f.name, progress: 0, status: 'uploading',
    }));
    setUploads(prev => [...prev, ...newUploads]);

    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      const uploadId = newUploads[i].id;
      const fd = new FormData();
      fd.append('file', file);
      try {
        await assetsApi.upload(fd, (p) => {
          setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress: p } : u));
        });
        setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'done', progress: 100 } : u));
      } catch (err: any) {
        setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: 'error', error: err?.message || 'Upload failed' } : u));
      }
    }

    qc.invalidateQueries({ queryKey: ['assets'] });
    setTimeout(() => setUploads(prev => prev.filter(u => u.status !== 'done')), 2500);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [], 'video/*': [], 'audio/*': [], 'image/svg+xml': [] },
    maxSize: 100 * 1024 * 1024,
  });

  const assets: Asset[] = data?.assets ?? [];
  const allIds = assets.map(a => a.id);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
  };

  const handleBulkDelete = () => {
    for (const id of selected) deleteMutation.mutate(id);
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="p-8 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Asset Library</h1>
          <p className="page-subtitle">
            {isLoading ? 'Loading...' : `${assets.length} asset${assets.length !== 1 ? 's' : ''}`}
            {selected.size > 0 && ` · ${selected.size} selected`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              onClick={handleBulkDelete}
              disabled={deleteMutation.isPending}
              className="btn text-xs"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              {deleteMutation.isPending
                ? <><Loader2 size={12} className="animate-spin" /> Deleting...</>
                : <><Trash2 size={12} /> Delete {selected.size}</>
              }
            </motion.button>
          )}
        </div>
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`mb-5 border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200
          ${isDragActive ? 'border-gold-400 bg-gold-400/5 scale-[1.01]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'}`}
      >
        <input {...getInputProps()} />
        <CloudUpload size={28} className={`mx-auto mb-2.5 transition-colors ${isDragActive ? 'text-gold-400' : 'text-ink-400'}`} />
        <p className="text-sm font-semibold text-ink-200">
          {isDragActive ? 'Release to upload' : 'Drop files or click to upload'}
        </p>
        <p className="text-xs text-ink-500 mt-1">SVG · PNG · JPG · GIF · MP4 · MOV · MP3 · WAV — up to 100MB each</p>
      </div>

      {/* Upload progress queue */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-5 card p-4 space-y-2"
          >
            {uploads.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {u.status === 'uploading' && <Loader2 size={13} className="animate-spin text-gold-400 flex-shrink-0" />}
                {u.status === 'done'      && <CheckCircle2 size={13} color="#10b981" className="flex-shrink-0" />}
                {u.status === 'error'     && <AlertCircle size={13} color="#ef4444" className="flex-shrink-0" />}
                <span className="text-xs text-ink-200 flex-1 truncate">{u.name}</span>
                {u.status === 'uploading' && (
                  <div style={{ width: 80, height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${u.progress}%`, background: '#e8a820', transition: 'width 0.2s' }} />
                  </div>
                )}
                {u.status === 'done'  && <span className="text-[10px] text-green-400">Uploaded</span>}
                {u.status === 'error' && <span className="text-[10px] text-red-400">{u.error}</span>}
                {u.status !== 'uploading' && (
                  <button onClick={() => setUploads(p => p.filter(x => x.id !== u.id))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter + search bar */}
      <div className="flex items-center gap-4 mb-6">
        {/* Type pills */}
        <div className="flex gap-1.5 flex-wrap flex-1">
          {TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 11px', borderRadius: 99, fontSize: 11.5, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                background: type === t.value ? 'rgba(232,168,32,0.15)' : 'rgba(255,255,255,0.05)',
                color: type === t.value ? '#e8a820' : 'var(--text-muted)',
                border: `1px solid ${type === t.value ? 'rgba(232,168,32,0.35)' : 'rgba(255,255,255,0.07)'}`,
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Select all */}
        {assets.length > 0 && (
          <button onClick={toggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 600 }}>
            {selected.size === allIds.length
              ? <CheckSquare size={14} color="#e8a820" />
              : <Square size={14} />
            }
            {selected.size === allIds.length ? 'Deselect all' : 'Select all'}
          </button>
        )}

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 32, width: 200, fontSize: 12 }}
            placeholder="Search assets..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {filter && (
            <button onClick={() => setFilter('')}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-6 gap-3">
          {Array(12).fill(0).map((_, i) => <div key={i} className="aspect-square bg-ink-800 rounded-xl animate-pulse" />)}
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-20">
          <CloudUpload size={40} className="mx-auto mb-4 text-ink-600" />
          <h3 className="text-sm font-bold text-ink-400 mb-1">{filter || type ? 'No assets match your filters' : 'No assets yet'}</h3>
          <p className="text-xs text-ink-500">
            {filter || type ? 'Try clearing filters' : 'Drop files above to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-3">
          {assets.map((asset, i) => {
            const isSelected = selected.has(asset.id);
            const isImage = asset.mime_type?.startsWith('image/');
            const c = typeColor(asset.type);
            return (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i * 0.025, 0.3), duration: 0.18 }}
                onClick={() => setPreview(asset)}
                style={{
                  position: 'relative', aspectRatio: '1',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 14,
                  border: `1px solid ${isSelected ? c : 'rgba(255,255,255,0.07)'}`,
                  overflow: 'hidden', cursor: 'pointer',
                  transition: 'all 0.15s',
                  outline: isSelected ? `2px solid ${c}` : 'none',
                  outlineOffset: 2,
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)'; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
              >
                {/* Thumbnail */}
                {isImage && asset.cdn_url ? (
                  <img src={asset.cdn_url} alt={asset.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <span style={{ fontSize: 28 }}>{assetIcon(asset.type, asset.mime_type)}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{asset.type}</span>
                  </div>
                )}

                {/* Type badge */}
                <div style={{
                  position: 'absolute', top: 6, left: 6,
                  padding: '2px 6px', borderRadius: 6,
                  background: `${c}25`, color: c,
                  fontSize: 9, fontWeight: 700,
                  border: `1px solid ${c}30`,
                  backdropFilter: 'blur(4px)',
                }}>
                  {asset.type}
                </div>

                {/* Hover overlay */}
                <div
                  className="group"
                  style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(10,10,20,0.75)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 8, opacity: 0, transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={e => { e.stopPropagation(); setPreview(asset); }}
                      style={{ padding: '6px 12px', borderRadius: 8, background: '#e8a820', border: 'none', color: '#0a0a14', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <ZoomIn size={11} /> View
                    </button>
                    <button
                      onClick={e => toggleSelect(asset.id, e)}
                      style={{ padding: '6px 12px', borderRadius: 8, background: isSelected ? `${c}30` : 'rgba(255,255,255,0.12)', border: `1px solid ${isSelected ? c : 'transparent'}`, color: isSelected ? c : '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >
                      {isSelected ? <CheckSquare size={11} /> : <Square size={11} />}
                    </button>
                  </div>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', textAlign: 'center', padding: '0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90%' }}>
                    {asset.name}
                  </p>
                </div>

                {/* Select checkbox when selected */}
                {isSelected && (
                  <button
                    onClick={e => toggleSelect(asset.id, e)}
                    style={{ position: 'absolute', top: 6, right: 6, background: c, border: 'none', borderRadius: 6, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  >
                    <CheckSquare size={11} color="#fff" />
                  </button>
                )}
              </motion.div>
            );
          })}

          {/* Upload slot */}
          <div
            {...getRootProps()}
            style={{
              aspectRatio: '1', borderRadius: 14,
              border: '2px dashed rgba(255,255,255,0.1)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', gap: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(232,168,32,0.4)'; (e.currentTarget as HTMLElement).style.background = 'rgba(232,168,32,0.04)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <input {...getInputProps()} />
            <CloudUpload size={18} style={{ color: 'var(--text-muted)', transition: 'color 0.15s' }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Upload</span>
          </div>
        </div>
      )}

      {/* Preview modal */}
      <AnimatePresence>
        {preview && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24 }}
            onClick={() => setPreview(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              style={{ background: '#14141f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, overflow: 'hidden', maxWidth: 560, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            >
              {/* Modal header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                  <h3 style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.name}</h3>
                  <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{preview.type}</span>
                    {preview.size_bytes && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{formatSize(preview.size_bytes)}</span>}
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{new Date(preview.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {preview.cdn_url && (
                    <>
                      <button
                        onClick={() => copyUrl(preview.cdn_url!)}
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', color: copied === preview.cdn_url ? '#10b981' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
                        title="Copy URL"
                      >
                        {copied === preview.cdn_url ? <CheckCircle2 size={12} /> : <Copy size={12} />} Copy URL
                      </button>
                      <a
                        href={preview.cdn_url} target="_blank" rel="noreferrer" download
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
                      >
                        <Download size={12} /> Download
                      </a>
                    </>
                  )}
                  <button
                    onClick={() => {
                      deleteMutation.mutate(preview.id);
                      setPreview(null);
                    }}
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '6px 10px', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                  <button onClick={() => setPreview(null)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 8px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Preview area */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,0.3)', overflow: 'hidden' }}>
                {preview.cdn_url && preview.mime_type?.startsWith('image/') ? (
                  <img
                    src={preview.cdn_url}
                    alt={preview.name}
                    style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain', borderRadius: 12 }}
                  />
                ) : preview.cdn_url && preview.mime_type?.startsWith('video/') ? (
                  <video
                    src={preview.cdn_url}
                    controls
                    style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 12 }}
                  />
                ) : preview.cdn_url && preview.mime_type?.startsWith('audio/') ? (
                  <audio src={preview.cdn_url} controls style={{ width: '100%' }} />
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 64, marginBottom: 12 }}>{assetIcon(preview.type, preview.mime_type)}</div>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Preview not available</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
