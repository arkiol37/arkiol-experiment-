// src/app/api/platform/route.ts
// Platform Intelligence API
// ─────────────────────────────────────────────────────────────────────────────
//
// GET  /api/platform?format=<format>
//      Returns platform rules for a given format
//
// POST /api/platform/score
//      Scores a design genome against platform requirements

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse } from "next/server";
import { getServerSession }          from "next-auth";
import { authOptions }               from "../../../lib/auth";
import {
  getPlatformRules,
  scorePlatformCompliance,
  getSupportedPlatforms,
  buildPlatformPromptContext,
} from "../../../engines/platform/intelligence";
import { validateDesignGenome } from "../../../engines/validation/stage-validator";
import { dbUnavailable } from "../../../lib/error-handling";

export async function GET(req: NextRequest) {
  if (!detectCapabilities().database) return dbUnavailable();

  const _ru = await getRequestUser(req).catch(() => null);
  const session = _ru ? { user: { id: _ru.id, email: _ru.email, orgId: _ru.orgId, role: _ru.role } } : null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url    = new URL(req.url);
  const format = url.searchParams.get("format");

  if (!format) {
    // Return list of all supported platforms
    return NextResponse.json({
      platforms:  getSupportedPlatforms(),
      totalCount: getSupportedPlatforms().length,
    });
  }

  const rules = getPlatformRules(format);
  const promptContext = buildPlatformPromptContext(format);

  return NextResponse.json({
    format,
    rules,
    promptContext,
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
  const format = typeof b.format === "string" ? b.format : "";
  if (!format) return NextResponse.json({ error: "format is required" }, { status: 400 });

  const genomeValidation = validateDesignGenome(b.genome);
  if (!genomeValidation.valid || !genomeValidation.data) {
    return NextResponse.json({ error: `Invalid genome: ${genomeValidation.errors.join(", ")}` }, { status: 400 });
  }

  const score = scorePlatformCompliance(genomeValidation.data, format);

  return NextResponse.json({
    format,
    genome:    genomeValidation.data,
    repaired:  genomeValidation.repaired,
    repairLog: genomeValidation.repairLog,
    score,
  });
}
