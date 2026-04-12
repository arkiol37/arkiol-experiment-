// src/engines/render/gif-renderer.ts  — Arkiol Ultimate v4  (Canva-parity GIFs)
//
// v4 changes:
//  • renderGif: theme gradient drawn as proper canvas gradient each frame
//  • buildKineticTextFrames: tightened easing curve, larger text, corner ring deco
//  • buildFadeFrames: slide counter dots, gradient header bar, accent rings
//  • buildPulseCtaFrames: headline positioned via theme zone coords, glow ring
//  • NEW buildRevealFrames: wipe-reveal animation (premium feel)
//  • alphaHex handles rgb() and rgba() inputs, not just hex
//  • All frame builders honor accentColor from theme

// canvas and gif-encoder-2 are optional native dependencies.
// They are available in worker environments (Node.js with system libs)
// but NOT on Vercel serverless. We use dynamic lazy requires so that
// the module can be imported without crashing when these are absent.
// The renderGif() function will throw a clear error if called without them.

type CanvasType = { createCanvas: (w: number, h: number) => any };
type GIFEncoderCtor = new (w: number, h: number, algo: string, cumulative: boolean) => any;

// Lazily-resolved references — populated on first renderGif() call
let _createCanvas: ((w: number, h: number) => any) | null = null;
let _GIFEncoder: GIFEncoderCtor | null = null;
// Type alias for CanvasRenderingContext2D — only used as a local cast
type CanvasRenderingContext2D = any;

function loadNativeDeps(): void {
  if (_createCanvas && _GIFEncoder) return; // already loaded
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const canvasMod = require("canvas") as CanvasType;
    _createCanvas = canvasMod.createCanvas;
  } catch {
    throw new Error(
      "GIF rendering requires the 'canvas' native module which is not available " +
      "in this environment (e.g. Vercel serverless). " +
      "Run GIF generation in a dedicated worker with system libraries installed."
    );
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _GIFEncoder = require("gif-encoder-2") as GIFEncoderCtor;
  } catch {
    throw new Error(
      "GIF rendering requires the 'gif-encoder-2' module which is not available."
    );
  }
}
import { wrapText } from "./text-measure";

export const MAX_FRAMES = 60;

// ── Types ────────────────────────────────────────────────────────────────────

export interface GifTextElement {
  text:         string;
  x:            number;
  y:            number;
  fontSize:     number;
  fontWeight:   "normal" | "bold" | "600" | "700" | "800" | "900";
  color:        string;
  fontFamily:   string;
  align:        "left" | "center" | "right";
  maxWidth?:    number;
  letterSpacing?: number;
  textTransform?: "uppercase" | "none";
  lineHeight?:  number;
}

export interface GifShapeElement {
  type:    "rect" | "circle" | "line" | "roundrect" | "gradient_rect" | "ring" | "arc";
  x:       number;
  y:       number;
  w?:      number;
  h?:      number;
  r?:      number;
  color:   string;
  color2?: string;
  opacity: number;
  startAngle?: number;
  endAngle?:   number;
}

export interface GifFrame {
  backgroundColor:    string;
  backgroundGradient?: { colors: string[]; angle: number };
  shapes?:    GifShapeElement[];
  texts?:     GifTextElement[];
  delay?:     number;
}

export interface GifOptions {
  width: number; height: number; repeat: number; quality: number; fps?: number;
}

// ── Core renderer ──────────────────────────────────────────────────────────────

