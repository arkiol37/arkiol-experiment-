// src/components/marketing/LandingPage.tsx — Arkiol v21
// Full redesign: 150% denser, real product entry points, all buttons working
"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArkiolLogo } from "../ArkiolLogo";

const C = {
  bg:            "#06070d",
  bgSurface:     "#0b0d18",
  bgCard:        "rgba(255,255,255,0.034)",
  bgCardHov:     "rgba(255,255,255,0.056)",
  border:        "rgba(255,255,255,0.068)",
  accent:        "#4f8ef7",
  textPrimary:   "#eaedf5",
  textSecondary: "#737a96",
  textMuted:     "#3e4358",
};

const PLANS = [
  { name:"Free",    price:"$0",   tag:"Always free",     credits:"1 generation / day",    cta:"Get started",  h:false },
  { name:"Creator", price:"$25",  tag:"For individuals", credits:"500 credits / month",   cta:"Get started",  h:false },
  { name:"Pro",     price:"$79",  tag:"Most chosen",     credits:"1,700 credits / month", cta:"Get started",  h:true  },
  { name:"Studio",  price:"$249", tag:"For teams",       credits:"6,000 credits / month", cta:"Talk to us",   h:false },
];

const DEMO_PROMPTS = [
  "Luxury skincare campaign for summer launch...",
  "Cinematic automotive brand — midnight, motion...",
  "Premium real estate — architectural editorial...",
  "High-end fashion — minimal, monochromatic...",
];

