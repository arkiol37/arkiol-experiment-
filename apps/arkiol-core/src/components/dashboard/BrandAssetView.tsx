"use client";
/**
 * BrandAssetView.tsx — Arkiol Core Brand Asset Management
 *
 * Embedded within the Brand Kit section of arkiol-core.
 * Provides upload, status tracking, and management of brand assets
 * uploaded through the platform.
 *
 * Integrated with Animation Studio backend for AI processing.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";

type AssetType = "logo" | "product" | "screenshot" | "packaging" | "pattern" | "icon" | "other";
type ProcessingStatus = "pending" | "processing" | "ready" | "failed";

interface BrandAsset {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  cdnUrl: string | null;
  thumbnailUrl: string | null;
  cutoutUrl: string | null;
  processingStatus: ProcessingStatus;
  assetType: AssetType;
  usageRole: string | null;
  extractedPalette: Array<{ hex: string; label: string }>;
  primaryColor: string | null;
  classificationConfidence: number;
  createdAt: string;
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  logo: "Logo",
  product: "Product",
  screenshot: "Screenshot",
  packaging: "Packaging",
  pattern: "Pattern",
  icon: "Icon",
  other: "Other",
};

const ASSET_TYPE_ICONS: Record<AssetType, string> = {
  logo: "◈",
  product: "◉",
  screenshot: "▣",
  packaging: "⬡",
  pattern: "▦",
  icon: "◆",
  other: "○",
};

const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  logo: "#a78bfa",
  product: "#34d399",
  screenshot: "#60a5fa",
  packaging: "#fb923c",
  pattern: "#f472b6",
  icon: "#facc15",
  other: "#94a3b8",
};

const STATUS_LABELS: Record<ProcessingStatus, string> = {
  pending: "Queued",
  processing: "AI Processing",
  ready: "Ready",
  failed: "Failed",
};

const STATUS_COLORS: Record<ProcessingStatus, string> = {
  pending: "#94a3b8",
  processing: "#f59e0b",
  ready: "#10b981",
  failed: "#ef4444",
};

export function BrandAssetView() {
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("");
  const [selectedAsset, setSelectedAsset] = useState<BrandAsset | null>(null);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Auto-refresh while processing
  useEffect(() => {
    loadAssets();
    const interval = setInterval(() => {
      const hasProcessing = assets.some(
        (a) => a.processingStatus === "processing" || a.processingStatus === "pending"
      );
      if (hasProcessing) loadAssets();
    }, 4000);
    return () => clearInterval(interval);
  }, [assets.some((a) => a.processingStatus === "processing" || a.processingStatus === "pending")]);

  const loadAssets = async () => {
    try {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      const res = await fetch(`/api/brand-assets?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAssets(data.assets || []);
      }
    } catch (err) {
      console.error("Failed to load brand assets", err);
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (text: string, type: "success" | "error") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3500);
  };

  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif", "image/avif"];
  const MAX_SIZE = 50 * 1024 * 1024;

  const uploadFiles = useCallback(async (files: File[]) => {
    const accepted = files.filter((f) => ACCEPTED_TYPES.includes(f.type) && f.size <= MAX_SIZE);
    if (!accepted.length) return;
    setUploading(true);
    let uploaded = 0;
    for (const file of accepted) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("name", file.name);
        const res = await fetch("/api/brand-assets", { method: "POST", body: fd });
        if (res.ok) uploaded++;
      } catch (err) {
        console.error("Upload failed for", file.name);
      }
    }
    await loadAssets();
    setUploading(false);
    if (uploaded > 0) showMsg(`${uploaded} asset${uploaded > 1 ? "s" : ""} uploaded — AI processing started`, "success");
  }, []);

  const getRootProps = () => ({
    onClick: () => fileInputRef.current?.click(),
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setIsDragActive(true); },
    onDragLeave: () => setIsDragActive(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);
      const files = Array.from(e.dataTransfer.files);
      uploadFiles(files);
    },
  });

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/brand-assets?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setAssets((prev) => prev.filter((a) => a.id !== id));
        setSelectedAsset(null);
        showMsg("Asset deleted", "success");
      }
    } catch {
      showMsg("Delete failed", "error");
    }
  };

  const readyAssets = assets.filter((a) => a.processingStatus === "ready");
  const processingAssets = assets.filter(
    (a) => a.processingStatus === "processing" || a.processingStatus === "pending"
  );

  return (
    <div className="ak-fade-in" style={{ padding: "36px 44px", maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.045em",
            }}
          >
            Brand Asset Library
          </h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
            Upload logos, products & visuals — AI processes them into animation-ready 2D ad elements
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {processingAssets.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#f59e0b",
                padding: "6px 12px",
                borderRadius: 8,
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.2)",
              }}
            >
              <span style={{ animation: "spin 1.5s linear infinite", display: "inline-block" }}>◌</span>
              {processingAssets.length} processing
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {msg && (
        <div
          className={msg.type === "error" ? "ak-toast ak-toast-error" : "ak-toast ak-toast-success"}
          style={{ marginBottom: 16 }}
        >
          <span>{msg.type === "error" ? "⚠" : "✓"}</span>
          <span>{msg.text}</span>
        </div>
      )}

      {/* Upload Zone */}
      <div
        {...getRootProps()}
        style={{
          border: `2px dashed ${isDragActive ? "var(--accent)" : "var(--border-strong)"}`,
          borderRadius: 16,
          padding: "28px 24px",
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 24,
          background: isDragActive ? "var(--accent-tint-md)" : "var(--bg-elevated)",
          transition: "all 0.2s",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            uploadFiles(files);
            e.target.value = "";
          }}
        />
        <div style={{ fontSize: 32, marginBottom: 8 }}>⬆</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
          {isDragActive ? "Drop brand assets here" : "Upload brand assets"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          PNG, JPG, SVG, WebP — up to 50MB · AI classifies and processes automatically
        </div>
        {uploading && (
          <div style={{ fontSize: 12, color: "var(--accent-light)" }}>Uploading & queuing AI processing...</div>
        )}
      </div>

      {/* Type filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          onClick={() => setFilterType("")}
          className={filterType === "" ? "ak-pill active" : "ak-pill"}
        >
          All Assets
        </button>
        {(["logo", "product", "screenshot", "packaging", "pattern", "icon"] as AssetType[]).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(filterType === t ? "" : t)}
            className={filterType === t ? "ak-pill active" : "ak-pill"}
            style={
              filterType === t
                ? { borderColor: ASSET_TYPE_COLORS[t], color: ASSET_TYPE_COLORS[t] }
                : {}
            }
          >
            {ASSET_TYPE_ICONS[t]} {ASSET_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Asset Grid */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="ak-shimmer" style={{ height: 200, borderRadius: 14 }} />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 24px",
            background: "var(--bg-elevated)",
            borderRadius: 20,
            border: "1px dashed var(--border-strong)",
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 14 }}>🎨</div>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 800,
              fontFamily: "var(--font-display)",
              margin: "0 0 8px",
              letterSpacing: "-0.04em",
            }}
          >
            No brand assets yet
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 320, margin: "0 auto 22px" }}>
            Upload your logos, product photos, and branded visuals to get started.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {assets.map((asset) => {
            const thumbUrl = asset.cutoutUrl || asset.thumbnailUrl || asset.cdnUrl;
            const typeColor = ASSET_TYPE_COLORS[asset.assetType] || "#94a3b8";
            const statusColor = STATUS_COLORS[asset.processingStatus];
            const isSelected = selectedAsset?.id === asset.id;

            return (
              <div
                key={asset.id}
                onClick={() => setSelectedAsset(isSelected ? null : asset)}
                style={{
                  background: "var(--bg-elevated)",
                  border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 14,
                  overflow: "hidden",
                  cursor: "pointer",
                  boxShadow: isSelected ? "0 0 0 2px rgba(99,102,241,0.25)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {/* Image */}
                <div
                  style={{
                    height: 140,
                    background: "var(--bg-input)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={asset.name}
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", padding: 12 }}
                    />
                  ) : (
                    <span style={{ fontSize: 36, opacity: 0.3 }}>{ASSET_TYPE_ICONS[asset.assetType]}</span>
                  )}

                  {/* Status dot */}
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: statusColor,
                      boxShadow: `0 0 6px ${statusColor}`,
                    }}
                  />

                  {/* Processing overlay */}
                  {(asset.processingStatus === "processing" || asset.processingStatus === "pending") && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        color: "#f59e0b",
                        fontWeight: 600,
                        backdropFilter: "blur(2px)",
                      }}
                    >
                      ◌ AI Processing
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div style={{ padding: "8px 10px" }}>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      marginBottom: 5,
                    }}
                  >
                    {asset.name}
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span
                      style={{
                        padding: "2px 7px",
                        borderRadius: 99,
                        fontSize: 10,
                        fontWeight: 600,
                        background: `${typeColor}20`,
                        color: typeColor,
                      }}
                    >
                      {ASSET_TYPE_ICONS[asset.assetType]} {ASSET_TYPE_LABELS[asset.assetType]}
                    </span>
                    {asset.primaryColor && (
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 3,
                          background: asset.primaryColor,
                          border: "1px solid rgba(255,255,255,0.2)",
                          flexShrink: 0,
                        }}
                        title={asset.primaryColor}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Asset Detail Panel */}
      {selectedAsset && (
        <div
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            bottom: 0,
            width: 320,
            background: "var(--bg-surface)",
            borderLeft: "1px solid var(--border)",
            padding: 24,
            overflow: "auto",
            zIndex: 50,
            boxShadow: "-12px 0 40px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Asset Detail</div>
            <button
              onClick={() => setSelectedAsset(null)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}
            >
              ×
            </button>
          </div>

          {/* Preview */}
          <div
            style={{
              height: 160,
              background: "var(--bg-input)",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
              overflow: "hidden",
            }}
          >
            {(selectedAsset.cutoutUrl || selectedAsset.cdnUrl) && (
              <img
                src={selectedAsset.cutoutUrl || selectedAsset.cdnUrl || ""}
                alt={selectedAsset.name}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", padding: 12 }}
              />
            )}
          </div>

          {/* Details */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{selectedAsset.name}</div>

          {[
            { label: "Type", value: `${ASSET_TYPE_ICONS[selectedAsset.assetType]} ${ASSET_TYPE_LABELS[selectedAsset.assetType]}` },
            { label: "Status", value: STATUS_LABELS[selectedAsset.processingStatus] },
            { label: "Usage Role", value: selectedAsset.usageRole?.replace(/_/g, " ") || "Auto-assigned" },
            { label: "AI Confidence", value: `${Math.round(selectedAsset.classificationConfidence * 100)}%` },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>{label}</span>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{value}</span>
            </div>
          ))}

          {/* Color palette */}
          {selectedAsset.extractedPalette?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Brand Colors
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {selectedAsset.extractedPalette.slice(0, 6).map((c, i) => (
                  <div
                    key={i}
                    title={c.hex}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: c.hex,
                      border: "1px solid rgba(255,255,255,0.15)",
                      cursor: "pointer",
                    }}
                    onClick={() => navigator.clipboard?.writeText(c.hex)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              className="ak-btn ak-btn-secondary"
              style={{ width: "100%", fontSize: 12 }}
              onClick={() => window.open(selectedAsset.cutoutUrl || selectedAsset.cdnUrl || "", "_blank")}
            >
              ↗ View Asset
            </button>
            <button
              className="ak-btn"
              style={{ width: "100%", fontSize: 12, background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
              onClick={() => handleDelete(selectedAsset.id)}
            >
              🗑 Delete Asset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
