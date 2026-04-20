// src/engines/ai/structured-content.ts
//
// STEP 7 — Template-type-aware structured content generation.
//
// What this module does
// ─────────────────────────────────────────────────────────────────────────────
// Before a variation is rendered we ask OpenAI for a STRUCTURED payload —
// headline + subheadline + CTA plus a list of body items shaped for the
// selected template type (tips, checklist, steps, ranked list, quote, etc).
//
// The old path asked OpenAI for "text for each zone id", which regularly
// produced one sentence in body and nothing in bullet_1/2/3 — so list-style
// templates rendered with a single block of text. This module fixes that by
// having OpenAI return a list of items directly, then mapping them onto the
// canvas zones that actually exist.
//
// What this module does NOT do
// ─────────────────────────────────────────────────────────────────────────────
// No layout, typography, colour, decoration, or SVG concerns. The output is
// plain content only — the existing design engine still owns every visual
// decision. When OPENAI_API_KEY is absent we return null and the builder
// falls back to the existing `buildFallbackTextContent` path.
//
// Per-variation uniqueness
// ─────────────────────────────────────────────────────────────────────────────
// Each variation for the same brief must produce distinct copy. We keep a
// tiny in-memory ring buffer of recent headlines + item phrases per
// (briefHash, templateType) and pass it back to the model as a "must avoid
// repeating these" block. Combined with a variation-seeded temperature
// jitter this reliably produces varied output across a gallery batch.

import "server-only";
import { z } from "zod";
import { detectCapabilities } from "@arkiol/shared";
import { chatJSON } from "../../lib/openai";
import { withRetry } from "../../lib/error-handling";
import type { BriefAnalysis } from "./brief-analyzer";
import type { TemplateType } from "../templates/template-types";

// ── Public shape ─────────────────────────────────────────────────────────────

export interface StructuredContent {
  /** Primary headline — the largest line on the canvas. */
  headline:   string;
  /** One sentence that expands on the headline. */
  subhead:    string;
  /** Action verb + value. 2–4 words. */
  cta:        string;
  /** Short shouted label (SALE / NEW / LIMITED) when the template wants one. */
  badge?:     string;
  /** Context line above the headline. 1–3 words. */
  eyebrow?:   string;
  /** Short source / attribution (used by quote template). */
  attribution?: string;
  /** Supporting lead line placed before the bullet zones when present. */
  supporting?:  string;
  /**
   * Template-shaped content items. Exactly `targetItemCount` items when the
   * template asks for a list (tips / checklist / steps / list_based /
   * educational). Empty for promotional / quote / minimal headline-first
   * templates.
   */
  items:      string[];
  /** Meta for logs / audit — never rendered. */
  meta: {
    templateType:   TemplateType;
    variationIdx:   number;
    source:         "openai" | "fallback";
    itemKind:       ItemKind;
  };
}

export type ItemKind =
  | "bullets"          // generic bullet list (list_based)
  | "checklist_items"  // actionable benefits (checklist)
  | "tips"             // short tip lines (tips)
  | "steps"            // ordered steps (step_by_step)
  | "insights"         // teaching points (educational)
  | "benefits"         // promotional bullets (promotional)
  | "none";            // quote / minimal — no list

export interface StructuredContentParams {
  brief:         BriefAnalysis;
  templateType:  TemplateType;
  variationIdx:  number;
  format:        string;
  categoryName?: string;
  /** Zones actually present on this canvas — used to decide which zones
   *  get populated and how many items to request. */
  availableZoneIds: Set<string>;
}

// ── Template-type policy ─────────────────────────────────────────────────────
//
// Each template type declares:
//   - itemKind: what the items mean semantically
//   - targetItemCount: how many items to request (capped by available zones)
//   - wantsBadge / wantsEyebrow / wantsAttribution / wantsSupporting
//   - itemGuidance: a sentence the model uses to shape each item's voice

interface TemplatePolicy {
  itemKind:          ItemKind;
  targetItemCount:   number;
  wantsBadge:        boolean;
  wantsEyebrow:      boolean;
  wantsAttribution:  boolean;
  wantsSupporting:   boolean;
  itemGuidance:      string;
  headlineGuidance:  string;
  ctaGuidance:       string;
}

