// src/engines/render/text-runs.ts
//
// Step 64 — rendering helper for multi-run styled text.
//
// A `TextRun[]` lets a zone carry per-segment style overrides (fill,
// weight, italic) — so a headline like "3 Simple Steps" can emit
// "Steps" in an accent color + heavier weight while the rest inherits
// from the zone. The SVG builder walks the measured lines (which wrap
// the full `text`) together with the run list, producing one `<tspan>`
// per run × line cell.
//
// Extracted into its own file so it can be unit-tested without loading
// the full svg-builder-ultimate module (which imports `server-only`
// and therefore can't be used in Node-side tests).

export interface TextRun {
  text:    string;
  color?:  string;   // hex; falls back to zone-level color when absent
  weight?: number;   // 100..900; falls back to zone-level weight
  italic?: boolean;  // style override (default inherited)
}

const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&apos;",
};
function escSvg(s: string): string {
  return s.replace(/[&<>"']/g, ch => XML_ESCAPE[ch]);
}

function f(n: number): string {
  // Two decimals, trailing-zero trimmed — matches the builder's `f`.
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "0";
}

/**
 * Render measured `lines` as tspans, distributing per-run style overrides
 * across the wrapped output. If the joined run text doesn't match the
 * wrapped text (ignoring whitespace), falls back to emitting each line
 * as a single plain tspan — we prefer correct-but-unstyled over
 * misaligned spans that would shuffle color across the wrong words.
 */
export function renderRunTspans(
  lines:         readonly string[],
  runs:          readonly TextRun[],
  anchorX:       number,
  lineHeight:    number,
  lineTransform: (l: string) => string = l => l,
): string[] {
  const joined  = runs.map(r => r.text).join("");
  const wrapped = lines.join("");
  if (joined.replace(/\s+/g, "") !== wrapped.replace(/\s+/g, "")) {
    return lines.map((l, i) =>
      `<tspan x="${f(anchorX)}" dy="${i === 0 ? "0" : f(lineHeight)}">${escSvg(lineTransform(l))}</tspan>`
    );
  }

  const out: string[] = [];
  let runIdx     = 0;
  let runOffset  = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lineTransform(lines[lineIdx]);
    let remaining = line;
    let firstOnLine = true;
    while (remaining.length > 0 && runIdx < runs.length) {
      const run      = runs[runIdx];
      const runText  = lineTransform(run.text);
      const avail    = runText.length - runOffset;
      if (avail <= 0) { runIdx++; runOffset = 0; continue; }
      const take     = Math.min(avail, remaining.length);
      const segment  = runText.substring(runOffset, runOffset + take);
      const attrs: string[] = [];
      if (firstOnLine) {
        attrs.push(`x="${f(anchorX)}"`);
        attrs.push(`dy="${lineIdx === 0 ? "0" : f(lineHeight)}"`);
      }
      if (run.color)   attrs.push(`fill="${run.color}"`);
      if (run.weight)  attrs.push(`font-weight="${run.weight}"`);
      if (run.italic)  attrs.push(`font-style="italic"`);
      out.push(`<tspan ${attrs.join(" ")}>${escSvg(segment)}</tspan>`);
      remaining = remaining.substring(take);
      runOffset += take;
      firstOnLine = false;
      if (runOffset >= runText.length) { runIdx++; runOffset = 0; }
    }
  }
  return out;
}
