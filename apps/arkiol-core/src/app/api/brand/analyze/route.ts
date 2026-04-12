// src/app/api/brand/analyze/route.ts
// POST /api/brand/analyze — uses GPT-4o to extract brand intelligence from a text description
import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { withErrorHandling }  from "../../../../lib/error-handling";
import { rateLimit }          from "../../../../lib/rate-limit";
import { chatJSON }           from "../../../../lib/openai";
import { z }                  from "zod";
import { dbUnavailable } from "../../../../lib/error-handling";

// Vercel route config — GPT-4o calls need extended timeout
export const maxDuration = 60;

const AnalyzeSchema = z.object({
  description: z.string().min(20).max(3000),
  examples:    z.array(z.string()).max(5).optional(),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "EDIT_BRAND");

  const rl = await rateLimit(user.id, "generate");
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = AnalyzeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { description, examples = [] } = parsed.data;

  const examplesText = examples.length
    ? `\n\nExisting brand copy examples:\n${examples.map((e, i) => `${i + 1}. "${e}"`).join("\n")}`
    : "";

  const result = await chatJSON(
    [
      {
        role: "system",
        content: `You are a brand identity expert. Analyze the brand description and extract structured brand DNA.
Return ONLY valid JSON with these exact fields:
{
  "primaryColor": "#hex",
  "secondaryColor": "#hex",
  "accentColors": ["#hex", "#hex"],
  "fontDisplay": "font name for headlines",
  "fontBody": "font name for body text",
  "voiceAttribs": {
    "professional": 0-100,
    "bold": 0-100,
    "warm": 0-100,
    "playful": 0-100,
    "minimal": 0-100
  },
  "toneKeywords": ["word1", "word2", "word3"],
  "targetAudience": "description",
  "brandSummary": "2-sentence brand positioning"
}
All hex values must be valid 6-digit hex codes.
Font names must be standard web-safe or Google Font names.`,
      },
      {
        role: "user",
        content: `Brand description: ${description}${examplesText}`,
      },
    ],
    { model: "gpt-4o", temperature: 0.3, max_tokens: 600 }
  );

  return NextResponse.json({ analysis: result });
});
