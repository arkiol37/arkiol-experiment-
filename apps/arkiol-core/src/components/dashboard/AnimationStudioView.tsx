"use client";
// AnimationStudioView — Normal Ads + Cinematic Ads
// Plan-gated: canUseStudioVideo (Creator, Pro, Studio)

import React, { useState, useEffect, useRef } from "react";

const MODES = [
  { id: "Normal Ad",   tag: "Normal",   credits: 20, icon: "◫", color: "#4f8ef7", badge: "Standard",
    desc: "Smooth animated ad. Perfect for social feeds and direct-response campaigns.",
    features: ["Smooth motion","Typography animation","Brand color integration","Loop-ready output"] },
  { id: "Cinematic Ad",tag: "Cinematic", credits: 35, icon: "✦", color: "#4f8ef7", badge: "Premium",
    desc: "Premium cinematic quality with parallax depth and advanced lighting.",
    features: ["Parallax depth","Cinematic camera motion","Advanced lighting","4K quality export"] },
] as const;

const AD_FORMATS = [
  { id: "instagram_post",    label: "Instagram Post",  dims: "1080×1080" },
  { id: "instagram_story",   label: "Instagram Story", dims: "1080×1920" },
  { id: "youtube_thumbnail", label: "YouTube",          dims: "1280×720"  },
  { id: "facebook_post",     label: "Facebook Feed",   dims: "1200×630"  },
  { id: "twitter_post",      label: "Twitter / X",     dims: "1600×900"  },
  { id: "display_banner",    label: "Display Banner",  dims: "728×90"    },
];

const STYLES = [
  { id: "modern_minimal", label: "Modern Minimal", e: "◇" },
  { id: "bold_editorial", label: "Bold Editorial", e: "▣" },
  { id: "luxury_elegant", label: "Luxury Elegant", e: "✦" },
  { id: "playful_vibrant",label: "Playful Vibrant",e: "⬡" },
  { id: "corporate_clean",label: "Corporate Clean",e: "⊡" },
  { id: "retro_vintage",  label: "Retro Vintage",  e: "◎" },
];

const DURATIONS = [{ v: 6, l: "6s", n: "Quick" },{ v: 15, l: "15s", n: "Standard" },{ v: 30, l: "30s", n: "Full" },{ v: 60, l: "60s", n: "Long" }];
const STAGES   = ["Analysing brief…","Generating storyboard…","Rendering motion layers…","Compositing frames…","Applying brand identity…","Encoding output…","Finalising…"];

interface Asset { id: string; name: string; renderMode: string; duration: number; fileSize?: number; thumbnailUrl?: string; }