const TEMPLATE_POLICY: Record<TemplateType, TemplatePolicy> = {
  checklist: {
    itemKind:         "checklist_items",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each item is a concrete benefit phrased as an actionable outcome. 3–7 words. No punctuation at the end. Start with a capital letter.",
    headlineGuidance: "Headline names the outcome or list topic. 3–7 words, assertive.",
    ctaGuidance:      "Imperative. 2–4 words. Encourage action on the list.",
  },
  tips: {
    itemKind:         "tips",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each tip is a short directive — verb-led, specific, 4–10 words. Must teach something, not restate the headline.",
    headlineGuidance: "Headline teases the payoff of the tips. 3–7 words, curiosity-forward.",
    ctaGuidance:      "Inviting. 2–4 words — 'Try This', 'See More', 'Save Pack'.",
  },
  quote: {
    itemKind:         "none",
    targetItemCount:  0,
    wantsBadge:       false,
    wantsEyebrow:     false,
    wantsAttribution: true,
    wantsSupporting:  false,
    itemGuidance:     "",
    headlineGuidance: "Headline IS the quote itself — memorable, between 6 and 18 words. Do not wrap in quotation marks.",
    ctaGuidance:      "Quiet. 2–3 words. Often optional.",
  },
  step_by_step: {
    itemKind:         "steps",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each step is a complete instruction. Verb-led, 3–8 words. Do not number — the design adds the numerals.",
    headlineGuidance: "Headline names the goal of the process. 3–7 words.",
    ctaGuidance:      "Imperative. 2–4 words — 'Start Now', 'Begin Guide'.",
  },
  list_based: {
    itemKind:         "bullets",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each item is a concrete list entry — a pick, a name, a category. 2–6 words. Do not prefix with numbers or bullets.",
    headlineGuidance: "Headline names the list. Often starts with a number ('5 Wines…') or 'Top …'.",
    ctaGuidance:      "Curious. 2–4 words — 'See Full List', 'Explore'.",
  },
  promotional: {
    itemKind:         "benefits",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  false,
    itemGuidance:     "Each benefit is a reason to buy NOW — specific, scannable, 3–7 words. Include numbers or proof when possible.",
    headlineGuidance: "Headline is bold and offer-forward. 3–8 words. Power words encouraged.",
    ctaGuidance:      "Urgent. 2–4 words — 'Shop Now', 'Claim Today'.",
  },
  educational: {
    itemKind:         "insights",
    targetItemCount:  3,
    wantsBadge:       false,
    wantsEyebrow:     true,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each insight is a concrete factoid or principle. 4–10 words. Teach, don't sell.",
    headlineGuidance: "Headline names the lesson. 3–8 words.",
    ctaGuidance:      "Inviting. 2–4 words — 'Learn More', 'Start Course'.",
  },
  minimal: {
    itemKind:         "none",
    targetItemCount:  0,
    wantsBadge:       false,
    wantsEyebrow:     true,
    wantsAttribution: false,
    wantsSupporting:  false,
    itemGuidance:     "",
    headlineGuidance: "Headline is a short, resonant phrase. 2–6 words, elegant.",
    ctaGuidance:      "Quiet. 1–3 words — 'Begin', 'Enter'.",
  },
};

// ── Zod schema for the model response ────────────────────────────────────────

const StructuredResponseSchema = z.object({
  headline:    z.string().min(1).max(120),
  subhead:     z.string().max(220).default(""),
  cta:         z.string().max(40).default(""),
  badge:       z.string().max(30).optional(),
  eyebrow:     z.string().max(40).optional(),
  attribution: z.string().max(80).optional(),
  supporting:  z.string().max(200).optional(),
  items:       z.array(z.string().min(1).max(120)).max(8).default([]),
});

// ── Recent-output memory (per brief + template type) ─────────────────────────

interface RecentOutput { headline: string; items: string[]; }
const RECENT_CAP = 6;
const recentByKey = new Map<string, RecentOutput[]>();

function briefKey(brief: BriefAnalysis, templateType: TemplateType): string {
  const head = (brief.headline ?? "").toLowerCase().slice(0, 64);
  const intent = (brief.intent ?? "").toLowerCase().slice(0, 48);
  return `${templateType}::${head}::${intent}`;
}

function remember(key: string, out: RecentOutput) {
  const list = recentByKey.get(key) ?? [];
  list.push(out);
  while (list.length > RECENT_CAP) list.shift();
  recentByKey.set(key, list);
}

