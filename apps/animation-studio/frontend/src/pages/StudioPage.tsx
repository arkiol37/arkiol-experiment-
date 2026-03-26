import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft, Play } from 'lucide-react';
import { projectsApi, rendersApi, brandAssetsApi } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { v4 as uuidv4 } from 'uuid';

// ── Platform & placement data (mirrors backend platformSpecs.ts) ─────────────
type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';
type AspectRatio = '9:16' | '1:1' | '16:9';

interface PlacementInfo {
  id: string;
  label: string;
  platform: Platform;
  aspectRatio: AspectRatio;
  icon: string;
  maxSec: number;
  recommendedScenes: number;
  secPerScene: number;
  tip: string;
}

const PLACEMENTS: PlacementInfo[] = [
  { id: 'youtube_instream',  label: 'In-Stream Ad',   platform: 'youtube',   aspectRatio: '16:9', icon: '▶️',  maxSec: 60,  recommendedScenes: 5, secPerScene: 7,  tip: 'Skip-proof hook in first 5s' },
  { id: 'youtube_shorts',    label: 'Shorts',         platform: 'youtube',   aspectRatio: '9:16', icon: '📱',  maxSec: 60,  recommendedScenes: 5, secPerScene: 7,  tip: 'Hook in first 2s, Gen-Z energy' },
  { id: 'facebook_feed',     label: 'Feed',           platform: 'facebook',  aspectRatio: '16:9', icon: '📰',  maxSec: 240, recommendedScenes: 5, secPerScene: 7,  tip: 'Silent-first design, bold captions' },
  { id: 'facebook_reel',     label: 'Reels',          platform: 'facebook',  aspectRatio: '9:16', icon: '🎬',  maxSec: 60,  recommendedScenes: 5, secPerScene: 7,  tip: 'Dynamic transitions, lifestyle feel' },
  { id: 'facebook_story',    label: 'Story',          platform: 'facebook',  aspectRatio: '9:16', icon: '📖',  maxSec: 15,  recommendedScenes: 2, secPerScene: 6,  tip: 'Max 15s, instant visual impact' },
  { id: 'instagram_feed',    label: 'Feed',           platform: 'instagram', aspectRatio: '1:1',  icon: '📷',  maxSec: 60,  recommendedScenes: 4, secPerScene: 7,  tip: 'Square aesthetic, scroll-stopping beauty' },
  { id: 'instagram_reel',    label: 'Reels',          platform: 'instagram', aspectRatio: '9:16', icon: '🎥',  maxSec: 90,  recommendedScenes: 5, secPerScene: 7,  tip: 'Creator-native, hook in 1.5s' },
  { id: 'instagram_story',   label: 'Story',          platform: 'instagram', aspectRatio: '9:16', icon: '📲',  maxSec: 15,  recommendedScenes: 2, secPerScene: 6,  tip: 'Max 15s, swipe-up CTA' },
  { id: 'tiktok_feed',       label: 'In-Feed',        platform: 'tiktok',    aspectRatio: '9:16', icon: '🎵',  maxSec: 60,  recommendedScenes: 5, secPerScene: 7,  tip: 'Hook in 1s, native TikTok feel' },
  { id: 'tiktok_topview',    label: 'TopView',        platform: 'tiktok',    aspectRatio: '9:16', icon: '⭐',  maxSec: 60,  recommendedScenes: 6, secPerScene: 8,  tip: 'Premium placement, cinematic open' },
];

const PLATFORM_META: Record<Platform, { label: string; color: string; bg: string }> = {
  youtube:   { label: 'YouTube',   color: '#FF0000', bg: 'rgba(255,0,0,0.12)' },
  facebook:  { label: 'Facebook',  color: '#1877F2', bg: 'rgba(24,119,242,0.12)' },
  instagram: { label: 'Instagram', color: '#E1306C', bg: 'rgba(225,48,108,0.12)' },
  tiktok:    { label: 'TikTok',    color: '#ffffff', bg: 'rgba(255,255,255,0.08)' },
};

const MOODS = ['Luxury','Energetic','Minimal','Playful','Cinematic','Emotional','Corporate','Bold','Calm','Tech'];
const MOOD_ICONS: Record<string, string> = { Luxury:'💎',Energetic:'⚡',Minimal:'◻️',Playful:'🎉',Cinematic:'🎬',Emotional:'💫',Corporate:'🏢',Bold:'🔥',Calm:'🌊',Tech:'🤖' };
const HOOK_TYPES = ['Pain-Point','Curiosity Gap','Bold Claim','Social Proof','Direct Offer'];
const MUSIC_STYLES = ['🎵 Mood-aligned (auto)','🎸 Upbeat Corporate','🌙 Cinematic Ambient','⚡ High Energy EDM'];
// ── Canonical credit costs — match packages/shared/src/plans.ts CREDIT_COSTS ──
// Normal Ads (2D): 20 credits  |  Cinematic Ads (2.5D): 35 credits
// FREE tier: 1 free watermarked Normal Ad per day (no credits deducted)
const CREDIT_COSTS: Record<string, number> = {
  'Normal Ad':   20,   // 2D  — launch mode
  'Cinematic Ad': 35,  // 2.5D — launch mode
};