export function AnimationStudioView() {
  const [tab,     setTab]     = useState<"create"|"library">("create");
  const [mode,    setMode]    = useState<"Normal Ad"|"Cinematic Ad">("Normal Ad");
  const [format,  setFormat]  = useState(AD_FORMATS[0].id);
  const [prompt,  setPrompt]  = useState("");
  const [style,   setStyle]   = useState("modern_minimal");
  const [dur,     setDur]     = useState(15);
  const [genning, setGenning] = useState(false);
  const [prog,    setProg]    = useState(0);
  const [stage,   setStage]   = useState("");
  const [err,     setErr]     = useState<string|null>(null);
  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [libLoad, setLibLoad] = useState(false);
  const [gated,   setGated]   = useState(false);
  const poll = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    // Gate check: use /api/billing/status which returns plan-based canUseStudioVideo.
    // /api/capabilities only has infrastructure flags — canUseStudioVideo is never present there.
    // Using ===false caused undefined===false=false, meaning FREE users were never gated.
    // The correct check: gate if canUseStudioVideo is NOT true (false or missing → gated).
    fetch("/api/billing/status")
      .then(r => r.json())
      .then(d => {
        // Gate FREE users. canUseStudioVideo=true means Creator/Pro/Studio or founder bypass.
        if (d.canUseStudioVideo !== true) setGated(true);
      })
      .catch(() => setGated(true)); // fail-closed: if billing unreachable, show upgrade prompt
  }, []);

  useEffect(() => {
    if (tab !== "library") return;
    setLibLoad(true);
    fetch("/api/assets?limit=24").then(r=>r.json()).then(d=>{ setAssets(d.assets??[]); setLibLoad(false); }).catch(()=>setLibLoad(false));
  }, [tab]);

  const sm = MODES.find(m => m.id === mode)!;
  const sf = AD_FORMATS.find(f => f.id === format)!;

  async function generate() {
    if (!prompt.trim()) return;
    setGenning(true); setErr(null); setProg(0); setStage(STAGES[0]!);
    try {
      const res = await fetch("/api/generate", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ prompt, formats:[format], renderMode:mode, stylePreset:style, duration:dur, includeVideo:true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const jid = data.jobId; let si = 0;
      poll.current = setInterval(async () => {
        const r = await fetch(`/api/jobs?id=${jid}`).catch(()=>null);
        const d = r ? await r.json().catch(()=>({})) : {};
        const job = d.jobs?.[0] ?? d.job ?? null;
        if (!job) return;
        const p = job.progress ?? 0; setProg(p);
        const ns = Math.min(Math.floor(p/100*STAGES.length), STAGES.length-1);
        if (ns !== si) { si = ns; setStage(STAGES[si]!); }
        if (["COMPLETED","SUCCEEDED"].includes(job.status)) { clearInterval(poll.current); setGenning(false); setTab("library"); }
        else if (job.status === "FAILED") { clearInterval(poll.current); setGenning(false); setErr(job.error??"Failed"); }
      }, 2500);
    } catch(e:any) { setGenning(false); setErr(e.message); }
  }
  useEffect(() => () => clearInterval(poll.current), []);

  if (gated) return (
    <div className="ak-fade-in" style={{ padding:"clamp(32px, 6vw, 60px) clamp(18px, 5vw, 48px)", maxWidth:680, margin:"0 auto", textAlign:"center" }}>
      <div style={{ fontSize:52, marginBottom:20 }}>🎬</div>
      <h1 style={{ fontSize:28, fontFamily:"var(--font-display)", letterSpacing:"-0.04em", margin:"0 0 12px" }}>Animation Studio</h1>
      <p style={{ fontSize:14, color:"var(--text-secondary)", lineHeight:1.7, marginBottom:32 }}>
        Generate Normal Ads and Cinematic Ads from a single prompt.<br/>Available on <strong>Creator, Pro, and Studio</strong> plans.
      </p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:12, marginBottom:32, textAlign:"left" }}>
        {[["◫","Normal Ads","Smooth animated ads — 20 credits"],["✦","Cinematic Ads","Parallax depth & lighting — 35 credits"],["🎨","Auto brand integration","Applies your brand kit"],["📐","All ad formats","Posts, stories, banners & more"]].map(([icon,label,desc])=>(
          <div key={String(label)} className="ak-card" style={{ padding:"16px 18px" }}>
            <span style={{ fontSize:22 }}>{icon}</span>
            <div style={{ fontSize:13, fontWeight:600, margin:"8px 0 3px" }}>{label}</div>
            <div style={{ fontSize:12, color:"var(--text-muted)" }}>{desc}</div>
          </div>
        ))}
      </div>
      <a href="/billing" className="ak-btn ak-btn-primary" style={{ padding:"12px 32px", fontSize:14 }}>Upgrade to unlock Animation Studio →</a>
      <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:12 }}>From $25/month · Cancel anytime</p>
    </div>
  );

  return (
    <div className="ak-fade-in" style={{ padding:"clamp(22px, 4vw, 36px) clamp(16px, 4vw, 44px)", maxWidth:1200, margin:"0 auto", width:"100%" }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:32, gap:16, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ margin:0, fontSize:28, fontFamily:"var(--font-display)", letterSpacing:"-0.045em" }}>🎬 Animation Studio</h1>
          <p style={{ margin:"5px 0 0", fontSize:13, color:"var(--text-secondary)" }}>Generate Normal Ads or Cinematic Ads from a single prompt</p>
        </div>
        <div style={{ display:"flex", background:"var(--bg-elevated)", borderRadius:"var(--radius-md)", border:"1px solid var(--border-strong)", overflow:"hidden" }}>
          {(["create","library"] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{ padding:"8px 20px", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, background:tab===t?"var(--accent-tint-md)":"transparent", color:tab===t?"var(--accent-light)":"var(--text-secondary)", fontFamily:"var(--font-body)", borderRight:t==="create"?"1px solid var(--border-strong)":"none" }}>
              {t==="create"?"✦ Create":"◫ Library"}
            </button>
          ))}
        </div>
      </div>

      {tab === "create" ? (
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) minmax(300px, 360px)", gap:24, alignItems:"start" }} className="ak-studio-layout">
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

            {/* Mode picker */}
            <div className="ak-card ak-card-elevated" style={{ padding:24 }}>
              <div className="ak-label" style={{ marginBottom:14 }}>Generation Mode</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:12 }}>
                {MODES.map(m=>(
                  <button key={m.id} onClick={()=>setMode(m.id)} disabled={genning} style={{ padding:16, borderRadius:"var(--radius-lg)", border:`2px solid ${mode===m.id?m.color:"var(--border-strong)"}`, background:mode===m.id?`${m.color}12`:"transparent", cursor:"pointer", textAlign:"left", fontFamily:"var(--font-body)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                      <span style={{ fontSize:22 }}>{m.icon}</span>
                      <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:m.color, background:`${m.color}18`, border:`1px solid ${m.color}30`, padding:"2px 7px", borderRadius:"var(--radius-full)" }}>{m.badge}</span>
                    </div>
                    <div style={{ fontSize:14, fontWeight:700, color:mode===m.id?m.color:"var(--text-primary)", marginBottom:4 }}>{m.id}</div>
                    <div style={{ fontSize:11.5, color:"var(--text-muted)", lineHeight:1.5, marginBottom:10 }}>{m.desc}</div>
                    {m.features.map(f=><div key={f} style={{ display:"flex", gap:5, fontSize:11, color:"var(--text-secondary)", marginBottom:3 }}><span style={{ color:m.color }}>✓</span>{f}</div>)}
                    <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${m.color}20`, fontSize:13, fontWeight:700, color:m.color }}>{m.credits} credits / generation</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="ak-card ak-card-elevated" style={{ padding:24 }}>
              <div className="ak-label" style={{ marginBottom:10 }}>Creative Brief</div>
              <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={genning} className="ak-input"
                placeholder={`e.g. "Luxury skincare launch — deep navy, gold particles, product hero reveal. Tagline: Glow Beyond Ordinary."`}
                style={{ resize:"vertical", minHeight:96, fontFamily:"var(--font-body)", marginBottom:10 }} />
              <div className="ak-label" style={{ marginBottom:8 }}>Quick prompts</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {["Product launch with dramatic reveal","Flash sale — urgency & energy","Brand awareness, elegant & minimal","App download CTA, mobile-first"].map(p=>(
                  <button key={p} onClick={()=>setPrompt(p)} disabled={genning} style={{ padding:"5px 12px", fontSize:11.5, borderRadius:"var(--radius-full)", background:"var(--accent-tint)", color:"var(--accent-light)", border:"1px solid var(--border-accent)", cursor:"pointer", fontFamily:"var(--font-body)" }}>{p}</button>
                ))}
              </div>
            </div>

            {/* Format + Style */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:16 }}>
              <div className="ak-card ak-card-elevated" style={{ padding:24 }}>
                <div className="ak-label" style={{ marginBottom:10 }}>Ad Format</div>
                {AD_FORMATS.map(f=>(
                  <button key={f.id} onClick={()=>setFormat(f.id)} disabled={genning} style={{ width:"100%", padding:"8px 12px", borderRadius:"var(--radius-md)", border:`1px solid ${format===f.id?"var(--border-accent)":"var(--border-strong)"}`, background:format===f.id?"var(--accent-tint-md)":"transparent", cursor:"pointer", fontFamily:"var(--font-body)", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                    <span style={{ fontSize:12.5, fontWeight:500, color:format===f.id?"var(--accent-light)":"var(--text-primary)" }}>{f.label}</span>
                    <span style={{ fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{f.dims}</span>
                  </button>
                ))}
              </div>
              <div className="ak-card ak-card-elevated" style={{ padding:24 }}>
                <div className="ak-label" style={{ marginBottom:10 }}>Style Preset</div>
                {STYLES.map(s=>(
                  <button key={s.id} onClick={()=>setStyle(s.id)} disabled={genning} style={{ width:"100%", padding:"8px 12px", borderRadius:"var(--radius-md)", border:`1px solid ${style===s.id?"var(--border-accent)":"var(--border-strong)"}`, background:style===s.id?"var(--accent-tint-md)":"transparent", cursor:"pointer", fontFamily:"var(--font-body)", textAlign:"left", display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <span style={{ fontSize:14 }}>{s.e}</span>
                    <span style={{ fontSize:12, fontWeight:500, color:style===s.id?"var(--accent-light)":"var(--text-primary)" }}>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div className="ak-card ak-card-elevated" style={{ padding:24 }}>
              <div className="ak-label" style={{ marginBottom:14 }}>Ad Duration</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(90px, 1fr))", gap:10 }}>
                {DURATIONS.map(d=>(
                  <button key={d.v} onClick={()=>setDur(d.v)} disabled={genning} style={{ flex:1, padding:"12px 8px", borderRadius:"var(--radius-md)", border:`1px solid ${dur===d.v?"var(--border-accent)":"var(--border-strong)"}`, background:dur===d.v?"var(--accent-tint-md)":"transparent", cursor:"pointer", fontFamily:"var(--font-body)", textAlign:"center" }}>
                    <div style={{ fontSize:18, color:dur===d.v?"var(--accent-light)":"var(--text-primary)", fontFamily:"var(--font-display)", letterSpacing:"-0.03em" }}>{d.l}</div>
                    <div style={{ fontSize:10.5, color:"var(--text-muted)", marginTop:3 }}>{d.n}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: preview + generate */}
          <div className="ak-studio-sidebar" style={{ display:"flex", flexDirection:"column", gap:14, position:"sticky", top:20, minWidth:0 }}>
            <div className="ak-card ak-card-elevated" style={{ padding:0, overflow:"hidden" }}>
              <div style={{ aspectRatio:"16/9", maxHeight:240, background:"var(--bg-overlay)", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse at 30% 40%,${sm.color}28,transparent 60%)` }} />
                {genning ? (
                  <div style={{ textAlign:"center", position:"relative", zIndex:1 }}>
                    <div style={{ fontSize:32, marginBottom:10 }} className="ak-spin">{sm.icon}</div>
                    <div style={{ fontSize:13, fontWeight:600, color:"var(--text-primary)", marginBottom:8 }}>{stage}</div>
                    <div style={{ width:140, margin:"0 auto" }}><div className="ak-progress"><div className="ak-progress-fill" style={{ width:`${prog}%` }}/></div></div>
                    <div style={{ fontSize:12, color:"var(--accent-light)", marginTop:6, fontFamily:"var(--font-mono)" }}>{prog}%</div>
                  </div>
                ) : (
                  <div style={{ textAlign:"center", position:"relative", zIndex:1 }}>
                    <div style={{ fontSize:40, marginBottom:8 }}>{sm.icon}</div>
                    <div style={{ fontSize:12, color:"var(--text-muted)" }}>Preview after generation</div>
                  </div>
                )}
              </div>
              <div style={{ padding:"12px 16px" }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{sm.id} · {sf.label}</div>
                <div style={{ fontSize:11.5, color:"var(--text-muted)", marginTop:2 }}>{dur}s · {sf.dims} · {sm.tag}</div>
              </div>
            </div>

            <div style={{ background:"var(--accent-tint-md)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-lg)", padding:"12px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:12, color:"var(--text-secondary)", marginBottom:2 }}>Credit cost</div>
                <div style={{ fontSize:11, color:"var(--text-muted)" }}>{mode==="Cinematic Ad"?"Cinematic rendering":"Standard rendering"}</div>
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                <span style={{ fontSize:28, fontFamily:"var(--font-display)", color:"var(--accent-light)", letterSpacing:"-0.05em" }}>{sm.credits}</span>
                <span style={{ fontSize:12, color:"var(--text-muted)" }}>credits</span>
              </div>
            </div>

            {err && <div className="ak-toast ak-toast-error"><span>⚠</span><span>{err}</span></div>}

            <button onClick={generate} disabled={genning||!prompt.trim()} className="ak-btn ak-btn-primary" style={{ padding:"13px", fontSize:15, width:"100%", background:`linear-gradient(135deg,${sm.color},${sm.color}cc)` }}>
              {genning ? <span style={{ display:"flex", alignItems:"center", gap:8 }}><span className="ak-spin" style={{ width:15, height:15, border:"2px solid rgba(255,255,255,.3)", borderTopColor:"#fff", borderRadius:"50%", display:"inline-block" }}/>Generating…</span> : `${sm.icon} Generate ${sm.id}`}
            </button>

            <div className="ak-card ak-card-elevated" style={{ padding:"16px 18px" }}>
              <div className="ak-label" style={{ marginBottom:10 }}>Pro tips</div>
              {["Include product name and key benefit","Mention your target audience","Specify colors or mood for style guidance",mode==="Cinematic Ad"?"Cinematic shines with premium brand positioning":"Normal Ads excel at direct-response campaigns"].map((t,i)=>(
                <div key={i} style={{ display:"flex", gap:8, marginBottom:7, fontSize:12.5, color:"var(--text-secondary)", alignItems:"flex-start", lineHeight:1.5 }}>
                  <span style={{ color:sm.color, flexShrink:0, marginTop:1 }}>✦</span>{t}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
            <p style={{ fontSize:13, color:"var(--text-muted)", margin:0 }}>{assets.length} video ad{assets.length!==1?"s":""} generated</p>
            <button onClick={()=>setTab("create")} className="ak-btn ak-btn-primary">🎬 Create New</button>
          </div>
          {libLoad ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
              {Array.from({length:6}).map((_,i)=><div key={i} className="ak-shimmer" style={{ borderRadius:"var(--radius-xl)", aspectRatio:"16/9" }}/>)}
            </div>
          ) : assets.length===0 ? (
            <div style={{ textAlign:"center", padding:"60px 24px", background:"var(--bg-elevated)", borderRadius:"var(--radius-2xl)", border:"1px dashed var(--border-strong)" }}>
              <div style={{ fontSize:44, marginBottom:14 }}>🎬</div>
              <h3 style={{ fontSize:18, fontFamily:"var(--font-display)", margin:"0 0 8px" }}>No video ads yet</h3>
              <p style={{ color:"var(--text-muted)", fontSize:13, maxWidth:300, margin:"0 auto 22px" }}>Create your first Normal or Cinematic ad above.</p>
              <button onClick={()=>setTab("create")} className="ak-btn ak-btn-primary">🎬 Create Video Ad</button>
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
              {assets.map(a=>(
                <div key={a.id} className="ak-gallery-card">
                  <div style={{ aspectRatio:"16/9", background:"var(--bg-overlay)", position:"relative", overflow:"hidden" }}>
                    {a.thumbnailUrl?<img src={a.thumbnailUrl} alt={a.name} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>:<div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", fontSize:32 }}>🎬</div>}
                    <div style={{ position:"absolute", top:8, left:8 }}><span style={{ background:"rgba(0,0,0,.7)", color:"#fff", fontSize:9.5, fontWeight:700, padding:"2px 8px", borderRadius:99, backdropFilter:"blur(4px)" }}>{a.renderMode==="Cinematic Ad"?"Cinematic":"Normal"}</span></div>
                    <div className="ak-gallery-overlay">
                      <a href={`/api/assets/${a.id}/download`} className="ak-btn ak-btn-primary ak-btn-sm" style={{ fontSize:11 }}>↓ Download</a>
                      <a href={`/editor?assetId=${a.id}`} className="ak-btn ak-btn-secondary ak-btn-sm" style={{ fontSize:11 }}>✎ Edit</a>
                    </div>
                  </div>
                  <div style={{ padding:"12px 14px" }}>
                    <div style={{ fontSize:12.5, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</div>
                    <div style={{ fontSize:11.5, color:"var(--text-muted)", marginTop:3 }}>{a.duration}s · {a.renderMode}{a.fileSize?` · ${(a.fileSize/1024/1024).toFixed(1)} MB`:""}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