export async function renderGif(frames: GifFrame[], opts: GifOptions): Promise<Buffer> {
  // Load native deps — throws clearly if unavailable (e.g. Vercel serverless)
  loadNativeDeps();
  const createCanvas = _createCanvas!;
  const GIFEncoder   = _GIFEncoder!;

  const { width, height, repeat, quality, fps = 12 } = opts;
  const defaultDelay = Math.round(1000 / fps);
  const safeFrames   = frames.slice(0, MAX_FRAMES);

  const encoder = new GIFEncoder(width, height, "neuquant", true);
  encoder.setRepeat(repeat);
  encoder.setQuality(quality);
  encoder.start();

  for (const frame of safeFrames) {
    const canvas = createCanvas(width, height);
    const ctx    = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

    // Background
    if (frame.backgroundGradient && frame.backgroundGradient.colors.length > 1) {
      const g   = frame.backgroundGradient;
      const rad = (g.angle * Math.PI) / 180;
      const x1  = width / 2 - Math.sin(rad) * width * 0.7;
      const y1  = height / 2 + Math.cos(rad) * height * 0.7;
      const x2  = width / 2 + Math.sin(rad) * width * 0.7;
      const y2  = height / 2 - Math.cos(rad) * height * 0.7;
      const gr  = (ctx as any).createLinearGradient(x1, y1, x2, y2);
      g.colors.forEach((c, i) => gr.addColorStop(i / Math.max(g.colors.length - 1, 1), c));
      (ctx as any).fillStyle = gr;
    } else {
      (ctx as any).fillStyle = frame.backgroundColor;
    }
    (ctx as any).fillRect(0, 0, width, height);

    // Shapes
    for (const shape of frame.shapes ?? []) {
      (ctx as any).save();
      (ctx as any).globalAlpha = shape.opacity;

      if (shape.type === "gradient_rect" && shape.color2) {
        const gr = (ctx as any).createLinearGradient(shape.x, shape.y, shape.x + (shape.w ?? 0), shape.y);
        gr.addColorStop(0, shape.color);
        gr.addColorStop(1, shape.color2);
        (ctx as any).fillStyle = gr;
        (ctx as any).fillRect(shape.x, shape.y, shape.w ?? 100, shape.h ?? 10);
      } else if (shape.type === "rect") {
        (ctx as any).fillStyle = shape.color;
        (ctx as any).fillRect(shape.x, shape.y, shape.w ?? 100, shape.h ?? 10);
      } else if (shape.type === "roundrect") {
        (ctx as any).fillStyle = shape.color;
        canvasRoundRect(ctx, shape.x, shape.y, shape.w ?? 100, shape.h ?? 40, shape.r ?? 8);
        (ctx as any).fill();
      } else if (shape.type === "circle") {
        (ctx as any).fillStyle = shape.color;
        (ctx as any).beginPath();
        (ctx as any).arc(shape.x, shape.y, shape.r ?? 40, 0, Math.PI * 2);
        (ctx as any).fill();
      } else if (shape.type === "ring") {
        (ctx as any).strokeStyle = shape.color;
        (ctx as any).lineWidth   = shape.w ?? 2;
        (ctx as any).beginPath();
        (ctx as any).arc(shape.x, shape.y, shape.r ?? 40, 0, Math.PI * 2);
        (ctx as any).stroke();
      } else if (shape.type === "arc") {
        (ctx as any).strokeStyle = shape.color;
        (ctx as any).lineWidth   = shape.w ?? 2;
        (ctx as any).lineCap     = "round";
        (ctx as any).beginPath();
        const s = ((shape.startAngle ?? 0) * Math.PI) / 180;
        const e = ((shape.endAngle   ?? 90) * Math.PI) / 180;
        (ctx as any).arc(shape.x, shape.y, shape.r ?? 40, s, e);
        (ctx as any).stroke();
      } else if (shape.type === "line") {
        (ctx as any).strokeStyle = shape.color;
        (ctx as any).lineWidth   = shape.h ?? 2;
        (ctx as any).lineCap     = "round";
        (ctx as any).beginPath();
        (ctx as any).moveTo(shape.x, shape.y);
        (ctx as any).lineTo(shape.x + (shape.w ?? 100), shape.y);
        (ctx as any).stroke();
      }
      (ctx as any).restore();
    }

    // Text
    for (const t of frame.texts ?? []) {
      (ctx as any).save();
      const fam = `"${t.fontFamily}", Arial, sans-serif`;
      (ctx as any).font          = `${t.fontWeight} ${t.fontSize}px ${fam}`;
      (ctx as any).fillStyle     = t.color;
      (ctx as any).textAlign     = t.align as CanvasTextAlign;
      (ctx as any).textBaseline  = "alphabetic";
      const display = t.textTransform === "uppercase" ? t.text.toUpperCase() : t.text;
      const lh      = t.lineHeight ?? t.fontSize * 1.18;

      if (t.maxWidth && display.includes(" ")) {
        const fw      = parseInt(String(t.fontWeight)) || 400;
        const wrapped = wrapText(display, t.fontSize, t.fontFamily, fw, t.maxWidth);
        let lineY     = t.y;
        for (const line of wrapped.lines) {
          (ctx as any).fillText(line, t.x, lineY, t.maxWidth);
          lineY += lh;
        }
      } else {
        (ctx as any).fillText(display, t.x, t.y, t.maxWidth);
      }
      (ctx as any).restore();
    }

    encoder.setDelay(frame.delay ?? defaultDelay);
    encoder.addFrame(ctx as any);
  }

  encoder.finish();
  return Buffer.from(encoder.out.getData());
}

