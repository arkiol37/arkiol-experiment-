// src/app/api/content-ai/route.ts
// Content AI — C2 requirement
// Generates platform-aware captions, hashtags, hooks, and ad copy
// Tone selector: Professional, Bold, Friendly, Luxury
// Output is short and usable (not long essays)
// NO direct process.env — all config via validated env module.

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser } from "../../../lib/auth";
import { rateLimit }     from "../../../lib/rate-limit";
import { withErrorHandling, aiUnavailable } from "../../../lib/error-handling";
import { ApiError }      from "../../../lib/types";
import { prisma }        from "../../../lib/prisma";
import { withRetry }     from "../../../lib/error-handling";
import { z }             from "zod";
import OpenAI            from "openai";
import { getEnv }        from "@arkiol/shared";

const ContentAISchema = z.object({
  prompt:    z.string().min(5).max(1000),
  platform:  z.enum(["instagram", "youtube", "linkedin", "twitter", "general"]).default("general"),
  tone:      z.enum(["professional", "bold", "friendly", "luxury"]).default("professional"),
  assetId:   z.string().optional(),   // enrich with asset context
});

function getOpenAI(): OpenAI {
  const key = getEnv().OPENAI_API_KEY;
  if (!key) throw new ApiError(503, "OpenAI not configured");
  return new OpenAI({ apiKey: key });
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: "Write in a polished, authoritative, business-appropriate tone. Avoid slang.",
  bold:         "Write in a punchy, confident, high-energy tone. Use strong action words.",
  friendly:     "Write in a warm, approachable, conversational tone. Keep it human and relatable.",
  luxury:       "Write in a sophisticated, aspirational tone. Evoke exclusivity and elegance.",
};

const PLATFORM_INSTRUCTIONS: Record<string, string> = {
  instagram:  "Optimize for Instagram: use 1-3 relevant emoji, keep caption under 150 chars for the hook, suggest 5-10 hashtags.",
  youtube:    "Optimize for YouTube: focus on SEO-friendly phrasing, suggest a thumbnail text hook (under 6 words), provide 3-5 relevant tags.",
  linkedin:   "Optimize for LinkedIn: professional framing, no hashtag spam, hook should spark professional curiosity.",
  twitter:    "Optimize for Twitter/X: under 280 characters for caption, punchy hook, 2-3 hashtags max.",
  general:    "Write versatile copy suitable for multiple platforms.",
};

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().ai) return aiUnavailable();

  const user = await getRequestUser(req);

  const rl = await rateLimit(user.id, "generate");
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = ContentAISchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { prompt, platform, tone, assetId } = parsed.data;

  // Check credits
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, include: { org: true } });
  if (!dbUser?.org) throw new ApiError(403, "No organization");
  const remaining = dbUser.org.creditLimit - dbUser.org.creditsUsed;
  if (remaining <= 0) {
    throw new ApiError(402, "Insufficient credits for Content AI. Please upgrade your plan.");
  }

  // Optional: enrich with asset context
  let assetContext = "";
  if (assetId) {
    const asset = await prisma.asset.findFirst({ where: { id: assetId, userId: user.id } });
    if (asset) {
      const meta = asset.metadata as any;
      assetContext = `\nDesign context: ${asset.name}, format: ${asset.format}, category: ${asset.category}`;
      if (meta?.brief?.headline) assetContext += `, headline: "${meta.brief.headline}"`;
    }
  }

  const systemPrompt = `You are a world-class marketing copywriter. ${TONE_INSTRUCTIONS[tone]} ${PLATFORM_INSTRUCTIONS[platform]}

Always respond with valid JSON matching this exact structure:
{
  "caption": "string (platform-optimized caption, 1-3 sentences)",
  "hooks": ["string", "string", "string"],
  "hashtags": ["string", "string", "string", "string", "string"],
  "adCopy": [
    { "variant": "A", "headline": "string (under 8 words)", "body": "string (1-2 sentences)" },
    { "variant": "B", "headline": "string (under 8 words)", "body": "string (1-2 sentences)" }
  ]
}`;

  const userPrompt = `Create marketing content for: ${prompt}${assetContext}

Generate:
- 1 platform-optimized caption
- 3-5 hook options (short, attention-grabbing opening lines)
- 5-10 relevant hashtags (without the # symbol)
- 2 short ad copy variants (headline + 1-2 sentence body)`;

  const openai = getOpenAI();
  const response = await withRetry(
    () => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system",  content: systemPrompt },
        { role: "user",    content: userPrompt },
      ],
      temperature:  0.7,
      max_tokens:   800,
      response_format: { type: "json_object" },
    }),
    { maxAttempts: 3, baseDelayMs: 1000 }
  );

  const raw = response.choices[0]?.message?.content ?? "{}";
  let contentResult: {
    caption: string;
    hooks: string[];
    hashtags: string[];
    adCopy: Array<{ variant: string; headline: string; body: string }>;
  };

  try {
    contentResult = JSON.parse(raw);
  } catch {
    throw new ApiError(500, "Content AI returned invalid JSON. Please retry.");
  }

  // Validate required fields before deducting credits
  if (typeof contentResult.caption !== "string") {
    throw new ApiError(500, "Content AI response missing required fields. Please retry.");
  }

  // Deduct 1 credit for content AI (only after successful generation)
  await prisma.org.update({
    where: { id: dbUser.org.id },
    data:  { creditsUsed: { increment: 1 } },
  });

  return NextResponse.json({
    platform,
    tone,
    prompt,
    ...contentResult,
    generatedAt: new Date().toISOString(),
  });
});