function buildPlatformScenePrompts(
  brief: string, brand: string, placement: PlacementInfo,
  mood: string, hookType: string, sceneCount: number
): Array<{ role: string; prompt: string; voiceoverScript: string; durationSec: number }> {
  const roles =
    sceneCount <= 2 ? ['hook', 'cta'] :
    sceneCount <= 3 ? ['hook', 'solution', 'cta'] :
    sceneCount <= 4 ? ['hook', 'problem', 'solution', 'cta'] :
    sceneCount <= 5 ? ['hook', 'problem', 'solution', 'proof', 'cta'] :
    sceneCount <= 6 ? ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'cta'] :
    ['hook','problem','solution','proof','proof','brand_reveal','offer','cta','close','end'].slice(0, sceneCount);

  const hookOpeners: Record<string, string> = {
    'Pain-Point':    `Are you tired of struggling with ${brief || 'the same problem'}?`,
    'Curiosity Gap': `What if there was a better way to ${brief || 'transform your results'}?`,
    'Bold Claim':    `${brand} is the only solution that actually ${brief || 'delivers results'}.`,
    'Social Proof':  `Join thousands who already trust ${brand}.`,
    'Direct Offer':  `Get started with ${brand} — free today.`,
  };

  const roleCopy: Record<string, { prompt: string; voice: string }> = {
    hook:         { prompt: `${hookOpeners[hookType] || hookOpeners['Pain-Point']} ${mood} mood. ${placement.tip}. Platform: ${placement.id}.`, voice: hookOpeners[hookType] || `Introducing ${brand}.` },
    problem:      { prompt: `Relatable problem scene — life without the solution. Empathetic ${mood.toLowerCase()} tone. ${placement.id} format.`, voice: `The old way just doesn't work anymore.` },
    solution:     { prompt: `${brand} solution reveal — product in action, transformation moment. ${mood} aesthetic. ${placement.tip}.`, voice: `${brand} changes everything.` },
    proof:        { prompt: `Social proof — happy customers, reviews, results. Trust-building ${mood.toLowerCase()} imagery. ${placement.id}.`, voice: `Thousands have already made the switch.` },
    brand_reveal: { prompt: `Cinematic ${brand} brand reveal. Logo animation, brand colors. ${mood} energy. ${placement.id}.`, voice: `${brand} — built for results.` },
    offer:        { prompt: `Limited-time offer. Urgency elements, value proposition. ${mood} style. ${placement.tip}.`, voice: `For a limited time — exclusive access now.` },
    cta:          { prompt: `CTA finale. ${brand} logo prominent, CTA button large. ${mood} peak energy. ${placement.tip}. ${placement.id}.`, voice: `Try ${brand} free today.` },
    close:        { prompt: `Brand closing shot. Logo lock-up, ${mood.toLowerCase()} fade. ${placement.id}.`, voice: `${brand} — start today.` },
    end:          { prompt: `End card with ${brand} logo. Clean ${mood.toLowerCase()} design.`, voice: `Visit us now.` },
  };

  return roles.map(role => ({
    role,
    prompt: roleCopy[role]?.prompt || `${brand} scene — ${mood} mood, ${placement.id} format.`,
    voiceoverScript: roleCopy[role]?.voice || `${brand}.`,
    durationSec: placement.secPerScene,
  }));
}

