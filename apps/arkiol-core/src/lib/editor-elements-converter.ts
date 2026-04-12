/**
 * editor-elements-converter.ts
 *
 * Converts the generation pipeline's output (zones + SvgContent) into the
 * ArkiolEditor's internal EditorElement[] schema so every generated design
 * opens as a fully-editable layer tree.
 *
 * This is a pure, isomorphic function — no server imports, no database calls.
 * It runs both in the API route (server) and could run client-side too.
 *
 * Zone coordinate system  →  Editor coordinate system
 *   zone.x  (% of width)  →  el.x  (px from left)
 *   zone.y  (% of height) →  el.y  (px from top)
 *   zone.width  (%)       →  el.width  (px)
 *   zone.height (%)       →  el.height (px)
 */

// ── Types (mirrored from ArkiolEditor — keep in sync) ─────────────────────────

export type EditorElementType = "text" | "image" | "rect" | "ellipse" | "line";
export type BlendMode = "normal";

export interface EditorElement {
  id:           string;
  type:         EditorElementType;
  x:            number;
  y:            number;
  width:        number;
  height:       number;
  rotation:     number;
  zIndex:       number;
  locked:       boolean;
  visible:      boolean;
  name?:        string;
  opacity:      number;
  blendMode:    BlendMode;
  // text
  text?:        string;
  fontSize?:    number;
  fontFamily?:  string;
  fontWeight?:  number;
  color?:       string;
  align?:       "left" | "center" | "right";
  lineHeight?:  number;
  letterSpacing?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  fontStyle?:   "normal" | "italic";
  textDecoration?: "none" | "underline" | "line-through";
  // rect/ellipse
  fill?:        string;
  gradient?:    string;
  stroke?:      string;
  strokeWidth?: number;
  borderRadius?: number;
  // image
  src?:         string;
  objectFit?:   "cover" | "contain" | "fill";
}

// ── Generation schema types (matches svg-builder-ultimate SvgContent) ──────────

interface SvgTextContent {
  zoneId:     string;
  text:       string;
  fontSize:   number;
  weight:     number;
  color:      string;
  fontFamily: string;
}

interface SvgCtaStyle {
  backgroundColor: string;
  textColor:       string;
  borderRadius:    number;
  paddingH:        number;
  paddingV:        number;
  shadow?:         boolean;
}

interface SvgContent {
  backgroundColor:     string;
  backgroundGradient?: { type: "linear" | "radial" | "none"; colors: string[]; angle?: number };
  textContents:        SvgTextContent[];
  ctaStyle?:           SvgCtaStyle;
  overlayOpacity?:     number;
  overlayColor?:       string;
  accentShape?: {
    type:   "rect" | "circle" | "line" | "none";
    color:  string;
    x:      number;  // % of width
    y:      number;  // % of height
    w:      number;  // % of width
    h:      number;  // % of height
    opacity?:     number;
    borderRadius?: number;
  };
  _selectedTheme?: unknown;
}

interface Zone {
  id:           string;
  x:            number;  // % of width
  y:            number;  // % of height
  width:        number;  // % of canvas width
  height:       number;  // % of canvas height
  minFontSize?: number;
  maxFontSize?: number;
  required:     boolean;
  zIndex:       number;
  alignH:       "left" | "center" | "right";
  alignV:       "top"  | "middle" | "bottom";
}

// ── On-demand asset map (CDN URLs from generation pipeline) ────────────────────

interface OnDemandAssetElement {
  elementId:   string;
  elementType: string;
  cdnUrl:      string;
  source:      string;
}

interface OnDemandAssetsMetadata {
  elements?: OnDemandAssetElement[];
}

// ── Converter ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
function uid(prefix: string): string {
  // Deterministic-enough for initial load; editor reassigns on edit.
  return `${prefix}_${Date.now()}_${(++_idCounter).toString(36)}`;
}

/** Convert % zone coordinates to absolute px */
function pct(val: number, total: number): number {
  return Math.round((val / 100) * total);
}

