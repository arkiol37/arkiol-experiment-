// src/engines/ai/brief-analyzer.ts
// Framework-neutral: imported by both Next (apps/arkiol-core) and plain
// Node (apps/render-backend). Do not add `import "server-only"`.
import { chatJSON } from "../../lib/openai";
import { withRetry } from "../../lib/retry";
import { inferCategoryFromText } from "../../lib/asset-library/category-recipes";
import type { AssetCategory } from "../../lib/asset-library/types";
import { z }         from "zod";

// Extended schema supports all 9 category zone types
export const BriefAnalysisSchema = z.object({
  intent:        z.string().max(200),
  audience:      z.string().max(200),
  tone:          z.enum(["professional","playful","urgent","warm","bold","minimal","luxury","energetic"]),
  keywords:      z.array(z.string().max(30)).max(10),
  colorMood:     z.enum(["vibrant","muted","dark","light","monochrome","warm","cool"]),
  imageStyle:    z.enum(["photography","illustration","abstract","product","lifestyle","geometric","none"]),
  // Universal text zones
  headline:      z.string().max(80),
  subhead:       z.string().max(150).optional(),
  body:          z.string().max(800).optional(),
  cta:           z.string().max(35).optional(),
  badge:         z.string().max(25).optional(),
  tagline:       z.string().max(60).optional(),
  priceText:     z.string().max(15).optional(),
  // Business card / Resume / Logo zones
  name:          z.string().max(50).optional(),
  title:         z.string().max(70).optional(),
  company:       z.string().max(50).optional(),
  contact:       z.string().max(200).optional(),
  // Colors
  primaryColor:  z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** First-class business-domain category, e.g. "fitness",
   *  "food", "fashion", "wellness", "education", "business",
   *  "beauty", "travel", "marketing", "motivation".
   *
   *  Set deterministically from the prompt by inferCategoryFromText
   *  (see lib/asset-library/category-recipes.ts) AFTER the GPT
   *  brief returns, so even when the model omits / hallucinates
   *  the category we still get a consistent signal that downstream
   *  asset selection + the marketplace gate can audit.
   *
   *  Null when no category keyword matched — pipeline falls back
   *  to format-driven asset selection. */
  category:      z.string().nullable().optional(),
});

export type BriefAnalysis = z.infer<typeof BriefAnalysisSchema>;

export interface BriefAnalysisOptions {
  prompt:      string;
  stylePreset: string;
  format?:     string;  // Hints which zones matter
  locale?:     string;  // BCP-47 language tag, e.g. "fr", "de", "ja". Defaults to "en".
  brand?: {
    primaryColor:   string;
    secondaryColor: string;
    voiceAttribs:   Record<string, number>;
    fontDisplay:    string;
  };
}

export async function analyzeBrief(options: BriefAnalysisOptions): Promise<BriefAnalysis> {
  const { prompt, stylePreset, brand, format, locale = "en" } = options;

  const brandContext = brand
    ? `Brand colors: primary=${brand.primaryColor}, secondary=${brand.secondaryColor}. ` +
      `Brand voice: ${JSON.stringify(brand.voiceAttribs)}. ` +
      `Use brand's primary color unless the style strongly requires otherwise.`
    : "No brand — choose colors matching the brief's tone and mood.";

  const formatHint = format
    ? `Target format: ${format}. Populate relevant text zones (name/title/contact for cards/resumes, headline/cta for social, etc).`
    : "";

  // Multi-language: instruct GPT to generate copy in the requested locale
  const localeInstruction = locale !== "en"
    ? `\nLANGUAGE REQUIREMENT: Generate ALL copy text fields (headline, subhead, body, cta, badge, tagline, name, title, company, contact) in ${locale} language. Do NOT translate back to English.`
    : "";

  const systemPrompt = `You are a senior creative director analyzing a campaign brief.
Extract structured design intelligence for visual asset generation.
Style preset: "${stylePreset}". ${formatHint}
${brandContext}${localeInstruction}

Rules:
- headline: max 80 chars, punchy and direct (always populate)
- subhead: max 150 chars, supporting detail
- cta: max 35 chars, action verb ("Shop Now", "Learn More", "Get Started")
- badge: max 25 chars ("NEW", "SALE 30%", "LIMITED")
- name: person's full name (business card, resume)
- title: job title / role
- company: company or organization name
- contact: email, phone, website (can be multi-line)
- body: longer descriptive text (resume, slide, flyer)
- All colors: valid 6-digit hex (#RRGGBB)
- Respond ONLY with valid JSON — no markdown, no explanation`;

  const raw = await withRetry(
    () => chatJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: `Campaign brief: ${prompt}` },
      ],
      { model: "gpt-4o", temperature: 0.7, max_tokens: 800 }
    ),
    { maxAttempts: 2, baseDelayMs: 300 }
  );

  const parsed = BriefAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    const partial = raw as any;

    // Rotate fallback tone and colorMood based on prompt content hash
    // to avoid always defaulting to the same values, which biases theme selection.
    const FALLBACK_TONES:  Array<BriefAnalysis["tone"]>      = ["professional","bold","warm","energetic","playful","minimal"];
    const FALLBACK_MOODS:  Array<BriefAnalysis["colorMood"]> = ["vibrant","warm","dark","cool","light","muted"];
    const promptHash = prompt.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const fallbackTone = FALLBACK_TONES[Math.abs(promptHash) % FALLBACK_TONES.length];
    const fallbackMood = FALLBACK_MOODS[Math.abs(promptHash * 31) % FALLBACK_MOODS.length];

    const recovered = BriefAnalysisSchema.safeParse({
      intent:     partial.intent     ?? "Campaign asset generation",
      audience:   partial.audience   ?? "General audience",
      tone:       partial.tone       ?? fallbackTone,
      keywords:   partial.keywords   ?? [],
      colorMood:  partial.colorMood  ?? fallbackMood,
      imageStyle: partial.imageStyle ?? "photography",
      headline:   (partial.headline  ?? prompt.slice(0, 79)) as string,
      ...partial,
    });
    if (recovered.success) return stampCategory(recovered.data, prompt);
    throw new Error(`Brief analysis failed schema validation: ${parsed.error.message}`);
  }
  return stampCategory(parsed.data, prompt);
}

/** Stamp a deterministic business-domain category onto the brief.
 *  The GPT output isn't authoritative for category — it sometimes
 *  omits the field and sometimes hallucinates (e.g. labels a
 *  fitness ad as "marketing"). We override with
 *  inferCategoryFromText() against the original prompt, which is
 *  a fast keyword match against the same CATEGORY_KEYWORDS table
 *  that drives downstream asset selection. That guarantees the
 *  brief.category here ALWAYS matches the category-recipes the
 *  asset selector will use later — no domain drift between brief
 *  and assets. */
function stampCategory(brief: BriefAnalysis, prompt: string): BriefAnalysis {
  const inferred: AssetCategory | null = inferCategoryFromText(
    `${prompt} ${brief.intent ?? ""} ${(brief.keywords ?? []).join(" ")}`,
  );
  if (inferred) {
    // eslint-disable-next-line no-console
    console.info(`[brief-analyzer] domain=${inferred} prompt="${prompt.slice(0, 60).replace(/\n/g, " ")}"`);
    return { ...brief, category: inferred };
  }
  // eslint-disable-next-line no-console
  console.info(`[brief-analyzer] domain=null (no keyword match) prompt="${prompt.slice(0, 60).replace(/\n/g, " ")}"`);
  return { ...brief, category: null };
}
