import { LayoutCandidate, LayoutElement } from "./layout-intelligence";

export interface TypographyMetrics {
  fontSize: number;
  lineHeight: number;
  tracking: number;
  lines: string[];
  overflowRisk: number;
}

export interface TypographyPlan {
  headline?: TypographyMetrics;
  subhead?: TypographyMetrics;
  body?: TypographyMetrics;
  cta?: TypographyMetrics;
}

export interface CopyPayload {
  headline?: string;
  subhead?: string;
  body?: string;
  cta?: string;
}

export function buildTypographyPlan(layout: LayoutCandidate, copy: CopyPayload): TypographyPlan {
  return {
    headline: copy.headline ? fitTextBlock(copy.headline, findElement(layout, "headline"), 92, 28, true) : undefined,
    subhead: copy.subhead ? fitTextBlock(copy.subhead, findElement(layout, "subhead"), 38, 18, false) : undefined,
    body: copy.body ? fitTextBlock(copy.body, findElement(layout, "body"), 24, 14, false) : undefined,
    cta: copy.cta ? fitTextBlock(copy.cta, findElement(layout, "cta"), 22, 14, false) : undefined,
  };
}

export function fitTextBlock(
  text: string,
  element: LayoutElement | undefined,
  maxFontSize: number,
  minFontSize: number,
  forceEmphasis: boolean
): TypographyMetrics {
  if (!element) {
    return {
      fontSize: minFontSize,
      lineHeight: minFontSize * 1.2,
      tracking: 0,
      lines: [text],
      overflowRisk: 1,
    };
  }

  const boxWidthPx = element.rect.w * 10.8;
  const boxHeightPx = element.rect.h * 10.8;
  let fontSize = maxFontSize;
  let bestLines = [text];

  while (fontSize >= minFontSize) {
    const lines = breakLines(text, boxWidthPx, fontSize, element.maxLines ?? 4, forceEmphasis);
    const lineHeight = fontSize * (forceEmphasis ? 0.96 : 1.22);
    const totalHeight = lines.length * lineHeight;
    if (totalHeight <= boxHeightPx && lines.length <= (element.maxLines ?? 4)) {
      bestLines = lines;
      const tracking = calculateTracking(text, fontSize, forceEmphasis);
      return {
        fontSize,
        lineHeight,
        tracking,
        lines,
        overflowRisk: estimateOverflowRisk(lines, boxWidthPx, fontSize),
      };
    }
    fontSize -= forceEmphasis ? 3 : 1;
    bestLines = lines;
  }

  return {
    fontSize: minFontSize,
    lineHeight: minFontSize * 1.22,
    tracking: calculateTracking(text, minFontSize, forceEmphasis),
    lines: bestLines,
    overflowRisk: 1,
  };
}

export function breakLines(
  text: string,
  boxWidthPx: number,
  fontSize: number,
  maxLines: number,
  forceEmphasis: boolean
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;

  const targetChars = Math.max(6, Math.floor(boxWidthPx / (fontSize * (forceEmphasis ? 0.56 : 0.5))));
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= targetChars || current.length === 0) {
      current = candidate;
      continue;
    }

    lines.push(balanceLine(current, targetChars));
    current = word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (current) {
    lines.push(current);
  }

  const remainingWords = words.slice(lines.join(" ").split(/\s+/).filter(Boolean).length);
  if (remainingWords.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${remainingWords.join(" ")}`.trim();
  }

  return rebalanceLines(lines.slice(0, maxLines), targetChars, forceEmphasis);
}

function rebalanceLines(lines: string[], targetChars: number, forceEmphasis: boolean): string[] {
  if (lines.length < 2) return lines;
  const rebalanced = [...lines];

  for (let i = 0; i < rebalanced.length - 1; i++) {
    const current = rebalanced[i];
    const next = rebalanced[i + 1];
    if (current.length < targetChars * 0.55 && next.includes(" ")) {
      const nextWords = next.split(" ");
      const moved = nextWords.shift();
      if (moved) {
        rebalanced[i] = `${current} ${moved}`.trim();
        rebalanced[i + 1] = nextWords.join(" ");
      }
    }
  }

  return rebalanced.map(line => forceEmphasis ? line.toUpperCase() : line).filter(Boolean);
}

function balanceLine(line: string, targetChars: number): string {
  if (line.length <= targetChars * 1.15) return line;
  const words = line.split(" ");
  if (words.length < 3) return line;
  const midpoint = Math.ceil(words.length / 2);
  const firstHalf = words.slice(0, midpoint).join(" ");
  const secondHalf = words.slice(midpoint).join(" ");
  return firstHalf.length >= secondHalf.length ? firstHalf : line;
}

function calculateTracking(text: string, fontSize: number, forceEmphasis: boolean): number {
  if (forceEmphasis && text.length <= 18) return 0.04;
  if (fontSize < 18) return 0.01;
  return text.length > 60 ? -0.02 : 0;
}

function estimateOverflowRisk(lines: string[], width: number, fontSize: number): number {
  const maxLine = Math.max(...lines.map(line => line.length), 0);
  const estimatedWidth = maxLine * fontSize * 0.54;
  return Math.max(0, Math.min(1, (estimatedWidth - width) / width + (lines.length > 4 ? 0.3 : 0)));
}

function findElement(layout: LayoutCandidate, id: string): LayoutElement | undefined {
  return layout.elements.find(element => element.id === id);
}