// ── Zone descriptors (pipeline interface) ─────────────────────────────────────

export interface ZoneTextDesc {
  text: string; color: string; fontSize: number; fontFamily: string;
  x: number; y: number; maxWidth: number;
  weight: "bold" | "normal" | "600" | "700" | "800" | "900";
  align: "left" | "center" | "right";
}
export interface CtaDesc {
  text: string; color: string; bgColor: string; fontSize: number;
  fontFamily?: string; x: number; y: number; width: number; height: number;
  borderRadius?: number;
}

// ── buildKineticTextFrames — slide-up entrance with progress bar ───────────────

export interface KineticTextOptions {
  width: number; height: number; bgColor: string;
  gradientColors?: [string, ...string[]];
  headline:    ZoneTextDesc;
  subhead?:    ZoneTextDesc;
  cta?:        CtaDesc;
  frameCount?: number;
  fps?:        number;
  accentColor?: string;
}

export function buildKineticTextFrames(opts: KineticTextOptions): GifFrame[] {
  const { width, height, bgColor, gradientColors, headline, subhead, cta, accentColor } = opts;
  const frameCount = Math.min(opts.frameCount ?? 30, MAX_FRAMES);
  const accent     = accentColor ?? headline.color;
  const result: GifFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t     = i / Math.max(1, frameCount - 1);
    const eased = easeOutExpo(t);
    const alpha = Math.min(1, eased * 2.2);
    const liftH = (1 - eased) * height * 0.08;
    const lineW = width * eased;

    const texts: GifTextElement[] = [{
      text: headline.text, x: headline.x, y: headline.y + liftH,
      fontSize: headline.fontSize, fontWeight: headline.weight as any,
      color: alphaApply(headline.color, alpha), fontFamily: headline.fontFamily,
      align: headline.align, maxWidth: headline.maxWidth,
      lineHeight: headline.fontSize * 1.12,
    }];
    if (subhead) {
      texts.push({
        text: subhead.text, x: subhead.x, y: subhead.y + liftH * 0.55,
        fontSize: subhead.fontSize, fontWeight: subhead.weight as any,
        color: alphaApply(subhead.color, alpha * 0.82), fontFamily: subhead.fontFamily,
        align: subhead.align, maxWidth: subhead.maxWidth,
      });
    }

    const shapes: GifShapeElement[] = [
      // Bottom progress bar
      { type:"rect",  x:0, y:height-4, w:lineW, h:4, color:accent, opacity:0.95 },
      // Left accent strip
      { type:"rect",  x:0, y:0, w:Math.round(width*0.025), h:height, color:accent, opacity:0.12 },
      // Decorative rings top-right (fade in late)
      { type:"ring",  x:width*0.9, y:height*0.1, r:Math.min(width,height)*0.07, w:1.5, color:accent, opacity:alpha*0.22 },
      { type:"ring",  x:width*0.9, y:height*0.1, r:Math.min(width,height)*0.095, w:1, color:accent, opacity:alpha*0.1 },
    ];

    // CTA fades in after 70%
    if (cta && t > 0.68) {
      const ba = easeOutExpo((t - 0.68) / 0.32);
      const br = cta.borderRadius ?? 50;
      shapes.push({ type:"roundrect", x:cta.x, y:cta.y, w:cta.width, h:cta.height, r:br, color:cta.bgColor, opacity:ba });
      texts.push({
        text: cta.text, x: cta.x + cta.width / 2, y: cta.y + cta.height * 0.65,
        fontSize: cta.fontSize, fontWeight: "bold",
        color: alphaApply(cta.color, ba),
        fontFamily: cta.fontFamily ?? headline.fontFamily, align: "center",
        textTransform: "uppercase",
      });
    }

    result.push({
      backgroundColor: bgColor,
      backgroundGradient: gradientColors ? { colors: gradientColors, angle: 148 } : undefined,
      shapes, texts,
      delay: i === frameCount - 1 ? 2800 : 42,
    });
  }
  return result;
}