export default function StudioPage() {
  const { workspace } = useAuthStore();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStep, setGenStep] = useState('');

  const [brand, setBrand] = useState({ name: '', brief: '', industry: '' });
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [mood, setMood] = useState('Cinematic');
  const [adStyle, setAdStyle] = useState<'normal' | 'cinematic'>('normal');
  const [renderMode, setRenderMode] = useState('Normal Ad');
  const [resolution, setResolution] = useState<'1080p' | '4K'>('1080p');
  const [hookType, setHookType] = useState('Pain-Point');
  const [ctaText, setCtaText] = useState('Start Free Trial');
  const [scenes, setScenes] = useState<any[]>([]);
  const [voice, setVoice] = useState({ gender: 'Female', tone: 'Confident', accent: 'American English', speed: 'Normal' });
  const [music, setMusic] = useState({ style: '🎵 Mood-aligned (auto)', energyCurve: 'Build Up (calm → peak)', beatSync: true });

  // ── Brand Asset Integration ──────────────────────────────────
  const [selectedBrandAssets, setSelectedBrandAssets] = useState<string[]>([]);
  const [brandAssetPalette, setBrandAssetPalette] = useState<string[]>([]);
  const [assetSlots, setAssetSlots] = useState<Record<string, any>[]>([]);
  const [assetSearchQuery, setAssetSearchQuery] = useState('');

  const selectedPlacement = PLACEMENTS.find(p => p.id === selectedPlacementId) || null;
  const aspectRatio: AspectRatio = selectedPlacement?.aspectRatio || '16:9';
  const [sceneCount, setSceneCount] = useState(5);

  useEffect(() => {
    if (selectedPlacement) setSceneCount(selectedPlacement.recommendedScenes);
  }, [selectedPlacementId]);

  useEffect(() => {
    if (!selectedPlacement) return;
    setScenes(buildPlatformScenePrompts(brand.brief, brand.name || 'Your Brand', selectedPlacement, mood, hookType, sceneCount));
  }, [selectedPlacementId, sceneCount, mood, hookType, brand.name, brand.brief]);

  // Cinematic mode uses Premium Cinematic pricing regardless of renderMode selector
  const effectiveRenderMode = adStyle === 'cinematic' ? 'Cinematic Ad' : renderMode;
  // Credit calculation: per-generation cost (not per-scene for Studio video mode)
  // FREE plan: 1 free Normal Ad/day (watermarked). Backend enforces — frontend shows 0.
  const costPerGeneration = CREDIT_COSTS[effectiveRenderMode] ?? CREDIT_COSTS['Normal Ad'];
  const totalCredits = costPerGeneration;

  const createProject    = useMutation({ mutationFn: (d: any) => projectsApi.create(d) });
  const createStoryboard = useMutation({ mutationFn: ({ id, d }: any) => projectsApi.createStoryboard(id, d) });
  const createRender     = useMutation({ mutationFn: (d: any) => rendersApi.create(d) });

  const handleGenerate = useCallback(async () => {
    // FREE plan gets 1 free Normal Ad/day — backend enforces, frontend just lets it through
    const isFreeNormalAd = adStyle === 'normal' && (!workspace || workspace.plan === 'FREE' || workspace.plan === 'free');
    if (!isFreeNormalAd && (!workspace || workspace.creditsBalance < totalCredits)) {
      alert(`Insufficient credits. Need ${totalCredits}, have ${workspace?.creditsBalance || 0}.`);
      return;
    }
    if (!selectedPlacement) { alert('Select a platform first.'); setStep(2); return; }

    setGenerating(true);
    setGenProgress(0);

    const genSteps = [
      'Analyzing brand profile...',
      `Building ${selectedPlacement.label} ad architecture...`,
      'Generating platform-optimized scripts...',
      'Configuring mood & voice engine...',
      'Preparing render pipeline...',
    ];
    let stepIdx = 0;
    const timer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, genSteps.length - 1);
      setGenStep(genSteps[stepIdx]);
      setGenProgress(prev => Math.min(prev + 16, 90));
    }, 900);

    try {
      const project = await createProject.mutateAsync({
        name: `${brand.name || 'Campaign'} — ${selectedPlacement.label} — ${new Date().toLocaleDateString()}`,
        brief: brand.brief,
      });

      const storyboard = await createStoryboard.mutateAsync({
        id: project.project.id,
        d: {
          name: `${mood} ${selectedPlacement.label} Campaign`,
          config: { mood, aspectRatio, renderMode: effectiveRenderMode, resolution, placement: selectedPlacementId, platform: selectedPlatform, adStyle },
          sceneCount,
          secondsPerScene: selectedPlacement.secPerScene,
        },
      });

      const sceneData = scenes.map((s, i) => ({
        id: uuidv4(), position: i,
        prompt: s.prompt, voiceoverScript: s.voiceoverScript, role: s.role,
        timing: { durationSec: s.durationSec || selectedPlacement.secPerScene },
        visualConfig: {},
      }));

      clearInterval(timer);
      setGenProgress(94);
      setGenStep(`Queuing ${selectedPlacement.label} render...`);

      await createRender.mutateAsync({
        storyboardId: storyboard.id,
        scenes: sceneData,
        config: {
          aspectRatio, renderMode: effectiveRenderMode, resolution, mood, voice,
          music: { ...music },
          creditsToCharge: totalCredits,
          placement: selectedPlacementId,
          platform: selectedPlatform,
          hookType: hookType.toLowerCase().replace(/ /g, '_'),
          ctaText,
          adStyle,
          // Brand Asset Integration
          brandAssetIds: selectedBrandAssets,
          brandPalette: brandAssetPalette,
          assetSlots: Object.fromEntries(assetSlots.map((s: any) => [s.slotName, s.assetId])),
          hasBrandAssets: selectedBrandAssets.length > 0,
        },
        idempotencyKey: uuidv4(),
      });

      setGenProgress(100);
      setGenStep(`${selectedPlacement.label} ad queued ✓`);
      setTimeout(() => { setGenerating(false); navigate('/dashboard'); }, 1400);
    } catch (err: any) {
      clearInterval(timer);
      setGenerating(false);
      alert(err.response?.data?.error || err.message || 'Generation failed.');
    }
  }, [workspace, totalCredits, selectedPlacement, brand, mood, adStyle, effectiveRenderMode, renderMode, resolution,
      aspectRatio, sceneCount, scenes, voice, music, hookType, ctaText, selectedPlacementId, selectedPlatform]);

  const previewAspect: Record<AspectRatio, string> = { '9:16': 'aspect-[9/16]', '1:1': 'aspect-square', '16:9': 'aspect-video' };
  const TOTAL_STEPS = 6;
  const platforms: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok'];

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="page-title">New Ad Campaign</h1>
          <p className="page-subtitle">
            {selectedPlacement
              ? `${selectedPlacement.icon} ${PLATFORM_META[selectedPlacement.platform].label} ${selectedPlacement.label} · ${aspectRatio} · ${sceneCount} scenes · ${sceneCount * selectedPlacement.secPerScene}s`
              : 'AI Director builds your 2D ad video in 5 steps'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => (
            <div key={s} className="flex items-center gap-1">
              <button onClick={() => s < step && setStep(s)}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${s === step ? 'bg-gold-400 text-ink-900' : s < step ? 'bg-gold-400/30 text-gold-300 hover:bg-gold-400/40 cursor-pointer' : 'bg-ink-700 text-ink-300 cursor-default'}`}>
                {s}
              </button>
              {s < TOTAL_STEPS && <div className={`w-6 h-0.5 rounded ${s < step ? 'bg-gold-400/50' : 'bg-ink-700'}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        <AnimatePresence mode="wait">
          <motion.div key={step}
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>

            {/* STEP 1 */}
            {step === 1 && (
              <div className="card p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-xl bg-gold-400/15 flex items-center justify-center text-lg">🏢</div>
                  <div><div className="text-sm font-bold text-ink-50">Brand Profile</div><div className="text-xs text-ink-300">Tell the AI Director about your brand</div></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Brand Name</label>
                    <input className="form-input" placeholder="e.g. Acme Corp" value={brand.name} onChange={e => setBrand(b => ({ ...b, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Industry</label>
                    <select className="form-select" value={brand.industry} onChange={e => setBrand(b => ({ ...b, industry: e.target.value }))}>
                      {['','Tech / SaaS','E-commerce','Finance','Health & Wellness','Fashion','Food & Beverage','Real Estate','Education','Other'].map(o => <option key={o} value={o}>{o || 'Select industry...'}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label">Campaign Brief</label>
                  <textarea className="form-input resize-none h-28"
                    placeholder="Describe your product, target audience, and campaign goal. Include your unique selling point..."
                    value={brand.brief} onChange={e => setBrand(b => ({ ...b, brief: e.target.value }))} />
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={() => setStep(2)} className="btn btn-primary px-6">Next: Platform <ChevronRight size={14} /></button>
                </div>
              </div>
            )}

            {/* STEP 2: PLATFORM PICKER */}
            {step === 2 && (
              <div className="card p-6 space-y-5">
                <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-xl bg-gold-400/15 flex items-center justify-center text-lg">📡</div>
                  <div><div className="text-sm font-bold text-ink-50">Platform & Placement</div><div className="text-xs text-ink-300">Each platform gets its own optimised format, bitrate, and aspect ratio</div></div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {platforms.map(platform => {
                    const meta = PLATFORM_META[platform];
                    const platformPlacements = PLACEMENTS.filter(p => p.platform === platform);
                    const isActive = selectedPlatform === platform;
                    return (
                      <div key={platform}
                        style={isActive ? { borderColor: meta.color + 'AA', background: meta.bg } : {}}
                        className={`rounded-2xl border p-4 transition-all ${isActive ? '' : 'border-white/[0.06] bg-ink-800/50 hover:border-white/15'}`}>
                        <button onClick={() => { setSelectedPlatform(platform); setSelectedPlacementId(platformPlacements[0]?.id || null); }}
                          className="flex items-center gap-2 mb-3 w-full">
                          <span className="text-xl">{platformPlacements[0]?.icon}</span>
                          <span className="font-bold text-sm" style={isActive ? { color: meta.color } : { color: '#e0e0e0' }}>{meta.label}</span>
                          {isActive && <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: meta.color, color: platform === 'tiktok' ? '#000' : '#fff' }}>✓</span>}
                        </button>
                        <div className="space-y-1.5">
                          {platformPlacements.map(placement => {
                            const isSel = selectedPlacementId === placement.id;
                            return (
                              <button key={placement.id}
                                onClick={() => { setSelectedPlatform(platform); setSelectedPlacementId(placement.id); }}
                                style={isSel ? { borderColor: meta.color + 'AA', background: meta.color + '18' } : {}}
                                className={`w-full text-left px-3 py-2 rounded-xl border transition-all ${isSel ? 'text-ink-50' : 'border-white/[0.06] bg-ink-900/50 text-ink-300 hover:border-white/15'}`}>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold">{placement.icon} {placement.label}</span>
                                  <span className="text-[10px] text-ink-400 font-mono">{placement.aspectRatio}</span>
                                </div>
                                <div className="text-[10px] text-ink-400 mt-0.5">{placement.tip}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!selectedPlacementId && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-300">
                    ↑ Select a platform and placement to continue
                  </div>
                )}
                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(1)} className="btn btn-ghost"><ChevronLeft size={14} /> Back</button>
                  <button onClick={() => selectedPlacementId && setStep(3)} disabled={!selectedPlacementId}
                    className="btn btn-primary px-6 disabled:opacity-40 disabled:cursor-not-allowed">
                    Next: Creative <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: CREATIVE */}
            {step === 3 && (
              <div className="card p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-xl bg-gold-400/15 flex items-center justify-center text-lg">🎨</div>
                  <div><div className="text-sm font-bold text-ink-50">Mood & Creative Engine</div>
                    <div className="text-xs text-ink-300">{selectedPlacement ? `Optimising for ${selectedPlacement.label} (${aspectRatio}) · max ${selectedPlacement.maxSec}s` : 'Controls colour, pacing, and visual style'}</div></div>
                </div>
                <div>
                  <label className="form-label mb-2">Mood</label>
                  <div className="grid grid-cols-5 gap-2">
                    {MOODS.map(m => (
                      <button key={m} onClick={() => setMood(m)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${mood === m ? 'bg-gold-400/15 border-gold-400/40 text-gold-300' : 'bg-ink-800 border-white/[0.06] text-ink-200 hover:border-white/15'}`}>
                        <span className="text-xl">{MOOD_ICONS[m]}</span>
                        <span className="text-[10px] font-semibold">{m}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Ad Style</label>
                    <div className="flex flex-col gap-2">
                      {/* Normal Ad Option */}
                      <button
                        onClick={() => { setAdStyle('normal'); setRenderMode('Normal Ad'); }}
                        className={`relative flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${adStyle === 'normal' ? 'bg-ink-700 border-white/20 text-ink-50' : 'bg-ink-800 border-white/[0.06] text-ink-300 hover:border-white/15'}`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm mt-0.5 ${adStyle === 'normal' ? 'bg-white/10' : 'bg-white/[0.04]'}`}>⚡</div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold">Normal Ad</div>
                          <div className="text-[10px] text-ink-400 leading-snug mt-0.5">Fast 2D motion graphics. Optimised for volume.</div>
                        </div>
                        {adStyle === 'normal' && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-green-400" />}
                      </button>
                      {/* Cinematic Ad Option */}
                      <button
                        onClick={() => { setAdStyle('cinematic'); setRenderMode('Cinematic Ad'); }}
                        className={`relative flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${adStyle === 'cinematic' ? 'bg-gold-400/12 border-gold-400/40 text-gold-100' : 'bg-ink-800 border-white/[0.06] text-ink-300 hover:border-gold-400/20'}`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm mt-0.5 ${adStyle === 'cinematic' ? 'bg-gold-400/20' : 'bg-white/[0.04]'}`}>🎬</div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold flex items-center gap-1.5">
                            Cinematic Ad
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gold-400/20 text-gold-300 uppercase tracking-wide">Premium</span>
                          </div>
                          <div className="text-[10px] text-ink-400 leading-snug mt-0.5">2.5D parallax depth · camera moves · cinematic grade</div>
                        </div>
                        {adStyle === 'cinematic' && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-gold-400" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    {adStyle === 'normal' ? (
                      <div>
                        <label className="form-label">Render Mode</label>
                        <select className="form-select" value={renderMode} onChange={e => setRenderMode(e.target.value)}>
                          <option value="Normal Ad">Normal Ad ({CREDIT_COSTS['Normal Ad']} cr)</option>
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="form-label">Cinematic Features</label>
                        <div className="space-y-1.5">
                          {['2.5D depth layers', 'Camera movement', 'Depth-of-field blur', 'Film color grade', 'Atmospheric vignette'].map(f => (
                            <div key={f} className="flex items-center gap-2 text-[10px] text-gold-200">
                              <div className="w-3 h-3 rounded-full bg-gold-400/30 flex items-center justify-center flex-shrink-0">
                                <div className="w-1.5 h-1.5 rounded-full bg-gold-400" />
                              </div>
                              {f}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                  <div>
                    <label className="form-label">Resolution</label>
                    <div className="flex gap-2">
                      {(['1080p','4K'] as const).map(r => (
                        <button key={r} onClick={() => setResolution(r)}
                          className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all ${resolution === r ? 'bg-gold-400/15 border-gold-400/40 text-gold-300' : 'bg-ink-800 border-white/[0.06] text-ink-300 hover:border-white/15'}`}>
                          {r}{r === '4K' && ' +5cr'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="form-label flex justify-between">
                    Scenes
                    <span className="text-gold-300 font-mono">{sceneCount} · {sceneCount * (selectedPlacement?.secPerScene || 7)}s{selectedPlacement ? ` / ${selectedPlacement.maxSec}s max` : ''}</span>
                  </label>
                  <input type="range" min={1} max={selectedPlacement?.maxSec && selectedPlacement.maxSec <= 15 ? 2 : 10}
                    value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))}
                    className="w-full mt-2 accent-gold-400" />
                  {selectedPlacement?.maxSec && selectedPlacement.maxSec <= 15 && (
                    <p className="text-[10px] text-amber-400 mt-1">Story/short: max 2 scenes (platform limit {selectedPlacement.maxSec}s)</p>
                  )}
                </div>
                <div>
                  <label className="form-label">CTA Text</label>
                  <input className="form-input" value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="e.g. Start Free Trial, Shop Now" />
                </div>
                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(2)} className="btn btn-ghost"><ChevronLeft size={14} /> Back</button>
                  <button onClick={() => setStep(4)} className="btn btn-primary px-6">Next: Script <ChevronRight size={14} /></button>
                </div>
              </div>
            )}

            {/* STEP 4: SCRIPT */}
            {step === 4 && (
              <div className="card p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-xl bg-gold-400/15 flex items-center justify-center text-lg">📝</div>
                  <div><div className="text-sm font-bold text-ink-50">AI Script — {selectedPlacement?.label}</div><div className="text-xs text-ink-300">Review and edit your platform-optimised scene scripts</div></div>
                </div>
                <div>
                  <label className="form-label mb-2">Hook Psychology</label>
                  <div className="flex flex-wrap gap-2">
                    {HOOK_TYPES.map(h => <button key={h} onClick={() => setHookType(h)} className={`chip ${hookType === h ? 'active' : ''}`}>{h}</button>)}
                  </div>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {scenes.map((s, i) => (
                    <div key={i} className="p-3 bg-ink-800 rounded-xl border border-white/[0.06]">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-gold-400/15 text-gold-300 text-[10px] font-bold rounded-full uppercase">{s.role}</span>
                        <span className="text-[10px] text-ink-400">Scene {i + 1} · {s.durationSec || selectedPlacement?.secPerScene || 7}s</span>
                      </div>
                      <textarea className="form-input text-xs resize-none h-16 mb-2" value={s.prompt}
                        onChange={e => setScenes(sc => sc.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x))} />
                      <input className="form-input text-xs" placeholder="Voiceover script..." value={s.voiceoverScript}
                        onChange={e => setScenes(sc => sc.map((x, j) => j === i ? { ...x, voiceoverScript: e.target.value } : x))} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(3)} className="btn btn-ghost"><ChevronLeft size={14} /> Back</button>
                  <button onClick={() => setStep(5)} className="btn btn-primary px-6">Next: Brand Assets <ChevronRight size={14} /></button>
                </div>
              </div>
            )}

            {/* STEP 5: BRAND ASSETS */}
            {step === 5 && (
              <div className="card p-6 space-y-5">
                <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-xl bg-gold-400/15 flex items-center justify-center text-lg">🎨</div>
                  <div>
                    <div className="text-sm font-bold text-ink-50">Brand Assets</div>
                    <div className="text-xs text-ink-300">Select logos, products & visuals — AI weaves them into your ad automatically</div>
                  </div>
                  {selectedBrandAssets.length > 0 && (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-gold-400/15 text-gold-300 text-[10px] font-bold rounded-full">
                        {selectedBrandAssets.length} selected
                      </span>
                    </div>
                  )}
                </div>

                {/* Brand palette preview */}
                {brandAssetPalette.length > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-ink-800 rounded-xl border border-white/[0.06]">
                    <span className="text-[10px] text-ink-400 font-semibold whitespace-nowrap">Brand Colors</span>
                    <div className="flex gap-2">
                      {brandAssetPalette.map(hex => (
                        <div key={hex} title={hex} style={{ width: 20, height: 20, borderRadius: 5, background: hex, border: '1px solid rgba(255,255,255,0.2)' }} />
                      ))}
                    </div>
                    <span className="text-[10px] text-ink-500">Auto-extracted from your assets</span>
                  </div>
                )}

                {/* Asset slot assignments */}
                {assetSlots.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-ink-400 font-semibold uppercase tracking-wider mb-2">AI Scene Assignments</div>
                    {assetSlots.map((slot: any) => (
                      <div key={slot.sceneRole} className="flex items-center gap-3 p-2.5 bg-ink-800 rounded-xl border border-white/[0.06]">
                        <span className="px-2 py-0.5 bg-gold-400/15 text-gold-300 text-[9px] font-bold rounded-full uppercase">{slot.sceneRole}</span>
                        <span className="text-[10px] text-ink-300">{slot.slotName?.replace('_', ' ')}</span>
                        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold">✦ {slot.motion}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Asset picker */}
                <BrandAssetPicker
                  selected={selectedBrandAssets}
                  onSelect={async (ids) => {
                    setSelectedBrandAssets(ids);
                    if (ids.length > 0 && scenes.length > 0) {
                      try {
                        const sceneRoles = scenes.map((s: any) => s.role);
                        const result = await brandAssetsApi.resolveSlots(ids, sceneRoles);
                        setAssetSlots(result.slots || []);
                        setBrandAssetPalette(result.palette || []);
                      } catch {}
                    } else {
                      setAssetSlots([]);
                      setBrandAssetPalette([]);
                    }
                  }}
                />

                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(4)} className="btn btn-ghost"><ChevronLeft size={14} /> Back</button>
                  <button onClick={() => setStep(6)} className="btn btn-primary px-6">
                    Next: Voice & Music <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 6: VOICE & MUSIC */}
            {step === 6 && (
              <div className="card p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-xl bg-gold-400/15 flex items-center justify-center text-lg">🎤</div>
                  <div><div className="text-sm font-bold text-ink-50">Voice & Music Engine</div><div className="text-xs text-ink-300">AI voiceover + beat-sync music</div></div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="form-label">Voice Gender</label>
                      <div className="flex gap-2">
                        {['Male','Female','Neutral'].map(g => (
                          <button key={g} onClick={() => setVoice(v => ({ ...v, gender: g }))}
                            className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition-all ${voice.gender === g ? 'bg-gold-400/15 border-gold-400/40 text-gold-300' : 'bg-ink-800 border-white/[0.06] text-ink-300 hover:border-white/15'}`}>{g}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Voice Tone</label>
                      <div className="flex flex-wrap gap-2">
                        {['Confident','Calm','Energetic','Luxury'].map(t => <button key={t} onClick={() => setVoice(v => ({ ...v, tone: t }))} className={`chip ${voice.tone === t ? 'active' : ''}`}>{t}</button>)}
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Accent</label>
                      <select className="form-select" value={voice.accent} onChange={e => setVoice(v => ({ ...v, accent: e.target.value }))}>
                        {['American English','British English','Australian','Neutral International'].map(a => <option key={a}>{a}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Speed</label>
                      <div className="flex gap-2">
                        {['Slow','Normal','Fast','Very Fast'].map(sp => (
                          <button key={sp} onClick={() => setVoice(v => ({ ...v, speed: sp }))}
                            className={`flex-1 py-1.5 text-[10px] font-bold rounded-xl border transition-all ${voice.speed === sp ? 'bg-gold-400/15 border-gold-400/40 text-gold-300' : 'bg-ink-800 border-white/[0.06] text-ink-300 hover:border-white/15'}`}>{sp}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="form-label">Music Style</label>
                      <div className="space-y-1.5">
                        {MUSIC_STYLES.map(s => (
                          <button key={s} onClick={() => setMusic(m => ({ ...m, style: s }))}
                            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${music.style === s ? 'bg-gold-400/15 border-gold-400/40 text-gold-300' : 'bg-ink-800 border-white/[0.06] text-ink-200 hover:border-white/15'}`}>{s}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Energy Curve</label>
                      <select className="form-select" value={music.energyCurve} onChange={e => setMusic(m => ({ ...m, energyCurve: e.target.value }))}>
                        {['Build Up (calm → peak)','Constant High','Emotional Arc','Drop & Rise'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setMusic(m => ({ ...m, beatSync: !m.beatSync }))} className={`toggle-track ${music.beatSync ? 'on' : ''}`}><div className="toggle-thumb"/></button>
                      <span className="text-xs font-semibold text-ink-50">Beat-synced transitions</span>
                    </div>
                  </div>
                </div>
                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(5)} className="btn btn-ghost"><ChevronLeft size={14} /> Back</button>
                  <button onClick={handleGenerate} className="btn btn-primary px-8 py-3 text-sm shadow-gold-lg">
                    <Play size={14} /> Generate {selectedPlacement?.label || 'Campaign'} ✦
                  </button>
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>

        {/* RIGHT PANEL */}
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gold-300 uppercase tracking-wide">Ad Preview</span>
              {selectedPlacement && <span className="text-[10px] text-ink-400 font-mono">{aspectRatio}</span>}
            </div>
            <div className={`relative bg-ink-800 rounded-xl overflow-hidden ${previewAspect[aspectRatio]} max-h-64 flex items-center justify-center border border-white/[0.06]`}>
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-ink-950/80" />
              {selectedPlacement && (
                <div className="absolute top-2 left-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                    style={{ background: PLATFORM_META[selectedPlacement.platform].color, color: selectedPlacement.platform === 'tiktok' ? '#000' : '#fff' }}>
                    {selectedPlacement.icon} {selectedPlacement.label}
                  </span>
                </div>
              )}
              <div className="relative z-10 text-center p-4">
                <div className="text-xs font-black text-gold-300 mb-1 uppercase tracking-widest">{brand.name || 'Your Brand'}</div>
                <div className="text-[10px] text-ink-100 leading-relaxed max-w-[160px] mx-auto">
                  {brand.brief ? brand.brief.slice(0, 70) + (brand.brief.length > 70 ? '...' : '') : 'Your ad preview...'}
                </div>
                {ctaText && <div className="mt-3 inline-block px-3 py-1.5 bg-gold-400 text-ink-900 text-[10px] font-black rounded-lg">{ctaText}</div>}
              </div>
            </div>
            {sceneCount > 0 && (
              <div className="flex gap-1 mt-3">
                {Array.from({ length: sceneCount }).map((_, i) => (
                  <div key={i} className={`flex-1 h-1 rounded-full ${i === 0 ? 'bg-gold-400' : 'bg-ink-600'}`} />
                ))}
              </div>
            )}
          </div>

          <div className="card p-4">
            <div className="text-[10px] font-semibold text-ink-300 uppercase tracking-widest mb-1">Estimated Cost</div>
            <div className="text-3xl font-black font-mono text-ink-50 mb-0.5">{totalCredits} <span className="text-sm text-ink-300 font-normal">credits</span></div>
            <div className="text-xs text-ink-400 mb-3">{sceneCount} scenes · {adStyle === 'cinematic' ? '🎬 Cinematic Ad (2.5D)' : '⚡ Normal Ad (2D)'} · {selectedPlacement?.label || aspectRatio} · {resolution}</div>
            <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
              <div className="flex justify-between text-xs"><span className={`${adStyle === 'cinematic' ? 'text-gold-300' : 'text-ink-300'}`}>{adStyle === 'cinematic' ? '🎬 Cinematic Ad' : '⚡ Normal Ad'}</span><span className="font-mono text-ink-100">{totalCredits} cr</span></div>
              <div className="flex justify-between text-xs"><span className="text-ink-300">Voiceover</span><span className="font-mono text-ink-100">3 cr</span></div>
              <div className="flex justify-between text-xs"><span className="text-ink-300">Music License</span><span className="font-mono text-ink-100">1 cr</span></div>
              {resolution === '4K' && <div className="flex justify-between text-xs"><span className="text-ink-300">4K Upgrade</span><span className="font-mono text-ink-100">5 cr</span></div>}
              {selectedPlacement && <div className="flex justify-between text-xs"><span className="text-ink-300">Platform exports</span><span className="font-mono text-green-400">Free</span></div>}
            </div>
            {workspace && workspace.creditsBalance < totalCredits && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-400 font-medium">⚠ Need {totalCredits - workspace.creditsBalance} more credits</div>
            )}
          </div>

          {selectedPlacement && (
            <div className="card p-4">
              <div className="text-[10px] font-semibold text-ink-300 uppercase tracking-widest mb-2">You'll receive</div>
              <div className="space-y-1.5">
                {PLACEMENTS.filter(p => p.platform === selectedPlacement.platform).map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-xs">
                    <span className="text-green-400">✓</span>
                    <span className={p.id === selectedPlacementId ? 'text-ink-50 font-semibold' : 'text-ink-300'}>
                      {p.icon} {p.label} ({p.aspectRatio})
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-ink-400 mt-2">All {PLACEMENTS.filter(p => p.platform === selectedPlacement.platform).length} {PLATFORM_META[selectedPlacement.platform].label} formats included</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {generating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink-950/90 backdrop-blur-sm flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="card p-10 text-center max-w-sm w-full mx-4">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-2 border-gold-400/20 border-t-gold-400 animate-spin" />
                <div className="absolute inset-2 rounded-full border-2 border-gold-400/10 border-b-gold-400/60 animate-[spin_2s_linear_infinite_reverse]" />
                <div className="absolute inset-4 rounded-full bg-gold-400/10 flex items-center justify-center text-2xl">🎬</div>
              </div>
              <h3 className="text-lg font-bold text-ink-50 mb-1">AI Director is working</h3>
              {selectedPlacement && <p className="text-xs text-ink-400 mb-2">{selectedPlacement.icon} {PLATFORM_META[selectedPlacement.platform].label} — {selectedPlacement.label}</p>}
              <p className="text-sm text-ink-300 mb-5">{genStep}</p>
              <div className="progress-track mb-2">
                <motion.div className="progress-bar" animate={{ width: `${genProgress}%` }} transition={{ duration: 0.5 }} />
              </div>
              <span className="font-mono text-xs text-gold-400">{genProgress}%</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Brand Asset Picker (inline component for Studio Step 5) ───────────────

interface BrandAssetPickerProps {
  selected: string[];
  onSelect: (ids: string[]) => void;
}

function BrandAssetPicker({ selected, onSelect }: BrandAssetPickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['brand-assets-picker'],
    queryFn: () => brandAssetsApi.list({ readyOnly: true, limit: 40 }),
    staleTime: 30_000,
  });

  const assets = data?.assets || [];

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onSelect(selected.filter(x => x !== id));
    } else {
      onSelect([...selected, id]);
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square bg-ink-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="text-center py-10 border border-dashed border-white/[0.08] rounded-2xl">
        <div className="text-2xl mb-3">🎨</div>
        <div className="text-sm font-semibold text-ink-100 mb-1">No brand assets yet</div>
        <div className="text-xs text-ink-400 mb-4">Upload logos, products & visuals in the Brand Asset Library first</div>
        <button
          onClick={() => window.open('/library', '_blank')}
          className="btn btn-secondary text-xs px-4 py-2"
        >
          Open Asset Library ↗
        </button>
      </div>
    );
  }

  const TYPE_BADGES: Record<string, string> = {
    logo: '◈', product: '◉', screenshot: '▣', packaging: '⬡', pattern: '▦', icon: '◆', other: '○',
  };

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
        {assets.map((asset: any) => {
          const isSelected = selected.includes(asset.id);
          const thumb = asset.cutoutUrl || asset.thumbnailUrl || asset.cdnUrl;
          return (
            <motion.button
              key={asset.id}
              onClick={() => toggle(asset.id)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              style={{
                position: 'relative', aspectRatio: '1',
                border: `2px solid ${isSelected ? '#f59e0b' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 12, overflow: 'hidden',
                background: 'rgba(255,255,255,0.04)',
                boxShadow: isSelected ? '0 0 0 2px rgba(245,158,11,0.25)' : 'none',
                cursor: 'pointer',
              }}
            >
              {thumb ? (
                <img src={thumb} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 24, opacity: 0.3 }}>
                  {TYPE_BADGES[asset.assetType] || '○'}
                </div>
              )}
              {isSelected && (
                <div style={{
                  position: 'absolute', top: 5, right: 5, width: 18, height: 18,
                  borderRadius: '50%', background: '#f59e0b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CheckCircle2 size={11} color="#000" />
                </div>
              )}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '4px 5px', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                fontSize: 8, color: 'rgba(255,255,255,0.8)', fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {asset.name}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Color preview of selected assets */}
      {selected.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-[10px] text-ink-400">
          <span>{selected.length} asset{selected.length > 1 ? 's' : ''} selected</span>
          <span>·</span>
          <span>AI will inject into matching scenes automatically</span>
        </div>
      )}
    </div>
  );
}

// Import CheckCircle2 needed for BrandAssetPicker
import { CheckCircle2 } from 'lucide-react';

