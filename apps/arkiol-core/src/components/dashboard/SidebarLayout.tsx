"use client";
// SidebarLayout v19 — Unified with homepage design system
// Blue-to-teal gradient logo · Blue accent nav · Atmospheric depth

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { GeneratePanel } from "../generate/GeneratePanel";
import { ArkiolLogo, ArkiolMark } from "../ArkiolLogo";

type NavItem = { href: string; label: string; icon: string; badge?: string; studioGated?: boolean };
type NavSection = { section: string; items: NavItem[] };

const NAV: NavSection[] = [
  { section: "Workspace", items: [
    { href: "/dashboard", label: "Overview",   icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { href: "/gallery",   label: "Gallery",    icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  ]},
  { section: "Create", items: [
    { href: "/editor",           label: "AI Generator",     icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { href: "/canvas",           label: "Canvas",           icon: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" },
    { href: "/animation-studio", label: "Animation Studio", icon: "M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z", badge: "Paid Plans", studioGated: true },
    { href: "/gif-studio",       label: "GIF Studio",       icon: "M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" },
  ]},
  { section: "Campaigns", items: [
    { href: "/campaign-director", label: "Ad Campaigns",   icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
    { href: "/campaigns",         label: "Results",        icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
    { href: "/content-ai",        label: "Design AI",      icon: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" },
  ]},
  { section: "Assets", items: [
    { href: "/brand",        label: "Brand Kit",    icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" },
    { href: "/brand-assets", label: "Brand Assets", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
    { href: "/team",         label: "Team",         icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  ]},
  { section: "Account", items: [
    { href: "/billing",  label: "Billing",  icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
    { href: "/settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  ]},
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Ops Dashboard", icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
];

const BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  "Paid Plans": { bg: "rgba(79,142,247,0.12)", color: "#60a5fa" },
};
const ELIGIBLE_BADGE = { bg: "rgba(79,142,247,0.12)", color: "#60a5fa" };

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split(" M").map((p, i) => <path key={i} d={i === 0 ? p : "M" + p} />)}
    </svg>
  );
}

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname          = usePathname();
  const router            = useRouter();
  const { data: session } = useSession();
  const [rawCol,    setCol]       = useState(false);
  const [gen,       setGen]       = useState(false);
  const [menu,      setMenu]      = useState(false);
  const [canStudio, setCanStudio] = useState<boolean | null>(null);
  // Responsive state — below 900px the sidebar becomes a drawer that
  // opens from the mobile top bar. `isMobile` drives layout choice;
  // `drawerOpen` drives visibility. Both reset on viewport changes so
  // rotating a device doesn't leave the drawer stuck open.
  const [isMobile,    setIsMobile]    = useState(false);
  const [drawerOpen,  setDrawerOpen]  = useState(false);

  const user    = session?.user as any;
  const isAdmin = user && new Set(["ADMIN","SUPER_ADMIN"]).has(user?.role);
  const initials = (user?.name ?? user?.email ?? "U").slice(0, 2).toUpperCase();

  useEffect(() => {
    fetch("/api/billing")
      .then(r => r.json())
      .then(d => setCanStudio(d.canUseStudioVideo === true))
      .catch(() => setCanStudio(false));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      setIsMobile(mql.matches);
      if (!mql.matches) setDrawerOpen(false);
    };
    sync();
    mql.addEventListener?.("change", sync);
    return () => mql.removeEventListener?.("change", sync);
  }, []);

  // Close drawer on route change so tapping a nav link doesn't leave
  // the drawer open over the newly navigated page.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (!menu) return;
    const fn = () => setMenu(false);
    document.addEventListener("click", fn);
    return () => document.removeEventListener("click", fn);
  }, [menu]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  function handleNavClick(e: React.MouseEvent, item: NavItem) {
    if (!item.studioGated) return;
    e.preventDefault();
    router.push(canStudio === true ? "/animation-studio" : "/animation-studio/upgrade");
  }

  // On mobile the sidebar always renders expanded inside a drawer —
  // the desktop collapse toggle (`rawCol`) is ignored so labels/icons
  // sit at their normal readable size and the drawer fills 82vw.
  const col = isMobile ? false : rawCol;
  const W = col ? 60 : 232;
  const sidebarWidth = isMobile ? "100%" : W;

  return (
    <div style={{ display: isMobile ? "block" : "flex", minHeight: "100vh", background: "#06070d", fontFamily: "var(--font-body)", position: "relative" }}>
      {/* Atmospheric background — matches homepage */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-10%", left: "15%", width: 600, height: 600, background: "radial-gradient(circle,rgba(59,130,246,0.055) 0%,transparent 55%)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: "20%", right: "-5%", width: 400, height: 400, background: "radial-gradient(circle,rgba(79,142,247,0.035) 0%,transparent 55%)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.011) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.011) 1px,transparent 1px)", backgroundSize: "80px 80px" }} />
      </div>

      {/* ── Mobile top bar ── */}
      {isMobile && (
        <header className="ak-mobile-topbar">
          <button
            className="ak-mobile-topbar-btn"
            onClick={() => setDrawerOpen(o => !o)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18"/>
            </svg>
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
            <ArkiolLogo size="sm" animate={false} variant="default" />
          </div>
          <button
            className="ak-mobile-topbar-btn"
            onClick={() => setGen(true)}
            aria-label="New design"
            style={{ background: "linear-gradient(135deg,#4f8ef7,#2460e8)", border: "none", color: "#fff" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </header>
      )}

      {/* Scrim (mobile only, drawer open) */}
      {isMobile && drawerOpen && (
        <div className="ak-drawer-scrim" onClick={() => setDrawerOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={isMobile ? "ak-drawer" : undefined}
        aria-hidden={isMobile ? !drawerOpen : false}
        style={{
          width: sidebarWidth, minHeight: isMobile ? undefined : "100vh",
          background: "rgba(6,7,13,0.95)",
          borderRight: "1px solid rgba(255,255,255,0.068)",
          backdropFilter: "blur(20px)",
          display: "flex", flexDirection: "column",
          transition: isMobile ? undefined : "width 220ms cubic-bezier(0.4,0,0.2,1)",
          position: isMobile ? "fixed" : "sticky",
          top: 0, alignSelf: "flex-start",
          zIndex: isMobile ? 101 : 50,
          flexShrink: 0, overflowX: "hidden",
      }}>
        {/* Logo — gradient version matching homepage */}
        <div style={{
          height: 64, display: "flex", alignItems: "center",
          padding: col ? "0" : "0 18px",
          justifyContent: col ? "center" : "flex-start",
          borderBottom: "1px solid rgba(255,255,255,0.068)",
          flexShrink: 0,
        }}>
          {col
            ? <ArkiolMark px={30} animate variant="default" />
            : <ArkiolLogo size="sm" animate variant="default" />
          }
        </div>

        {/* New Design button — blue gradient matching homepage primary CTA */}
        <div style={{ padding: col ? "10px 8px 4px" : "10px 10px 4px" }}>
          <button
            onClick={() => setGen(true)}
            style={{
              width: "100%",
              display: "flex", alignItems: "center",
              justifyContent: col ? "center" : "flex-start",
              gap: col ? 0 : 8,
              padding: col ? "9px 0" : "9px 14px",
              background: "linear-gradient(135deg,#4f8ef7,#2460e8)",
              border: "none", borderRadius: 10,
              cursor: "pointer", color: "#fff",
              fontSize: 13, fontWeight: 600,
              fontFamily: "var(--font-body)",
              boxShadow: "0 4px 14px rgba(79,142,247,0.32)",
              transition: "transform 140ms ease, box-shadow 140ms ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 22px rgba(79,142,247,0.48)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 14px rgba(79,142,247,0.32)"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            {!col && <span>New Design</span>}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "6px 0", overflowY: "auto", overflowX: "hidden" }}>
          {NAV.map(s => (
            <React.Fragment key={s.section}>
              {!col && (
                <div style={{
                  padding: "12px 18px 5px",
                  fontSize: "9.5px", fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "rgba(115,122,150,0.45)",
                }}>
                  {s.section}
                </div>
              )}
              {s.items.map(item => {
                const isStudio  = !!item.studioGated;
                const eligible  = isStudio && canStudio === true;
                const locked    = isStudio && canStudio === false;
                const active    = isActive(item.href);

                let badgeStyle = item.badge ? (BADGE_STYLES[item.badge] ?? null) : null;
                if (isStudio && eligible) badgeStyle = ELIGIBLE_BADGE;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{ textDecoration: "none", display: "block" }}
                    onClick={isStudio ? (e: React.MouseEvent) => handleNavClick(e, item) : undefined}
                  >
                    <div style={{
                      display: "flex", alignItems: "center",
                      gap: col ? 0 : 9,
                      padding: col ? "9px 0" : "7px 12px",
                      margin: `1px ${col ? "8" : "8"}px`,
                      justifyContent: col ? "center" : "flex-start",
                      borderRadius: 8,
                      color: active ? "#4f8ef7" : "rgba(148,163,184,0.75)",
                      background: active ? "rgba(79,142,247,0.10)" : "transparent",
                      border: active ? "1px solid rgba(79,142,247,0.18)" : "1px solid transparent",
                      opacity: locked ? 0.55 : 1,
                      transition: "background 140ms ease, color 140ms ease, border-color 140ms ease",
                      cursor: "pointer",
                      position: "relative",
                    }}
                      onMouseEnter={e => {
                        if (!active) {
                          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                          (e.currentTarget as HTMLElement).style.color = "#eaedf5";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!active) {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                          (e.currentTarget as HTMLElement).style.color = "rgba(148,163,184,0.75)";
                        }
                      }}
                      title={col ? item.label : undefined}
                    >
                      <span style={{ fontSize: 0, flexShrink: 0 }}>
                        <NavIcon d={item.icon} />
                      </span>
                      {!col && (
                        <>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 600 : 400, letterSpacing: "-0.005em" }}>
                            {item.label}
                          </span>
                          {locked && (
                            <span style={{ fontSize: 9, color: "rgba(148,163,184,0.4)" }}>🔒</span>
                          )}
                          {badgeStyle && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                              padding: "2px 6px", borderRadius: 99,
                              background: badgeStyle.bg,
                              color: badgeStyle.color,
                              flexShrink: 0,
                            }}>
                              {isStudio && eligible ? "✓" : item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </React.Fragment>
          ))}

          {isAdmin && (
            <>
              {!col && (
                <div style={{ padding: "12px 18px 5px", fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(245,158,11,0.5)" }}>
                  Admin
                </div>
              )}
              {ADMIN_ITEMS.map(item => (
                <Link key={item.href} href={item.href} style={{ textDecoration: "none", display: "block" }}>
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: col ? 0 : 9,
                      padding: col ? "9px 0" : "7px 12px",
                      margin: `1px 8px`,
                      justifyContent: col ? "center" : "flex-start",
                      borderRadius: 8, cursor: "pointer",
                      color: pathname.startsWith(item.href) ? "#fbbf24" : "rgba(245,158,11,0.55)",
                      background: pathname.startsWith(item.href) ? "rgba(245,158,11,0.10)" : "transparent",
                      border: "1px solid transparent",
                      transition: "background 140ms ease, color 140ms ease",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.08)"; (e.currentTarget as HTMLElement).style.color = "#fbbf24"; }}
                    onMouseLeave={e => { if (!pathname.startsWith(item.href)) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "rgba(245,158,11,0.55)"; } }}
                    title={col ? item.label : undefined}
                  >
                    <span style={{ fontSize: 0, flexShrink: 0 }}><NavIcon d={item.icon} /></span>
                    {!col && <span style={{ fontSize: 13 }}>{item.label}</span>}
                  </div>
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* User footer */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.068)", padding: "8px" }}>
          {user && (
            <div style={{ position: "relative", marginBottom: 4 }}>
              <button
                onClick={e => { e.stopPropagation(); setMenu(m => !m); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center",
                  gap: col ? 0 : 9,
                  padding: col ? "7px 0" : "8px 10px",
                  justifyContent: col ? "center" : "flex-start",
                  background: "none", border: "none", cursor: "pointer",
                  borderRadius: 8, fontFamily: "var(--font-body)",
                  transition: "background 140ms ease",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                  background: "linear-gradient(135deg,#4f8ef7,#2460e8)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, color: "#fff",
                  boxShadow: "0 0 0 2px rgba(79,142,247,0.25)",
                }}>
                  {initials}
                </div>
                {!col && (
                  <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#eaedf5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {user.name ?? user.email}
                    </div>
                    <div style={{ fontSize: 10.5, color: "rgba(115,122,150,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                      {(user.role === "SUPER_ADMIN" || user.role === "ADMIN") && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 99, padding: "1px 5px", letterSpacing: "0.04em", flexShrink: 0 }}>
                          {user.role === "SUPER_ADMIN" ? "OWNER" : "ADMIN"}
                        </span>
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
                    </div>
                  </div>
                )}
              </button>

              {menu && !col && (
                <div style={{
                  position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0,
                  background: "#0b0d18",
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 12, padding: "4px",
                  boxShadow: "0 20px 56px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.07) inset",
                  zIndex: 100,
                }}>
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.068)", marginBottom: 4 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#eaedf5" }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(115,122,150,0.7)" }}>{user.email}</div>
                  </div>
                  {[{ label: "Settings", href: "/settings" }, { label: "Billing", href: "/billing" }].map(item => (
                    <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
                      <div style={{ padding: "7px 12px", fontSize: 13, color: "#737a96", borderRadius: 8, cursor: "pointer", transition: "background 120ms ease, color 120ms ease" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.color = "#eaedf5"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "#737a96"; }}>
                        {item.label}
                      </div>
                    </Link>
                  ))}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.068)", marginTop: 4, paddingTop: 4 }}>
                    <button
                      onClick={() => signOut({ callbackUrl: "/login" })}
                      style={{ width: "100%", padding: "7px 12px", fontSize: 13, color: "#f87171", background: "none", border: "none", cursor: "pointer", textAlign: "left", borderRadius: 8, fontFamily: "var(--font-body)", transition: "background 120ms ease" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isMobile && (
            <button
              onClick={() => setCol(c => !c)}
              style={{
                width: "100%", padding: "6px", fontSize: 11,
                color: "rgba(115,122,150,0.4)", background: "none", border: "none",
                borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-body)",
                display: "flex", alignItems: "center",
                justifyContent: col ? "center" : "flex-start", gap: 5,
                transition: "color 140ms ease",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#737a96")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(115,122,150,0.4)")}
              title={col ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {col ? <path d="M13 17l5-5-5-5M6 17l5-5-5-5"/> : <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>}
              </svg>
              {!col && <span>Collapse</span>}
            </button>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{
        flex: isMobile ? undefined : 1,
        width: isMobile ? "100%" : undefined,
        minWidth: 0,
        overflow: "auto",
        position: "relative",
        zIndex: 1,
      }}>
        {children}
      </main>

      {gen && <GeneratePanel onClose={() => setGen(false)} onComplete={() => { setGen(false); window.location.href = "/gallery"; }} />}
    </div>
  );
}