// ── buildFadeFrames — crossfade carousel ───────────────────────────────────────

export interface FadeFramesOptions {
  width: number; height: number; bgColor: string;
  gradientColors?: [string, ...string[]];
  slides: Array<{ headline: string; headlineColor?: string; fontSize?: number; sub?: string; subColor?: string; }>;
  framesPerSlide?: number;
  accentColor?:    string;
  fontFamily?:     string;
}

export function buildFadeFrames(opts: FadeFramesOptions): GifFrame[] {
  const { width, height, bgColor, gradientColors, slides, accentColor = "#4f6ef7", fontFamily = "Montserrat" } = opts;
  const totalSlides = slides.length || 1;
  const maxPer = Math.floor(MAX_FRAMES / totalSlides);
  const fps    = Math.min(opts.framesPerSlide ?? 20, maxPer);
  const result: GifFrame[] = [];

  slides.forEach((slide, si) => {
    const hColor = slide.headlineColor ?? "#ffffff";
    const fs     = slide.fontSize ?? Math.round(Math.min(width * 0.07, 70));

    for (let i = 0; i < fps; i++) {
      const t     = i / Math.max(1, fps - 1);
      // Ease in and out within each slide
      const alpha = t < 0.25 ? easeOutExpo(t / 0.25) : t > 0.75 ? easeOutExpo((1 - t) / 0.25) : 1;

      const texts: GifTextElement[] = [{
        text: slide.headline, x: width / 2, y: height * 0.32, fontSize: fs,
        fontWeight: "bold", color: alphaApply(hColor, alpha),
        fontFamily, align: "center", maxWidth: width * 0.84,
        textTransform: "uppercase", lineHeight: fs * 1.1,
      }];
      if (slide.sub) {
        texts.push({
          text: slide.sub, x: width / 2, y: height * 0.54,
          fontSize: Math.round(fs * 0.46), fontWeight: "normal",
          color: alphaApply(slide.subColor ?? hColor, alpha * 0.72),
          fontFamily, align: "center", maxWidth: width * 0.72,
        });
      }
      // Slide progress dots
      for (let di = 0; di < totalSlides; di++) {
        const dop = di === si ? 1 : 0.3;
        const dr  = di === si ? 5 : 3.5;
        texts.push({
          text: "●", x: width / 2 + (di - (totalSlides-1)/2) * 16, y: height * 0.9,
          fontSize: Math.round(dr * 2), fontWeight: "normal",
          color: alphaApply(accentColor, dop * alpha),
          fontFamily: "Arial", align: "center",
        });
      }

      const shapes: GifShapeElement[] = [
        // Accent divider line between headline and sub
        { type:"line",  x:width*0.22, y:height*0.48, w:width*0.56, h:1.5, color:accentColor, opacity:alpha*0.65 },
        // Decorative corner rings
        { type:"ring",  x:width*0.9,  y:height*0.1,  r:Math.min(width,height)*0.07, w:1.5, color:accentColor, opacity:alpha*0.22 },
        { type:"ring",  x:width*0.1,  y:height*0.92, r:Math.min(width,height)*0.055,w:1,   color:accentColor, opacity:alpha*0.15 },
        // Top gradient header bar
        { type:"gradient_rect", x:0, y:0, w:width, h:height*0.08, color:accentColor+"44", color2:"transparent", opacity:alpha*0.5 },
      ];

      result.push({
        backgroundColor: bgColor,
        backgroundGradient: gradientColors ? { colors:gradientColors, angle:148 } : undefined,
        shapes, texts,
        delay: i === fps - 1 ? 1000 : 42,
      });
    }
  });
  return result;
}

