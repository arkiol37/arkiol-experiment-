"use client";
// CanvasEditorShell — blank canvas Canva-like manual editor
// No AI generation required. Pick a preset and start designing.

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";

const ArkiolEditor = dynamic(
  () => import("../editor/ArkiolEditor").then(m => ({ default: m.default ?? m.ArkiolEditor })),
  { ssr: false, loading: () => <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", color:"var(--text-muted)", fontSize:14 }}>Loading editor…</div> }
);

const PRESETS = [
  { g: "Social Media", items: [
    { label:"Instagram Post",   w:1080, h:1080, icon:"📷", tag:"1:1"     },
    { label:"Instagram Story",  w:1080, h:1920, icon:"📱", tag:"9:16"    },
    { label:"Facebook Post",    w:1200, h:630,  icon:"👥", tag:"1.91:1"  },
    { label:"Twitter / X Post", w:1600, h:900,  icon:"🐦", tag:"16:9"    },
    { label:"LinkedIn Banner",  w:1584, h:396,  icon:"💼", tag:"4:1"     },
  ]},
  { g: "Video & Thumbnails", items: [
    { label:"YouTube Thumbnail",w:1280, h:720,  icon:"🎬", tag:"16:9"    },
    { label:"YouTube Banner",   w:2560, h:1440, icon:"📺", tag:"16:9"    },
    { label:"Widescreen 16:9",  w:1920, h:1080, icon:"🖥", tag:"16:9"    },
  ]},
  { g: "Print & Documents", items: [
    { label:"A4 Poster",        w:2480, h:3508, icon:"🖼️",tag:"A4"      },
    { label:"Letter Flyer",     w:2550, h:3300, icon:"📄", tag:"Letter"  },
    { label:"Business Card",    w:1050, h:600,  icon:"💳", tag:"CR80"    },
    { label:"Resume",           w:2550, h:3300, icon:"📋", tag:"Letter"  },
    { label:"A3 Poster",        w:3508, h:4961, icon:"🖼", tag:"A3"      },
  ]},
  { g: "Branding & Ads", items: [
    { label:"Square Logo",      w:1000, h:1000, icon:"✦",  tag:"1:1"     },
    { label:"Presentation",     w:1920, h:1080, icon:"📊", tag:"16:9"    },
    { label:"Email Header",     w:600,  h:200,  icon:"📧", tag:"3:1"     },
    { label:"Display Banner",   w:728,  h:90,   icon:"📐", tag:"728×90"  },
    { label:"Square Banner",    w:300,  h:250,  icon:"⬡",  tag:"Med Rect"},
  ]},
];

const BG_PRESETS = [
  { label:"Ivory",      v:"#f8f7f4" },
  { label:"White",      v:"#ffffff" },
  { label:"Peach",      v:"#fff5ee" },
  { label:"Lavender",   v:"#f3edff" },
  { label:"Sky",        v:"#e8f4fd" },
  { label:"Sage",       v:"#ecf3ed" },
  { label:"Deep Dark",  v:"#090909" },
  { label:"Coffee",     v:"#2c1810" },
  { label:"Sunset",     v:"linear-gradient(135deg,#f59e6b,#f472b6)" },
  { label:"Coral",      v:"linear-gradient(135deg,#ff6b6b,#ee5a24)" },
  { label:"Tropical",   v:"linear-gradient(135deg,#00b894,#fdcb6e)" },
  { label:"Aurora",     v:"linear-gradient(135deg,#7c5cbf,#e879f9)" },
];

const FEATURES = [
  "Layers panel","Drag & drop","Multi-page","Snap & grid","Rulers",
  "Gradient editor","Image crop & flip","AI text generation","Version history",
  "Find & replace","Comments & annotations","Blend modes","Drop shadows",
  "PNG / JPG / PDF export","Copy & paste style","Align & distribute",
];

function previewSize(w: number, h: number) {
  const mW = 76, mH = 46, r = w/h;
  return r > mW/mH ? { width:mW, height:Math.round(mW/r) } : { width:Math.round(mH*r), height:mH };
}

interface Cfg { label:string; w:number; h:number; bg:string; projectId:string; editorKey:string; }

export function CanvasEditorShell() {
  const [step,    setStep]    = useState<"pick"|"edit">("pick");
  const [cfg,     setCfg]     = useState<Cfg|null>(null);
  const [bg,      setBg]      = useState("#f8f7f4");
  const [cW,      setCW]      = useState(1080);
  const [cH,      setCH]      = useState(1080);
  const [showC,   setShowC]   = useState(false);

  function open(label:string, w:number, h:number) {
    const stableId = `canvas_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${w}x${h}_${Math.random().toString(36).slice(2, 10)}`;
    setCfg({ label, w, h, bg, projectId: stableId, editorKey: stableId });
    setStep("edit");
  }

  if (step === "edit" && cfg) {
    return (
      <div style={{ height:"100%", minHeight:0, display:"flex", flexDirection:"column" }}>
        <div style={{ height:44, display:"flex", alignItems:"center", gap:12, padding:"0 16px", borderBottom:"1px solid var(--border)", background:"var(--bg-surface)", flexShrink:0, zIndex:200 }}>
          <button onClick={()=>setStep("pick")} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"var(--text-muted)", background:"none", border:"none", cursor:"pointer", padding:"4px 8px", borderRadius:"var(--radius-sm)", fontFamily:"var(--font-body)" }}
            onMouseEnter={e=>(e.currentTarget.style.color="var(--text-primary)")}
            onMouseLeave={e=>(e.currentTarget.style.color="var(--text-muted)")}>
            ← New Canvas
          </button>
          <div style={{ width:1, height:16, background:"var(--border)" }}/>
          <span style={{ fontSize:12.5, fontWeight:600 }}>{cfg.label}</span>
          <span style={{ fontSize:11, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{cfg.w} × {cfg.h}px</span>
          <div style={{ flex:1 }}/>
          <span aria-label="Editing mode" style={{ fontSize:11, color:"var(--accent-light)", background:"var(--accent-tint)", padding:"2px 10px", borderRadius:"var(--radius-full)", border:"1px solid var(--border-accent)", cursor:"default", userSelect:"none" }}>Editor Mode</span>
        </div>
        <div style={{ flex:1, overflow:"hidden" }}>
          <ArkiolEditor
            key={cfg.editorKey}
            projectId={cfg.projectId}
            initialElements={[]}
            canvasWidth={cfg.w}
            canvasHeight={cfg.h}
            canvasBg={cfg.bg}
            readOnly={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="ak-fade-in ak-workspace-scroll" style={{ padding:"clamp(24px, 4vw, 40px) clamp(18px, 4vw, 48px)", maxWidth:1080, margin:"0 auto", width:"100%" }}>
      <div style={{ marginBottom:32 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8, flexWrap:"wrap" }}>
          <h1 style={{ margin:0, fontSize:28, fontFamily:"var(--font-display)", letterSpacing:"-0.045em" }}>Arkiol Canvas</h1>
          <span style={{ fontSize:11, fontWeight:700, background:"var(--accent-tint)", color:"var(--accent-light)", border:"1px solid var(--border-accent)", padding:"2px 10px", borderRadius:"var(--radius-full)", letterSpacing:"0.04em" }}>MANUAL EDITOR</span>
        </div>
        <p style={{ margin:0, fontSize:13.5, color:"var(--text-secondary)" }}>
          Start from a blank canvas — drag, drop, layer, style, and export with full control.
          <a href="/editor" style={{ marginLeft:10, color:"var(--accent-light)", fontSize:13 }}>Use AI to generate instead →</a>
        </p>
      </div>

      {/* Background picker */}
      <div style={{ marginBottom:28 }}>
        <div className="ak-label" style={{ marginBottom:10 }}>Canvas background</div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          {BG_PRESETS.map(b=>(
            <button key={b.label} onClick={()=>setBg(b.v)} title={b.label} style={{ width:34, height:34, borderRadius:"var(--radius-md)", background:b.v, cursor:"pointer", border:bg===b.v?"2.5px solid var(--accent)":"2px solid var(--border-strong)", outline:bg===b.v?"2px solid var(--bg-surface)":"none", outlineOffset:2, transition:"transform var(--transition-fast)" }}
              onMouseEnter={e=>(e.currentTarget.style.transform="scale(1.1)")}
              onMouseLeave={e=>(e.currentTarget.style.transform="")}/>
          ))}
          <label style={{ position:"relative", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", width:34, height:34, borderRadius:"var(--radius-md)", border:"2px dashed var(--border-strong)" }} title="Custom color">
            <span style={{ fontSize:14 }}>🎨</span>
            <input type="color" value={bg.startsWith("#")?bg:"#f8f7f4"} onChange={e=>setBg(e.target.value)} style={{ position:"absolute", width:0, height:0, opacity:0 }}/>
          </label>
        </div>
      </div>

      {/* Preset groups */}
      {PRESETS.map(group=>(
        <div key={group.g} style={{ marginBottom:28 }}>
          <div className="ak-label" style={{ marginBottom:10 }}>{group.g}</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:8 }}>
            {group.items.map(item=>{
              const ps = previewSize(item.w, item.h);
              return (
                <button key={item.label} onClick={()=>open(item.label, item.w, item.h)} style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:6, padding:"14px 16px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", cursor:"pointer", textAlign:"left", fontFamily:"var(--font-body)" }}
                  onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.borderColor="var(--border-accent)"; (e.currentTarget as HTMLElement).style.transform="translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow="var(--shadow-lift)"; }}
                  onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.borderColor="var(--border)"; (e.currentTarget as HTMLElement).style.transform=""; (e.currentTarget as HTMLElement).style.boxShadow=""; }}>
                  <div style={{ width:"100%", display:"flex", justifyContent:"center", marginBottom:4 }}>
                    <div style={{ ...ps, background:bg, borderRadius:3, border:"1px solid var(--border-strong)", display:"flex", alignItems:"center", justifyContent:"center", minWidth:20, minHeight:12 }}>
                      <span style={{ opacity:0.5, fontSize:12 }}>{item.icon}</span>
                    </div>
                  </div>
                  <div style={{ fontSize:12.5, fontWeight:600, color:"var(--text-primary)" }}>{item.label}</div>
                  <div style={{ fontSize:11, color:"var(--text-muted)", display:"flex", gap:5 }}>
                    <span>{item.tag}</span><span>·</span><span style={{ fontFamily:"var(--font-mono)", fontSize:10 }}>{item.w}×{item.h}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Custom size */}
      <div style={{ marginBottom:36 }}>
        <button onClick={()=>setShowC(v=>!v)} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:600, color:"var(--accent-light)", background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:"var(--font-body)" }}>
          {showC?"▾":"▸"} Custom canvas size
        </button>
        {showC && (
          <div style={{ marginTop:12, padding:"20px 24px", background:"var(--bg-elevated)", borderRadius:"var(--radius-lg)", border:"1px solid var(--border-strong)", display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap" }}>
            {([["Width", cW, setCW],["Height", cH, setCH]] as [string,number,(v:number)=>void][]).map(([label,val,setter])=>(
              <div key={label}>
                <div className="ak-label" style={{ marginBottom:6 }}>{label} (px)</div>
                <input type="number" value={val} onChange={e=>setter(Number(e.target.value))} min={100} max={8192} className="ak-input" style={{ width:130, textAlign:"center" }}/>
              </div>
            ))}
            <span style={{ fontSize:20, color:"var(--text-muted)", marginBottom:8 }}>×</span>
            <button onClick={()=>open("Custom Canvas", cW, cH)} className="ak-btn ak-btn-primary" style={{ padding:"9px 24px", marginBottom:1 }}>Open Canvas →</button>
          </div>
        )}
      </div>

      {/* Features strip */}
      <div style={{ padding:"20px 24px", background:"var(--accent-tint)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-xl)" }}>
        <div className="ak-label" style={{ marginBottom:12 }}>Editor includes</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"8px 20px" }}>
          {FEATURES.map(f=>(
            <div key={f} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"var(--text-secondary)" }}>
              <span style={{ color:"var(--accent-light)" }}>✓</span>{f}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CanvasEditorShell;
