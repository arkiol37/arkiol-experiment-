// src/engines/memory/output-history.ts
//
// Cross-request output history tracking.
// Records theme fingerprints of recent generations and detects
// near-duplicate outputs to ensure visual diversity across requests.

import type { DesignTheme } from "../render/design-themes";

const _recentOutputFingerprints: string[] = [];
const RECENT_OUTPUT_HISTORY = 40;

export function themeFingerprint(theme: DesignTheme): string {
  const bgKind = theme.background.kind;
  const bgColors = "colors" in theme.background
    ? (theme.background as any).colors.slice(0, 2).join(",")
    : ("color" in theme.background ? (theme.background as any).color : "");
  const decoKinds = [...new Set(theme.decorations.map(d => d.kind))].sort().join(",");
  const paletteSig = [theme.palette.primary, theme.palette.background].join(",").toLowerCase();
  return `${theme.id}|${bgKind}|${bgColors}|${decoKinds}|${paletteSig}`;
}

export function recordOutputFingerprint(theme: DesignTheme): void {
  const fp = themeFingerprint(theme);
  _recentOutputFingerprints.unshift(fp);
  if (_recentOutputFingerprints.length > RECENT_OUTPUT_HISTORY) {
    _recentOutputFingerprints.pop();
  }
}

export function isRecentDuplicate(theme: DesignTheme): boolean {
  const fp = themeFingerprint(theme);
  return _recentOutputFingerprints.includes(fp);
}