// ─── 3D Icons ─────────────────────────────────────────────────────────────────
function Icon3DMegaphone({ size=40 }: { size?: number }) {
  const id = `meg${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id={`${id}bd`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#60a5fa"/><stop offset="40%" stopColor="#3b82f6"/><stop offset="100%" stopColor="#1d4ed8"/></linearGradient>
        <linearGradient id={`${id}bl`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#93c5fd"/><stop offset="50%" stopColor="#3b82f6"/><stop offset="100%" stopColor="#1e40af"/></linearGradient>
        <linearGradient id={`${id}sh`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#dbeafe" stopOpacity="0.8"/><stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.5"/></linearGradient>
        <filter id={`${id}f`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="3.5" floodColor="#1d4ed8" floodOpacity="0.4"/></filter>
      </defs>
      <g filter={`url(#${id}f)`}>
        <path d="M10 20 L19 15 L35 15 L35 33 L19 33 L10 28 Z" fill="#1e3a8a" opacity="0.55"/>
        <path d="M10 20 L10 28 L19 33 L19 15 Z" fill={`url(#${id}bd)`}/>
        <path d="M10 20 L19 15 L35 15 L35 17 L19 17 L10 22 Z" fill="#bfdbfe" opacity="0.5"/>
        <rect x="19" y="15" width="16" height="18" rx="1.5" fill={`url(#${id}bd)`}/>
        <rect x="19" y="15" width="16" height="5" rx="1.5" fill="#dbeafe" opacity="0.32"/>
        <path d="M35 14 L46 8 L46 36 L35 30 Z" fill={`url(#${id}bl)`}/>
        <path d="M35 14 L46 8 L46 11 L35 17 Z" fill="#dbeafe" opacity="0.45"/>
        <line x1="35" y1="14" x2="35" y2="30" stroke="#93c5fd" strokeWidth="1" opacity="0.55"/>
        <path d="M41 19 Q44 23 41 27" stroke="#bfdbfe" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9"/>
        <path d="M43 17 Q47.5 23 43 29" stroke="#93c5fd" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.55"/>
        <path d="M12 28 L16 28 L16 36 L12 36 Z" fill={`url(#${id}sh)`} opacity="0.75"/>
        <rect x="9" y="34" width="10" height="2" rx="1" fill="#1d4ed8" opacity="0.85"/>
      </g>
      <ellipse cx="24" cy="17" rx="4.5" ry="1.8" fill="white" opacity="0.22"/>
    </svg>
  );
}
function Icon3DDocument({ size=40 }: { size?: number }) {
  const id = `doc${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id={`${id}p`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#eff6ff"/><stop offset="60%" stopColor="#dbeafe"/><stop offset="100%" stopColor="#bfdbfe"/></linearGradient>
        <linearGradient id={`${id}pe`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#fbbf24"/><stop offset="50%" stopColor="#f59e0b"/><stop offset="100%" stopColor="#d97706"/></linearGradient>
        <linearGradient id={`${id}sp`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#c4b5fd"/><stop offset="100%" stopColor="#8b5cf6"/></linearGradient>
        <filter id={`${id}dr`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="3" floodColor="#1d4ed8" floodOpacity="0.28"/></filter>
      </defs>
      <g filter={`url(#${id}dr)`}>
        <rect x="11" y="8" width="26" height="34" rx="2.5" fill={`url(#${id}p)`}/>
        <rect x="11" y="8" width="26" height="3" rx="2" fill="white" opacity="0.55"/>
        <path d="M29 8 L37 8 L37 16 Z" fill="#93c5fd" opacity="0.45"/>
        <rect x="16" y="20" width="14" height="2.5" rx="1.2" fill="#93c5fd" opacity="0.65"/>
        <rect x="16" y="25" width="18" height="2" rx="1" fill="#bfdbfe" opacity="0.55"/>
        <rect x="16" y="29.5" width="16" height="2" rx="1" fill="#bfdbfe" opacity="0.55"/>
        <rect x="16" y="34" width="11" height="2" rx="1" fill="#bfdbfe" opacity="0.45"/>
        <g transform="rotate(-35, 38, 38)">
          <rect x="33" y="28" width="6" height="16" rx="1.5" fill={`url(#${id}pe)`}/>
          <rect x="33" y="27" width="6" height="3" rx="1.5" fill="#fef3c7"/>
          <path d="M34.5 44 L36 48 L37.5 44 Z" fill="#fbbf24"/>
        </g>
        <path d="M38 12 l1 2.5 2.5 1 -2.5 1 -1 2.5 -1 -2.5 -2.5 -1 2.5 -1 Z" fill={`url(#${id}sp)`} opacity="0.92"/>
      </g>
      <rect x="12" y="9" width="10" height="4" rx="1" fill="white" opacity="0.28"/>
    </svg>
  );
}
function Icon3DImageStudio({ size=40 }: { size?: number }) {
  const id = `img${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id={`${id}fr`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#a855f7"/><stop offset="50%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#5b21b6"/></linearGradient>
        <linearGradient id={`${id}sk`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#bae6fd"/><stop offset="100%" stopColor="#7dd3fc"/></linearGradient>
        <linearGradient id={`${id}m1`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#6ee7b7"/><stop offset="100%" stopColor="#059669"/></linearGradient>
        <linearGradient id={`${id}m2`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#047857"/></linearGradient>
        <linearGradient id={`${id}su`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#fde68a"/><stop offset="100%" stopColor="#f59e0b"/></linearGradient>
        <filter id={`${id}dr`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="4" floodColor="#5b21b6" floodOpacity="0.42"/></filter>
      </defs>
      <g filter={`url(#${id}dr)`}>
        <rect x="8" y="9" width="36" height="32" rx="3" fill={`url(#${id}fr)`}/>
        <rect x="11" y="12" width="30" height="26" rx="1.5" fill={`url(#${id}sk)`}/>
        <ellipse cx="20" cy="16" rx="5" ry="2" fill="white" opacity="0.65"/>
        <ellipse cx="32" cy="15" rx="4" ry="1.5" fill="white" opacity="0.48"/>
        <circle cx="36" cy="16" r="3" fill={`url(#${id}su)`}/>
        <path d="M11 32 L19 20 L27 30 L35 18 L41 30 L41 38 L11 38 Z" fill={`url(#${id}m1)`}/>
        <path d="M11 38 L18 26 L25 35 L33 23 L41 35 L41 38 Z" fill={`url(#${id}m2)`}/>
        <rect x="8" y="9" width="36" height="4" rx="2" fill="white" opacity="0.22"/>
      </g>
    </svg>
  );
}
function Icon3DVideo({ size=40 }: { size?: number }) {
  const id = `vid${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id={`${id}b`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#1f2937"/><stop offset="100%" stopColor="#111827"/></linearGradient>
        <linearGradient id={`${id}pl`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#4ade80"/><stop offset="100%" stopColor="#16a34a"/></linearGradient>
        <linearGradient id={`${id}sc`} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#0f172a"/><stop offset="100%" stopColor="#1e293b"/></linearGradient>
        <linearGradient id={`${id}s1`} x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f43f5e"/><stop offset="100%" stopColor="#e11d48"/></linearGradient>
        <filter id={`${id}dr`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="4" floodColor="#000" floodOpacity="0.48"/></filter>
      </defs>
      <g filter={`url(#${id}dr)`}>
        <rect x="7" y="22" width="38" height="24" rx="3" fill={`url(#${id}b)`}/>
        <rect x="10" y="25" width="32" height="18" rx="1.5" fill={`url(#${id}sc)`}/>
        <circle cx="26" cy="34" r="6" fill={`url(#${id}pl)`}/>
        <path d="M24 31 L30 34 L24 37 Z" fill="white"/>
        <rect x="7" y="13" width="38" height="10" rx="3" fill="#374151"/>
        {[0,1,2,3,4,5].map(i=>(
          <path key={i} d={`M${7+i*6.5} 13 L${7+i*6.5+5} 13 L${7+i*6.5+3} 23 L${7+i*6.5-2} 23 Z`} fill={i%2===0?`url(#${id}s1)`:"#f9fafb"} opacity="0.88"/>
        ))}
        <rect x="7" y="21.5" width="38" height="2.5" fill="#374151"/>
        <circle cx="38" cy="28" r="2" fill="#f43f5e"/>
      </g>
      <rect x="8" y="14" width="14" height="3" rx="1" fill="white" opacity="0.14"/>
    </svg>
  );
}
function Icon3DBrand({ size=40 }: { size?: number }) {
  const id = `brd${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id={`${id}p`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f8fafc"/><stop offset="100%" stopColor="#e2e8f0"/></linearGradient>
        <linearGradient id={`${id}c1`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f87171"/><stop offset="100%" stopColor="#dc2626"/></linearGradient>
        <linearGradient id={`${id}c2`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#fb923c"/><stop offset="100%" stopColor="#ea580c"/></linearGradient>
        <linearGradient id={`${id}c3`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#facc15"/><stop offset="100%" stopColor="#ca8a04"/></linearGradient>
        <linearGradient id={`${id}c4`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></linearGradient>
        <linearGradient id={`${id}c5`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#60a5fa"/><stop offset="100%" stopColor="#2563eb"/></linearGradient>
        <linearGradient id={`${id}c6`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#7c3aed"/></linearGradient>
        <filter id={`${id}dr`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="3.5" floodColor="#334155" floodOpacity="0.38"/></filter>
      </defs>
      <g filter={`url(#${id}dr)`}>
        <ellipse cx="24" cy="28" rx="19" ry="16" fill={`url(#${id}p)`}/>
        <ellipse cx="31" cy="36" rx="3" ry="2.2" fill="#f1f5f9"/>
        <circle cx="14" cy="22" r="4.5" fill={`url(#${id}c1)`}/>
        <circle cx="21" cy="16" r="4.5" fill={`url(#${id}c2)`}/>
        <circle cx="29" cy="14" r="4.5" fill={`url(#${id}c3)`}/>
        <circle cx="37" cy="17" r="4.5" fill={`url(#${id}c4)`}/>
        <circle cx="40" cy="26" r="4.5" fill={`url(#${id}c5)`}/>
        <circle cx="36" cy="34" r="4" fill={`url(#${id}c6)`}/>
        {[[14,20],[21,14],[29,12],[37,15],[40,24],[36,32]].map(([cx,cy],i)=>(
          <ellipse key={i} cx={cx-0.5} cy={cy} rx="1.8" ry="1.2" fill="white" opacity="0.42"/>
        ))}
        <ellipse cx="18" cy="20" rx="9" ry="5" fill="white" opacity="0.18"/>
      </g>
    </svg>
  );
}
function Icon3DBrain({ size=40 }: { size?: number }) {
  const id = `brn${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
      <defs>
        <linearGradient id={`${id}r`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#c4b5fd"/><stop offset="40%" stopColor="#8b5cf6"/><stop offset="100%" stopColor="#5b21b6"/></linearGradient>
        <linearGradient id={`${id}l`} x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#6d28d9"/></linearGradient>
        <linearGradient id={`${id}n`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#fde68a"/><stop offset="100%" stopColor="#f59e0b"/></linearGradient>
        <filter id={`${id}dr`} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="4.5" floodColor="#5b21b6" floodOpacity="0.48"/></filter>
        <filter id={`${id}ng`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.8" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter>
      </defs>
      <g filter={`url(#${id}dr)`}>
        <path d="M27 10 C38 10 44 16 44 26 C44 34 39 40 30 41 L27 41 Z" fill={`url(#${id}r)`}/>
        <path d="M25 10 C14 10 8 16 8 26 C8 34 13 40 22 41 L25 41 Z" fill={`url(#${id}l)`}/>
        <path d="M30 14 Q36 16 38 20" stroke="#e9d5ff" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.55"/>
        <path d="M32 20 Q40 22 41 28" stroke="#e9d5ff" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.45"/>
        <path d="M22 14 Q16 16 14 20" stroke="#c4b5fd" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.55"/>
        <path d="M20 20 Q12 22 11 28" stroke="#c4b5fd" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.45"/>
        {[[21,18],[31,16],[15,26],[37,24],[20,34],[32,33],[26,22]].map(([cx,cy],i)=>(
          <g key={i} filter={`url(#${id}ng)`}>
            <circle cx={cx} cy={cy} r="2.5" fill={`url(#${id}n)`} opacity="0.95"/>
          </g>
        ))}
        <path d="M22 41 Q26 44 30 41" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.75"/>
        <ellipse cx="26" cy="13" rx="9" ry="4" fill="white" opacity="0.18"/>
      </g>
    </svg>
  );
}

