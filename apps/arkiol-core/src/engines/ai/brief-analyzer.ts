// src/engines/ai/brief-analyzer.ts
import "server-only";
import { chatJSON } from "../../lib/openai";
import { withRetry } from "../../lib/error-handling";
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
    { maxAttempts: 3, baseDelayMs: 1000 }
  );

  const parsed = BriefAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    const partial = raw as any;
    const recovered = BriefAnalysisSchema.safeParse({
      intent:     partial.intent     ?? "Campaign asset generation",
      audience:   partial.audience   ?? "General audience",
      tone:       partial.tone       ?? "professional",
      keywords:   partial.keywords   ?? [],
      colorMood:  partial.colorMood  ?? "vibrant",
      imageStyle: partial.imageStyle ?? "photography",
      headline:   (partial.headline  ?? prompt.slice(0, 79)) as string,
      ...partial,
    });
    if (recovered.success) return recovered.data;
    throw new Error(`Brief analysis failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
