import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User, CreditCard, Bell, Lock, Download, LogOut,
  Eye, EyeOff, Shield, MonitorSmartphone, Trash2,
  CheckCircle2, AlertCircle, RefreshCw, Key,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { userApi, billingApi } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useNavigate } from 'react-router-dom';

// ── Toast ─────────────────────────────────────────────────────────────────────
interface Toast { id: number; text: string; type: 'success' | 'error' }
let toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = (text: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId;
    setToasts(p => [...p, { id, text, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  };
  return { toasts, show };
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'profile',       label: 'Profile',        icon: User },
  { id: 'billing',       label: 'Billing',         icon: CreditCard },
  { id: 'notifications', label: 'Notifications',   icon: Bell },
  { id: 'security',      label: 'Security',        icon: Lock },
  { id: 'defaults',      label: 'Export Defaults', icon: Download },
] as const;
type TabId = typeof TABS[number]['id'];

// ── Root ──────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('profile');
  const { user, workspace, logout, loadMe } = useAuthStore();
  const navigate = useNavigate();
  const { toasts, show } = useToast();

  return (
    <div className="p-8 min-h-screen">
      {/* Toast layer */}
      <div style={{ position:'fixed',bottom:24,right:24,zIndex:9999,display:'flex',flexDirection:'column',gap:8 }}>
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id}
              initial={{ opacity:0, x:40 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:40 }}
              style={{
                display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderRadius:12,
                fontSize:13,fontWeight:600,backdropFilter:'blur(8px)',minWidth:260,
                boxShadow:'0 8px 24px rgba(0,0,0,0.3)',
                background: t.type==='error' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                border: `1px solid ${t.type==='error' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                color: t.type==='error' ? '#fca5a5' : '#6ee7b7',
              }}>
              {t.type==='error' ? <AlertCircle size={15}/> : <CheckCircle2 size={15}/>}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="mb-8">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Account, billing, security and preferences</p>
      </div>

      <div className="grid grid-cols-[200px_1fr] gap-6">
        {/* Sidebar */}
        <div className="space-y-0.5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all
                ${tab===t.id ? 'bg-ink-700 text-gold-300' : 'text-ink-200 hover:bg-ink-800 hover:text-ink-50'}`}>
              <t.icon size={14}/>{t.label}
            </button>
          ))}
          <div className="pt-4 mt-4 border-t border-white/[0.06]">
            <button onClick={async()=>{await logout();navigate('/auth');}}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-all">
              <LogOut size={14}/>Sign Out
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-6">
          <AnimatePresence mode="wait">
            <motion.div key={tab}
              initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
              transition={{ duration:0.16, ease:[0.16,1,0.3,1] }}>
              {tab==='profile'       && <ProfileTab user={user} loadMe={loadMe} show={show}/>}
              {tab==='billing'       && <BillingTab workspace={workspace} navigate={navigate}/>}
              {tab==='notifications' && <NotificationsTab show={show}/>}
              {tab==='security'      && <SecurityTab user={user} show={show}/>}
              {tab==='defaults'      && <DefaultsTab show={show}/>}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfileTab({ user, loadMe, show }: any) {
  const [profile, setProfile] = useState({ firstName:'', lastName:'', company:'', timezone:'UTC' });
  useEffect(() => {
    if (user) setProfile({
      firstName: user.firstName||'', lastName: user.lastName||'',
      company: user.company||'',
      timezone: user.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',
    });
  }, [user]);

  const save = useMutation({
    mutationFn: userApi.updateProfile,
    onSuccess: ()=>{ loadMe(); show('Profile saved.'); },
    onError: ()=>show('Failed to save profile.','error'),
  });

  const TIMEZONES = ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
    'Europe/London','Europe/Paris','Europe/Berlin','Asia/Tokyo','Asia/Singapore','Asia/Dubai','Australia/Sydney'];

  return (
    <div className="card p-6">
      <h2 className="text-sm font-bold text-ink-50 mb-1">Profile Information</h2>
      <p className="text-xs text-ink-300 mb-6">Your personal account details</p>

      {/* Avatar row */}
      <div className="flex items-center gap-4 mb-6 pb-6 border-b border-white/[0.06]">
        <div style={{ width:64,height:64,borderRadius:'50%',flexShrink:0,
          background:'linear-gradient(135deg,#6366f1,#a78bfa)',
          display:'flex',alignItems:'center',justifyContent:'center',
          fontSize:24,fontWeight:800,color:'#fff' }}>
          {(user?.firstName?.[0]||user?.email?.[0]||'?').toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-bold text-ink-50">{user?.firstName} {user?.lastName}</div>
          <div className="text-xs text-ink-400 mt-0.5">{user?.email}</div>
          <div className="text-[10px] text-ink-500 mt-1 capitalize">
            {user?.plan||'Free'} plan · Member since {new Date(user?.createdAt||Date.now()).getFullYear()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div><label className="form-label">First Name</label>
          <input className="form-input" value={profile.firstName} onChange={e=>setProfile(p=>({...p,firstName:e.target.value}))}/></div>
        <div><label className="form-label">Last Name</label>
          <input className="form-input" value={profile.lastName} onChange={e=>setProfile(p=>({...p,lastName:e.target.value}))}/></div>
      </div>
      <div className="mb-4">
        <label className="form-label">Email Address</label>
        <input className="form-input opacity-50 cursor-not-allowed" type="email" value={user?.email||''} disabled/>
        <p className="text-[10px] text-ink-500 mt-1">Email changes require contacting support.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div><label className="form-label">Company</label>
          <input className="form-input" value={profile.company} onChange={e=>setProfile(p=>({...p,company:e.target.value}))}/></div>
        <div><label className="form-label">Timezone</label>
          <select className="form-select" value={profile.timezone} onChange={e=>setProfile(p=>({...p,timezone:e.target.value}))}>
            {TIMEZONES.map(tz=><option key={tz} value={tz}>{tz.replace('_',' ')}</option>)}
          </select></div>
      </div>
      <button onClick={()=>save.mutate(profile)} disabled={save.isPending} className="btn btn-primary">
        {save.isPending ? <><RefreshCw size={13} className="animate-spin"/> Saving...</> : '✓ Save Profile'}
      </button>
    </div>
  );
}

// ── Billing ───────────────────────────────────────────────────────────────────
function BillingTab({ workspace, navigate }: any) {
  const { data: invoiceData, isLoading } = useQuery({ queryKey:['invoices'], queryFn: billingApi.invoices });
  const portal = useMutation({ mutationFn: billingApi.createPortal, onSuccess: d=>{ if(d.url) window.location.href=d.url; } });
  const credit = useMutation({ mutationFn: ()=>billingApi.creditPack(25), onSuccess: d=>{ if(d.url) window.location.href=d.url; } });
  const COLORS: Record<string,string> = { free:'#94a3b8', creator:'#6366f1', pro:'#f59e0b', studio:'#10b981' };
  const c = COLORS[workspace?.plan||'free']||'#94a3b8';

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="text-sm font-bold text-ink-50 mb-1">Current Plan</h2>
        <p className="text-xs text-ink-300 mb-5">Subscription and credit balance</p>
        <div className="flex items-center gap-4 p-4 bg-ink-800 rounded-xl mb-5" style={{ borderLeft:`3px solid ${c}` }}>
          <div style={{ width:40,height:40,borderRadius:10,background:`${c}20`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            <CreditCard size={18} color={c}/>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-50 capitalize">{workspace?.plan||'Free'} Plan</span>
              <span className={`badge ${workspace?.subscriptionStatus==='active'?'badge-green':'badge-muted'}`}>
                {workspace?.subscriptionStatus||'Active'}
              </span>
            </div>
            <div className="text-xs text-ink-300 mt-1">
              <span className="font-bold text-gold-300">{workspace?.creditsBalance?.toLocaleString()||0}</span> credits remaining
            </div>
          </div>
          {workspace?.plan!=='free' && (
            <button onClick={()=>portal.mutate()} className="btn btn-ghost text-xs" disabled={portal.isPending}>Manage Billing</button>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={()=>navigate('/pricing')} className="btn btn-primary text-xs">View All Plans</button>
          <button onClick={()=>credit.mutate()} className="btn btn-ghost text-xs" disabled={credit.isPending}>
            {credit.isPending?'Loading...':'Buy 25 Credit Pack'}
          </button>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-bold text-ink-50 mb-4">Billing History</h2>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-10 bg-ink-800 rounded-lg animate-pulse"/>)}</div>
        ) : !invoiceData?.invoices?.length ? (
          <div className="text-center py-8 text-ink-400 text-sm">No invoices yet.</div>
        ) : invoiceData.invoices.map((inv: any)=>(
          <div key={inv.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-ink-800 transition-colors">
            <div>
              <div className="text-xs font-semibold text-ink-100">{inv.description||'Subscription'}</div>
              <div className="text-[10px] text-ink-400">{new Date(inv.date*1000).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-ink-50">${(inv.amount/100).toFixed(2)}</span>
              <span className={`badge ${inv.status==='paid'?'badge-green':'badge-muted'} text-[9px]`}>{inv.status}</span>
              {inv.pdf && <a href={inv.pdf} target="_blank" rel="noreferrer" className="text-[10px] text-gold-400 hover:underline">PDF</a>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────
const NOTIF_GROUPS = [
  { title:'Render Alerts', icon:'🎬', items:[
    { key:'email_render_complete', label:'Render complete',   desc:'Email when a video finishes rendering' },
    { key:'email_render_failed',   label:'Render failed',     desc:'Email when a render job fails' },
  ]},
  { title:'Credits & Billing', icon:'💳', items:[
    { key:'email_billing',     label:'Billing receipts',   desc:'Email for invoices and subscription changes' },
    { key:'email_low_credits', label:'Low credit warning',  desc:'Alert when balance drops below 50 credits' },
  ]},
  { title:'Product', icon:'✨', items:[
    { key:'email_product_updates', label:'Product updates',  desc:'New features, model upgrades, and improvements' },
    { key:'email_weekly_digest',   label:'Weekly digest',    desc:'Weekly summary of your usage and highlights' },
    { key:'email_marketing',       label:'Marketing emails', desc:'Tips, tutorials, and promotional content' },
  ]},
];

function NotificationsTab({ show }: { show:(t:string,k?:'success'|'error')=>void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey:['notif-settings'], queryFn: userApi.getNotifications });
  const [settings, setSettings] = useState<Record<string,boolean>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(()=>{ if(data?.settings){ setSettings(data.settings); setDirty(false); } }, [data]);

  const save = useMutation({
    mutationFn: (s:Record<string,boolean>)=>userApi.updateNotifications(s),
    onSuccess: ()=>{ qc.invalidateQueries({queryKey:['notif-settings']}); show('Notification preferences saved.'); setDirty(false); },
    onError: ()=>show('Failed to save.','error'),
  });

  if (isLoading) return <div className="card p-6 space-y-3">{[1,2,3,4,5].map(i=><div key={i} className="h-12 bg-ink-800 rounded-lg animate-pulse"/>)}</div>;

  return (
    <div className="space-y-4">
      {NOTIF_GROUPS.map(group=>(
        <div key={group.title} className="card p-6">
          <div className="flex items-center gap-2 mb-5">
            <span className="text-base">{group.icon}</span>
            <h2 className="text-sm font-bold text-ink-50">{group.title}</h2>
          </div>
          {group.items.map((item,idx)=>(
            <div key={item.key} className="flex items-center justify-between py-3.5"
              style={{ borderBottom: idx<group.items.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
              <div>
                <div className="text-sm font-semibold text-ink-50">{item.label}</div>
                <div className="text-xs text-ink-400 mt-0.5">{item.desc}</div>
              </div>
              <button onClick={()=>{ setSettings(p=>({...p,[item.key]:!p[item.key]})); setDirty(true); }}
                className={`toggle-track flex-shrink-0 ${settings[item.key]?'on':''}`} style={{ marginLeft:16 }}>
                <div className="toggle-thumb"/>
              </button>
            </div>
          ))}
        </div>
      ))}
      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:12 }}
            className="card p-4 flex items-center justify-between"
            style={{ background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)' }}>
            <span className="text-sm text-ink-100 font-medium">You have unsaved changes</span>
            <button onClick={()=>save.mutate(settings)} disabled={save.isPending} className="btn btn-primary text-xs px-5">
              {save.isPending?<><RefreshCw size={12} className="animate-spin"/> Saving</>:'Save Changes'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Security ──────────────────────────────────────────────────────────────────
function SecurityTab({ user, show }: any) {
  const qc = useQueryClient();
  const [showPw, setShowPw] = useState({ current:false, next:false, confirm:false });
  const [pwForm, setPwForm] = useState({ current:'', next:'', confirm:'' });
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuthStore();

  const { data: sessData, isLoading: loadingSess } = useQuery({ queryKey:['sessions'], queryFn: userApi.getSessions });

  const changePw = useMutation({
    mutationFn: ()=>userApi.changePassword(pwForm.current, pwForm.next),
    onSuccess: ()=>{ show('Password changed.'); setPwForm({current:'',next:'',confirm:''}); },
    onError: (e:any)=>show(e?.response?.data?.error||'Failed to change password.','error'),
  });

  const revokeOne = useMutation({
    mutationFn: userApi.revokeSession,
    onSuccess: ()=>{ qc.invalidateQueries({queryKey:['sessions']}); show('Session revoked.'); },
  });

  const revokeAll = useMutation({
    mutationFn: userApi.revokeAllSessions,
    onSuccess: ()=>{ qc.invalidateQueries({queryKey:['sessions']}); show('All other sessions revoked.'); },
  });

  const deleteAcct = useMutation({
    mutationFn: ()=>userApi.deleteAccount(deleteConfirm),
    onSuccess: async()=>{ await logout(); navigate('/auth'); },
    onError: (e:any)=>show(e?.response?.data?.error||'Failed.','error'),
  });

  const strength = (pw: string) => {
    let s=0;
    if(pw.length>=8)s++; if(pw.length>=12)s++; if(/[A-Z]/.test(pw))s++;
    if(/[0-9]/.test(pw))s++; if(/[^A-Za-z0-9]/.test(pw))s++;
    return s;
  };
  const s = strength(pwForm.next);
  const sColor = ['','#ef4444','#f59e0b','#6366f1','#10b981','#10b981'][s]||'';
  const sLabel = ['','Weak','Fair','Good','Strong','Very Strong'][s]||'';

  const formatUA = (ua: string) => {
    if(!ua||ua==='Unknown device') return {label:'Unknown Device',icon:'💻'};
    if(/mobile|android|iphone/i.test(ua)) return {label:'Mobile',icon:'📱'};
    if(/chrome/i.test(ua)) return {label:'Chrome',icon:'🌐'};
    if(/firefox/i.test(ua)) return {label:'Firefox',icon:'🌐'};
    if(/safari/i.test(ua)) return {label:'Safari',icon:'🌐'};
    return {label:'Browser',icon:'💻'};
  };

  return (
    <div className="space-y-4">
      {/* Change password */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div style={{ width:32,height:32,borderRadius:9,background:'rgba(99,102,241,0.15)',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <Key size={15} color="#a78bfa"/>
          </div>
          <div>
            <h2 className="text-sm font-bold text-ink-50">Change Password</h2>
            <p className="text-xs text-ink-400">Keep your account secure</p>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          {(['current','next','confirm'] as const).map(field=>(
            <div key={field}>
              <label className="form-label">
                {field==='current'?'Current Password':field==='next'?'New Password':'Confirm New Password'}
              </label>
              <div className="relative">
                <input className="form-input pr-10"
                  type={showPw[field]?'text':'password'}
                  value={pwForm[field]}
                  onChange={e=>setPwForm(p=>({...p,[field]:e.target.value}))}
                  placeholder={field==='next'?'Min 8 characters':'••••••••'}
                  style={field==='confirm'&&pwForm.confirm&&pwForm.confirm!==pwForm.next?{borderColor:'#ef4444'}:undefined}
                />
                <button type="button" onClick={()=>setShowPw(p=>({...p,[field]:!p[field]}))}
                  style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer' }}>
                  {showPw[field]?<EyeOff size={14}/>:<Eye size={14}/>}
                </button>
              </div>
              {field==='next'&&pwForm.next&&(
                <div style={{ marginTop:6 }}>
                  <div style={{ display:'flex',gap:3,marginBottom:4 }}>
                    {[1,2,3,4,5].map(i=><div key={i} style={{ flex:1,height:3,borderRadius:99,transition:'background 0.2s',background:i<=s?sColor:'rgba(255,255,255,0.08)' }}/>)}
                  </div>
                  <span style={{ fontSize:10,color:sColor,fontWeight:600 }}>{sLabel}</span>
                </div>
              )}
              {field==='confirm'&&pwForm.confirm&&pwForm.confirm!==pwForm.next&&(
                <p style={{ fontSize:10,color:'#ef4444',marginTop:4 }}>Passwords do not match.</p>
              )}
            </div>
          ))}
        </div>

        <button onClick={()=>{
          if(!pwForm.current) return show('Enter current password.','error');
          if(pwForm.next.length<8) return show('Min 8 characters.','error');
          if(pwForm.next!==pwForm.confirm) return show('Passwords do not match.','error');
          changePw.mutate();
        }} disabled={changePw.isPending||!pwForm.current||!pwForm.next||!pwForm.confirm} className="btn btn-primary">
          {changePw.isPending?<><RefreshCw size={13} className="animate-spin"/> Updating...</>:'Update Password'}
        </button>
      </div>

      {/* Sessions */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div style={{ width:32,height:32,borderRadius:9,background:'rgba(16,185,129,0.15)',display:'flex',alignItems:'center',justifyContent:'center' }}>
              <MonitorSmartphone size={15} color="#6ee7b7"/>
            </div>
            <div>
              <h2 className="text-sm font-bold text-ink-50">Active Sessions</h2>
              <p className="text-xs text-ink-400">Devices currently signed in</p>
            </div>
          </div>
          {(sessData?.sessions?.length||0)>1&&(
            <button onClick={()=>revokeAll.mutate()} disabled={revokeAll.isPending}
              className="btn btn-ghost text-xs" style={{ color:'#ef4444' }}>
              {revokeAll.isPending?'Revoking...':'Revoke All Others'}
            </button>
          )}
        </div>

        {loadingSess ? (
          <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-14 bg-ink-800 rounded-xl animate-pulse"/>)}</div>
        ) : !sessData?.sessions?.length ? (
          <div className="text-center py-6 text-ink-400 text-sm">No active sessions.</div>
        ) : sessData.sessions.map((s: any, idx: number)=>{
          const { label, icon } = formatUA(s.userAgent);
          const isCurrent = idx===0;
          return (
            <div key={s.id} style={{
              display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:12,marginBottom:8,
              background: isCurrent?'rgba(16,185,129,0.07)':'rgba(255,255,255,0.03)',
              border:`1px solid ${isCurrent?'rgba(16,185,129,0.2)':'rgba(255,255,255,0.06)'}`,
            }}>
              <span style={{ fontSize:20 }}>{icon}</span>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                  <span style={{ fontSize:12.5,fontWeight:600,color:'var(--text-primary)' }}>{label}</span>
                  {isCurrent&&<span style={{ fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:99,background:'rgba(16,185,129,0.2)',color:'#6ee7b7' }}>CURRENT</span>}
                </div>
                <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:2 }}>
                  {s.ipAddress} · Last active {new Date(s.lastUsedAt).toLocaleDateString()}
                </div>
              </div>
              {!isCurrent&&(
                <button onClick={()=>revokeOne.mutate(s.id)} disabled={revokeOne.isPending}
                  style={{ background:'none',border:'none',color:'#ef4444',cursor:'pointer',padding:6,borderRadius:7 }}>
                  <Trash2 size={13}/>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Danger zone */}
      <div className="card p-6" style={{ borderColor:'rgba(239,68,68,0.2)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div style={{ width:32,height:32,borderRadius:9,background:'rgba(239,68,68,0.12)',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <Shield size={15} color="#fca5a5"/>
          </div>
          <div>
            <h2 className="text-sm font-bold text-red-400">Danger Zone</h2>
            <p className="text-xs text-ink-400">Permanent, irreversible actions</p>
          </div>
        </div>

        {!showDelete ? (
          <button onClick={()=>setShowDelete(true)} className="btn text-xs"
            style={{ background:'rgba(239,68,68,0.1)',color:'#ef4444',border:'1px solid rgba(239,68,68,0.25)' }}>
            <Trash2 size={12}/> Delete Account
          </button>
        ) : (
          <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }}
            style={{ padding:16,borderRadius:12,background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)' }}>
            <p style={{ fontSize:12.5,color:'#fca5a5',marginBottom:12,lineHeight:1.6 }}>
              This will permanently delete your account, all projects, renders, and brand assets. This cannot be undone.
              Enter your current password to confirm.
            </p>
            <input className="form-input mb-3" type="password" placeholder="Current password to confirm"
              value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)} style={{ fontSize:12 }}/>
            <div style={{ display:'flex',gap:8 }}>
              <button onClick={()=>{ setShowDelete(false); setDeleteConfirm(''); }} className="btn btn-ghost text-xs">Cancel</button>
              <button onClick={()=>deleteAcct.mutate()} disabled={!deleteConfirm||deleteAcct.isPending}
                className="btn text-xs" style={{ background:'#ef4444',color:'#fff',border:'none' }}>
                {deleteAcct.isPending?'Deleting...':'🗑 Permanently Delete Account'}
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ── Defaults ──────────────────────────────────────────────────────────────────
const QUALITY_ITEMS = [
  { key:'quality_distortion_check', label:'Product Distortion Detection', desc:'Flag and auto-correct AI-distorted product imagery' },
  { key:'quality_logo_check',       label:'Logo Placement Validation',    desc:'Ensure logo safe zones are respected in all scenes' },
  { key:'quality_text_check',       label:'Text Overflow Checks',         desc:'Validate text fits within scene bounds and safe areas' },
  { key:'quality_color_check',      label:'Color Drift Detection',        desc:'Maintain brand color consistency across all scenes' },
  { key:'beat_sync_default',        label:'Beat-sync by Default',         desc:'Sync scene transitions to music BPM automatically' },
];
const RENDER_DEFAULTS = [
  { key:'default_aspect_ratio', label:'Default Aspect Ratio', options:['9:16','1:1','16:9'] },
  { key:'default_render_mode',  label:'Default Render Mode',  options:['2D Standard','2D Premium','2D Pro'] },
  { key:'default_voice_gender', label:'Default Voice',        options:['Female','Male','Neutral'] },
  { key:'default_resolution',   label:'Default Resolution',   options:['1080p','4K'] },
];

function DefaultsTab({ show }: { show:(t:string,k?:'success'|'error')=>void }) {
  const [prefs, setPrefs] = useState<Record<string,any>>({
    quality_distortion_check:true, quality_logo_check:true, quality_text_check:true,
    quality_color_check:false, beat_sync_default:true,
    default_aspect_ratio:'9:16', default_render_mode:'2D Standard',
    default_voice_gender:'Female', default_resolution:'1080p',
  });
  const [dirty, setDirty] = useState(false);

  const { data: prefsData } = useQuery({ queryKey:['user-prefs'], queryFn: userApi.getPreferences });
  useEffect(()=>{ if(prefsData && Object.keys(prefsData).length) { setPrefs(p=>({...p,...prefsData})); setDirty(false); } }, [prefsData]);

  const save = useMutation({
    mutationFn: (p:Record<string,any>)=>userApi.updatePreferences(p),
    onSuccess: ()=>{ show('Defaults saved.'); setDirty(false); },
    onError: ()=>show('Failed to save.','error'),
  });

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="text-sm font-bold text-ink-50 mb-1">Render Defaults</h2>
        <p className="text-xs text-ink-300 mb-5">Pre-fill Studio steps with your preferred settings</p>
        <div className="grid grid-cols-2 gap-4">
          {RENDER_DEFAULTS.map(item=>(
            <div key={item.key}>
              <label className="form-label">{item.label}</label>
              <select className="form-select" value={prefs[item.key]||item.options[0]}
                onChange={e=>{ setPrefs(p=>({...p,[item.key]:e.target.value})); setDirty(true); }}>
                {item.options.map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-bold text-ink-50 mb-1">Quality Controls</h2>
        <p className="text-xs text-ink-300 mb-5">Automatic validation checks applied to every render</p>
        {QUALITY_ITEMS.map((item,idx)=>(
          <div key={item.key} className="flex items-center justify-between py-3.5"
            style={{ borderBottom:idx<QUALITY_ITEMS.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
            <div>
              <div className="text-sm font-semibold text-ink-50">{item.label}</div>
              <div className="text-xs text-ink-400 mt-0.5">{item.desc}</div>
            </div>
            <button onClick={()=>{ setPrefs(p=>({...p,[item.key]:!p[item.key]})); setDirty(true); }}
              className={`toggle-track flex-shrink-0 ${prefs[item.key]?'on':''}`} style={{ marginLeft:16 }}>
              <div className="toggle-thumb"/>
            </button>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {dirty&&(
          <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:12 }}
            className="card p-4 flex items-center justify-between"
            style={{ background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)' }}>
            <span className="text-sm text-ink-100 font-medium">You have unsaved changes</span>
            <button onClick={()=>save.mutate(prefs)} disabled={save.isPending} className="btn btn-primary text-xs px-5">
              {save.isPending?<><RefreshCw size={12} className="animate-spin"/> Saving</>:'Save Changes'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