const MODULE_ICONS = [Icon3DMegaphone, Icon3DDocument, Icon3DImageStudio, Icon3DVideo, Icon3DBrand, Icon3DBrain];
const MODULE_BG = [
  "linear-gradient(145deg,#1e3a8a,#1e40af)",
  "linear-gradient(145deg,#3b0764,#4c1d95)",
  "linear-gradient(145deg,#2e1065,#4a1d96)",
  "linear-gradient(145deg,#111827,#1f2937)",
  "linear-gradient(145deg,#0c4a6e,#075985)",
  "linear-gradient(145deg,#2e1065,#5b21b6)",
];
const MODULE_ROUTES = ["/campaign-director", "/content-ai", "/gallery", "/gif-studio", "/brand", "/dashboard"];
const MODULES = [
  { name:"Ad Builder",   sub:"Instant ads & banners",  route:"/campaign-director" },
  { name:"Copy Engine",  sub:"AI-powered content",     route:"/content-ai" },
  { name:"Image Studio", sub:"Custom visuals",          route:"/gallery" },
  { name:"Video Maker",  sub:"Animated videos",         route:"/gif-studio" },
  { name:"Brand System", sub:"Logo & identity",         route:"/brand" },
  { name:"Intelligence", sub:"Marketing insights",      route:"/dashboard" },
];

// ─── Float cards ──────────────────────────────────────────────────────────────
function FloatCard({ children, style={}, delay=0 }: any) {
  return (
    <div style={{ position:"absolute", borderRadius:14, overflow:"hidden", background:C.bgSurface, border:`1px solid ${C.border}`, boxShadow:"0 20px 56px rgba(0,0,0,0.5),0 1px 0 rgba(255,255,255,0.07) inset", animation:"card-float 6s ease-in-out infinite", animationDelay:`${delay}s`, ...style }}>
      {children}
    </div>
  );
}

