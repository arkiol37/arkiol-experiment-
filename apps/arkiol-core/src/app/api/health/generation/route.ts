// src/app/api/health/generation/route.ts
//
// GET /api/health/generation
//
// In-process generation metrics: counters, success rate, marketplace
// pass rate, p50/p90/p99 latency, recent rejection reasons. No auth
// gate because operational health endpoints need to be hit by
// uptime monitors and load balancers that don't carry session
// cookies. Returns a small JSON blob, never throws — the whole point
// is to stay up even when the pipeline is on fire.

import { NextResponse } from "next/server";
import { snapshot } from "../../../../lib/generation-metrics";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...snapshot() });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "metrics snapshot failed" },
      { status: 500 },
    );
  }
}
