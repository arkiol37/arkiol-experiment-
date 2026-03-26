import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Clapperboard, FolderOpen, Image, BarChart3,
  CreditCard, Cpu, Settings, LogOut, ChevronDown, Coins, Plus, Layers
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/studio', label: 'New Campaign', icon: Plus, primary: true },
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/library', label: 'Asset Library', icon: Image },
  { to: '/brand-assets', label: 'Brand Assets', icon: Layers },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/providers', label: 'AI Providers', icon: Cpu },
  { to: '/pricing', label: 'Pricing & Plans', icon: CreditCard },
];


// ── Arkiol animated mark (inline — no shared pkg dep needed) ─────────────────
function ArkiolLogoMark({ size = 36 }: { size?: number }) {
  const cx = size / 2, cy = size / 2;
  const rO = size * 0.47, rI = size * 0.33;
  return (
    <>
      <style>{`
        @keyframes ak-spin    { to { transform: rotate( 360deg); } }
        @keyframes ak-spinrev { to { transform: rotate(-360deg); } }
      `}</style>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" style={{ overflow:"visible", flexShrink:0 }}>
        <defs>
          <linearGradient id="ak2-arc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#6EE7F7"/>
            <stop offset="100%" stopColor="#A78BFA"/>
          </linearGradient>
          <linearGradient id="ak2-dot" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#A78BFA"/>
            <stop offset="100%" stopColor="#6EE7F7"/>
          </linearGradient>
          <filter id="ak2-glow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="1.4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r={rO} stroke="url(#ak2-arc)" strokeWidth={size*0.028}
          strokeDasharray={`${rO*4.5} ${rO*1.6}`} strokeLinecap="round" opacity={0.6}
          filter="url(#ak2-glow)"
          style={{ transformOrigin:`${cx}px ${cy}px`, animation:"ak-spin 8s linear infinite" }}/>
        <circle cx={cx} cy={cy} r={rI} stroke="url(#ak2-arc)" strokeWidth={size*0.018}
          strokeDasharray={`${rI*3.0} ${rI*3.4}`} strokeLinecap="round" opacity={0.35}
          style={{ transformOrigin:`${cx}px ${cy}px`, animation:"ak-spinrev 12s linear infinite" }}/>
        <line x1={cx} y1={size*0.115} x2={cx-size*0.275} y2={size*0.885}
          stroke="url(#ak2-arc)" strokeWidth={size*0.07} strokeLinecap="round" filter="url(#ak2-glow)"/>
        <line x1={cx} y1={size*0.115} x2={cx+size*0.275} y2={size*0.885}
          stroke="url(#ak2-arc)" strokeWidth={size*0.07} strokeLinecap="round" filter="url(#ak2-glow)"/>
        <line x1={cx-size*0.185} y1={size*0.555} x2={cx+size*0.185} y2={size*0.555}
          stroke="url(#ak2-arc)" strokeWidth={size*0.055} strokeLinecap="round" filter="url(#ak2-glow)"/>
        <circle cx={cx+rO} cy={cy} r={size*0.062} fill="url(#ak2-dot)" filter="url(#ak2-glow)"
          style={{ transformOrigin:`${cx}px ${cy}px`, animation:"ak-spin 8s linear infinite" }}/>
      </svg>
    </>
  );
}
export default function AppLayout() {
  const { user, workspace, logout } = useAuthStore();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/auth');
  };

  const planBadgeColors: Record<string, string> = {
    free:    'text-ink-100',
    creator: 'text-blue-400',
    pro:     'text-gold-300',
    studio:  'text-purple-400',
  };

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 px-1">
          <ArkiolLogoMark size={36} />
          <div>
            <div style={{ fontFamily: "'Syne','Helvetica Neue',sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: "-0.6px", color: "#F0F0FF" }}>arkiol</div>
            <div style={{ fontFamily: "'Syne','Helvetica Neue',sans-serif", fontSize: 9, letterSpacing: "0.25em", color: "#6EE7F7", opacity: 0.6 }}>DESIGN INTELLIGENCE</div>
          </div>
        </div>

        {/* Workspace */}
        {workspace && (
          <div className="mb-6 px-1">
            <div className="text-[10px] font-semibold text-ink-300 uppercase tracking-widest mb-2">Workspace</div>
            <div className="flex items-center gap-2 p-2 bg-ink-600 rounded-xl border border-white/[0.06]">
              <div className="w-7 h-7 rounded-lg bg-gold-400/20 flex items-center justify-center text-gold-300 text-xs font-bold">
                {workspace.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-ink-50 truncate">{workspace.name}</div>
                <div className={`text-[10px] font-semibold capitalize ${planBadgeColors[workspace.plan]}`}>
                  {workspace.plan} plan
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Credits */}
        {workspace && (
          <div className="mb-6 mx-1 p-3 bg-ink-800 rounded-xl border border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-ink-200 uppercase tracking-widest">
                <Coins size={10} className="text-gold-400" />
                Credits
              </div>
              <span className="font-mono text-xs font-bold text-gold-300">{workspace.creditsBalance}</span>
            </div>
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${Math.min(100, (workspace.creditsBalance / 100) * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon, primary }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'active' : ''} ${primary ? 'mt-2 !text-gold-300 border border-gold-400/20 bg-gold-400/10 hover:bg-gold-400/15' : ''}`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: Settings + User */}
        <div className="mt-6 space-y-0.5 border-t border-white/[0.06] pt-4">
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Settings size={15} />
            Settings
          </NavLink>

          {user && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-ink-700 transition-all"
              >
                <div className="w-7 h-7 rounded-full bg-gold-400/20 flex items-center justify-center text-gold-300 text-xs font-bold flex-shrink-0">
                  {user.firstName[0]}{user.lastName[0]}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-xs font-semibold text-ink-50 truncate">{user.firstName} {user.lastName}</div>
                  <div className="text-[10px] text-ink-200 truncate">{user.email}</div>
                </div>
                <ChevronDown size={12} className="text-ink-300 flex-shrink-0" />
              </button>

              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-full left-0 right-0 mb-2 bg-ink-700 border border-white/10 rounded-xl overflow-hidden shadow-xl z-50"
                >
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-400/10 transition-all"
                  >
                    <LogOut size={13} />
                    Sign Out
                  </button>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 ml-64 min-h-screen bg-ink-900">
        <Outlet />
      </main>
    </div>
  );
}
