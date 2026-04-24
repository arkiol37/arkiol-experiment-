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

// Framework-neutral: imported by both Next (apps/arkiol-core) and plain
// Node (apps/render-backend). Do not add `import "server-only"`.
import { z } from "zod";
import { detectCapabilities } from "@arkiol/shared";
import { chatJSON } from "../../lib/openai";
import { withRetry } from "../../lib/retry";
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
    targetItemCount:  4,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each checklist item is a CONCRETE must-have or to-do the reader can tick off. Start with a capital verb or noun phrase. 3–7 words. Include specifics (numbers, names, tools) — not vague platitudes. No trailing punctuation. NEVER a slogan or marketing headline.",
    headlineGuidance: "Headline names the exact list — e.g. 'Packing Checklist for Weekend Trips', '5 Things Every Launch Needs'. 3–8 words, assertive.",
    ctaGuidance:      "Imperative. 2–4 words. 'Save This', 'Download PDF', 'Get Checklist'.",
  },
  tips: {
    itemKind:         "tips",
    targetItemCount:  4,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each tip is a SPECIFIC, verb-led directive that teaches one technique. 4–12 words. Must include a concrete action + an object (what to do and to what). No generic advice like 'Stay positive' or 'Work hard'. Every tip must teach something distinct — no overlap.",
    headlineGuidance: "Headline teases the specific payoff. 'N Tips to …' or 'How to … Faster'. 3–8 words, curiosity-forward.",
    ctaGuidance:      "Inviting. 2–4 words — 'Try This', 'Save Pack', 'See More Tips'.",
  },
  quote: {
    itemKind:         "none",
    targetItemCount:  0,
    wantsBadge:       false,
    wantsEyebrow:     true,
    wantsAttribution: true,
    wantsSupporting:  false,
    itemGuidance:     "",
    headlineGuidance: "Headline IS the quote itself — memorable, resonant, between 6 and 18 words. Must make a single clear claim. Do NOT wrap in quotation marks (the design adds them).",
    ctaGuidance:      "Quiet. 2–3 words. Often optional — 'Read More', 'Follow'.",
  },
  step_by_step: {
    itemKind:         "steps",
    targetItemCount:  4,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each step is a CONCRETE instruction that moves the reader forward. Verb-led, 3–9 words. Steps must be ORDERED — later steps build on earlier ones. Do NOT prefix with numerals (the design adds them). No two steps may repeat the same verb.",
    headlineGuidance: "Headline names the outcome of the process. 'How to …' or 'The N-Step … Method'. 3–8 words.",
    ctaGuidance:      "Imperative. 2–4 words — 'Start Now', 'Begin Guide', 'Follow Along'.",
  },
  list_based: {
    itemKind:         "bullets",
    targetItemCount:  4,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each list entry is a CONCRETE pick — a named product, place, person, book, tool, or category. 2–7 words. Where helpful, include a tiny attribute (a year, price band, descriptor). NEVER a bare adjective or abstract noun on its own.",
    headlineGuidance: "Headline names the list and the number — 'Top 5 …', '7 Best …', 'The …2026 List'. 3–8 words.",
    ctaGuidance:      "Curious. 2–4 words — 'See Full List', 'Explore Picks'.",
  },
  promotional: {
    itemKind:         "benefits",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  false,
    itemGuidance:     "Each benefit is a SPECIFIC reason to buy now — include real numbers, percentages, timeframes, or named inclusions. 3–8 words. Do NOT repeat the offer line. NEVER generic puffery like 'Amazing quality'.",
    headlineGuidance: "Headline is bold and offer-forward — leads with price, discount, or launch hook. 3–8 words. Power words encouraged.",
    ctaGuidance:      "Urgent. 2–4 words — 'Shop Now', 'Claim Today', 'Order Before Sunday'.",
  },
  educational: {
    itemKind:         "insights",
    targetItemCount:  4,
    wantsBadge:       false,
    wantsEyebrow:     true,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each insight is a factoid or principle the reader can walk away with. 5–12 words. Must TEACH — include a data point, a cause/effect, or a named concept. No motivational filler.",
    headlineGuidance: "Headline names the lesson or concept being taught. 3–8 words — 'Understanding …', 'Why … Matters'.",
    ctaGuidance:      "Inviting. 2–4 words — 'Learn More', 'Start Course', 'Read Guide'.",
  },
  reminder: {
    itemKind:         "bullets",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     false,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each reminder item is a SHORT labeled note — a date, a task, a thing not to forget. 2–6 words. Read like a sticky note, not a marketing line. Include time-sensitive specifics where possible ('Pay rent by 30th', 'Send pitch by Friday').",
    headlineGuidance: "Headline is the thing the reader must remember — direct, urgent. 'Don't Forget …', 'Heads Up: …'. 3–7 words.",
    ctaGuidance:      "Imperative. 2–4 words — 'Add to Cal', 'Set Reminder', 'Mark the Date'.",
  },
  announcement: {
    itemKind:         "benefits",
    targetItemCount:  3,
    wantsBadge:       true,
    wantsEyebrow:     true,
    wantsAttribution: false,
    wantsSupporting:  true,
    itemGuidance:     "Each detail is a fact about what's being announced — date, location, feature, price, eligibility. 3–8 words. CONCRETE nouns and numbers. NEVER marketing fluff.",
    headlineGuidance: "Headline names what's being announced in plain news-style language. 'Introducing …', 'Now Live: …'. 3–8 words.",
    ctaGuidance:      "Urgent. 2–4 words — 'Learn More', 'Get Early Access', 'Save the Date'.",
  },
  minimal: {
    itemKind:         "none",
    targetItemCount:  0,
    wantsBadge:       false,
    wantsEyebrow:     true,
    wantsAttribution: false,
    wantsSupporting:  false,
    itemGuidance:     "",
    headlineGuidance: "Headline is a short, resonant phrase — elegant, specific to the brief, NOT abstract. 2–6 words.",
    ctaGuidance:      "Quiet. 1–3 words — 'Begin', 'Enter', 'Read'.",
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
      { maxAttempts: 2, baseDelayMs: 300 },
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

// Primer strings injected at the top of every system prompt. These are the
// "this template IS a … and must look like one" framing. Together with the
// tighter itemGuidance they keep generations from drifting into abstract
// poster-card copy. Kept as a separate record (not on TemplatePolicy) so the
// policy object stays focused on per-field voice rules.
const USE_CASE_PRIMER: Record<TemplateType, string> = {
  checklist:    "a CHECKLIST carousel slide — a named list the reader can tick through, every item a concrete must-have.",
  tips:         "a TIPS post — multiple bite-sized techniques the reader can actually apply, each teaching one specific move.",
  quote:        "a QUOTE post — a memorable line with its speaker; the quote IS the design, not a decoration around it.",
  step_by_step: "a STEP-BY-STEP guide — ordered, numbered steps that teach a process from start to finish.",
  list_based:   "a LIST / ROUNDUP post — named picks (products / places / books / tools) the reader can refer to.",
  promotional:  "a PROMOTION / OFFER post — loud, price-forward, with concrete reasons to act before a deadline.",
  educational:  "an EDUCATIONAL explainer — teaching a named concept with real factoids, not motivational filler.",
  reminder:     "a REMINDER note — a pinned-post-style nudge about something the reader must not forget, with dates or deadlines when relevant.",
  announcement: "an ANNOUNCEMENT — news-style reveal of a launch / event / update, with dates, locations, or access details.",
  minimal:      "a MINIMAL typographic post — one resonant phrase standing alone, content still specific to the brief (not a generic inspirational card).",
};

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

  const useCasePrimer = USE_CASE_PRIMER[templateType];

  const sections: string[] = [
    `You are a senior social-media designer-copywriter producing content for a "${templateType}" template.`,
    `Target format: ${format}.${categoryName ? ` Category: ${categoryName}.` : ""}`,
    `Brief: "${brief.headline ?? ""}" — intent: ${brief.intent ?? "n/a"} — tone: ${brief.tone ?? "n/a"} — audience: ${brief.audience ?? "n/a"}.`,
    brief.keywords?.length ? `Keywords: ${brief.keywords.slice(0, 8).join(", ")}.` : "",
    "",
    `USE CASE — this must read as: ${useCasePrimer}`,
    `This is NOT a generic poster card. The output must VISIBLY be the use case above — a reader glancing at it for one second must recognise the format.`,
    "",
    `This is variation #${variationIdx + 1} in a gallery batch. Every variation must feel materially different from the others — pick a fresh angle, fresh vocabulary, and fresh specifics. Do not rephrase the brief verbatim.`,
    "",
    "Voice rules:",
    `• Headline: ${policy.headlineGuidance}`,
    `• Subhead: one sentence expanding the headline with a specific benefit or detail, ≤ 120 characters. NEVER abstract marketing copy.`,
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
    sections.push(`• Items MUST carry concrete nouns, numbers, names, or actions — NEVER abstract marketing adjectives on their own.`);
    sections.push(`• If you can't think of ${targetItemCount} genuinely distinct, specific items, invent plausible concrete examples rather than padding with fluff.`);
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
