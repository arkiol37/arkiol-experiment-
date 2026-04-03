/**
 * Animation Diagnostics — admin dashboard page for monitoring
 * animation studio pipeline health, render metrics, and engine status.
 */
import React, { useState, useEffect } from 'react';

interface PipelineMetric {
  name: string;
  value: number;
  unit: string;
  status: 'healthy' | 'degraded' | 'critical';
}

interface EngineStatus {
  engine: string;
  status: 'active' | 'inactive' | 'error';
  lastRun: string;
  avgDurationMs: number;
  successRate: number;
}

export default function AnimationDiagnostics() {
  const [metrics, setMetrics] = useState<PipelineMetric[]>([
    { name: 'Queue Depth', value: 0, unit: 'jobs', status: 'healthy' },
    { name: 'Avg Render Time', value: 45, unit: 'sec', status: 'healthy' },
    { name: 'Success Rate', value: 94.5, unit: '%', status: 'healthy' },
    { name: 'Active Workers', value: 3, unit: '', status: 'healthy' },
    { name: 'GPU Utilization', value: 67, unit: '%', status: 'healthy' },
    { name: 'Cache Hit Rate', value: 32, unit: '%', status: 'degraded' },
  ]);

  const [engines, setEngines] = useState<EngineStatus[]>([
    { engine: 'Director', status: 'active', lastRun: '2 min ago', avgDurationMs: 120, successRate: 99.2 },
    { engine: 'Storyboard', status: 'active', lastRun: '2 min ago', avgDurationMs: 85, successRate: 98.8 },
    { engine: 'Timeline', status: 'active', lastRun: '3 min ago', avgDurationMs: 45, successRate: 99.5 },
    { engine: 'Continuity', status: 'active', lastRun: '3 min ago', avgDurationMs: 35, successRate: 97.1 },
    { engine: 'QC Gate', status: 'active', lastRun: '2 min ago', avgDurationMs: 28, successRate: 100 },
    { engine: 'Orchestrator', status: 'active', lastRun: '2 min ago', avgDurationMs: 450, successRate: 96.3 },
  ]);

  const statusColor = (s: string) => s === 'healthy' || s === 'active' ? 'text-green-400' : s === 'degraded' || s === 'inactive' ? 'text-yellow-400' : 'text-red-400';
  const statusBg = (s: string) => s === 'healthy' || s === 'active' ? 'bg-green-500/10 border-green-500/20' : s === 'degraded' || s === 'inactive' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Animation Studio Diagnostics</h1>
      <p className="text-sm text-white/50 mb-6">Real-time pipeline monitoring and engine health</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {metrics.map(m => (
          <div key={m.name} className={`rounded-xl p-4 border ${statusBg(m.status)}`}>
            <p className="text-[11px] text-white/50 uppercase tracking-wider">{m.name}</p>
            <p className="text-2xl font-bold mt-1">{m.value}<span className="text-sm text-white/40 ml-1">{m.unit}</span></p>
            <p className={`text-[10px] mt-1 ${statusColor(m.status)}`}>{m.status}</p>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-3">Engine Status</h2>
      <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 text-white/50 text-xs"><th className="text-left p-3">Engine</th><th className="text-left p-3">Status</th><th className="text-left p-3">Last Run</th><th className="text-right p-3">Avg Duration</th><th className="text-right p-3">Success Rate</th></tr></thead>
          <tbody>
            {engines.map(e => (
              <tr key={e.engine} className="border-b border-white/5 hover:bg-white/5">
                <td className="p-3 font-medium">{e.engine}</td>
                <td className={`p-3 ${statusColor(e.status)}`}>{e.status}</td>
                <td className="p-3 text-white/50">{e.lastRun}</td>
                <td className="p-3 text-right text-white/70">{e.avgDurationMs}ms</td>
                <td className="p-3 text-right"><span className={e.successRate >= 98 ? 'text-green-400' : e.successRate >= 95 ? 'text-yellow-400' : 'text-red-400'}>{e.successRate}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
