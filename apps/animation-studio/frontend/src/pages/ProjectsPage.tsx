import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, FolderOpen, Video, ChevronRight, X, Download,
  AlertCircle, CheckCircle2, Clock, Play,
  RotateCcw, Loader2, Film, Zap, ExternalLink, Copy,
  Calendar, Tag,
} from 'lucide-react';
import { projectsApi, rendersApi } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Project {
  id: string;
  name: string;
  brief?: string;
  status: string;
  created_at: string;
  render_count?: number;
}

interface Render {
  id: string;
  status: string;
  progress: number;
  current_step?: string;
  output_video_url?: string;
  output_thumbnail_url?: string;
  platform?: string;
  placement?: string;
  ad_duration_sec?: number;
  hook_type?: string;
  cta_text?: string;
  quality_report?: any;
  platform_exports?: any;
  credits_charged?: number;
  created_at: string;
  completed_at?: string;
}

// ── Status helpers ─────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  complete:        '#10b981',
  processing:      '#f59e0b',
  scene_rendering: '#f59e0b',
  mixing:          '#14B8A6',
  queued:          '#94a3b8',
  failed:          '#ef4444',
  dead_letter:     '#ef4444',
  cancelled:       '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  complete:        'Complete',
  processing:      'Processing',
  scene_rendering: 'Rendering',
  mixing:          'Mixing',
  queued:          'Queued',
  failed:          'Failed',
  dead_letter:     'Failed',
  cancelled:       'Cancelled',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#94a3b8';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: `${color}18`, color, border: `1px solid ${color}30`,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  const isRunning = ['processing', 'scene_rendering', 'mixing', 'queued'].includes(status);
  if (status === 'complete')  return <CheckCircle2 size={14} color="#10b981" />;
  if (status === 'failed' || status === 'dead_letter') return <AlertCircle size={14} color="#ef4444" />;
  if (isRunning)              return <Loader2 size={14} color="#f59e0b" className="animate-spin" />;
  return <Clock size={14} color="#94a3b8" />;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  const { data: rendersData, isLoading: loadingRenders } = useQuery({
    queryKey: ['project-renders', selectedProject?.id],
    queryFn: () => rendersApi.list({ projectId: selectedProject!.id, limit: 20 }),
    enabled: !!selectedProject?.id,
    refetchInterval: (d) => {
      const renders = (d as any)?.renders ?? [];
      return renders.some((r: Render) => ['processing','scene_rendering','mixing','queued'].includes(r.status)) ? 3000 : false;
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => rendersApi.retry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-renders', selectedProject?.id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => rendersApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-renders', selectedProject?.id] }),
  });

  const downloadMutation = useMutation({
    mutationFn: ({ id, format }: { id: string; format?: string }) =>
      rendersApi.download(id, format),
    onSuccess: (data) => {
      if (data.url) window.open(data.url, '_blank');
    },
  });

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const projects: Project[] = data?.projects ?? [];
  const renders: Render[]   = rendersData?.renders ?? [];

  const hasActiveRenders = renders.some(r =>
    ['processing','scene_rendering','mixing','queued'].includes(r.status)
  );

  return (
    <div className="p-8 min-h-screen">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">All your brand campaigns and video renders</p>
        </div>
        <button onClick={() => navigate('/studio')} className="btn btn-primary">
          <Plus size={14} /> New Campaign
        </button>
      </div>

      <div className="flex gap-6" style={{ minHeight: 0 }}>
        {/* Project list */}
        <div className={`flex-1 min-w-0 transition-all duration-300 ${selectedProject ? 'max-w-[420px]' : ''}`}>
          {isLoading ? (
            <div className="grid grid-cols-3 gap-4">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-40 bg-ink-800 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-24">
              <FolderOpen size={48} className="mx-auto mb-4 text-ink-600" />
              <h3 className="text-lg font-bold text-ink-400 mb-2">No projects yet</h3>
              <p className="text-sm text-ink-500 mb-6">Create your first AI brand campaign</p>
              <button onClick={() => navigate('/studio')} className="btn btn-primary">
                <Plus size={14} /> New Campaign
              </button>
            </div>
          ) : (
            <div className={`grid gap-4 ${selectedProject ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {projects.map((project, i) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isSelected={selectedProject?.id === project.id}
                  compact={!!selectedProject}
                  index={i}
                  onClick={() => setSelectedProject(
                    selectedProject?.id === project.id ? null : project
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* Render detail panel */}
        <AnimatePresence>
          {selectedProject && (
            <motion.div
              initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              style={{ width: 520, flexShrink: 0 }}
            >
              <div className="card" style={{ height: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
                {/* Panel header */}
                <div className="p-5 border-b border-white/[0.06] flex items-start justify-between">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Film size={14} className="text-teal-400 flex-shrink-0" />
                      <h2 className="text-sm font-bold text-ink-50 truncate">{selectedProject.name}</h2>
                    </div>
                    {selectedProject.brief && (
                      <p className="text-xs text-ink-400 line-clamp-2">{selectedProject.brief}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-ink-500 flex items-center gap-1">
                        <Calendar size={9} /> {new Date(selectedProject.created_at).toLocaleDateString()}
                      </span>
                      {hasActiveRenders && (
                        <span className="text-[10px] text-amber-400 flex items-center gap-1">
                          <Loader2 size={9} className="animate-spin" /> Processing
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <button
                      onClick={() => navigate('/studio')}
                      className="btn btn-ghost text-xs py-1.5 px-3"
                      title="New render for this project"
                    >
                      <Plus size={12} /> Render
                    </button>
                    <button
                      onClick={() => setSelectedProject(null)}
                      className="btn btn-ghost text-xs p-1.5"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Renders list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                  {loadingRenders ? (
                    <div className="space-y-3">
                      {[1,2,3].map(i => (
                        <div key={i} className="h-24 bg-ink-800 rounded-xl animate-pulse" />
                      ))}
                    </div>
                  ) : renders.length === 0 ? (
                    <div className="text-center py-16">
                      <Video size={32} className="mx-auto mb-3 text-ink-600" />
                      <p className="text-sm font-semibold text-ink-400 mb-1">No renders yet</p>
                      <p className="text-xs text-ink-500">Start a new campaign to generate video renders.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {renders.map(render => (
                        <RenderCard
                          key={render.id}
                          render={render}
                          copiedId={copiedId}
                          onCopy={copyId}
                          onRetry={() => retryMutation.mutate(render.id)}
                          onCancel={() => cancelMutation.mutate(render.id)}
                          onDownload={(fmt) => downloadMutation.mutate({ id: render.id, format: fmt })}
                          isRetrying={retryMutation.isPending && retryMutation.variables === render.id}
                          isCancelling={cancelMutation.isPending && cancelMutation.variables === render.id}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Panel footer stats */}
                {renders.length > 0 && (
                  <div className="p-4 border-t border-white/[0.06]">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        {
                          label: 'Total Renders',
                          value: renders.length,
                          icon: <Film size={11} color="#14B8A6" />,
                        },
                        {
                          label: 'Completed',
                          value: renders.filter(r => r.status === 'complete').length,
                          icon: <CheckCircle2 size={11} color="#10b981" />,
                        },
                        {
                          label: 'Credits Used',
                          value: renders.reduce((s, r) => s + (r.credits_charged ?? 0), 0),
                          icon: <Zap size={11} color="#f59e0b" />,
                        },
                      ].map(stat => (
                        <div key={stat.label} style={{
                          padding: '8px 10px', borderRadius: 10,
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                          <div className="flex items-center gap-1.5 mb-1">{stat.icon}
                            <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {stat.label}
                            </span>
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)', lineHeight: 1 }}>
                            {stat.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────
function ProjectCard({
  project, isSelected, compact, index, onClick,
}: {
  project: Project;
  isSelected: boolean;
  compact: boolean;
  index: number;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className="card card-hover cursor-pointer"
      style={{
        padding: compact ? '14px 16px' : '20px',
        borderColor: isSelected ? 'rgba(15,118,110,0.4)' : undefined,
        background: isSelected ? 'rgba(15,118,110,0.04)' : undefined,
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: compact ? 'center' : undefined,
        gap: compact ? 12 : 0,
      }}
    >
      <div style={{
        width: compact ? 36 : 44, height: compact ? 36 : 44, borderRadius: 12, flexShrink: 0,
        background: isSelected ? 'rgba(15,118,110,0.2)' : 'rgba(15,118,110,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: compact ? 0 : 14,
      }}>
        <Video size={compact ? 16 : 20} className={isSelected ? 'text-teal-300' : 'text-teal-400'} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-ink-50 truncate flex-1">{project.name}</h3>
          {!compact && (
            <span className={`badge ${project.status === 'active' ? 'badge-green' : 'badge-muted'} ml-2 flex-shrink-0`}>
              {project.status}
            </span>
          )}
        </div>
        {!compact && (
          <p className="text-xs text-ink-300 line-clamp-2 mb-3">{project.brief || 'No description'}</p>
        )}
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-ink-400">
            {new Date(project.created_at).toLocaleDateString()}
          </p>
          <ChevronRight size={12} className={`text-ink-500 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
        </div>
      </div>
    </motion.div>
  );
}

// ── Render Card ───────────────────────────────────────────────────────────────
function RenderCard({
  render, copiedId, onCopy, onRetry, onCancel, onDownload, isRetrying, isCancelling,
}: {
  render: Render;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onRetry: () => void;
  onCancel: () => void;
  onDownload: (format?: string) => void;
  isRetrying: boolean;
  isCancelling: boolean;
}) {
  const [showFormats, setShowFormats] = useState(false);

  const isActive    = ['processing','scene_rendering','mixing','queued'].includes(render.status);
  const isComplete  = render.status === 'complete';
  const isFailed    = render.status === 'failed' || render.status === 'dead_letter';

  const platformExports = render.platform_exports
    ? (typeof render.platform_exports === 'string' ? JSON.parse(render.platform_exports) : render.platform_exports)
    : null;

  const formatDuration = (s?: number) => s ? `${s}s` : null;
  const formatElapsed = (start: string, end?: string) => {
    const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
    const secs = Math.round(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  };

  return (
    <div style={{
      borderRadius: 14,
      background: 'rgba(255,255,255,0.025)',
      border: `1px solid ${isComplete ? 'rgba(16,185,129,0.15)' : isFailed ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.07)'}`,
      overflow: 'hidden',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px' }}>
        {/* Thumbnail */}
        <div style={{
          width: 72, height: 42, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
          background: 'rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {render.output_thumbnail_url ? (
            <img src={render.output_thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Video size={18} color="rgba(255,255,255,0.2)" />
          )}
          {isComplete && render.output_video_url && (
            <a href={render.output_video_url} target="_blank" rel="noreferrer"
              style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)', opacity: 0, transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
            >
              <Play size={16} color="#fff" fill="#fff" />
            </a>
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <StatusIcon status={render.status} />
            <StatusBadge status={render.status} />
            {render.platform && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Tag size={9} /> {render.platform}
              </span>
            )}
            {render.placement && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{render.placement}</span>
            )}
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Clock size={9} /> {new Date(render.created_at).toLocaleDateString()}{' '}
              {new Date(render.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {formatDuration(render.ad_duration_sec) && (
              <span>· {formatDuration(render.ad_duration_sec)}</span>
            )}
            {render.credits_charged != null && (
              <span style={{ color: '#f59e0b' }}>· {render.credits_charged} cr</span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar for active */}
      {isActive && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{render.current_step || 'Processing...'}</span>
            <span style={{ fontSize: 10.5, color: '#f59e0b', fontFamily: 'monospace' }}>{render.progress}%</span>
          </div>
          <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.08)' }}>
            <motion.div
              style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #14B8A6, #f59e0b)' }}
              initial={{ width: 0 }}
              animate={{ width: `${render.progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        {/* Copy ID */}
        <button
          onClick={() => onCopy(render.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-muted)', padding: '3px 0' }}
          title="Copy render ID"
        >
          {copiedId === render.id ? <CheckCircle2 size={11} color="#10b981" /> : <Copy size={11} />}
          <span style={{ fontFamily: 'monospace' }}>{render.id.slice(0, 8)}</span>
        </button>

        <span style={{ flex: 1 }} />

        {/* Active: cancel */}
        {isActive && (
          <button onClick={onCancel} disabled={isCancelling}
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: 7, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            {isCancelling ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
            Cancel
          </button>
        )}

        {/* Failed: retry */}
        {isFailed && (
          <button onClick={onRetry} disabled={isRetrying}
            style={{ background: 'rgba(15,118,110,0.15)', border: '1px solid rgba(15,118,110,0.3)', color: '#2DD4BF', borderRadius: 7, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            {isRetrying ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            Retry
          </button>
        )}

        {/* Complete: download */}
        {isComplete && (
          <>
            {platformExports && Object.keys(platformExports).length > 1 ? (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowFormats(f => !f)}
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#6ee7b7', borderRadius: 7, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Download size={11} /> Download ▾
                </button>
                <AnimatePresence>
                  {showFormats && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                      style={{
                        position: 'absolute', bottom: '100%', right: 0, marginBottom: 4,
                        background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 10, padding: 6, minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 10,
                      }}
                    >
                      {Object.keys(platformExports).map(fmt => (
                        <button key={fmt} onClick={() => { onDownload(fmt); setShowFormats(false); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 8px', borderRadius: 7, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          <Download size={11} color="#6ee7b7" /> {fmt.replace(/_/g, ' ')}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button onClick={() => onDownload()}
                style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#6ee7b7', borderRadius: 7, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Download size={11} /> Download
              </button>
            )}

            {render.output_video_url && (
              <a href={render.output_video_url} target="_blank" rel="noreferrer"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', borderRadius: 7, padding: '3px 10px', fontSize: 11, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                <ExternalLink size={11} /> Preview
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