/** Build a CSS gradient string from SvgContent backgroundGradient */
function buildGradientCss(grad: SvgContent["backgroundGradient"]): string | undefined {
  if (!grad || grad.type === "none" || !grad.colors.length) return undefined;
  if (grad.type === "linear") {
    const angle = grad.angle ?? 135;
    const stops = grad.colors
      .map((c, i) => `${c} ${Math.round((i / (grad.colors.length - 1)) * 100)}%`)
      .join(", ");
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  if (grad.type === "radial") {
    const stops = grad.colors
      .map((c, i) => `${c} ${Math.round((i / (grad.colors.length - 1)) * 100)}%`)
      .join(", ");
    return `radial-gradient(circle at center, ${stops})`;
  }
  return undefined;
}

/** Map generation font names to the editor's registered font list */
const FONT_MAP: Record<string, string> = {
  "Syne":                "Syne",
  "DM Sans":             "DM Sans",
  "Arial":               "DM Sans",      // closest registered sans
  "Arial Black":         "DM Sans",
  "Georgia":             "Georgia",
  "Impact":              "Impact",
  "Verdana":             "Verdana",
  "Trebuchet MS":        "Trebuchet MS",
  "Courier New":         "Courier New",
  "Times New Roman":     "Georgia",      // closest registered serif
  "Palatino Linotype":   "Georgia",
  "Inter":               "DM Sans",
  "Poppins":             "Syne",
  "Montserrat":          "Syne",
  "Raleway":             "Syne",
};

function mapFont(fontFamily: string): string {
  // Try exact match first, then partial match, then fallback
  if (FONT_MAP[fontFamily]) return FONT_MAP[fontFamily];
  const lower = fontFamily.toLowerCase();
  if (lower.includes("georgia") || lower.includes("serif")) return "Georgia";
  if (lower.includes("impact")) return "Impact";
  if (lower.includes("courier") || lower.includes("mono")) return "Courier New";
  return "DM Sans";
}

/**
 * Main converter.
 *
 * @param zones          Layout zones from the generation pipeline
 * @param svgContent     AI-generated visual content (text, colors, styles)
 * @param canvasW        Canvas width in px (from FORMAT_DIMS)
 * @param canvasH        Canvas height in px (from FORMAT_DIMS)
 * @param onDemandAssets Optional: CDN URLs for AI-generated sub-images
 * @returns              EditorElement[] ready to pass as ArkiolEditor initialElements
 */
export function convertGenerationToEditorElements(
  zones:           Zone[],
  svgContent:      SvgContent,
  canvasW:         number,
  canvasH:         number,
  onDemandAssets?: OnDemandAssetsMetadata,
): EditorElement[] {
  const elements: EditorElement[] = [];
  let zi = 0; // zIndex counter — follows zone z-order

  // ── 1. Background layer ────────────────────────────────────────────────────
  // Always created first as the bottom-most layer.
  const bgGradient = buildGradientCss(svgContent.backgroundGradient);
  const bgEl: EditorElement = {
    id:           uid("bg"),
    type:         "rect",
    name:         "Background",
    x:            0,
    y:            0,
    width:        canvasW,
    height:       canvasH,
    rotation:     0,
    zIndex:       zi++,
    locked:       false,   // unlocked — user can change BG color
    visible:      true,
    opacity:      1,
    blendMode:    "normal",
    fill:         bgGradient ? undefined : svgContent.backgroundColor,
    gradient:     bgGradient,
    borderRadius: 0,
    strokeWidth:  0,
  };
  elements.push(bgEl);

  // ── 2. Overlay layer (darkens behind text over images) ─────────────────────
  if ((svgContent.overlayOpacity ?? 0) > 0.05) {
    // Find the image zone to size the overlay, or fall back to full canvas
    const imageZone = zones.find(z => z.id === "image");
    const ox = imageZone ? pct(imageZone.x, canvasW) : 0;
    const oy = imageZone ? pct(imageZone.y, canvasH) : 0;
    const ow = imageZone ? pct(imageZone.width, canvasW)  : canvasW;
    const oh = imageZone ? pct(imageZone.height, canvasH) : canvasH;

    elements.push({
      id:       uid("overlay"),
      type:     "rect",
      name:     "Overlay",
      x:        ox,
      y:        oy,
      width:    ow,
      height:   oh,
      rotation: 0,
      zIndex:   zi++,
      locked:   false,
      visible:  true,
      opacity:  svgContent.overlayOpacity ?? 0.4,
      blendMode: "normal",
      fill:     svgContent.overlayColor ?? "#000000",
      borderRadius: 0,
      strokeWidth:  0,
    });
  }

  // ── 3. Accent shape ────────────────────────────────────────────────────────
  const shape = svgContent.accentShape;
  if (shape && shape.type !== "none") {
    const sx = pct(shape.x, canvasW);
    const sy = pct(shape.y, canvasH);
    const sw = pct(shape.w, canvasW);
    const sh = pct(shape.h, canvasH);

    if (shape.type === "rect" || shape.type === "line") {
      elements.push({
        id:           uid("accent"),
        type:         "rect",
        name:         "Accent Shape",
        x:            sx,
        y:            sy,
        width:        Math.max(sw, 4),
        height:       Math.max(sh, 2),
        rotation:     0,
        zIndex:       zi++,
        locked:       false,
        visible:      true,
        opacity:      shape.opacity ?? 0.15,
        blendMode:    "normal",
        fill:         shape.color,
        borderRadius: shape.borderRadius ?? (shape.type === "line" ? 0 : 8),
        strokeWidth:  0,
      });
    } else if (shape.type === "circle") {
      elements.push({
        id:        uid("accent"),
        type:      "ellipse",
        name:      "Accent Circle",
        x:         sx,
        y:         sy,
        width:     Math.max(sw, 20),
        height:    Math.max(sh, 20),
        rotation:  0,
        zIndex:    zi++,
        locked:    false,
        visible:   true,
        opacity:   shape.opacity ?? 0.15,
        blendMode: "normal",
        fill:      shape.color,
        strokeWidth: 0,
      });
    }
  }

  // ── 4. Image placeholder zone (or CDN-sourced image) ──────────────────────
  const imageZone = zones.find(z => z.id === "image");
  if (imageZone) {
    // Check if a CDN image was generated for this zone
    const cdnImage = onDemandAssets?.elements?.find(
      e => e.elementType === "hero_image" || e.elementType === "background_image" || e.elementType === "product_image"
    );

    elements.push({
      id:        uid("img"),
      type:      "image",
      name:      "Image",
      x:         pct(imageZone.x, canvasW),
      y:         pct(imageZone.y, canvasH),
      width:     pct(imageZone.width, canvasW),
      height:    pct(imageZone.height, canvasH),
      rotation:  0,
      zIndex:    Math.max(zi, imageZone.zIndex > 0 ? imageZone.zIndex : zi++),
      locked:    false,
      visible:   true,
      opacity:   1,
      blendMode: "normal",
      // If a CDN image was generated, use it; otherwise leave src empty so user can upload
      src:       cdnImage?.cdnUrl ?? "",
      objectFit: "cover",
    });
    if (!cdnImage) zi++;
  }

  // ── 5. Text and CTA zones ─────────────────────────────────────────────────
  const textMap = new Map(svgContent.textContents.map(tc => [tc.zoneId, tc]));
  const zonesByZIndex = [...zones]
    .filter(z => !["background", "image", "accent"].includes(z.id))
    .sort((a, b) => a.zIndex - b.zIndex);

  for (const zone of zonesByZIndex) {
    const tc = textMap.get(zone.id);
    if (!tc?.text?.trim()) continue;

    const x      = pct(zone.x, canvasW);
    const y      = pct(zone.y, canvasH);
    const width  = pct(zone.width, canvasW);
    const height = pct(zone.height, canvasH);

    // CTA zone → rect button + text element
    if (zone.id === "cta" && svgContent.ctaStyle) {
      const cs = svgContent.ctaStyle;
      const btnH = Math.min(height, tc.fontSize + cs.paddingV * 2);
      const btnY = y + (height - btnH) / 2;

      // CTA background rect
      elements.push({
        id:           uid("cta_bg"),
        type:         "rect",
        name:         "CTA Button",
        x,
        y:            btnY,
        width,
        height:       btnH,
        rotation:     0,
        zIndex:       zi++,
        locked:       false,
        visible:      true,
        opacity:      1,
        blendMode:    "normal",
        fill:         cs.backgroundColor,
        borderRadius: cs.borderRadius,
        strokeWidth:  0,
      });

      // CTA text
      elements.push({
        id:           uid("cta_text"),
        type:         "text",
        name:         "CTA Text",
        x,
        y:            btnY,
        width,
        height:       btnH,
        rotation:     0,
        zIndex:       zi++,
        locked:       false,
        visible:      true,
        opacity:      1,
        blendMode:    "normal",
        text:         tc.text,
        fontSize:     tc.fontSize,
        fontFamily:   mapFont(tc.fontFamily),
        fontWeight:   tc.weight,
        color:        cs.textColor,
        align:        "center",
        lineHeight:   1.2,
        letterSpacing: 0,
        textTransform: "none",
        fontStyle:     "normal",
        textDecoration: "none",
      });
      continue;
    }

    // Badge zone → pill background + text
    if (zone.id === "badge") {
      elements.push({
        id:           uid("badge_bg"),
        type:         "rect",
        name:         "Badge Pill",
        x,
        y,
        width:        Math.min(width, tc.text.length * tc.fontSize * 0.65 + 24),
        height,
        rotation:     0,
        zIndex:       zi++,
        locked:       false,
        visible:      true,
        opacity:      0.85,
        blendMode:    "normal",
        fill:         tc.color,
        borderRadius: height / 2,
        strokeWidth:  0,
      });
      elements.push({
        id:           uid("badge_text"),
        type:         "text",
        name:         "Badge",
        x,
        y,
        width,
        height,
        rotation:     0,
        zIndex:       zi++,
        locked:       false,
        visible:      true,
        opacity:      1,
        blendMode:    "normal",
        text:         tc.text,
        fontSize:     tc.fontSize,
        fontFamily:   mapFont(tc.fontFamily),
        fontWeight:   tc.weight,
        color:        svgContent.backgroundColor,
        align:        "center",
        lineHeight:   1.2,
        letterSpacing: 0.08,
        textTransform: "uppercase",
        fontStyle:     "normal",
        textDecoration: "none",
      });
      continue;
    }

    // Standard text zone
    const align = zone.alignH === "center" ? "center"
                : zone.alignH === "right"  ? "right"
                : "left";

    // Letter spacing & text transform for known zones
    const letterSpacing = ["badge", "eyebrow", "section_header"].includes(zone.id) ? 0.08 : 0;
    const textTransform = ["badge", "eyebrow"].includes(zone.id) ? ("uppercase" as const) : ("none" as const);

    elements.push({
      id:           uid(zone.id),
      type:         "text",
      name:         ZONE_DISPLAY_NAMES[zone.id] ?? capitalise(zone.id),
      x,
      y,
      width,
      height,
      rotation:     0,
      zIndex:       Math.max(zi, zone.zIndex > 0 ? zone.zIndex : zi++),
      locked:       false,
      visible:      true,
      opacity:      1,
      blendMode:    "normal",
      text:         tc.text,
      fontSize:     tc.fontSize,
      fontFamily:   mapFont(tc.fontFamily),
      fontWeight:   tc.weight,
      color:        tc.color,
      align,
      lineHeight:   tc.fontSize >= 72 ? 1.08 : tc.fontSize >= 48 ? 1.14 : 1.25,
      letterSpacing,
      textTransform,
      fontStyle:     "normal",
      textDecoration: "none",
    });
    zi++;
  }

  return elements;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ZONE_DISPLAY_NAMES: Record<string, string> = {
  headline:       "Headline",
  subhead:        "Subheadline",
  body:           "Body Copy",
  cta:            "Call to Action",
  badge:          "Badge",
  tagline:        "Tagline",
  eyebrow:        "Eyebrow Label",
  name:           "Name",
  title:          "Title",
  company:        "Company",
  contact:        "Contact",
  section_header: "Section Header",
  bullet_1:       "Bullet 1",
  bullet_2:       "Bullet 2",
  bullet_3:       "Bullet 3",
  price:          "Price",
  legal:          "Legal Text",
  logo:           "Logo Area",
  image:          "Image",
  background:     "Background",
  accent:         "Accent Shape",
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

// ── SVG-based fallback converter ───────────────────────────────────────────────
// When zone metadata is not available, parse the stored svgSource into elements.
// This handles legacy assets and edge cases.

interface ParsedSvgElement {
  tag:   string;
  attrs: Record<string, string>;
  text?: string;
}

/**
 * Lightweight SVG parser for the specific SVG output format from our builder.
 * Extracts rects, ellipses, and text elements from the generated SVG.
 * Used as a fallback when zone metadata is unavailable.
 */
export function convertSvgSourceToEditorElements(
  svgSource: string,
  canvasW:   number,
  canvasH:   number,
): EditorElement[] {
  const elements: EditorElement[] = [];
  let zi = 0;

  // Extract viewport from svg tag
  const vbMatch = svgSource.match(/viewBox="0 0 (\d+) (\d+)"/);
  const svgW = vbMatch ? parseInt(vbMatch[1]) : canvasW;
  const svgH = vbMatch ? parseInt(vbMatch[2]) : canvasH;
  const scaleX = canvasW / svgW;
  const scaleY = canvasH / svgH;

  // Helper: parse a single element's attributes
  const parseAttrs = (tagStr: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    const re = /(\w[\w-]*)="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tagStr)) !== null) attrs[m[1]] = m[2];
    return attrs;
  };

  // ── Background rect ────────────────────────────────────────────────────────
  const bgMatch = svgSource.match(/<rect width="(\d+)" height="(\d+)" fill="([^"]+)"/);
  if (bgMatch) {
    const fill = bgMatch[3];
    const isGrad = fill.startsWith("url(");
    // Extract gradient if present
    let gradient: string | undefined;
    if (isGrad) {
      const lgMatch = svgSource.match(/<linearGradient[^>]*>[\s\S]*?<\/linearGradient>/);
      if (lgMatch) {
        const stops = [...lgMatch[0].matchAll(/stop-color="([^"]+)"/g)].map(m => m[1]);
        const angleMatch = lgMatch[0].match(/x2="([\d.]+)%"\s+y2="([\d.]+)%"/);
        if (stops.length >= 2) {
          gradient = `linear-gradient(135deg, ${stops.join(", ")})`;
        }
      }
    }
    elements.push({
      id: uid("bg"), type: "rect", name: "Background",
      x: 0, y: 0, width: canvasW, height: canvasH,
      rotation: 0, zIndex: zi++, locked: false, visible: true, opacity: 1, blendMode: "normal",
      fill: isGrad ? svgSource.match(/stop-color="([^"]+)"/)?.[1] ?? "#1a1a2e" : fill,
      gradient,
      borderRadius: 0, strokeWidth: 0,
    });
  }

  // ── Rects (decorations, overlays, CTA buttons) ────────────────────────────
  const rectRe = /<rect ([^/]*?)(?:\/>|>)/g;
  let rMatch: RegExpExecArray | null;
  let rectIdx = 0;
  while ((rMatch = rectRe.exec(svgSource)) !== null) {
    const attrs = parseAttrs(rMatch[1]);
    const x = parseFloat(attrs.x ?? "0") * scaleX;
    const y = parseFloat(attrs.y ?? "0") * scaleY;
    const w = parseFloat(attrs.width  ?? "0") * scaleX;
    const h = parseFloat(attrs.height ?? "0") * scaleY;
    if (w <= 0 || h <= 0) continue;
    // Skip the background rect (full-canvas) — already handled above
    if (rectIdx === 0 && Math.abs(w - canvasW) < 10 && Math.abs(h - canvasH) < 10) { rectIdx++; continue; }
    rectIdx++;

    elements.push({
      id: uid("rect"), type: "rect",
      name: attrs.rx && parseFloat(attrs.rx) > h * 0.4 ? "Pill Shape" : "Shape",
      x: Math.max(0, x), y: Math.max(0, y),
      width: Math.max(w, 4), height: Math.max(h, 4),
      rotation: 0, zIndex: zi++, locked: false, visible: true,
      opacity: parseFloat(attrs.opacity ?? "1"), blendMode: "normal",
      fill: attrs.fill ?? "#7c7ffa",
      borderRadius: parseFloat(attrs.rx ?? "0") * scaleX,
      strokeWidth: 0,
    });
  }

  // ── Text elements ──────────────────────────────────────────────────────────
  const textRe = /<text([^>]*)>([\s\S]*?)<\/text>/g;
  let tMatch: RegExpExecArray | null;
  while ((tMatch = textRe.exec(svgSource)) !== null) {
    const attrs  = parseAttrs(tMatch[1]);
    const inner  = tMatch[2];
    // Extract text from tspans
    const tspanTexts = [...inner.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1]);
    const rawText = tspanTexts.length ? tspanTexts.join(" ") : inner.replace(/<[^>]+>/g, "").trim();
    if (!rawText.trim()) continue;

    // Extract position from first tspan x/y or from text element
    const firstTspan = inner.match(/<tspan x="([\d.]+)" [^>]*y="([\d.]+)"/);
    const tx = parseFloat(firstTspan?.[1] ?? attrs.x ?? "0") * scaleX;
    const ty = parseFloat(firstTspan?.[2] ?? attrs.y ?? "0") * scaleY;
    const fs = parseFloat(attrs["font-size"] ?? "24");
    const fw = attrs["font-weight"] === "bold" ? 700 : parseFloat(attrs["font-weight"] ?? "400");

    // Estimate width from text content and font size
    const estimatedWidth = Math.min(canvasW * 0.9, rawText.length * fs * 0.58);
    const estimatedHeight = Math.max(fs * 1.4, tspanTexts.length * fs * 1.25);

    const anchorMap: Record<string, "left" | "center" | "right"> = {
      start: "left", middle: "center", end: "right",
    };
    const align = anchorMap[attrs["text-anchor"] ?? "start"] ?? "left";
    const elX = align === "center" ? tx - estimatedWidth / 2
              : align === "right"  ? tx - estimatedWidth
              : tx;

    elements.push({
      id: uid("text"), type: "text", name: guessTextName(rawText, fs),
      x: Math.max(0, elX), y: Math.max(0, ty),
      width:  Math.min(canvasW, estimatedWidth),
      height: estimatedHeight,
      rotation: 0, zIndex: zi++, locked: false, visible: true, opacity: 1, blendMode: "normal",
      text:         unescapeSvg(rawText),
      fontSize:     fs * scaleY,
      fontFamily:   mapFont(attrs["font-family"]?.split(",")[0]?.trim() ?? "DM Sans"),
      fontWeight:   fw,
      color:        attrs.fill ?? "#ffffff",
      align,
      lineHeight:   fs >= 72 ? 1.08 : fs >= 48 ? 1.14 : 1.25,
      letterSpacing: 0,
      textTransform: "none",
      fontStyle:   "normal",
      textDecoration: "none",
    });
  }

  return elements;
}

function guessTextName(text: string, fontSize: number): string {
  if (fontSize >= 60) return "Headline";
  if (fontSize >= 36) return "Subheadline";
  if (fontSize >= 20) return "Body Copy";
  return "Small Text";
}

function unescapeSvg(s: string): string {
  return s
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