// ── buildPulseCtaFrames — pulsing CTA with headline ────────────────────────────

export interface PulseCtaOptions {
  width: number; height: number; bgColor: string;
  gradientColors?: [string, ...string[]];
  headline?:   { text: string; color: string; fontSize: number };
  cta:         { text: string; color: string; bgColor: string; x: number; y: number; w: number; h: number };
  frameCount?: number;
  fontFamily?: string;
  accentColor?: string;
}

export function buildPulseCtaFrames(opts: PulseCtaOptions): GifFrame[] {
  const { width, height, bgColor, gradientColors, headline, cta, fontFamily = "Montserrat", accentColor } = opts;
  const frameCount = Math.min(opts.frameCount ?? 32, MAX_FRAMES);
  const accent     = accentColor ?? cta.bgColor;

  return Array.from({ length: frameCount }, (_, i) => {
    const t     = i / Math.max(1, frameCount - 1);
    const pulse = 1 + 0.055 * Math.sin(t * Math.PI * 4);
    const glow  = 0.08 + 0.14 * Math.abs(Math.sin(t * Math.PI * 4));
    const pW    = cta.w * pulse, pH = cta.h * pulse;
    const pX    = cta.x + (cta.w - pW) / 2, pY = cta.y + (cta.h - pH) / 2;
    const fs    = Math.round(cta.h * 0.44 * pulse);

    const shapes: GifShapeElement[] = [
      // Outer glow ring
      { type:"circle",   x:cta.x+cta.w/2, y:cta.y+cta.h/2, r:pH*0.9, color:cta.bgColor, opacity:glow },
      // Main button
      { type:"roundrect",x:pX, y:pY, w:pW, h:pH, r:pH/2, color:cta.bgColor, opacity:1 },
      // Accent lines
      { type:"line", x:width*0.06, y:height*0.16, w:width*0.14, h:1.5, color:accent, opacity:0.28 },
      { type:"line", x:width*0.8,  y:height*0.84, w:width*0.14, h:1.5, color:accent, opacity:0.2 },
      // Corner rings
      { type:"ring", x:width*0.9, y:height*0.1, r:Math.min(width,height)*0.07, w:1.5, color:accent, opacity:0.15 },
    ];

    const texts: GifTextElement[] = [];
    if (headline) {
      texts.push({
        text: headline.text, x: width / 2, y: height * 0.25,
        fontSize: headline.fontSize, fontWeight: "bold", color: headline.color,
        fontFamily, align: "center", maxWidth: width * 0.84,
        lineHeight: headline.fontSize * 1.1,
      });
    }
    texts.push({
      text: cta.text, x: pX + pW / 2, y: pY + pH * 0.65,
      fontSize: fs, fontWeight: "bold", color: cta.color,
      fontFamily, align: "center", textTransform: "uppercase",
    });

    return {
      backgroundColor: bgColor,
      backgroundGradient: gradientColors ? { colors:gradientColors, angle:148 } : undefined,
      shapes, texts, delay: 42,
    };
  });
}

