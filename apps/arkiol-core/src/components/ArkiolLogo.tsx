"use client";
// src/components/ArkiolLogo.tsx — v19 Arc Mark
import React, { useEffect } from "react";

interface ArkiolLogoProps {
  collapsed?:   boolean;
  size?:        "sm" | "lg";
  showTagline?: boolean;
  animate?:     boolean;
  variant?:     "default" | "mono" | "onBlue";
}

const KEYFRAMES = `
@keyframes ark-orbit { to { transform: rotate(360deg); } }
@keyframes ark-pulse { 0%,100% { opacity:0.7; } 50% { opacity:1; } }
`;
let _kfInjected = false;
function injectKF() {
  if (_kfInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
  _kfInjected = true;
}

export function ArkiolMark({
  px = 36, animate = true, variant = "default",
}: { px?: number; animate?: boolean; variant?: "default"|"mono"|"onBlue" }) {
  useEffect(() => { injectKF(); }, []);
  const sw  = Math.max(2,   px * 0.072);
  const asw = Math.max(1.5, px * 0.048);
  const dr  = Math.max(2,   px * 0.052);
  const apr = Math.max(1.2, px * 0.028);
  const orr = px * 0.46;
  const scheme = variant === "mono"   ? { stroke:"rgba(255,255,255,0.92)", arc:"rgba(255,255,255,0.5)", dot:"rgba(255,255,255,0.92)", apex:"rgba(255,255,255,0.6)", ring:"rgba(255,255,255,0.1)" }
               : variant === "onBlue" ? { stroke:"rgba(255,255,255,0.95)", arc:"rgba(191,219,254,0.8)", dot:"#ffffff", apex:"rgba(255,255,255,0.7)", ring:"rgba(255,255,255,0.14)" }
               : { stroke:"url(#ark-grad-stroke)", arc:"url(#ark-grad-arc)", dot:"url(#ark-grad-dot)", apex:"#bfdbfe", ring:"url(#ark-grad-ring)" };
  return (
    <svg width={px} height={px} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink:0, overflow:"visible" }}>
      <defs>
        <linearGradient id="ark-grad-stroke" x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%"   stopColor="#93c5fd"/><stop offset="50%" stopColor="#3b82f6"/><stop offset="100%" stopColor="#1d4ed8"/>
        </linearGradient>
        <linearGradient id="ark-grad-arc" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#60a5fa" stopOpacity="0.05"/><stop offset="28%" stopColor="#93c5fd" stopOpacity="1"/>
          <stop offset="72%"  stopColor="#60a5fa" stopOpacity="1"/><stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05"/>
        </linearGradient>
        <radialGradient id="ark-grad-dot" cx="35%" cy="32%" r="65%">
          <stop offset="0%"   stopColor="#dbeafe"/><stop offset="60%" stopColor="#60a5fa"/><stop offset="100%" stopColor="#2563eb"/>
        </radialGradient>
        <linearGradient id="ark-grad-ring" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#bfdbfe" stopOpacity="0.22"/><stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05"/>
        </linearGradient>
        <filter id="ark-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="ark-dot-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx="50" cy="50" r={orr} stroke={scheme.ring} strokeWidth="0.7"/>
      <path d="M 50 16 L 24 80" stroke={scheme.stroke} strokeWidth={sw} strokeLinecap="round" filter="url(#ark-glow)"/>
      <path d="M 50 16 L 76 80" stroke={scheme.stroke} strokeWidth={sw} strokeLinecap="round" filter="url(#ark-glow)"/>
      <path d="M 33 55 Q 50 46 67 55" stroke={scheme.arc} strokeWidth={asw} strokeLinecap="round" fill="none"/>
      {animate ? (
        <g style={{ transformOrigin:"50px 50px", animation:"ark-orbit 4s linear infinite" }}>
          <circle cx="67" cy="55" r={dr} fill={scheme.dot} filter="url(#ark-dot-glow)"/>
        </g>
      ) : (
        <circle cx="67" cy="55" r={dr} fill={scheme.dot} filter="url(#ark-dot-glow)"/>
      )}
      <circle cx="50" cy="16" r={apr} fill={scheme.apex} opacity="0.75" filter="url(#ark-glow)"/>
    </svg>
  );
}

export function ArkiolAppIcon({ size = 32, radius = 8 }: { size?: number; radius?: number }) {
  return (
    <div style={{ width:size, height:size, borderRadius:radius, background:"linear-gradient(145deg,#0d1525,#0f1e3d)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 16px rgba(59,130,246,0.28),0 1px 0 rgba(255,255,255,0.07) inset,0 0 0 1px rgba(59,130,246,0.15)", position:"relative", overflow:"hidden", flexShrink:0 }}>
      <div style={{ position:"absolute", inset:0, background:"radial-gradient(circle at 35% 28%,rgba(147,197,253,0.1) 0%,transparent 60%)" }}/>
      <ArkiolMark px={size * 0.6} animate />
    </div>
  );
}

export function ArkiolLogo({ collapsed=false, size="sm", showTagline=false, animate=true, variant="default" }: ArkiolLogoProps) {
  const isLg     = size === "lg";
  const markPx   = isLg ? 54 : 30;
  const wordSize = isLg ? 32 : 18;
  const tagSize  = isLg ? 9  : 7.5;
  const gap      = isLg ? 14 : 9;
  const wordColor = variant==="mono"?"rgba(255,255,255,0.92)":variant==="onBlue"?"#ffffff":"#eaedf5";
  const tagColor  = variant==="mono"?"rgba(255,255,255,0.45)":variant==="onBlue"?"rgba(191,219,254,0.7)":"#64748b";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:collapsed?0:gap, flexShrink:0, overflow:"hidden" }}>
      <ArkiolMark px={markPx} animate={animate} variant={variant as any}/>
      {!collapsed && (
        <div style={{ display:"flex", flexDirection:"column", gap:2, lineHeight:1 }}>
          <span style={{ fontFamily:"'Instrument Serif',Georgia,serif", fontWeight:400, fontSize:wordSize, letterSpacing:"-0.02em", color:wordColor, whiteSpace:"nowrap" }}>Arkiol</span>
          {showTagline && (
            <span style={{ fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif", fontWeight:600, fontSize:tagSize, letterSpacing:"0.1em", color:tagColor, textTransform:"uppercase" as const, whiteSpace:"nowrap" }}>Design Intelligence</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ArkiolLogo;