function recentPhrases(key: string): string[] {
  const list = recentByKey.get(key) ?? [];
  const phrases: string[] = [];
  for (const r of list) {
    if (r.headline) phrases.push(r.headline);
    for (const it of r.items) phrases.push(it);
  }
  return phrases.slice(-12);
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function generateStructuredContent(
  params: StructuredContentParams,
): Promise<StructuredContent | null> {
  if (!detectCapabilities().ai) return null;

  const { brief, templateType, variationIdx, format, categoryName, availableZoneIds } = params;
  const policy = TEMPLATE_POLICY[templateType];

  // Clamp requested item count to what the zones can actually show.
  const zoneBullets = ["bullet_1", "bullet_2", "bullet_3"].filter(id => availableZoneIds.has(id)).length;
  const targetItemCount = policy.targetItemCount === 0
    ? 0
    : Math.min(policy.targetItemCount, Math.max(2, zoneBullets || policy.targetItemCount));

  const key       = briefKey(brief, templateType);
  const avoidList = recentPhrases(key);

  const systemPrompt = buildSystemPrompt({ brief, templateType, format, categoryName, policy, targetItemCount, avoidList, variationIdx });
  const userPrompt   = buildUserPrompt(brief, templateType, variationIdx);

  // Slight per-variation temperature jitter to force variety — deterministic
  // on variationIdx so reruns stay stable.
  const temperature = 0.75 + ((variationIdx * 7) % 5) * 0.04; // 0.75..0.91

  try {
    const raw = await withRetry(
      () => chatJSON(
        [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        { model: "gpt-4o", temperature, max_tokens: 600 },
      ),
      { maxAttempts: 2 },
    );

    const parsed = StructuredResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    const data = parsed.data;

    const items = targetItemCount === 0
      ? []
      : data.items.slice(0, targetItemCount).map((s: string) => s.trim()).filter(Boolean);

    const content: StructuredContent = {
      headline:    data.headline.trim(),
      subhead:     (data.subhead ?? "").trim(),
      cta:         (data.cta ?? "").trim() || (brief.cta ?? "Learn More"),
      badge:       policy.wantsBadge       ? data.badge?.trim()       : undefined,
      eyebrow:     policy.wantsEyebrow     ? data.eyebrow?.trim()     : undefined,
      attribution: policy.wantsAttribution ? data.attribution?.trim() : undefined,
      supporting:  policy.wantsSupporting  ? data.supporting?.trim()  : undefined,
      items,
      meta: { templateType, variationIdx, source: "openai", itemKind: policy.itemKind },
    };

    remember(key, { headline: content.headline, items });
    return content;
  } catch {
    return null;
  }
}

// ── Prompt construction ─────────────────────────────────────────────────────

function buildSystemPrompt(args: {
  brief:           BriefAnalysis;
  templateType:    TemplateType;
  format:          string;
  categoryName?:   string;
  policy:          TemplatePolicy;
  targetItemCount: number;
  avoidList:       string[];
  variationIdx:    number;
}): string {
  const { brief, templateType, format, categoryName, policy, targetItemCount, avoidList, variationIdx } = args;

  const kindLabel: Record<ItemKind, string> = {
    bullets:         "list items",
    checklist_items: "checklist benefits",
    tips:            "tip lines",
    steps:           "ordered steps",
    insights:        "teaching insights",
    benefits:        "promotional benefits",
    none:            "",
  };

  const sections: string[] = [
    `You are a senior copywriter producing structured content for a "${templateType}" design template.`,
    `Target format: ${format}.${categoryName ? ` Category: ${categoryName}.` : ""}`,
    `Brief: "${brief.headline ?? ""}" — intent: ${brief.intent ?? "n/a"} — tone: ${brief.tone ?? "n/a"} — audience: ${brief.audience ?? "n/a"}.`,
    brief.keywords?.length ? `Keywords: ${brief.keywords.slice(0, 8).join(", ")}.` : "",
    "",
    `This is variation #${variationIdx + 1} in a gallery batch. Every variation must feel materially different from the others — pick a fresh angle, fresh vocabulary, and fresh specifics. Do not rephrase the brief verbatim.`,
    "",
    "Voice rules:",
    `• Headline: ${policy.headlineGuidance}`,
    `• Subhead: one sentence expanding the headline with a specific benefit or detail, ≤ 120 characters.`,
    `• CTA: ${policy.ctaGuidance}`,
  ];

  if (policy.wantsBadge)       sections.push(`• Badge: short shouted label, 1–3 words, uppercase (e.g. "NEW", "TOP 5", "LIMITED").`);
  if (policy.wantsEyebrow)     sections.push(`• Eyebrow: 1–3 word context label placed above the headline.`);
  if (policy.wantsAttribution) sections.push(`• Attribution: the speaker — a real or plausible name and a short role. ≤ 40 characters.`);
  if (policy.wantsSupporting)  sections.push(`• Supporting line: one short lead sentence placed before the list. ≤ 90 characters.`);

  if (targetItemCount > 0) {
    sections.push("");
    sections.push(`Items: return EXACTLY ${targetItemCount} ${kindLabel[policy.itemKind]}.`);
    sections.push(`• ${policy.itemGuidance}`);
    sections.push(`• Every item must be distinct from the others. No synonyms or paraphrases.`);
    sections.push(`• Items must not repeat the headline, subhead, or each other.`);
  } else {
    sections.push("");
    sections.push(`Items: return an empty array. This template is headline-forward only.`);
  }

  if (avoidList.length) {
    sections.push("");
    sections.push(`Must NOT reuse any of these phrases from prior variations (reshuffle vocabulary):`);
    for (const p of avoidList.slice(0, 10)) sections.push(`  • ${p}`);
  }

  sections.push("");
  sections.push("Respond with ONLY valid JSON. No markdown, no prose. Schema:");
  sections.push(JSON.stringify({
    headline: "string",
    subhead: "string",
    cta: "string",
    ...(policy.wantsBadge       ? { badge:       "string" } : {}),
    ...(policy.wantsEyebrow     ? { eyebrow:     "string" } : {}),
    ...(policy.wantsAttribution ? { attribution: "string" } : {}),
    ...(policy.wantsSupporting  ? { supporting:  "string" } : {}),
    items: targetItemCount > 0 ? `string[${targetItemCount}]` : "[]",
  }));

  return sections.filter(Boolean).join("\n");
}

function buildUserPrompt(brief: BriefAnalysis, templateType: TemplateType, variationIdx: number): string {
  const body = brief.body ? `\nUser notes: ${brief.body.slice(0, 600)}` : "";
  return `Generate structured ${templateType} content for variation #${variationIdx + 1}.${body}`;
}

// ── Fallback builder (used when AI disabled or fails) ────────────────────────
//
// Builds a StructuredContent from whatever we already have in the brief so
// the caller can treat AI-off and AI-on paths uniformly. The shape is
// deliberately minimal — we do NOT fabricate items here because that would
// just move the "generic list" problem back into code.

export function buildFallbackStructuredContent(
  brief: BriefAnalysis, templateType: TemplateType, variationIdx: number,
): StructuredContent {
  const policy = TEMPLATE_POLICY[templateType];
  const items: string[] = [];

  if (policy.targetItemCount > 0) {
    const kws = (brief.keywords ?? []).filter(Boolean);
    for (let i = 0; i < Math.min(policy.targetItemCount, kws.length); i++) {
      items.push(kws[i]);
    }
  }

  return {
    headline:    brief.headline ?? "",
    subhead:     brief.subhead ?? "",
    cta:         brief.cta ?? "Learn More",
    badge:       policy.wantsBadge       ? (brief.badge ?? undefined)   : undefined,
    eyebrow:     policy.wantsEyebrow     ? (brief.keywords?.[0] ?? "")  : undefined,
    attribution: policy.wantsAttribution ? undefined                    : undefined,
    supporting:  policy.wantsSupporting  ? (brief.tagline ?? undefined) : undefined,
    items,
    meta: { templateType, variationIdx, source: "fallback", itemKind: policy.itemKind },
  };
}

// Note: the legacy `structuredContentToTextMap` greedy field-to-zone
// mapper was replaced in Step 8 by the declarative, role-based
// `mapContentToComponents` in engines/components/content-component-mapper.ts.

// ── Audit helpers ────────────────────────────────────────────────────────────

export function describeStructuredContent(c: StructuredContent): string {
  const parts: string[] = [];
  parts.push(`src=${c.meta.source}`);
  parts.push(`kind=${c.meta.itemKind}`);
  parts.push(`items=${c.items.length}`);
  if (c.badge)       parts.push("badge");
  if (c.eyebrow)     parts.push("eyebrow");
  if (c.attribution) parts.push("attribution");
  if (c.supporting)  parts.push("supporting");
  return parts.join(" ");
}
