// src/app/api/assets/library/route.ts
// Asset Library API — Intelligent Asset Retrieval
// ─────────────────────────────────────────────────────────────────────────────
//
// GET  /api/assets/library?industry=tech&mood=dark
//      Returns matching assets from the library
//
// POST /api/assets/library/retrieve
//      Intelligent context-aware asset retrieval

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { getServerSession }          from "next-auth";
import { authOptions }               from "../../../../lib/auth";
import { dbUnavailable } from "../../../../lib/error-handling";
import {
  retrieveAssets,
  listAssetPacks,
  getAssetPack,
  generateParametricBackground,
  buildRetrievalContext,
  type RetrievalContext,
  type AssetIndustry,
  type AssetMood,
} from "../../../../engines/assets/asset-library";

export async function GET(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url      = new URL(req.url);
  const packId   = url.searchParams.get("pack");
  const industry = url.searchParams.get("industry") as AssetIndustry | null;

  if (packId) {
    const pack = getAssetPack(packId);
    if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
    return NextResponse.json({ pack });
  }

  const packs = industry
    ? listAssetPacks().filter(p => p.industry === industry || p.industry === "generic")
    : listAssetPacks();

  return NextResponse.json({
    packs,
    totalPacks:  packs.length,
    totalAssets: packs.reduce((s, p) => s + p.assets.length, 0),
  });
}

export async function POST(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "retrieve";

  if (action === "retrieve") {
    const context: RetrievalContext = {
      industry:        b.industry as AssetIndustry | undefined,
      layoutType:      typeof b.layoutType === "string" ? b.layoutType : undefined,
      primaryColor:    typeof b.primaryColor === "string" ? b.primaryColor : undefined,
      audienceSegment: typeof b.audienceSegment === "string" ? b.audienceSegment : undefined,
      toneKeywords:    Array.isArray(b.toneKeywords) ? b.toneKeywords.filter((t: unknown) => typeof t === "string") : undefined,
      prefersDarkBg:   typeof b.prefersDarkBg === "boolean" ? b.prefersDarkBg : undefined,
      format:          typeof b.format === "string" ? b.format : undefined,
      mood:            b.mood as AssetMood | undefined,
      seed:            typeof b.seed === "string" ? b.seed : undefined,
    };

    const maxResults = typeof b.maxResults === "number" ? Math.min(b.maxResults, 10) : 3;
    const assets     = retrieveAssets(context, maxResults);

    return NextResponse.json({ assets, context });
  }

  if (action === "generate_background") {
    const seed    = typeof b.seed === "string" ? b.seed : "default";
    const color   = typeof b.primaryColor === "string" ? b.primaryColor : "#4f6ef7";
    const style   = ["gradient", "mesh", "dots", "waves", "geometric"].includes(b.style as string)
      ? b.style as "gradient" | "mesh" | "dots" | "waves" | "geometric"
      : "gradient";

    const svg = generateParametricBackground(seed, color, style);

    return NextResponse.json({ svg, seed, style });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
