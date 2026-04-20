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
import { asset3dManifestStats } from "../../../../engines/assets/3d-asset-manifest";
import { photoAssetManifestStats } from "../../../../engines/assets/photo-asset-manifest";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      ...snapshot(),
      // Static-config sidecars: CDN-backed asset manifests. Ops can see
      // at a glance whether 3D / photo CDNs are wired without shelling
      // into the deploy.
      assets3d: asset3dManifestStats(),
      photo:    photoAssetManifestStats(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "metrics snapshot failed" },
      { status: 500 },
    );
  }
}
