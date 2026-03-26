import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Play, RefreshCw, TrendingUp, Video, Coins, Zap, Download } from 'lucide-react';
import { rendersApi, analyticsApi } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

const STATUS_COLORS: Record<string, string> = {
  complete: 'badge-green',
  failed: 'badge-red',
  processing: 'badge-blue',
  queued: 'badge-muted',
  scene_rendering: 'badge-blue',
};

const STATUS_LABELS: Record<string, string> = {
  complete: '✓ Complete',
  failed: '✗ Failed',
  processing: '⟳ Processing',
  queued: '◷ Queued',
  scene_rendering: '⟳ Rendering Scenes',
  mixing: '⟳ Mixing',
};

export default function DashboardPage() {
  const { user, workspace } = useAuthStore();
  const navigate = useNavigate();

  const { data: renders } = useQuery({
    queryKey: ['renders'],
    queryFn: () => rendersApi.list({ limit: 8 }),
    refetchInterval: (data) => {
      const hasActive = data?.jobs?.some((j: any) => ['queued','processing','scene_rendering','mixing'].includes(j.status));
      return hasActive ? 5000 : false;
    },
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', '7d'],
    queryFn: () => analyticsApi.overview('7d'),
  });

  const stats = [
    { label: 'Credits Balance', value: workspace?.creditsBalance ?? 0, change: '', icon: Coins, accent: 'from-gold-600 to-gold-400' },
    { label: 'Total Renders', value: analytics?.renderStats?.total || 0, change: '+12% this week', icon: Video, accent: 'from-green-600 to-green-400' },
    { label: 'Success Rate', value: analytics?.renderStats?.total ? `${Math.round((analytics.renderStats.complete / analytics.renderStats.total) * 100)}%` : '—', change: '', icon: TrendingUp, accent: 'from-blue-600 to-blue-400' },
    { label: 'Avg Scenes', value: analytics?.renderStats?.avg_scenes ? Number(analytics.renderStats.avg_scenes).toFixed(1) : '—', change: '', icon: Zap, accent: 'from-purple-600 to-purple-400' },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-title">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},{' '}
            <span className="text-gold-300">{user?.firstName}</span> ✦
          </h1>
          <p className="page-subtitle">Here's what's happening with your campaigns</p>
        </div>
        <button onClick={() => navigate('/studio')} className="btn btn-primary gap-2 px-5 py-2.5 text-sm shadow-gold">
          <Plus size={15} />
          New Campaign
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="stat-card"
          >
            <div className={`stat-card-accent bg-gradient-to-r ${stat.accent}`} />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-ink-200 uppercase tracking-wide mb-2">{stat.label}</p>
                <p className="text-3xl font-black text-ink-50 font-mono">{stat.value}</p>
                {stat.change && <p className="text-xs text-green-400 font-semibold mt-1">{stat.change}</p>}
              </div>
              <div className="p-2 bg-ink-600 rounded-xl">
                <stat.icon size={16} className="text-ink-100" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Recent Renders */}
        <div className="col-span-2">
          <div className="card">
            <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Video size={15} className="text-gold-400" />
                <h2 className="text-sm font-bold text-ink-50">Recent Campaigns</h2>
              </div>
              <button onClick={() => navigate('/projects')} className="text-xs text-gold-400 hover:text-gold-300 transition-colors font-semibold">
                View all →
              </button>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {renders?.jobs?.length === 0 && (
                <div className="text-center py-16">
                  <div className="text-4xl mb-3 opacity-40">🎬</div>
                  <p className="text-sm text-ink-300 font-medium">No campaigns yet</p>
                  <p className="text-xs text-ink-400 mt-1">Create your first AI brand video</p>
                  <button onClick={() => navigate('/studio')} className="btn btn-primary mt-4 text-xs">
                    <Plus size={13} />
                    New Campaign
                  </button>
                </div>
              )}
              {renders?.jobs?.map((job: any) => {
                const PLATFORM_ICONS: Record<string, string> = { youtube: '▶️', facebook: '👥', instagram: '📷', tiktok: '🎵' };
                const platformIcon = job.platform ? PLATFORM_ICONS[job.platform] : '🎬';

                const handleDownload = async (format?: string) => {
                  try {
                    const result = await rendersApi.download(job.id, format);
                    if (result?.url) {
                      const a = document.createElement('a');
                      a.href = result.url;
                      a.download = `${job.placement || format || 'video'}.mp4`;
                      a.target = '_blank';
                      a.click();
                    }
                  } catch { alert('Download failed. Please try again.'); }
                };

                // Parse platform exports to build download buttons
                const platformExports: Record<string, string> = (() => {
                  try { return job.platform_exports ? JSON.parse(job.platform_exports) : {}; }
                  catch { return {}; }
                })();
                const hasPlatformExports = Object.keys(platformExports).length > 0;

                return (
                  <div key={job.id} className="p-4 hover:bg-ink-700/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-ink-600 flex items-center justify-center text-2xl flex-shrink-0">
                        {platformIcon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-ink-50 truncate">
                          {job.placement ? job.placement.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Campaign'}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-ink-300">{job.scenes_total} scenes</span>
                          <span className="text-ink-500">·</span>
                          <span className="text-xs text-ink-300">{new Date(job.created_at).toLocaleDateString()}</span>
                          {job.platform && <span className="text-[10px] font-semibold text-ink-400 uppercase">{job.platform}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {['queued','processing','scene_rendering','mixing'].includes(job.status) && (
                          <div className="text-xs font-mono text-gold-400">{job.progress}%</div>
                        )}
                        <span className={`badge ${STATUS_COLORS[job.status] || 'badge-muted'}`}>
                          {STATUS_LABELS[job.status] || job.status}
                        </span>
                        {job.status === 'failed' && (
                          <button onClick={() => rendersApi.retry(job.id)} className="btn btn-ghost p-1.5" title="Retry">
                            <RefreshCw size={12} />
                          </button>
                        )}
                        {job.status === 'complete' && !hasPlatformExports && (
                          <button onClick={() => handleDownload()} className="btn btn-ghost p-1.5" title="Download">
                            <Download size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Platform-specific download buttons */}
                    {job.status === 'complete' && hasPlatformExports && (
                      <div className="flex flex-wrap gap-1.5 mt-3 pl-16">
                        {Object.keys(platformExports).map(placement => (
                          <button
                            key={placement}
                            onClick={() => handleDownload(placement)}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-ink-700 hover:bg-ink-600 border border-white/[0.08] hover:border-white/15 rounded-lg text-[10px] font-semibold text-ink-200 transition-all"
                            title={`Download ${placement}`}
                          >
                            <Download size={10} />
                            {placement.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </button>
                        ))}
                        <button
                          onClick={() => handleDownload()}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-gold-400/15 hover:bg-gold-400/25 border border-gold-400/30 rounded-lg text-[10px] font-semibold text-gold-300 transition-all"
                          title="Download primary format"
                        >
                          <Download size={10} /> Primary
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Quick Start + Plan Status */}
        <div className="space-y-4">
          {/* Quick start */}
          <div className="card p-5">
            <h3 className="text-sm font-bold text-ink-50 mb-3">Quick Start</h3>
            <div className="space-y-2">
              {[
                { icon: '🎯', label: 'New Campaign', sub: 'AI-directed video ad', action: () => navigate('/studio') },
                { icon: '🖼️', label: 'Upload Assets', sub: 'Logos, products, patterns', action: () => navigate('/library') },
                { icon: '📊', label: 'View Analytics', sub: 'Usage & performance', action: () => navigate('/analytics') },
              ].map(item => (
                <button key={item.label} onClick={item.action} className="w-full flex items-center gap-3 p-3 rounded-xl bg-ink-800 hover:bg-ink-700 border border-white/[0.05] hover:border-white/10 transition-all text-left">
                  <span className="text-xl">{item.icon}</span>
                  <div>
                    <div className="text-xs font-bold text-ink-50">{item.label}</div>
                    <div className="text-[10px] text-ink-300">{item.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Plan */}
          {workspace && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-ink-50">Plan Status</h3>
                <span className={`badge ${workspace.plan === 'free' ? 'badge-muted' : 'badge-gold'} capitalize`}>
                  {workspace.plan}
                </span>
              </div>
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-ink-300">Credits remaining</span>
                  <span className="font-mono font-bold text-gold-300">{workspace.creditsBalance}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${Math.min(100, (workspace.creditsBalance / (
                      workspace.plan === 'studio'  ? 6000 :
                      workspace.plan === 'pro'     ? 1700 :
                      workspace.plan === 'creator' ? 500  : 0
                    ) * 100) || 0)}%` }} />
                </div>
              </div>
              {workspace.plan === 'free' && (
                <button onClick={() => navigate('/pricing')} className="btn btn-primary w-full justify-center text-xs py-2">
                  Upgrade for More Credits
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