// ── buildRevealFrames — wipe-reveal animation (premium) ────────────────────────

export interface RevealFramesOptions {
  width: number; height: number; bgColor: string;
  gradientColors?: [string, ...string[]];
  headline:    ZoneTextDesc;
  subhead?:    ZoneTextDesc;
  accentColor?: string;
  frameCount?:  number;
}

export function buildRevealFrames(opts: RevealFramesOptions): GifFrame[] {
  const { width, height, bgColor, gradientColors, headline, subhead, accentColor } = opts;
  const frameCount = Math.min(opts.frameCount ?? 28, MAX_FRAMES);
  const accent     = accentColor ?? headline.color;
  const result: GifFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t      = i / Math.max(1, frameCount - 1);
    const reveal = easeOutExpo(Math.min(1, t * 1.6));
    const clipW  = width * reveal;

    const shapes: GifShapeElement[] = [
      // Reveal overlay (black block that shrinks)
      { type:"rect",   x:clipW, y:0, w:width-clipW, h:height, color:"#000000", opacity:1 },
      // Accent bar that sweeps along the reveal edge
      { type:"rect",   x:Math.max(0, clipW-4), y:0, w:4, h:height, color:accent, opacity:reveal > 0.02 ? 0.9 : 0 },
      // Bottom progress line
      { type:"rect",   x:0, y:height-3, w:clipW, h:3, color:accent, opacity:0.7 },
    ];

    const alpha  = Math.min(1, reveal * 1.5);
    const texts: GifTextElement[] = [{
      text: headline.text, x: headline.x, y: headline.y,
      fontSize: headline.fontSize, fontWeight: headline.weight as any,
      color: alphaApply(headline.color, alpha), fontFamily: headline.fontFamily,
      align: headline.align, maxWidth: headline.maxWidth,
      lineHeight: headline.fontSize * 1.1,
    }];
    if (subhead) {
      texts.push({
        text: subhead.text, x: subhead.x, y: subhead.y,
        fontSize: subhead.fontSize, fontWeight: subhead.weight as any,
        color: alphaApply(subhead.color, alpha * 0.8), fontFamily: subhead.fontFamily,
        align: subhead.align, maxWidth: subhead.maxWidth,
      });
    }

    result.push({
      backgroundColor: bgColor,
      backgroundGradient: gradientColors ? { colors:gradientColors, angle:148 } : undefined,
      shapes, texts,
      delay: i === frameCount - 1 ? 2400 : 42,
    });
  }
  return result;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function alphaApply(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 0.999) return color;
  if (color.startsWith("rgba")) {
    return color.replace(/,\s*[\d.]+\)/, `,${a.toFixed(3)})`);
  }
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `,${a.toFixed(3)})`);
  }
  // hex
  const c = color.replace("#","").slice(0,6).padEnd(6,"0");
  const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

function canvasRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const s = Math.min(r, w/2, h/2);
  (ctx as any).beginPath();
  (ctx as any).moveTo(x+s, y);       (ctx as any).lineTo(x+w-s, y);     (ctx as any).quadraticCurveTo(x+w, y,   x+w, y+s);
  (ctx as any).lineTo(x+w, y+h-s);   (ctx as any).quadraticCurveTo(x+w, y+h, x+w-s, y+h);
  (ctx as any).lineTo(x+s, y+h);     (ctx as any).quadraticCurveTo(x,   y+h, x,   y+h-s);
  (ctx as any).lineTo(x, y+s);       (ctx as any).quadraticCurveTo(x,   y,   x+s, y);
  (ctx as any).closePath();
}
