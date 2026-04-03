import React from 'react';
interface QualityIssue { id: string; severity: string; category: string; message: string; }
export default function SceneWarnings({ issues }: { issues: QualityIssue[] }) {
  if (issues.length === 0) return null;
  const critical = issues.filter(i => i.severity === 'critical' || i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  return (<div className="space-y-2"><h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Quality Warnings</h3>{critical.length > 0 && (<div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 space-y-1">{critical.map(i => <p key={i.id} className="text-xs text-red-300">{i.message}</p>)}</div>)}{warnings.length > 0 && (<div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 space-y-1">{warnings.map(i => <p key={i.id} className="text-xs text-yellow-300">{i.message}</p>)}</div>)}</div>);
}
