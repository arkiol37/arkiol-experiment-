// src/engines/assets/decorative-components.ts
// Decorative Components — reusable template building blocks.
//
// Step 16 introduces composed decorative components that sit on top of the
// raw asset library. An asset is a single visual (a ribbon SVG, an icon
// glyph). A *component* composes one or more assets plus content slots
// (a label, a value, a list of items) into a self-contained, renderable
// unit that templates can drop in as a group.
//
// Supported kinds:
//   ribbon              — title banner with a text slot
//   badge               — circular / rectangular emblem (NEW, SALE 50%)
//   sticker             — playful polychrome marker with a caption
//   checklist-block     — stacked list with checkmark bullets
//   framed-info-card    — bordered card with heading + body text
//   divider             — horizontal separator with optional label
//   label-chip          — pill-shaped tag with a single label
//   accent-group        — cluster of 2–3 small decorative marks
//
// Each component's build() returns an Asset-compatible object so the existing
// placement pipeline (asset-placement.ts / libraryAssetToPlacement) can route
// it through unchanged. The "kind" on the returned asset is the library kind
// that controls placement (ribbon, badge, frame, divider, shape, etc.), so a
// checklist block lands where a frame would, a label-chip where a badge
// would, and so on.

import type {
  Asset,
  AssetCategory,
  AssetKind,
} from "../../lib/asset-library";

// ── Component taxonomy ───────────────────────────────────────────────────────

export type DecorativeComponentKind =
  | "ribbon"
  | "badge"
  | "sticker"
  | "checklist-block"
  | "framed-info-card"
  | "divider"
  | "label-chip"
  | "accent-group";

// Props a component reads. Every prop is optional — `build()` falls back to
// sensible defaults so a component is always renderable even with no context.
export interface ComponentProps {
  label?:    string;                     // primary text (NEW, SALE, etc.)
  value?:    string;                     // secondary text ("50%", "$19")
  subtitle?: string;                     // caption under label
  items?:    string[];                   // checklist / card body items
  palette?:  { bg: string; fg: string; accent?: string };
  tone?:     "bold" | "soft" | "formal" | "playful";
}