function MultiFormatCard() {
  const formats = [
    { label:"Story", w:28, h:50, active:true },
    { label:"Post", w:44, h:44, active:false },
    { label:"Banner", w:64, h:28, active:true },
    { label:"YouTube", w:50, h:28, active:false },
  ];
  return (
    <div style={{ width:"100%", height:"100%", background:"linear-gradient(145deg,#0e1117,#141825)", padding:"14px 15px", display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>
      <div style={{ position:"absolute", top:-20, right:-20, width:80, height:80, background:"radial-gradient(circle,rgba(79,142,247,0.14) 0%,transparent 65%)" }}/>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:11 }}>
        <div style={{ width:17, height:17, borderRadius:4, background:"rgba(79,142,247,0.18)", border:"1px solid rgba(79,142,247,0.3)", display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:8.5, color:"#4f8ef7" }}>⊞</span></div>
        <span style={{ fontSize:9, fontWeight:700, color:"rgba(200,210,240,0.8)", letterSpacing:"0.04em" }}>Multi-Format Output</span>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:4, flex:1, alignContent:"flex-start" }}>
        {formats.map((f,i)=>(
          <div key={i} style={{ width:f.w, height:f.h, background:f.active?"linear-gradient(135deg,rgba(79,142,247,0.22),rgba(37,99,235,0.15))":"rgba(255,255,255,0.045)", border:`1px solid ${f.active?"rgba(79,142,247,0.38)":"rgba(255,255,255,0.07)"}`, borderRadius:4, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end", padding:"3px 2px" }}>
            <div style={{ width:"80%", height:f.h>35?"35%":"30%", background:f.active?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.06)", borderRadius:2, marginBottom:2 }}/>
            <span style={{ fontSize:6, color:f.active?"rgba(148,197,253,0.9)":"rgba(255,255,255,0.25)", fontWeight:600 }}>{f.label}</span>
          </div>
        ))}
        <div style={{ width:26, height:26, borderRadius:4, background:"rgba(79,142,247,0.1)", border:"1px solid rgba(79,142,247,0.22)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontSize:7.5, color:"#4f8ef7", fontWeight:700 }}>+12</span>
        </div>
      </div>
      <div style={{ marginTop:9, fontSize:8, color:"rgba(115,122,150,0.8)" }}>16 platform formats, instantly</div>
    </div>
  );
}

function BrandCard() {
  const colors = ["#1e3a5f","#2563eb","#93c5fd","#e2e8f0","#0f172a"];
  return (
    <div style={{ width:"100%", height:"100%", background:"linear-gradient(145deg,#f8f9fc,#eef1f7)", padding:"13px 14px", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
        <div style={{ width:17, height:17, borderRadius:4, background:"rgba(37,99,235,0.12)", border:"1px solid rgba(37,99,235,0.22)", display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:8.5, color:"#2563eb" }}>◉</span></div>
        <span style={{ fontSize:9, fontWeight:700, color:"#1e293b", letterSpacing:"0.04em" }}>Brand Intelligence</span>
      </div>
      <div style={{ background:"white", borderRadius:6, padding:"7px 9px", marginBottom:7, border:"1px solid rgba(0,0,0,0.07)", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize:7, color:"#94a3b8", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:5 }}>Brand Palette</div>
        <div style={{ display:"flex", gap:3.5, alignItems:"center" }}>
          {colors.map((c,i)=><div key={i} style={{ width:i===1?20:14, height:i===1?20:14, borderRadius:"50%", background:c, border:"1.5px solid rgba(255,255,255,0.8)", boxShadow:"0 1px 3px rgba(0,0,0,0.12)" }}/>)}
          <div style={{ marginLeft:3, fontSize:7, color:"#64748b", fontWeight:500 }}>5 locked</div>
        </div>
      </div>
      <div style={{ background:"white", borderRadius:6, padding:"7px 9px", border:"1px solid rgba(0,0,0,0.07)", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize:7, color:"#94a3b8", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:4 }}>Typography</div>
        <div style={{ fontSize:12, fontWeight:700, color:"#0f172a", fontFamily:"Georgia,serif", lineHeight:1 }}>Aa</div>
        <div style={{ fontSize:7, color:"#64748b", marginTop:2 }}>Brand font locked</div>
      </div>
      <div style={{ marginTop:7, fontSize:8, color:"#94a3b8" }}>Always on-brand, automatically</div>
    </div>
  );
}

function AIGenerateCard() {
  const [step, setStep] = useState(0);
  useEffect(()=>{ const t = setInterval(()=>setStep(s=>(s+1)%4),1150); return()=>clearInterval(t); },[]);
  const steps = [
    { label:"Analysing brief",   done:true },
    { label:"Generating layout", done:step>=1 },
    { label:"Applying brand",    done:step>=2 },
    { label:"Exporting assets",  done:step>=3 },
  ];
  return (
    <div style={{ width:"100%", height:"100%", background:"linear-gradient(145deg,#0c0f1a,#121726)", padding:"13px 14px", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:11 }}>
        <div style={{ width:17, height:17, borderRadius:4, background:"rgba(34,197,94,0.14)", border:"1px solid rgba(34,197,94,0.28)", display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:8.5, color:"#22c55e" }}>▷</span></div>
        <span style={{ fontSize:9, fontWeight:700, color:"rgba(200,210,240,0.8)" }}>AI Generation</span>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:3 }}>
          <span style={{ width:4.5, height:4.5, borderRadius:"50%", background:"#22c55e", display:"inline-block", animation:"pulse-green 1.5s ease-in-out infinite" }}/>
          <span style={{ fontSize:7, color:"rgba(34,197,94,0.7)", fontWeight:600 }}>Live</span>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:5.5, flex:1 }}>
        {steps.map((s,i)=>(
          <div key={i} style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:12, height:12, borderRadius:"50%", flexShrink:0, background:s.done?"rgba(34,197,94,0.2)":i===step?"rgba(79,142,247,0.15)":"rgba(255,255,255,0.05)", border:`1px solid ${s.done?"rgba(34,197,94,0.5)":i===step?"rgba(79,142,247,0.4)":"rgba(255,255,255,0.08)"}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {s.done ? <span style={{ fontSize:6.5, color:"#22c55e" }}>✓</span> : i===step ? <div style={{ width:4, height:4, borderRadius:"50%", border:"1px solid #4f8ef7", borderTopColor:"transparent", animation:"spin 0.7s linear infinite" }}/> : null}
            </div>
            <div style={{ flex:1, height:1.5, borderRadius:1, background:s.done?"rgba(34,197,94,0.3)":i===step?"rgba(79,142,247,0.2)":"rgba(255,255,255,0.05)", overflow:"hidden", position:"relative" }}>
              {i===step&&<div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg,transparent,rgba(79,142,247,0.6),transparent)", animation:"scan 1.2s linear infinite" }}/>}
            </div>
            <span style={{ fontSize:7.5, color:s.done?"rgba(34,197,94,0.8)":i===step?"rgba(148,197,253,0.9)":"rgba(255,255,255,0.22)", fontWeight:s.done||i===step?600:400, width:76 }}>{s.label}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop:9, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:7.5, color:"rgba(115,122,150,0.7)" }}>Avg. 4.2s per campaign</span>
        <div style={{ fontSize:7, color:"rgba(34,197,94,0.6)", fontWeight:600, background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.18)", borderRadius:99, padding:"2px 7px" }}>6 ready</div>
      </div>
    </div>
  );
}

function AnalyticsCard() {
  const bars = [55,72,48,88,65,92,78];
  const days = ["M","T","W","T","F","S","S"];
  return (
    <div style={{ width:"100%", height:"100%", background:"linear-gradient(145deg,#f9f8f6,#f1ede8)", padding:"13px 13px", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:9 }}>
        <div style={{ width:17, height:17, borderRadius:4, background:"rgba(245,158,11,0.14)", border:"1px solid rgba(245,158,11,0.28)", display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:8.5, color:"#f59e0b" }}>◈</span></div>
        <span style={{ fontSize:9, fontWeight:700, color:"#1e293b" }}>Campaign Output</span>
      </div>
      <div style={{ display:"flex", gap:5, marginBottom:8 }}>
        {[{v:"16",l:"Formats",c:"#2563eb"},{v:"3.8s",l:"Gen time",c:"#f59e0b"},{v:"100%",l:"On-brand",c:"#22c55e"}].map((s,i)=>(
          <div key={i} style={{ flex:1, background:"white", borderRadius:5, padding:"5px 5px", border:"1px solid rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize:13, fontWeight:800, color:s.c, letterSpacing:"-0.03em", lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:6.5, color:"#94a3b8", marginTop:2, fontWeight:500 }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
        <div style={{ display:"flex", alignItems:"flex-end", gap:2.5, height:32 }}>
          {bars.map((h,i)=>(
            <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
              <div style={{ width:"100%", height:`${h}%`, background:i===5?"linear-gradient(180deg,#f59e0b,#d97706)":"linear-gradient(180deg,rgba(37,99,235,0.5),rgba(37,99,235,0.2))", borderRadius:"2px 2px 0 0" }}/>
              <span style={{ fontSize:5.5, color:"#94a3b8", fontWeight:500 }}>{days[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LuminousOrb() {
  return (
    <div style={{ position:"relative", width:280, height:280, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <div style={{ position:"absolute", inset:-60, borderRadius:"50%", background:"radial-gradient(circle,rgba(147,197,253,0.12) 0%,rgba(79,142,247,0.05) 40%,transparent 68%)", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", width:248, height:248, borderRadius:"50%", border:"1px solid rgba(147,197,253,0.18)", transform:"rotateX(62deg)", animation:"orb-ring1 12s linear infinite", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", width:200, height:200, borderRadius:"50%", border:"1px solid rgba(191,219,254,0.13)", transform:"rotateX(62deg) rotateY(55deg)", animation:"orb-ring1 18s linear infinite reverse", pointerEvents:"none" }}/>
      <div style={{ width:182, height:182, borderRadius:"50%", background:"radial-gradient(circle at 36% 32%,#ffffff 0%,#dbeafe 14%,#93c5fd 34%,#3b82f6 58%,#1d4ed8 80%,#1e3a8a 100%)", boxShadow:"0 0 32px rgba(147,197,253,0.55),0 0 66px rgba(96,165,250,0.3),0 0 110px rgba(59,130,246,0.15),inset 0 0 32px rgba(255,255,255,0.18)", animation:"orb-breathe 5s ease-in-out infinite alternate", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:"10%", left:"16%", width:"38%", height:"26%", borderRadius:"50%", background:"radial-gradient(circle,rgba(255,255,255,0.72) 0%,rgba(255,255,255,0.18) 60%,transparent 100%)" }}/>
        {[{top:"28%",left:"36%",s:5},{top:"42%",left:"63%",s:4},{top:"60%",left:"28%",s:4.5},{top:"55%",left:"54%",s:3.5},{top:"34%",left:"54%",s:3},{top:"68%",left:"44%",s:5}].map((n,i)=>(
          <div key={i} style={{ position:"absolute", width:n.s, height:n.s, borderRadius:"50%", background:`rgba(255,255,255,${0.7+i*0.05})`, top:n.top, left:n.left, boxShadow:`0 0 ${n.s*2}px rgba(255,255,255,0.9)`, animation:`node-pulse ${1.8+i*0.35}s ease-in-out infinite alternate` }}/>
        ))}
      </div>
      <div style={{ position:"absolute", width:9, height:9, borderRadius:"50%", background:"#bfdbfe", boxShadow:"0 0 10px rgba(191,219,254,0.9),0 0 22px rgba(147,197,253,0.5)", top:"50%", left:"50%", marginTop:-4.5, marginLeft:-4.5, transformOrigin:"4.5px 4.5px", transform:"rotate(0deg) translateX(128px)", animation:"orbit-dot-a 9s linear infinite" }}/>
      <div style={{ position:"absolute", width:5.5, height:5.5, borderRadius:"50%", background:"rgba(255,255,255,0.85)", top:"50%", left:"50%", marginTop:-2.75, marginLeft:-2.75, transformOrigin:"2.75px 2.75px", transform:"rotate(180deg) translateX(128px)", animation:"orbit-dot-a 9s linear infinite reverse" }}/>
    </div>
  );
}

function PromptBar() {
  const [idx,setIdx]=useState(0);
  const [text,setText]=useState("");
  const [busy,setBusy]=useState(false);
  const cur=DEMO_PROMPTS[idx];
  useEffect(()=>{
    setText("");setBusy(false);
    let i=0;
    const t=setInterval(()=>{i++;setText(cur.slice(0,i));if(i>=cur.length){clearInterval(t);setTimeout(()=>{setBusy(true);setTimeout(()=>{setBusy(false);setTimeout(()=>setIdx(p=>(p+1)%DEMO_PROMPTS.length),2200);},1400);},500);}},22);
    return()=>clearInterval(t);
  },[idx]);
  return (
    <div style={{ display:"flex", alignItems:"center", background:"rgba(255,255,255,0.04)", backdropFilter:"blur(28px)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"6px 6px 6px 24px", boxShadow:"0 8px 32px rgba(0,0,0,0.3),0 1px 0 rgba(255,255,255,0.05) inset", maxWidth:600, width:"100%" }}>
      <div style={{ flex:1, fontSize:15, color:C.textPrimary, display:"flex", alignItems:"center", minHeight:28, letterSpacing:"-0.01em" }}>
        <span style={{ opacity:text?0.9:0.32 }}>{text||"Describe your creative vision..."}</span>
        <span style={{ display:"inline-block", width:1.5, height:17, background:C.accent, marginLeft:3, animation:"cursor-blink 1s step-end infinite", borderRadius:1, verticalAlign:"middle" }}/>
      </div>
      <Link href="/register">
        <button style={{ background:busy?"rgba(79,142,247,0.1)":"linear-gradient(135deg,#4f8ef7,#2460e8)", color:busy?C.accent:"#fff", border:busy?"1px solid rgba(79,142,247,0.25)":"none", borderRadius:10, padding:"12px 28px", fontSize:14, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:8, letterSpacing:"-0.01em", transition:"all 0.2s", boxShadow:busy?"none":"0 4px 18px rgba(79,142,247,0.3)", whiteSpace:"nowrap", fontFamily:"system-ui" }}>
          {busy?<><div style={{ width:12, height:12, border:"1.5px solid rgba(79,142,247,0.28)", borderTopColor:C.accent, borderRadius:"50%", animation:"spin 0.65s linear infinite" }}/>Generating</>:"Generate →"}
        </button>
      </Link>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export function LandingPage({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [scrolled,setScrolled]=useState(false);
  useEffect(()=>{
    const fn=()=>setScrolled(window.scrollY>20);
    window.addEventListener("scroll",fn,{passive:true});
    return()=>window.removeEventListener("scroll",fn);
  },[]);

  return (
    <div style={{ fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif", background:C.bg, color:C.textPrimary, overflowX:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes ark-orbit  {to{transform:rotate(360deg);}}
        @keyframes orb-ring1  {to{transform:rotateX(62deg) rotateZ(360deg);}}
        @keyframes orb-breathe{
          from{box-shadow:0 0 32px rgba(147,197,253,0.55),0 0 66px rgba(96,165,250,0.3),0 0 110px rgba(59,130,246,0.15),inset 0 0 32px rgba(255,255,255,0.18);}
          to  {box-shadow:0 0 48px rgba(147,197,253,0.72),0 0 90px rgba(96,165,250,0.44),0 0 140px rgba(59,130,246,0.22),inset 0 0 40px rgba(255,255,255,0.22);}
        }
        @keyframes node-pulse {from{opacity:0.35;transform:scale(1);}to{opacity:1;transform:scale(1.7);}}
        @keyframes orbit-dot-a{to{transform:rotate(360deg) translateX(128px);}}
        @keyframes card-float {0%,100%{transform:translateY(0);}50%{transform:translateY(-12px);}}
        @keyframes cursor-blink{0%,100%{opacity:1;}50%{opacity:0;}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes scan{from{transform:translateX(-100%);}to{transform:translateX(100%);}}
        @keyframes fade-in-up{from{opacity:0;transform:translateY(24px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pulse-green{0%,100%{opacity:1;}50%{opacity:0.55;}}
        @keyframes shimmer{0%{background-position:-400px 0;}100%{background-position:400px 0;}}

        .nav-lnk{color:${C.textSecondary};text-decoration:none;font-size:13.5px;font-weight:500;letter-spacing:-0.01em;transition:color 0.14s;}
        .nav-lnk:hover{color:${C.textPrimary};}

        /* Module items — clickable */
        .mod-item{transition:background 0.18s,transform 0.22s cubic-bezier(0.34,1.4,0.64,1);cursor:pointer;text-decoration:none;display:flex;flex-direction:column;align-items:center;justify-content:center;}
        .mod-item:hover{background:rgba(255,255,255,0.052)!important;}
        .mod-item:hover .mod-icon{transform:translateY(-5px) scale(1.08)!important;box-shadow:0 14px 32px rgba(0,0,0,0.55),0 1px 0 rgba(255,255,255,0.18) inset!important;}

        /* Product entry cards */
        .entry-card{transition:all 0.22s cubic-bezier(0.34,1.4,0.64,1);cursor:pointer;text-decoration:none;display:block;}
        .entry-card:hover{transform:translateY(-5px)!important;border-color:rgba(79,142,247,0.35)!important;box-shadow:0 20px 48px rgba(0,0,0,0.45),0 0 0 1px rgba(79,142,247,0.12)!important;}
        .entry-card:hover .entry-arrow{transform:translateX(4px)!important;opacity:1!important;}

        .plan-card{transition:transform 0.22s cubic-bezier(0.34,1.4,0.64,1);}
        .plan-card:hover{transform:translateY(-6px)!important;}

        .fcard{transition:background 0.18s,transform 0.22s;}
        .fcard:hover{background:${C.bgCardHov}!important;transform:translateY(-3px)!important;}

        @media(max-width:900px){
          .hero-cards .float-tl,.hero-cards .float-tr,.hero-cards .float-bl,.hero-cards .float-br{display:none!important;}
          .entry-grid{grid-template-columns:repeat(2,1fr)!important;}
        }
        @media(max-width:600px){
          .entry-grid{grid-template-columns:1fr!important;}
          .mod-grid{grid-template-columns:repeat(3,1fr)!important;}
          .plan-grid{grid-template-columns:repeat(2,1fr)!important;}
        }
        @media(max-width:400px){
          .plan-grid{grid-template-columns:1fr!important;}
        }
      `}</style>

      {/* BG */}
      <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0 }}>
        <div style={{ position:"absolute", top:"-8%", left:"26%", width:720, height:720, background:"radial-gradient(circle,rgba(59,130,246,0.072) 0%,transparent 54%)", borderRadius:"50%" }}/>
        <div style={{ position:"absolute", top:"35%", right:"-8%", width:500, height:500, background:"radial-gradient(circle,rgba(96,165,250,0.04) 0%,transparent 54%)", borderRadius:"50%" }}/>
        <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.013) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.013) 1px,transparent 1px)", backgroundSize:"80px 80px" }}/>
      </div>

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav style={{ position:"sticky", top:0, zIndex:200, height:60, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 56px", background:scrolled?"rgba(6,7,13,0.95)":"rgba(6,7,13,0.15)", backdropFilter:"blur(28px)", borderBottom:`1px solid ${scrolled?C.border:"transparent"}`, transition:"all 0.28s" }}>
        <ArkiolLogo size="sm" animate />
        <div style={{ display:"flex", gap:32 }}>
          <a href="#features" className="nav-lnk">Features</a>
          <a href="#product"  className="nav-lnk">Product</a>
          <a href="#pricing"  className="nav-lnk">Pricing</a>
        </div>
        <div style={{ display:"flex", gap:9 }}>
          {isLoggedIn ? (
            <Link href="/dashboard">
              <button style={{ background:"linear-gradient(135deg,#4f8ef7,#2460e8)", color:"#fff", border:"none", borderRadius:9, padding:"8px 22px", fontSize:13.5, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 14px rgba(79,142,247,0.32)", letterSpacing:"-0.01em", transition:"all 0.16s", fontFamily:"inherit" }}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow="0 6px 22px rgba(79,142,247,0.48)";(e.currentTarget as HTMLElement).style.transform="translateY(-1px)";}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow="0 4px 14px rgba(79,142,247,0.32)";(e.currentTarget as HTMLElement).style.transform="";}}>Go to dashboard →</button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <button style={{ background:"rgba(255,255,255,0.05)", color:C.textSecondary, border:"1px solid rgba(255,255,255,0.09)", borderRadius:9, padding:"8px 20px", fontSize:13.5, fontWeight:500, cursor:"pointer", letterSpacing:"-0.01em", transition:"all 0.16s", fontFamily:"inherit" }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background="rgba(255,255,255,0.09)";(e.currentTarget as HTMLElement).style.color=C.textPrimary;}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="rgba(255,255,255,0.05)";(e.currentTarget as HTMLElement).style.color=C.textSecondary;}}>Sign in</button>
              </Link>
              <Link href="/register">
                <button style={{ background:"linear-gradient(135deg,#4f8ef7,#2460e8)", color:"#fff", border:"none", borderRadius:9, padding:"8px 22px", fontSize:13.5, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 14px rgba(79,142,247,0.32)", letterSpacing:"-0.01em", transition:"all 0.16s", fontFamily:"inherit" }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow="0 6px 22px rgba(79,142,247,0.48)";(e.currentTarget as HTMLElement).style.transform="translateY(-1px)";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow="0 4px 14px rgba(79,142,247,0.32)";(e.currentTarget as HTMLElement).style.transform="";}}>Get started</button>
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
        {/* Eyebrow */}
        <div style={{ display:"flex", alignItems:"center", gap:13, paddingTop:52, animation:"fade-in-up 0.7s ease both" }}>
          <div style={{ height:"1px", width:38, background:"linear-gradient(90deg,transparent,rgba(79,142,247,0.4))" }}/>
          <span style={{ fontSize:11.5, fontWeight:600, letterSpacing:"0.12em", textTransform:"uppercase", color:C.accent, opacity:0.78 }}>Intelligent Creative Infrastructure</span>
          <div style={{ height:"1px", width:38, background:"linear-gradient(90deg,rgba(79,142,247,0.4),transparent)" }}/>
        </div>

        {/* Stage */}
        <div className="hero-cards" style={{ position:"relative", width:"100%", maxWidth:1120, minHeight:460, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto", animation:"fade-in-up 0.85s 0.08s ease both" }}>
          <FloatCard style={{ top:"8%", left:"2%", width:210, height:154 }} delay={0} className="float-tl"><MultiFormatCard/></FloatCard>
          <FloatCard style={{ top:"6%", right:"2%", width:216, height:154 }} delay={1} className="float-tr"><BrandCard/></FloatCard>
          <FloatCard style={{ bottom:"8%", left:"1.5%", width:206, height:144 }} delay={1.8} className="float-bl"><AIGenerateCard/></FloatCard>
          <FloatCard style={{ bottom:"6%", right:"1.5%", width:196, height:144 }} delay={2.6} className="float-br"><AnalyticsCard/></FloatCard>
          <LuminousOrb/>
        </div>

        {/* Headline */}
        <div style={{ textAlign:"center", maxWidth:680, padding:"0 28px", marginTop:-18, animation:"fade-in-up 0.9s 0.15s ease both" }}>
          <h1 style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontSize:"clamp(42px,5.5vw,68px)", fontWeight:400, lineHeight:1.04, letterSpacing:"-0.03em", color:C.textPrimary, marginBottom:20 }}>
            Design at the<br/>speed of <em style={{ color:C.accent, fontStyle:"italic" }}>intent.</em>
          </h1>
          <p style={{ fontSize:"clamp(14px,1.6vw,16.5px)", color:C.textSecondary, lineHeight:1.72, maxWidth:380, margin:"0 auto 32px", fontWeight:400 }}>
            One brief. Every format. Always on-brand. Powered by AI that understands your brand.
          </p>

          {/* Primary CTAs — session-aware */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
            {isLoggedIn ? (
              <Link href="/dashboard">
                <button style={{ background:"linear-gradient(135deg,#4f8ef7,#2460e8)", color:"#fff", border:"none", borderRadius:11, padding:"14px 32px", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 20px rgba(79,142,247,0.38)", letterSpacing:"-0.01em", display:"flex", alignItems:"center", gap:9, transition:"all 0.18s", fontFamily:"inherit" }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.transform="translateY(-2px)";(e.currentTarget as HTMLButtonElement).style.boxShadow="0 10px 28px rgba(79,142,247,0.52)";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.transform="";(e.currentTarget as HTMLButtonElement).style.boxShadow="0 4px 20px rgba(79,142,247,0.38)";}}>
                  ⌘ Open dashboard
                </button>
              </Link>
            ) : (
              <>
                <Link href="/register">
                  <button style={{ background:"linear-gradient(135deg,#4f8ef7,#2460e8)", color:"#fff", border:"none", borderRadius:11, padding:"14px 32px", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 20px rgba(79,142,247,0.38)", letterSpacing:"-0.01em", display:"flex", alignItems:"center", gap:9, transition:"all 0.18s", fontFamily:"inherit" }}
                    onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.transform="translateY(-2px)";(e.currentTarget as HTMLButtonElement).style.boxShadow="0 10px 28px rgba(79,142,247,0.52)";}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.transform="";(e.currentTarget as HTMLButtonElement).style.boxShadow="0 4px 20px rgba(79,142,247,0.38)";}}>
                    ✦ Start creating — it's free
                  </button>
                </Link>
                <Link href="/login">
                  <button style={{ background:"rgba(255,255,255,0.065)", color:C.textSecondary, border:"1px solid rgba(255,255,255,0.13)", borderRadius:11, padding:"13px 26px", fontSize:15, fontWeight:500, cursor:"pointer", letterSpacing:"-0.01em", transition:"all 0.18s", fontFamily:"inherit" }}
                    onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(255,255,255,0.11)";(e.currentTarget as HTMLButtonElement).style.color=C.textPrimary;}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(255,255,255,0.065)";(e.currentTarget as HTMLButtonElement).style.color=C.textSecondary;}}>
                    Sign in to dashboard →
                  </button>
                </Link>
              </>
            )}
          </div>
          <div style={{ fontSize:12, color:C.textMuted, display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:44 }}>
            <span style={{ width:5, height:5, borderRadius:"50%", background:"#22c55e", display:"inline-block" }}/>
            No credit card required · 1 free generation daily
          </div>
        </div>

        {/* Prompt bar */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:"0 28px", marginBottom:52, width:"100%", animation:"fade-in-up 0.9s 0.22s ease both" }}>
          <PromptBar/>
          <p style={{ fontSize:12, color:C.textMuted, margin:0 }}>Try it — clicking Generate → takes you to the app</p>
        </div>

        {/* ── MODULE STRIP — clickable to actual pages ────────────────────── */}
        <div style={{ width:"100%", borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, background:"rgba(255,255,255,0.016)", backdropFilter:"blur(20px)" }}>
          <div className="mod-grid" style={{ maxWidth:1040, margin:"0 auto", display:"grid", gridTemplateColumns:"repeat(6,1fr)", padding:"0 40px" }}>
            {MODULES.map((mod,i)=>{
              const IconComp = MODULE_ICONS[i];
              return (
                <Link key={i} href={mod.route} className="mod-item" style={{ gap:11, padding:"26px 10px", borderRight:i<5?`1px solid ${C.border}`:"none", textAlign:"center", textDecoration:"none" }}>
                  <div className="mod-icon" style={{ width:60, height:60, borderRadius:17, background:MODULE_BG[i], border:"1px solid rgba(255,255,255,0.13)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 20px rgba(0,0,0,0.42),0 1px 0 rgba(255,255,255,0.13) inset", transition:"all 0.25s cubic-bezier(0.34,1.4,0.64,1)" }}>
                    <IconComp size={36}/>
                  </div>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:700, color:C.textPrimary, letterSpacing:"-0.01em", marginBottom:2 }}>{mod.name}</div>
                    <div style={{ fontSize:10.5, color:C.textMuted, lineHeight:1.4 }}>{mod.sub}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── PRODUCT ENTRY SECTION ───────────────────────────────────────────── */}
      <section id="product" style={{ position:"relative", zIndex:1, padding:"96px 56px" }}>
        <div style={{ maxWidth:1040, margin:"0 auto" }}>
          <div style={{ marginBottom:52 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.13em", textTransform:"uppercase", color:C.accent, marginBottom:14, opacity:0.72 }}>Product Areas</div>
            <h2 style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontSize:"clamp(32px,4vw,48px)", fontWeight:400, color:C.textPrimary, lineHeight:1.08, letterSpacing:"-0.025em" }}>
              Everything you need<br/><em>to create at scale.</em>
            </h2>
          </div>

          {/* Big entry cards grid */}
          <div className="entry-grid" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
            {[
              {
                icon:"✦", label:"Ad Generator",
                desc:"Enter a prompt, pick your format, get production-ready ad creatives in seconds.",
                route:"/campaign-director",
                badge:"Core",
                badgeColor:"rgba(79,142,247,0.15)",
                badgeText:"#4f8ef7",
                bg:"linear-gradient(135deg,rgba(79,142,247,0.06) 0%,rgba(37,99,235,0.03) 100%)",
                border:"rgba(79,142,247,0.2)",
              },
              {
                icon:"◻", label:"Image Studio",
                desc:"Browse your generated assets, filter by format, download or send to the editor.",
                route:"/gallery",
                badge:"Gallery",
                badgeColor:"rgba(139,92,246,0.15)",
                badgeText:"#a78bfa",
                bg:"linear-gradient(135deg,rgba(139,92,246,0.06) 0%,rgba(109,40,217,0.03) 100%)",
                border:"rgba(139,92,246,0.2)",
              },
              {
                icon:"✏", label:"Canvas Editor",
                desc:"Fine-tune any generated design in the drag-and-drop visual editor with layer control.",
                route:"/editor",
                badge:"Editor",
                badgeColor:"rgba(34,197,94,0.15)",
                badgeText:"#4ade80",
                bg:"linear-gradient(135deg,rgba(34,197,94,0.05) 0%,rgba(4,120,87,0.03) 100%)",
                border:"rgba(34,197,94,0.2)",
              },
              {
                icon:"◈", label:"Brand Kit",
                desc:"Upload your brand identity once — colors, fonts, logo. Every output respects it automatically.",
                route:"/brand",
                badge:"Brand",
                badgeColor:"rgba(245,158,11,0.15)",
                badgeText:"#fbbf24",
                bg:"linear-gradient(135deg,rgba(245,158,11,0.05) 0%,rgba(180,83,9,0.03) 100%)",
                border:"rgba(245,158,11,0.2)",
              },
              {
                icon:"▷", label:"GIF & Animation Studio",
                desc:"Create animated GIFs and motion-ready loops for Instagram, YouTube, and more.",
                route:"/gif-studio",
                badge:"Studio",
                badgeColor:"rgba(249,115,22,0.15)",
                badgeText:"#fb923c",
                bg:"linear-gradient(135deg,rgba(249,115,22,0.05) 0%,rgba(194,65,12,0.03) 100%)",
                border:"rgba(249,115,22,0.2)",
              },
              {
                icon:"⌘", label:"Copy & Content AI",
                desc:"Generate captions, hooks, hashtags, and ad copy — all tuned to your platform and tone.",
                route:"/content-ai",
                badge:"Content",
                badgeColor:"rgba(236,72,153,0.15)",
                badgeText:"#f472b6",
                bg:"linear-gradient(135deg,rgba(236,72,153,0.05) 0%,rgba(157,23,77,0.03) 100%)",
                border:"rgba(236,72,153,0.2)",
              },
            ].map((card,i)=>(
              <Link key={i} href={card.route} className="entry-card" style={{ background:card.bg, border:`1px solid ${card.border}`, borderRadius:16, padding:"28px 26px", boxShadow:"0 4px 20px rgba(0,0,0,0.18)", position:"relative", overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color:C.textPrimary }}>
                    {card.icon}
                  </div>
                  <div style={{ fontSize:10, fontWeight:700, color:card.badgeText, background:card.badgeColor, border:`1px solid ${card.badgeText}30`, borderRadius:99, padding:"3px 11px", letterSpacing:"0.06em", textTransform:"uppercase" }}>
                    {card.badge}
                  </div>
                </div>
                <div style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontSize:20, fontWeight:400, color:C.textPrimary, marginBottom:10, letterSpacing:"-0.015em" }}>{card.label}</div>
                <div style={{ fontSize:13.5, color:C.textSecondary, lineHeight:1.68 }}>{card.desc}</div>
                <div style={{ marginTop:20, display:"flex", alignItems:"center", gap:5, fontSize:12.5, color:C.accent, fontWeight:600, opacity:0.8 }}>
                  <span>Open {card.label}</span>
                  <span className="entry-arrow" style={{ transition:"transform 0.18s, opacity 0.18s", opacity:0.7 }}>→</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Dashboard shortcut banner */}
          <Link href="/dashboard" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:14, padding:"20px 28px", background:"rgba(255,255,255,0.024)", border:`1px solid ${C.border}`, borderRadius:14, textDecoration:"none", transition:"all 0.2s" }}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background="rgba(255,255,255,0.042)";(e.currentTarget as HTMLElement).style.borderColor="rgba(79,142,247,0.24)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="rgba(255,255,255,0.024)";(e.currentTarget as HTMLElement).style.borderColor=C.border;}}>
            <div style={{ display:"flex", alignItems:"center", gap:16 }}>
              <div style={{ width:40, height:40, borderRadius:11, background:"rgba(79,142,247,0.1)", border:"1px solid rgba(79,142,247,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>⌂</div>
              <div>
                <div style={{ fontSize:15, fontWeight:600, color:C.textPrimary, letterSpacing:"-0.01em" }}>Dashboard</div>
                <div style={{ fontSize:12.5, color:C.textSecondary, marginTop:1 }}>View your credits, recent jobs, and workspace overview</div>
              </div>
            </div>
            <span style={{ fontSize:18, color:C.textSecondary, opacity:0.5 }}>→</span>
          </Link>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────────────── */}
      <section id="features" style={{ position:"relative", zIndex:1, padding:"96px 56px", borderTop:`1px solid ${C.border}` }}>
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg,transparent 0%,rgba(59,130,246,0.016) 50%,transparent 100%)", pointerEvents:"none" }}/>
        <div style={{ maxWidth:1040, margin:"0 auto", position:"relative" }}>
          <div style={{ marginBottom:52 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.13em", textTransform:"uppercase", color:C.accent, marginBottom:14, opacity:0.72 }}>Capabilities</div>
            <h2 style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontSize:"clamp(32px,4vw,48px)", fontWeight:400, color:C.textPrimary, lineHeight:1.08, letterSpacing:"-0.025em", maxWidth:420 }}>
              Every format.<br/><em>Perfectly composed.</em>
            </h2>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:1.5, background:C.border, borderRadius:18, overflow:"hidden", border:`1px solid ${C.border}` }}>
            {[
              { n:"01", title:"One prompt,\nevery format", body:"From a single brief, Arkiol generates every ad format sized for every platform simultaneously. No rework, no resizing.", route:"/campaign-director" },
              { n:"02", title:"Always\non-brand",       body:"Upload your brand identity once — colors, fonts, logo. Every output respects your system automatically.",                     route:"/brand" },
              { n:"03", title:"Entire\ncampaigns",      body:"Brief to full asset set in one flow. Captions, variants, and formats — all coherent, all ready to ship.",                    route:"/campaigns" },
            ].map((f,i)=>(
              <Link key={i} href={f.route} className="fcard" style={{ background:C.bgCard, padding:"36px 30px", textDecoration:"none", display:"block" }}>
                <div style={{ fontFamily:"monospace", fontSize:10.5, color:C.accent, marginBottom:24, letterSpacing:"0.06em", opacity:0.62 }}>{f.n}</div>
                <div style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontSize:21, color:C.textPrimary, marginBottom:13, lineHeight:1.2, whiteSpace:"pre-line" }}>{f.title}</div>
                <div style={{ fontSize:14, color:C.textSecondary, lineHeight:1.76 }}>{f.body}</div>
                <div style={{ marginTop:20, fontSize:12.5, color:C.accent, fontWeight:600, opacity:0.72 }}>Learn more →</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ position:"relative", zIndex:1, padding:"96px 56px", borderTop:`1px solid ${C.border}` }}>
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg,rgba(255,255,255,0.008) 0%,transparent 100%)", pointerEvents:"none" }}/>
        <div style={{ maxWidth:1040, margin:"0 auto", position:"relative" }}>
          <div style={{ marginBottom:52 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.13em", textTransform:"uppercase", color:C.accent, marginBottom:14, opacity:0.72 }}>Pricing</div>
            <h2 style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontSize:"clamp(32px,4vw,48px)", fontWeight:400, color:C.textPrimary, lineHeight:1.08, letterSpacing:"-0.025em" }}>
              Simple, transparent<br/><em>pricing.</em>
            </h2>
          </div>
          <div className="plan-grid" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
            {PLANS.map((plan,i)=>(
              <div key={i} className="plan-card" style={{ background:plan.h?"rgba(79,142,247,0.07)":C.bgCard, border:plan.h?"1px solid rgba(79,142,247,0.28)":`1px solid ${C.border}`, borderRadius:15, padding:"28px 22px", position:"relative", boxShadow:plan.h?"0 0 0 1px rgba(79,142,247,0.06),0 20px 52px rgba(0,0,0,0.3)":"0 4px 20px rgba(0,0,0,0.16)" }}>
                {plan.h&&<div style={{ position:"absolute", top:18, right:16, fontSize:9, fontWeight:700, color:C.accent, background:"rgba(79,142,247,0.1)", border:"1px solid rgba(79,142,247,0.18)", borderRadius:99, padding:"3px 10px", letterSpacing:"0.07em", textTransform:"uppercase" }}>Popular</div>}
                <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", color:C.textMuted, marginBottom:4 }}>{plan.name}</div>
                <div style={{ fontSize:10, color:C.textMuted, marginBottom:20 }}>{plan.tag}</div>
                <div style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontSize:40, color:C.textPrimary, lineHeight:1, marginBottom:4 }}>
                  {plan.price}<span style={{ fontSize:13, fontWeight:400, color:C.textMuted, fontFamily:"inherit" }}>/mo</span>
                </div>
                <div style={{ fontSize:12.5, color:C.textSecondary, margin:"14px 0 20px", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ width:3.5, height:3.5, borderRadius:"50%", background:plan.h?C.accent:C.textMuted, display:"inline-block", opacity:0.65, flexShrink:0 }}/>{plan.credits}
                </div>
                <div style={{ height:1, background:C.border, marginBottom:18 }}/>
                <Link href={plan.cta==="Talk to us"?"mailto:hello@arkiol.ai":"/register"} style={{ display:"block" }}>
                  <button style={{ width:"100%", padding:"11px", fontSize:13, fontWeight:700, cursor:"pointer", borderRadius:9, border:"none", letterSpacing:"-0.01em", background:plan.h?"linear-gradient(135deg,#4f8ef7,#2460e8)":"rgba(255,255,255,0.055)", color:plan.h?"#fff":C.textSecondary, boxShadow:plan.h?"0 4px 14px rgba(79,142,247,0.28)":"none", transition:"opacity 0.18s", fontFamily:"inherit" }}
                    onMouseEnter={e=>e.currentTarget.style.opacity="0.78"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                    {plan.cta}
                  </button>
                </Link>
              </div>
            ))}
          </div>
          <p style={{ marginTop:26, textAlign:"center", fontSize:12, color:C.textMuted }}>All plans include unlimited brand storage. Credits reset monthly. No contracts.</p>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer style={{ position:"relative", zIndex:1, borderTop:`1px solid ${C.border}`, padding:"28px 56px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
        <ArkiolLogo size="sm" animate={false} />
        <div style={{ display:"flex", gap:24, flexWrap:"wrap", alignItems:"center" }}>
          <Link href="/dashboard" style={{ color:C.textMuted, textDecoration:"none", fontSize:12.5, transition:"color 0.14s" }} onMouseEnter={e=>e.currentTarget.style.color=C.textSecondary} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>Dashboard</Link>
          <Link href="/gallery"   style={{ color:C.textMuted, textDecoration:"none", fontSize:12.5, transition:"color 0.14s" }} onMouseEnter={e=>e.currentTarget.style.color=C.textSecondary} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>Gallery</Link>
          <Link href="/billing"   style={{ color:C.textMuted, textDecoration:"none", fontSize:12.5, transition:"color 0.14s" }} onMouseEnter={e=>e.currentTarget.style.color=C.textSecondary} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>Pricing</Link>
          <Link href="/privacy"   style={{ color:C.textMuted, textDecoration:"none", fontSize:12.5, transition:"color 0.14s" }} onMouseEnter={e=>e.currentTarget.style.color=C.textSecondary} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>Privacy</Link>
          <Link href="/terms"     style={{ color:C.textMuted, textDecoration:"none", fontSize:12.5, transition:"color 0.14s" }} onMouseEnter={e=>e.currentTarget.style.color=C.textSecondary} onMouseLeave={e=>e.currentTarget.style.color=C.textMuted}>Terms</Link>
        </div>
        <span style={{ fontSize:12, color:C.textMuted }}>© 2026 Arkiol. All rights reserved.</span>
      </footer>
    </div>
  );
}

export default LandingPage;
