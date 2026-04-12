"use client";
// src/components/dashboard/ArkiolArtView.tsx — v10
// Visual gallery with High Confidence / Experimental sections, rich design cards

import React, { useState, useEffect, useCallback } from "react";
import { CATEGORY_LABELS, ARKIOL_CATEGORIES, ArkiolCategory } from "../../lib/types";
import { GeneratePanel } from "../generate/GeneratePanel";

interface Asset {
  id: string; name: string; format: string; category: string;
  width: number; height: number; fileSize: number;
  brandScore?: number; layoutFamily?: string; noveltyScore?: number;
  createdAt: string; s3Key?: string; thumbnailUrl?: string;
}

const SORT_OPTIONS = [
  { value: "createdAt", label: "Latest" },
  { value: "brandScore", label: "Brand Score" },
];

const PLATFORM_MAP: Record<string, string[]> = {
  instagram_post:    ["Instagram", "Facebook"],
  instagram_story:   ["Instagram", "TikTok"],
  youtube_thumbnail: ["YouTube"],
  flyer:             ["Print", "Email"],
  poster:            ["Print", "Digital"],
  business_card:     ["Print"],
  presentation_slide:["Google Slides", "PowerPoint"],
  resume:            ["PDF", "Email"],
  logo:              ["Universal"],
};

function ScoreRing({ score, color = "#7c7ffa", size = 44 }: { score: number; color?: string; size?: number }) {
  const radius = (size - 6) / 2;
  const circ = 2 * Math.PI * radius;
  const fill = (score / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: size * 0.22, fontWeight: 400, fontFamily: "var(--font-display)", color, letterSpacing: "-0.04em" }}>
          {score}
        </span>
      </div>
    </div>
  );
}

