"use client";
// SidebarLayout v12 — unified nav with plan-aware Animation Studio routing

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { GeneratePanel } from "../generate/GeneratePanel";
import { ArkiolLogo } from "../ArkiolLogo";

type NavItem = { href: string; label: string; icon: string; badge?: string; studioGated?: boolean };
type NavSection = { section: string; items: NavItem[] };

const NAV: NavSection[] = [
  { section: "Workspace", items: [
    { href: "/dashboard", label: "Overview",   icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { href: "/gallery",   label: "Arkiol Art", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  ]},
  { section: "Create", items: [
    { href: "/editor",           label: "AI Generator",     icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { href: "/canvas",           label: "Arkiol Canvas",    icon: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z", badge: "Canvas" },
    { href: "/animation-studio", label: "Animation Studio", icon: "M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z", badge: "Studio Only", studioGated: true },
    { href: "/gif-studio",       label: "Arkiol Studio",    icon: "M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z", badge: "GIF" },
    { href: "/campaign-director",label: "Arkiol Ads",       icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
    { href: "/content-ai",       label: "Arkiol Design",    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
  ]},
  { section: "Manage", items: [
    { href: "/campaigns",    label: "Campaigns",    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
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

const BADGE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Canvas:        { bg: "rgba(79,70,229,.10)",  color: "#6366f1", border: "rgba(79,70,229,.22)" },
  "Studio Only": { bg: "rgba(245,158,11,.10)", color: "#d97706", border: "rgba(245,158,11,.22)" },
  GIF:           { bg: "rgba(6,182,212,.10)",  color: "#0891b2", border: "rgba(6,182,212,.22)"  },
};
const STUDIO_ELIGIBLE_BADGE = { bg: "rgba(124,58,237,.10)", color: "#7c3aed", border: "rgba(124,58,237,.22)" };

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
  const [col,       setCol]       = useState(false);
  const [gen,       setGen]       = useState(false);
  const [menu,      setMenu]      = useState(false);
  const [canStudio, setCanStudio] = useState<boolean | null>(null);

  const user    = session?.user as any;
  const isAdmin = user && new Set(["ADMIN","SUPER_ADMIN"]).has(user?.role);
  const initials = (user?.name ?? user?.email ?? "U").slice(0, 2).toUpperCase();

  useEffect(() => {
    fetch("/api/capabilities")
      .then(r => r.json())
      .then(d => setCanStudio(d.canUseStudioVideo === true))
      .catch(() => setCanStudio(false));
  }, []);

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
    if (canStudio === true) {
      router.push("/animation-studio");
    } else {
      router.push("/animation-studio/upgrade");
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "var(--font-body)" }}>

      <aside style={{
        width: col ? 56 : 228, minHeight: "100vh", background: "#F8FAFC",
        borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column",
        transition: "width var(--transition-slow)", position: "sticky", top: 0,
        alignSelf: "flex-start", zIndex: 50, flexShrink: 0, overflowX: "hidden",
      }}>

        <div style={{ height: 58, display: "flex", alignItems: "center", padding: "0 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, justifyContent: col ? "center" : "flex-start" }}>
          <ArkiolLogo collapsed={col} size="sm" />
        </div>

        <div style={{ padding: col ? "10px 6px 4px" : "10px 10px 4px" }}>
          <button onClick={() => setGen(true)} style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: col ? "center" : "flex-start",
            gap: col ? 0 : 7, padding: col ? "8px 0" : "8px 12px",
            background: "linear-gradient(135deg,#4F46E5,#6366F1)", border: "none",
            borderRadius: "var(--radius-md)", cursor: "pointer", color: "#fff",
            fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "linear-gradient(135deg,#4338CA,#4F46E5)")}
            onMouseLeave={e => (e.currentTarget.style.background = "linear-gradient(135deg,#4F46E5,#6366F1)")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            {!col && <span>New Design</span>}
          </button>
        </div>

        <nav style={{ flex: 1, padding: "4px 0", overflowY: "auto", overflowX: "hidden" }}>
          {NAV.map(s => (
            <React.Fragment key={s.section}>
              {!col && (
                <div style={{ padding: "10px 20px 4px", fontSize: "9px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                  {s.section}
                </div>
              )}
              {s.items.map(item => {
                const isStudioItem = !!item.studioGated;
                const eligible     = isStudioItem && canStudio === true;
                const locked       = isStudioItem && canStudio === false;

                let bc = item.badge ? (BADGE_COLORS[item.badge] ?? null) : null;
                if (isStudioItem && eligible) bc = STUDIO_ELIGIBLE_BADGE;

                const active = isActive(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{ textDecoration: "none", display: "block" }}
                    onClick={isStudioItem ? (e: React.MouseEvent) => handleNavClick(e, item) : undefined}
                  >
                    <div
                      className={`ak-nav-item${active ? " active" : ""}`}
                      style={{
                        padding: col ? "9px" : "7px 11px",
                        margin: `1.5px ${col ? "6" : "8"}px`,
                        justifyContent: col ? "center" : "flex-start",
                        gap: col ? 0 : 9,
                        opacity: locked ? 0.72 : 1,
                      }}
                      title={col ? item.label : undefined}
                    >
                      <span className="ak-nav-icon" style={{ fontSize: 0, flexShrink: 0, position: "relative" }}>
                        <NavIcon d={item.icon} />
                        {locked && col && (
                          <span style={{ position: "absolute", bottom: -3, right: -3, fontSize: 8, lineHeight: 1 }}>🔒</span>
                        )}
                      </span>
                      {!col && (
                        <>
                          <span style={{ flex: 1, fontSize: 12.5 }}>{item.label}</span>
                          {bc && (
                            <span style={{
                              fontSize: 8.5, fontWeight: 700, letterSpacing: "0.05em",
                              padding: "1.5px 5px", borderRadius: "var(--radius-full)",
                              background: bc.bg, color: bc.color, border: `1px solid ${bc.border}`,
                              flexShrink: 0, display: "flex", alignItems: "center", gap: 3,
                            }}>
                              {locked && <span style={{ fontSize: 9 }}>🔒</span>}
                              {item.badge}
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
              {!col && <div style={{ padding: "10px 20px 4px", fontSize: "9px", fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--text-muted)" }}>Admin</div>}
              {ADMIN_ITEMS.map(item => (
                <Link key={item.href} href={item.href} style={{ textDecoration: "none", display: "block" }}>
                  <div className={`ak-nav-item${pathname.startsWith(item.href) ? " active" : ""}`}
                    style={{ padding: col ? "9px" : "7px 11px", margin: `1.5px ${col ? "6" : "8"}px`, justifyContent: col ? "center" : "flex-start", gap: col ? 0 : 9 }}
                    title={col ? item.label : undefined}>
                    <span className="ak-nav-icon" style={{ fontSize: 0 }}><NavIcon d={item.icon} /></span>
                    {!col && <span style={{ fontSize: 12.5 }}>{item.label}</span>}
                  </div>
                </Link>
              ))}
            </>
          )}
        </nav>

        <div style={{ borderTop: "1px solid var(--border)", padding: "8px" }}>
          {user && (
            <div style={{ position: "relative", marginBottom: 4 }}>
              <button onClick={e => { e.stopPropagation(); setMenu(m => !m); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: col ? 0 : 9, padding: col ? "7px 0" : "8px 10px", justifyContent: col ? "center" : "flex-start", background: "none", border: "none", cursor: "pointer", borderRadius: "var(--radius-md)", fontFamily: "var(--font-body)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg,#4F46E5,#6366F1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600, color: "#fff" }}>{initials}</div>
                {!col && (
                  <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{user.name ?? user.email}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                      {(user.role === "SUPER_ADMIN" || user.role === "ADMIN") && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.28)", borderRadius: 99, padding: "1px 5px", letterSpacing: "0.04em", flexShrink: 0 }}>
                          {user.role === "SUPER_ADMIN" ? "OWNER" : "ADMIN"}
                        </span>
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
                    </div>
                  </div>
                )}
              </button>

              {menu && !col && (
                <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, background: "#F1F5F9", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", padding: "4px", boxShadow: "var(--shadow-lg)", zIndex: 100 }}>
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{user.email}</div>
                  </div>
                  {[{ label: "Settings", href: "/settings" }, { label: "Billing", href: "/billing" }].map(item => (
                    <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
                      <div style={{ padding: "7px 12px", fontSize: 13, color: "var(--text-secondary)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--bg-hover)")}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "")}>
                        {item.label}
                      </div>
                    </Link>
                  ))}
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
                    <button onClick={() => signOut({ callbackUrl: "/login" })} style={{ width: "100%", padding: "7px 12px", fontSize: 13, color: "var(--error)", background: "none", border: "none", cursor: "pointer", textAlign: "left", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-body)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--error-tint)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button onClick={() => setCol(c => !c)} style={{ width: "100%", padding: "5px", fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", justifyContent: col ? "center" : "flex-start", gap: 5 }} title={col ? "Expand sidebar" : "Collapse sidebar"}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {col ? <path d="M13 17l5-5-5-5M6 17l5-5-5-5"/> : <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>}
            </svg>
            {!col && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflow: "auto", background: "var(--bg-base)" }}>{children}</main>

      {gen && <GeneratePanel onClose={() => setGen(false)} onComplete={() => { setGen(false); window.location.href = "/gallery"; }} />}
    </div>
  );
}
