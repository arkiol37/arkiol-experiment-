// src/engines/hierarchy/enforcer.ts
import { Zone, ZoneId } from "../layout/families";

export interface TextContent {
  zoneId:     ZoneId;
  text:       string;
  fontSize:   number;
  weight:     number;
  color:      string;
  fontFamily: string;
}

export interface HierarchyViolation {
  zoneId:  string;
  issue:   string;
  applied: string;
}

export interface HierarchyResult {
  contents:   TextContent[];
  violations: HierarchyViolation[];
  valid:      boolean;
}

// Canonical weight per zone role
const ROLE_WEIGHTS: Partial<Record<ZoneId, number>> = {
  headline: 800,
  subhead:  600,
  body:     400,
  cta:      700,
  badge:    600,
  legal:    400,
  price:    700,
  tagline:  500,
};

// Required size ordering (larger → smaller)
const SIZE_HIERARCHY: ZoneId[] = ["headline", "subhead", "body", "legal"];

/**
 * Validates and enforces typographic hierarchy rules.
 * All violations are auto-corrected — assets cannot be structurally broken
 * by LLM output that doesn't respect layout constraints.
 */
export function enforceHierarchy(
  zones:    Zone[],
  contents: TextContent[]
): HierarchyResult {
  const result: TextContent[] = contents.map(c => ({ ...c }));
  const violations: HierarchyViolation[] = [];
  const zoneMap = new Map(zones.map(z => [z.id, z]));

  for (const content of result) {
    const zone = zoneMap.get(content.zoneId as ZoneId);
    if (!zone) continue;

    // 1. Font size min bound
    if (zone.minFontSize && content.fontSize < zone.minFontSize) {
      violations.push({
        zoneId:  content.zoneId,
        issue:   `fontSize ${content.fontSize}px is below minimum ${zone.minFontSize}px`,
        applied: `Raised to ${zone.minFontSize}px`,
      });
      content.fontSize = zone.minFontSize;
    }

    // 2. Font size max bound
    if (zone.maxFontSize && content.fontSize > zone.maxFontSize) {
      violations.push({
        zoneId:  content.zoneId,
        issue:   `fontSize ${content.fontSize}px exceeds maximum ${zone.maxFontSize}px`,
        applied: `Clamped to ${zone.maxFontSize}px`,
      });
      content.fontSize = zone.maxFontSize;
    }

    // 3. Font weight by role
    const requiredWeight = ROLE_WEIGHTS[content.zoneId as ZoneId];
    if (requiredWeight && content.weight !== requiredWeight) {
      violations.push({
        zoneId:  content.zoneId,
        issue:   `weight ${content.weight} doesn't match role expectation ${requiredWeight}`,
        applied: `Set to ${requiredWeight}`,
      });
      content.weight = requiredWeight;
    }

    // 4. Allowed weights from zone constraints
    const allowedWeights = zone.constraints?.fontWeight;
    if (allowedWeights?.length && !allowedWeights.includes(content.weight)) {
      const closest = allowedWeights.reduce((a, b) =>
        Math.abs(b - content.weight) < Math.abs(a - content.weight) ? b : a
      );
      violations.push({
        zoneId:  content.zoneId,
        issue:   `weight ${content.weight} not in allowed set [${allowedWeights.join(", ")}]`,
        applied: `Set to nearest allowed: ${closest}`,
      });
      content.weight = closest;
    }

    // 5. Character limit
    const maxChars = zone.constraints?.maxChars;
    if (maxChars && content.text.length > maxChars) {
      violations.push({
        zoneId:  content.zoneId,
        issue:   `text length ${content.text.length} exceeds maxChars ${maxChars}`,
        applied: `Truncated to ${maxChars - 1} chars with ellipsis`,
      });
      content.text = content.text.slice(0, maxChars - 1) + "…";
    }

    // 6. Sanitize text — remove HTML/SVG injection
    content.text = content.text
      .replace(/[<>]/g, "")
      .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, "&amp;")
      .trim();

    // 7. Ensure valid hex color
    if (!/^#[0-9a-fA-F]{6}$/.test(content.color)) {
      violations.push({
        zoneId:  content.zoneId,
        issue:   `invalid color value: ${content.color}`,
        applied: "Reset to #ffffff",
      });
      content.color = "#ffffff";
    }
  }

  // 8. Enforce size ordering across hierarchy zones
  const byZone = new Map(result.map(c => [c.zoneId, c]));
  for (let i = 0; i < SIZE_HIERARCHY.length - 1; i++) {
    const biggerZone  = SIZE_HIERARCHY[i];
    const smallerZone = SIZE_HIERARCHY[i + 1];
    const bigger  = byZone.get(biggerZone);
    const smaller = byZone.get(smallerZone);

    if (bigger && smaller && bigger.fontSize <= smaller.fontSize) {
      const newSize = smaller.fontSize + 4;
      violations.push({
        zoneId:  biggerZone,
        issue:   `${biggerZone}(${bigger.fontSize}px) ≤ ${smallerZone}(${smaller.fontSize}px) — hierarchy broken`,
        applied: `${biggerZone} bumped to ${newSize}px`,
      });
      bigger.fontSize = newSize;
    }
  }

  return {
    contents:   result,
    violations,
    valid:      violations.length === 0,
  };
}