function ScoreBreakdown({ asset }: { asset: Asset }) {
  const brand = asset.brandScore ?? 0;
  const novelty = asset.noveltyScore ?? Math.min(99, Math.floor(40 + brand * 0.4));
  const quality = Math.min(100, brand + 5);
  const bars = [
    { label: "Brand", value: brand, color: "#7c7ffa" },
    { label: "Quality", value: quality, color: "#22d3ee" },
    { label: "Novelty", value: novelty, color: "#f472b6" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {bars.map(b => (
        <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 9.5, color: "var(--text-muted)", minWidth: 40, letterSpacing: "0.02em" }}>{b.label}</span>
          <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${b.value}%`,
              background: b.color, borderRadius: "var(--radius-full)",
              transition: "width 0.9s ease", boxShadow: `0 0 4px ${b.color}55`,
            }} />
          </div>
          <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", color: b.color, minWidth: 22, textAlign: "right" }}>{b.value}</span>
        </div>
      ))}
    </div>
  );
}

function PlatformHints({ format }: { format: string }) {
  const platforms = PLATFORM_MAP[format] ?? ["Digital"];
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {platforms.map(p => (
        <span key={p} className="ak-platform-chip">{p}</span>
      ))}
    </div>
  );
}

function DesignCard({ asset, selected, onSelect, onGenSimilar, isExperimental }: {
  asset: Asset; selected: boolean; onSelect: () => void; onGenSimilar?: () => void; isExperimental?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const score = asset.brandScore ?? 0;
  const scoreColor = isExperimental ? "#f472b6" : score >= 75 ? "#34d399" : score >= 50 ? "#7c7ffa" : "#fbbf24";

  return (
    <div
      className={`ak-result-card${isExperimental ? " ak-result-card-experimental" : ""} ak-fade-in`}
      style={{ outline: selected ? `2px solid ${isExperimental ? "#f472b6" : "var(--accent)"}` : "none", outlineOffset: -2, cursor: "pointer" }}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: "100%", aspectRatio: "4/3",
        background: "var(--bg-overlay)", position: "relative", overflow: "hidden",
        borderRadius: "var(--radius-2xl) var(--radius-2xl) 0 0",
      }}>
        {asset.thumbnailUrl ? (
          <img src={asset.thumbnailUrl} alt={asset.name} style={{
            width: "100%", height: "100%", objectFit: "cover",
            transition: "transform 0.5s cubic-bezier(0.4,0,0.2,1)",
            transform: hovered ? "scale(1.04)" : "scale(1)",
          }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{
              width: 48, height: 48, borderRadius: "var(--radius-lg)",
              background: `linear-gradient(135deg, ${scoreColor}33, ${scoreColor}11)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, border: `1px solid ${scoreColor}22`,
            }}>◫</div>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {asset.format ?? asset.category}
            </span>
          </div>
        )}
        <div style={{
          position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
          opacity: hovered ? 1 : 0, transition: "opacity 0.22s ease",
        }}>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={`/editor?assetId=${asset.id}`} className="ak-btn ak-btn-secondary ak-btn-sm" onClick={e => e.stopPropagation()} style={{ fontSize: 12 }}>✎ Edit</a>
            <a href={`/api/assets/${asset.id}`} className="ak-btn ak-btn-primary ak-btn-sm" onClick={e => e.stopPropagation()} style={{ fontSize: 12 }}>↓ Export</a>
          </div>
          <button className="ak-btn ak-btn-ghost ak-btn-sm" style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }} onClick={e => { e.stopPropagation(); onGenSimilar?.(); }}>
            ✦ Generate Similar
          </button>
        </div>
        {selected && (
          <div style={{
            position: "absolute", top: 10, right: 10, width: 24, height: 24, borderRadius: "50%",
            background: isExperimental ? "#f472b6" : "var(--accent)", border: "2px solid #fff",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff",
          }}>✓</div>
        )}
        <div style={{ position: "absolute", top: 10, left: 10 }}>
          <span className="ak-badge ak-badge-muted" style={{ fontSize: 9.5, padding: "2px 8px", backdropFilter: "blur(8px)" }}>
            {CATEGORY_LABELS[asset.category as ArkiolCategory] ?? asset.category}
          </span>
        </div>
      </div>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 400, fontFamily: "var(--font-display)",
              letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
            }}>{asset.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {new Date(asset.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </div>
          </div>
          {score > 0 && <ScoreRing score={score} color={scoreColor} size={42} />}
        </div>
        {score > 0 && <div style={{ marginBottom: 11 }}><ScoreBreakdown asset={asset} /></div>}
        <PlatformHints format={asset.category} />
      </div>
    </div>
  );
}

function SectionHeader({ label, count, variant }: { label: string; count: number; variant: "high" | "experimental" }) {
  return (
    <div className="ak-gallery-section-header">
      <span className={`ak-section-badge ak-section-badge-${variant === "high" ? "high" : "experimental"}`}>
        {variant === "high" ? "★" : "✦"} {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{count} design{count !== 1 ? "s" : ""}</span>
      <div className={`ak-gallery-section-line${variant === "experimental" ? " ak-gallery-section-line-exp" : ""}`} />
    </div>
  );
}

export function ArkiolArtView() {
  const [genSimilarAsset, setGenSimilarAsset] = useState<Asset|null>(null);
  const [assets,   setAssets]   = useState<Asset[]>([]);
  const [filter,   setFilter]   = useState<string>("all");
  const [search,   setSearch]   = useState("");
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page,     setPage]     = useState(1);
  const [hasMore,  setHasMore]  = useState(false);
  const [sortBy,   setSortBy]   = useState<"createdAt" | "brandScore">("createdAt");
  const [showGen,  setShowGen]  = useState(false);

  const load = useCallback(async (p = 1, reset = false) => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(p), limit: "24",
      ...(filter !== "all" && { format: filter }),
      ...(search && { q: search }),
      sort: sortBy,
    });
    const res  = await fetch(`/api/assets?${params}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    const list = data.assets ?? [];
    setAssets(prev => reset ? list : [...prev, ...list]);
    setHasMore(list.length === 24);
    setLoading(false);
  }, [filter, search, sortBy]);

  useEffect(() => { setPage(1); load(1, true); }, [filter, search, sortBy]);

  const toggleSelect = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const deleteSelected = async () => {
    if (!selected.size || !confirm(`Delete ${selected.size} asset(s)?`)) return;
    await Promise.all([...selected].map(id => fetch(`/api/assets/${id}`, { method: "DELETE" })));
    setSelected(new Set()); load(1, true);
  };

  const exportSelected = async (format: string) => {
    const res = await fetch("/api/export", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: [...selected], outputFormat: format }),
    });
    if (res.ok) {
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `arkiol-export.${format === "zip" ? "zip" : "png"}`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  const highConfidence = assets.filter(a => (a.brandScore ?? 0) >= 65);
  const experimental   = assets.filter(a => (a.brandScore ?? 0) < 65);

  const gridStyle: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18,
  };

  return (
    <div className="ak-fade-in" style={{ padding: "36px 44px", maxWidth: 1440 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.045em" }}>Arkiol Art</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)", letterSpacing: "-0.01em" }}>
            {assets.length} design{assets.length !== 1 ? "s" : ""} generated
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && (
            <>
              <span className="ak-badge ak-badge-accent">{selected.size} selected</span>
              <button onClick={() => exportSelected("zip")} className="ak-btn ak-btn-secondary ak-btn-sm">↓ Export ZIP</button>
              <button onClick={deleteSelected} className="ak-btn ak-btn-danger ak-btn-sm">Delete</button>
            </>
          )}
          <button onClick={() => setShowGen(true)} className="ak-btn ak-btn-primary">✦ Generate</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 28, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} className="ak-input"
          placeholder="Search designs…" style={{ maxWidth: 220 }} />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <button className={`ak-pill${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All</button>
          {ARKIOL_CATEGORIES.map(c => (
            <button key={c} className={`ak-pill${filter === c ? " active" : ""}`} onClick={() => setFilter(c)}>{CATEGORY_LABELS[c]}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="ak-input ak-select" style={{ width: "auto" }}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {loading && assets.length === 0 ? (
        <div style={gridStyle}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="ak-shimmer" style={{ borderRadius: "var(--radius-2xl)", aspectRatio: "4/3" }} />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 24px", background: "var(--bg-elevated)", borderRadius: "var(--radius-2xl)", border: "1px dashed rgba(124,127,250,0.2)" }}>
          <div style={{ width: 72, height: 72, borderRadius: "var(--radius-2xl)", background: "var(--accent-tint)", border: "1px solid var(--border-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 20px" }}>◫</div>
          <h3 style={{ fontSize: 20, fontWeight: 400, fontFamily: "var(--font-display)", margin: "0 0 10px", letterSpacing: "-0.04em" }}>No designs yet</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 340, margin: "0 auto 26px", lineHeight: 1.6 }}>Generate your first AI design to see it here. Arkiol creates multiple formats from a single prompt.</p>
          <button onClick={() => setShowGen(true)} className="ak-btn ak-btn-primary" style={{ padding: "11px 28px" }}>✦ Generate Now</button>
        </div>
      ) : (
        <>
          {highConfidence.length > 0 && (
            <div>
              <SectionHeader label="High Confidence Designs" count={highConfidence.length} variant="high" />
              <div style={gridStyle}>
                {highConfidence.map((asset, i) => (
                  <div key={asset.id} style={{ animation: `ak-slide-up-stagger ${280 + i * 40}ms ease both`, animationDelay: `${i * 30}ms` }}>
                    <DesignCard asset={asset} selected={selected.has(asset.id)} onSelect={() => toggleSelect(asset.id)} onGenSimilar={() => setGenSimilarAsset(asset)} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {experimental.length > 0 && (
            <div>
              <SectionHeader label="Experimental Ideas" count={experimental.length} variant="experimental" />
              <div style={gridStyle}>
                {experimental.map((asset, i) => (
                  <div key={asset.id} style={{ animation: `ak-slide-up-stagger ${280 + i * 40}ms ease both`, animationDelay: `${i * 30}ms` }}>
                    <DesignCard asset={asset} selected={selected.has(asset.id)} onSelect={() => toggleSelect(asset.id)} onGenSimilar={() => setGenSimilarAsset(asset)} isExperimental />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 36 }}>
          <button onClick={() => { const next = page + 1; setPage(next); load(next); }} className="ak-btn ak-btn-secondary" disabled={loading} style={{ padding: "11px 32px" }}>
            {loading ? "Loading…" : "Load More Designs"}
          </button>
        </div>
      )}

      {showGen && <GeneratePanel onClose={() => setShowGen(false)} onComplete={() => { setShowGen(false); load(1, true); }} />}
      {genSimilarAsset && (
        <div className="ak-modal-overlay" onClick={() => setGenSimilarAsset(null)}>
          <div className="ak-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 400, fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>Generate Similar</h3>
              <button onClick={() => setGenSimilarAsset(null)} className="ak-btn ak-btn-ghost ak-btn-icon" style={{ borderRadius: "50%" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)", padding: "12px 16px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
              {genSimilarAsset.thumbnailUrl && <img src={genSimilarAsset.thumbnailUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: "var(--radius-md)", flexShrink: 0 }} />}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{genSimilarAsset.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{genSimilarAsset.category} · Score: {genSimilarAsset.brandScore ?? "—"}</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
              We&apos;ll generate new variations in the same format and style as this design. Head to the AI Generator to customise the brief.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <a href={`/editor?format=${genSimilarAsset.category}`} className="ak-btn ak-btn-primary" style={{ flex: 1, textAlign: "center" }}>Open AI Generator →</a>
              <button onClick={() => setGenSimilarAsset(null)} className="ak-btn ak-btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Named export alias so dashboard/gallery/page.tsx can import { GalleryView }
export { ArkiolArtView as GalleryView };