// Metadata for a component definition. `build(props)` returns a ready-to-use
// Asset that flows through the existing placement pipeline.
export interface DecorativeComponentDefinition {
  id:          string;                   // stable identifier (ribbon.primary)
  kind:        DecorativeComponentKind;
  // The AssetKind whose KIND_PLACEMENT_RULES entry should govern where this
  // component lands (scale / anchor / layer). e.g. ribbon → "ribbon",
  // checklist-block → "frame", label-chip → "badge".
  placementAs: AssetKind;
  category:    AssetCategory;            // primary contextual bucket
  extraCategories?: AssetCategory[];
  label:       string;                   // human-readable name
  description: string;                   // what this component is for
  tags:        string[];                 // searchable traits
  defaultProps:ComponentProps;
  build:       (props?: ComponentProps) => Asset;
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

function svg(viewBox: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
}

function mergePalette(
  base:     Required<Pick<NonNullable<ComponentProps["palette"]>, "bg" | "fg">> &
            Partial<Pick<NonNullable<ComponentProps["palette"]>, "accent">>,
  override?: ComponentProps["palette"],
): { bg: string; fg: string; accent: string } {
  return {
    bg:     override?.bg     ?? base.bg,
    fg:     override?.fg     ?? base.fg,
    accent: override?.accent ?? base.accent ?? base.fg,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
}

function makeId(prefix: string, props?: ComponentProps): string {
  const seed = JSON.stringify(props ?? {});
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return `${prefix}.${Math.abs(h).toString(36)}`;
}

// Produce an Asset shell. Components emit svg payloads only — photo-style
// URL payloads aren't relevant for composed components.
function asSvgAsset(opts: {
  id:              string;
  kind:            AssetKind;
  category:        AssetCategory;
  extraCategories?: AssetCategory[];
  label:           string;
  tags:            string[];
  aspectRatio:     number;
  preferredColor?: string;
  markup:          string;
}): Asset {
  return {
    id:              opts.id,
    kind:            opts.kind,
    category:        opts.category,
    extraCategories: opts.extraCategories,
    label:           opts.label,
    tags:            opts.tags,
    aspectRatio:     opts.aspectRatio,
    preferredColor:  opts.preferredColor,
    payload:         { format: "svg", markup: opts.markup },
  };
}

// ── Component definitions ────────────────────────────────────────────────────
// Definitions are curated to feel like they come from a design pack: strong
// defaults, clear contextual tags, and build() functions that degrade
// gracefully when props are absent.

const DEFS: DecorativeComponentDefinition[] = [
  // ── Ribbon ────────────────────────────────────────────────────────────────
  {
    id:            "ribbon.primary",
    kind:          "ribbon",
    placementAs:   "ribbon",
    category:      "marketing",
    extraCategories: ["business", "education"],
    label:         "Primary title ribbon",
    description:   "Flat banner ribbon with a centered title. Best for section headers and announcements.",
    tags:          ["ribbon", "banner", "title", "section"],
    defaultProps:  { label: "ANNOUNCEMENT", palette: { bg: "#2563EB", fg: "#FFFFFF", accent: "#1E40AF" } },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "#2563EB", fg: "#FFFFFF", accent: "#1E40AF" }, p.palette);
      const label = esc(p.label ?? "ANNOUNCEMENT");
      const markup = svg("0 0 600 120",
        `<path fill="${pal.accent}" d="M20 80h40l-20 30zM540 80h40l-20 30z"/>` +
        `<rect x="20" y="20" width="560" height="80" rx="4" fill="${pal.bg}"/>` +
        `<text x="300" y="72" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="36" font-weight="700" fill="${pal.fg}" letter-spacing="2">${label}</text>`,
      );
      return asSvgAsset({
        id:            makeId("component.ribbon.primary", p),
        kind:          "ribbon",
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Ribbon: ${p.label}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   5,
        preferredColor:pal.bg,
        markup,
      });
    },
  },

  // ── Badges ────────────────────────────────────────────────────────────────
  {
    id:            "badge.circle",
    kind:          "badge",
    placementAs:   "badge",
    category:      "marketing",
    extraCategories: ["business"],
    label:         "Circular discount badge",
    description:   "Round seal with a headline label and a supporting value (e.g. 'SALE 50%').",
    tags:          ["badge", "emblem", "discount", "sale", "seal"],
    defaultProps:  { label: "SALE", value: "50%", palette: { bg: "#DC2626", fg: "#FFFFFF" } },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "#DC2626", fg: "#FFFFFF" }, p.palette);
      const label = esc(p.label ?? "SALE");
      const value = esc(p.value ?? "50%");
      const markup = svg("0 0 200 200",
        `<circle cx="100" cy="100" r="92" fill="${pal.bg}" stroke="${pal.fg}" stroke-width="3" stroke-dasharray="4 6"/>` +
        `<circle cx="100" cy="100" r="82" fill="${pal.bg}"/>` +
        `<text x="100" y="92" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="24" font-weight="700" fill="${pal.fg}" letter-spacing="2">${label}</text>` +
        `<text x="100" y="132" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="44" font-weight="800" fill="${pal.fg}">${value}</text>`,
      );
      return asSvgAsset({
        id:            makeId("component.badge.circle", p),
        kind:          "badge",
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Badge: ${p.label} ${p.value}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   1,
        preferredColor:pal.bg,
        markup,
      });
    },
  },
  {
    id:            "badge.rectangle",
    kind:          "badge",
    placementAs:   "badge",
    category:      "business",
    extraCategories: ["productivity", "education"],
    label:         "Rectangular verified badge",
    description:   "Compact rectangular emblem for trust / credential tags (VERIFIED, PREMIUM).",
    tags:          ["badge", "verified", "seal", "premium", "credential"],
    defaultProps:  { label: "VERIFIED", palette: { bg: "#0F172A", fg: "#FACC15" } },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "#0F172A", fg: "#FACC15" }, p.palette);
      const label = esc(p.label ?? "VERIFIED");
      const markup = svg("0 0 260 90",
        `<rect x="4" y="4" width="252" height="82" rx="10" fill="${pal.bg}"/>` +
        `<rect x="12" y="12" width="236" height="66" rx="6" fill="none" stroke="${pal.fg}" stroke-width="2"/>` +
        `<text x="130" y="57" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="26" font-weight="700" fill="${pal.fg}" letter-spacing="4">${label}</text>`,
      );
      return asSvgAsset({
        id:            makeId("component.badge.rect", p),
        kind:          "badge",
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Badge: ${p.label}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   2.9,
        preferredColor:pal.bg,
        markup,
      });
    },
  },

  // ── Stickers ──────────────────────────────────────────────────────────────
  {
    id:            "sticker.star-burst",
    kind:          "sticker",
    placementAs:   "sticker",
    category:      "marketing",
    extraCategories: ["fitness", "beauty"],
    label:         "Star-burst sticker",
    description:   "Polychrome jagged-edge star burst with a caption — grabs attention in a corner.",
    tags:          ["sticker", "burst", "attention", "promo", "new"],
    defaultProps:  { label: "NEW!", palette: { bg: "#F59E0B", fg: "#FFFFFF", accent: "#DC2626" } },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "#F59E0B", fg: "#FFFFFF", accent: "#DC2626" }, p.palette);
      const label = esc(p.label ?? "NEW!");
      const points = "100,8 120,54 170,44 142,86 186,112 136,122 150,170 108,144 80,184 74,136 24,146 58,108 14,78 64,72 54,24 94,50";
      const markup = svg("0 0 200 200",
        `<polygon points="${points}" fill="${pal.bg}" stroke="${pal.accent}" stroke-width="4"/>` +
        `<text x="100" y="112" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="32" font-weight="800" fill="${pal.fg}" transform="rotate(-8 100 100)">${label}</text>`,
      );
      return asSvgAsset({
        id:            makeId("component.sticker.starburst", p),
        kind:          "sticker",
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Sticker: ${p.label}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   1,
        preferredColor:pal.bg,
        markup,
      });
    },
  },

  // ── Checklist block ───────────────────────────────────────────────────────
  {
    id:            "checklist.block",
    kind:          "checklist-block",
    placementAs:   "frame",
    category:      "productivity",
    extraCategories: ["education", "business"],
    label:         "Checklist block",
    description:   "Stacked list with checkmark bullets — ideal for productivity / how-to layouts.",
    tags:          ["checklist", "list", "task", "done", "todo"],
    defaultProps:  {
      label:    "Today's focus",
      items:    ["Plan the day", "Deep-work block", "Ship the update"],
      palette:  { bg: "#F8FAFC", fg: "#0F172A", accent: "#2563EB" },
    },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "#F8FAFC", fg: "#0F172A", accent: "#2563EB" }, p.palette);
      const items = (p.items && p.items.length > 0 ? p.items : this.defaultProps.items!).slice(0, 5);
      const lineHeight = 44;
      const headerHeight = 64;
      const padding = 24;
      const width = 480;
      const height = headerHeight + items.length * lineHeight + padding * 2;
      const title = esc(p.label ?? "Today's focus");
      const rows = items.map((it, i) => {
        const y = headerHeight + padding + i * lineHeight;
        return `<rect x="${padding + 4}" y="${y - 18}" width="24" height="24" rx="4" fill="${pal.accent}"/>` +
               `<path d="M${padding + 10} ${y - 6} l4 4 10-10" fill="none" stroke="${pal.bg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
               `<text x="${padding + 40}" y="${y}" font-family="Inter, system-ui, sans-serif" ` +
                 `font-size="20" font-weight="500" fill="${pal.fg}">${esc(it)}</text>`;
      }).join("");
      const markup = svg(`0 0 ${width} ${height}`,
        `<rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="${pal.bg}" stroke="${pal.accent}" stroke-width="2"/>` +
        `<text x="${padding}" y="${headerHeight - 12}" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="24" font-weight="700" fill="${pal.fg}">${title}</text>` +
        `<line x1="${padding}" y1="${headerHeight}" x2="${width - padding}" y2="${headerHeight}" ` +
          `stroke="${pal.accent}" stroke-width="1.5" opacity="0.4"/>` +
        rows,
      );
      return asSvgAsset({
        id:            makeId("component.checklist.block", p),
        kind:          "frame", // uses frame placement rules
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Checklist: ${p.label}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   width / height,
        preferredColor:pal.accent,
        markup,
      });
    },
  },

  // ── Framed info card ──────────────────────────────────────────────────────
  {
    id:            "card.framed-info",
    kind:          "framed-info-card",
    placementAs:   "frame",
    category:      "education",
    extraCategories: ["business", "wellness"],
    label:         "Framed information card",
    description:   "Bordered card with a heading, body paragraph, and subtle accent bar — a mini info panel.",
    tags:          ["card", "frame", "info", "panel", "note"],
    defaultProps:  {
      label:    "Did you know?",
      subtitle: "Short context or supporting detail goes in this slot for a quick sidebar read.",
      palette:  { bg: "#FFFFFF", fg: "#111827", accent: "#10B981" },
    },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "#FFFFFF", fg: "#111827", accent: "#10B981" }, p.palette);
      const title = esc(p.label ?? "Did you know?");
      const body  = esc(p.subtitle ?? "");
      // Naive word-wrap into up to 3 lines at ~46 chars each.
      const words = body.split(/\s+/);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length > 46) { if (cur) lines.push(cur); cur = w; }
        else cur = (cur ? cur + " " : "") + w;
        if (lines.length === 3) break;
      }
      if (cur && lines.length < 3) lines.push(cur);
      const lineEls = lines.map((l, i) =>
        `<text x="40" y="${140 + i * 32}" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="20" fill="${pal.fg}" opacity="0.85">${l}</text>`,
      ).join("");
      const markup = svg("0 0 560 300",
        `<rect x="8" y="8" width="544" height="284" rx="18" fill="${pal.bg}" stroke="${pal.accent}" stroke-width="3"/>` +
        `<rect x="8" y="8" width="10" height="284" fill="${pal.accent}"/>` +
        `<text x="40" y="82" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="32" font-weight="700" fill="${pal.fg}">${title}</text>` +
        `<line x1="40" y1="100" x2="180" y2="100" stroke="${pal.accent}" stroke-width="4"/>` +
        lineEls,
      );
      return asSvgAsset({
        id:            makeId("component.card.framed", p),
        kind:          "frame",
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Info card: ${p.label}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   560 / 300,
        preferredColor:pal.accent,
        markup,
      });
    },
  },

  // ── Divider ───────────────────────────────────────────────────────────────
  {
    id:            "divider.labeled",
    kind:          "divider",
    placementAs:   "divider",
    category:      "education",
    extraCategories: ["wellness", "business", "beauty"],
    label:         "Labeled divider",
    description:   "Horizontal rule with a short centered label — breaks sections without feeling heavy.",
    tags:          ["divider", "rule", "section-break", "separator"],
    defaultProps:  { label: "SECTION", palette: { bg: "transparent", fg: "#64748B", accent: "#CBD5F5" } },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "transparent", fg: "#64748B", accent: "#CBD5F5" }, p.palette);
      const label = esc(p.label ?? "SECTION");
      const markup = svg("0 0 600 60",
        `<line x1="20" y1="30" x2="230" y2="30" stroke="${pal.accent}" stroke-width="2"/>` +
        `<circle cx="250" cy="30" r="4" fill="${pal.accent}"/>` +
        `<text x="300" y="36" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="16" font-weight="600" fill="${pal.fg}" letter-spacing="4">${label}</text>` +
        `<circle cx="350" cy="30" r="4" fill="${pal.accent}"/>` +
        `<line x1="370" y1="30" x2="580" y2="30" stroke="${pal.accent}" stroke-width="2"/>`,
      );
      return asSvgAsset({
        id:            makeId("component.divider.labeled", p),
        kind:          "divider",
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Divider: ${p.label}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   10,
        preferredColor:pal.accent,
        markup,
      });
    },
  },

  // ── Label chip ────────────────────────────────────────────────────────────
  {
    id:            "chip.label",
    kind:          "label-chip",
    placementAs:   "badge",
    category:      "productivity",
    extraCategories: ["business", "travel", "beauty"],
    label:         "Label chip",
    description:   "Pill-shaped tag used to tag categories / tone — compact and color-tunable.",
    tags:          ["chip", "pill", "tag", "label", "category"],
    defaultProps:  { label: "CATEGORY", palette: { bg: "#EEF2FF", fg: "#4338CA" } },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "#EEF2FF", fg: "#4338CA" }, p.palette);
      const label = esc(p.label ?? "CATEGORY");
      // Width grows with label length; viewBox is tuned so render stays compact.
      const width = Math.max(180, 60 + label.length * 14);
      const markup = svg(`0 0 ${width} 56`,
        `<rect x="2" y="2" width="${width - 4}" height="52" rx="26" fill="${pal.bg}"/>` +
        `<text x="${width / 2}" y="36" text-anchor="middle" font-family="Inter, system-ui, sans-serif" ` +
          `font-size="20" font-weight="600" fill="${pal.fg}" letter-spacing="2">${label}</text>`,
      );
      return asSvgAsset({
        id:            makeId("component.chip.label", p),
        kind:          "badge", // chips are accent-band badges
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         `Chip: ${p.label}`,
        tags:          [...this.tags, "component"],
        aspectRatio:   width / 56,
        preferredColor:pal.fg,
        markup,
      });
    },
  },

  // ── Accent group ──────────────────────────────────────────────────────────
  {
    id:            "accent.group-sparkles",
    kind:          "accent-group",
    placementAs:   "shape",
    category:      "beauty",
    extraCategories: ["marketing", "wellness"],
    label:         "Sparkle accent group",
    description:   "Cluster of three sparkle marks that sit together as a small decorative flourish.",
    tags:          ["accent", "sparkle", "glow", "cluster", "ornament"],
    defaultProps:  { palette: { bg: "transparent", fg: "#F59E0B", accent: "#FBBF24" } },
    build(props?) {
      const p = { ...this.defaultProps, ...props };
      const pal = mergePalette({ bg: "transparent", fg: "#F59E0B", accent: "#FBBF24" }, p.palette);
      const spark = (cx: number, cy: number, r: number, fill: string) =>
        `<path fill="${fill}" d="M${cx} ${cy - r}l${r * 0.35} ${r * 0.65}l${r * 0.65} ${r * 0.35}l-${r * 0.65} ${r * 0.35}l-${r * 0.35} ${r * 0.65}l-${r * 0.35} -${r * 0.65}l-${r * 0.65} -${r * 0.35}l${r * 0.65} -${r * 0.35}z"/>`;
      const markup = svg("0 0 160 160",
        spark(40, 50, 22, pal.fg) +
        spark(110, 40, 14, pal.accent) +
        spark(90, 110, 28, pal.fg) +
        spark(130, 120, 10, pal.accent),
      );
      return asSvgAsset({
        id:            makeId("component.accent.sparkles", p),
        kind:          "shape",
        category:      this.category,
        extraCategories: this.extraCategories,
        label:         "Sparkle accent group",
        tags:          [...this.tags, "component"],
        aspectRatio:   1,
        preferredColor:pal.fg,
        markup,
      });
    },
  },
];

// ── Registry API ─────────────────────────────────────────────────────────────

const INDEX_BY_ID   = new Map(DEFS.map(d => [d.id, d]));
const INDEX_BY_KIND = DEFS.reduce<Map<DecorativeComponentKind, DecorativeComponentDefinition[]>>(
  (m, d) => { const arr = m.get(d.kind) ?? []; arr.push(d); m.set(d.kind, arr); return m; },
  new Map(),
);

export const DECORATIVE_COMPONENTS: readonly DecorativeComponentDefinition[] = Object.freeze(DEFS);

export function getComponentById(id: string): DecorativeComponentDefinition | undefined {
  return INDEX_BY_ID.get(id);
}

export function listComponentsByKind(
  kind: DecorativeComponentKind,
): DecorativeComponentDefinition[] {
  return (INDEX_BY_KIND.get(kind) ?? []).slice();
}

export function buildComponent(
  id:    string,
  props?: ComponentProps,
): Asset | null {
  const def = INDEX_BY_ID.get(id);
  return def ? def.build(props) : null;
}

// ── Roster composition ───────────────────────────────────────────────────────

export interface ComposeOptions {
  category?: AssetCategory;
  // Cap on the number of components returned (default 3 — enough to feel
  // like a curated pack without overwhelming a single template).
  limit?:    number;
  // Stable string so repeated builds pick the same components + props.
  seed?:     string;
  // Restrict to these component kinds. When omitted, all kinds are eligible.
  kinds?:    DecorativeComponentKind[];
}

/**
 * Return a small, curated set of decorative components for a template. The
 * roster is a blend across kinds so templates feel like curated packs: a
 * ribbon or section-marker, a badge or chip, and one corner accent — not
 * three stickers on the same corner.
 */
export function composeDecorativeRoster(opts: ComposeOptions = {}): Asset[] {
  const seed  = opts.seed ?? "default";
  const limit = Math.max(0, opts.limit ?? 3);
  if (limit === 0) return [];

  // Preferred ordering ensures each roster picks at most one component per
  // kind and spreads the mix across purposes: header mark, accent emblem,
  // corner mark, content enhancer. The first N kinds (capped by `limit`)
  // that have at least one eligible definition get a pick.
  const preferredOrder: DecorativeComponentKind[] = [
    "ribbon",
    "badge",
    "sticker",
    "checklist-block",
    "framed-info-card",
    "divider",
    "label-chip",
    "accent-group",
  ];

  const allowed = opts.kinds && opts.kinds.length > 0
    ? new Set<DecorativeComponentKind>(opts.kinds)
    : new Set<DecorativeComponentKind>(preferredOrder);

  const picks: Asset[] = [];
  const seenKinds = new Set<DecorativeComponentKind>();

  for (const kind of preferredOrder) {
    if (picks.length >= limit) break;
    if (!allowed.has(kind)) continue;
    if (seenKinds.has(kind)) continue;

    const pool = (INDEX_BY_KIND.get(kind) ?? []).filter(d => {
      if (!opts.category) return true;
      return d.category === opts.category ||
             (d.extraCategories?.includes(opts.category) ?? false);
    });

    // Fall back to the category-agnostic pool when the category has no
    // matching component of this kind — components are cross-category-friendly
    // by design.
    const candidates = pool.length > 0 ? pool : (INDEX_BY_KIND.get(kind) ?? []);
    if (candidates.length === 0) continue;

    const def = candidates[hash(`${seed}::${kind}`) % candidates.length];
    picks.push(def.build());
    seenKinds.add(kind);
  }

  return picks;
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
