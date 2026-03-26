import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../lib/api';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

export default function AuthPage({ mode: initialMode }: { mode?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode === 'reset' ? 'reset' : 'signin');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', company: '' });
  const { login, register } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      if (mode === 'signin') { await login(form.email, form.password); navigate('/dashboard'); }
      else if (mode === 'signup') { await register(form); navigate('/dashboard'); }
      else if (mode === 'forgot') { await authApi.forgotPassword(form.email); setSuccess('Check your inbox for a reset link.'); }
      else { await authApi.resetPassword(searchParams.get('token') || '', form.password); setSuccess('Password updated!'); setTimeout(() => setMode('signin'), 2000); }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  };

  const titles: Record<Mode, string> = { signin: 'Welcome back', signup: 'Start creating', forgot: 'Reset password', reset: 'New password' };
  const subs: Record<Mode, string> = { signin: 'Sign in to Arkiol', signup: 'Create your AI Brand Ad Studio', forgot: "We'll send a reset link", reset: 'Choose a secure password' };
  const btns: Record<Mode, string> = { signin: 'Sign In to Arkiol →', signup: 'Create Account — Free →', forgot: 'Send Reset Link', reset: 'Set New Password' };

  return (
    <div className="min-h-screen bg-ink-900 flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-gold-400/5 blur-3xl" />
        <div className="absolute top-1/3 -left-40 w-96 h-96 rounded-full bg-gold-600/3 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[420px] relative"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-gold-500 to-gold-700 text-ink-900 font-black text-2xl mb-4 shadow-gold-lg">
            N
          </div>
          <h1 className="font-display text-[28px] leading-tight text-ink-50">{titles[mode]}</h1>
          <p className="text-sm text-ink-200 mt-1">{subs[mode]}</p>
        </div>

        <div className="card p-6 shadow-xl border-white/[0.08]">
          {(mode === 'signin' || mode === 'signup') && (
            <div className="flex gap-1 mb-6 bg-ink-800 p-1 rounded-xl border border-white/[0.06]">
              {(['signin', 'signup'] as Mode[]).map(m => (
                <button key={m} onClick={() => { setMode(m); setError(''); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${mode === m ? 'bg-ink-600 text-ink-50 shadow' : 'text-ink-200 hover:text-ink-100'}`}>
                  {m === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-red-400 text-xs font-medium">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/25 rounded-xl text-green-400 text-xs font-medium">
              {success}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">First Name</label>
                  <input className="form-input" placeholder="Alex" value={form.firstName} onChange={setF('firstName')} required />
                </div>
                <div>
                  <label className="form-label">Last Name</label>
                  <input className="form-input" placeholder="Chen" value={form.lastName} onChange={setF('lastName')} required />
                </div>
              </div>
            )}

            {mode !== 'reset' && (
              <div>
                <label className="form-label">Email</label>
                <input className="form-input" type="email" placeholder="you@company.com" value={form.email} onChange={setF('email')} required />
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label className="form-label">Company <span className="text-ink-300 normal-case">(optional)</span></label>
                <input className="form-input" placeholder="Acme Corp" value={form.company} onChange={setF('company')} />
              </div>
            )}

            {mode !== 'forgot' && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="form-label mb-0">{mode === 'reset' ? 'New Password' : 'Password'}</label>
                  {mode === 'signin' && (
                    <button type="button" onClick={() => setMode('forgot')} className="text-xs text-gold-400 hover:text-gold-300 transition-colors">
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input className="form-input pr-10" type={showPw ? 'text' : 'password'} placeholder="••••••••" minLength={8} value={form.password} onChange={setF('password')} required />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-100 transition-colors">
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center py-3 mt-2">
              {loading
                ? <div className="w-4 h-4 border-2 border-ink-800/30 border-t-ink-900 rounded-full animate-spin" />
                : btns[mode]
              }
            </button>
          </form>

          {(mode === 'signin' || mode === 'signup') && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-white/[0.07]" />
                <span className="text-xs text-ink-300">or continue with</span>
                <div className="flex-1 h-px bg-white/[0.07]" />
              </div>
              <button className="w-full flex items-center justify-center gap-3 py-2.5 bg-ink-700 border border-white/10 rounded-xl text-sm font-semibold text-ink-50 hover:bg-ink-600 transition-all">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#4285F4" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#34A853" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
            </>
          )}

          {mode === 'forgot' && (
            <button onClick={() => setMode('signin')} className="mt-4 w-full text-center text-xs text-ink-300 hover:text-ink-100 transition-colors">
              ← Back to sign in
            </button>
          )}
        </div>

        <p className="text-center text-xs text-ink-300 mt-6">
          Trusted by <strong className="text-ink-100">5,000+</strong> brands and marketing agencies worldwide
        </p>
      </motion.div>
    </div>
  );
}
