// src/app/api/memory/selection/route.ts
//
// POST /api/memory/selection
//
// Records a user selection into the generation ledger + visual-pattern
// memory. Called by the gallery / editor when a user commits to a
// specific generated asset (opens it in the editor, exports it, saves
// a copy). Selection is the strongest positive signal in the Step 33
// learning layer — 3× the weight of an auto-record of the same
// template's quality score.
//
// The endpoint is deliberately minimal: no DB dependency (memory lives
// in-process alongside the worker), no auth beyond the existing
// session check. Safe to call repeatedly — idempotent.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestUser } from "../../../../lib/auth";
import { withErrorHandling } from "../../../../lib/error-handling";
import { ApiError } from "../../../../lib/types";
import {
  recordSelection,
  isSelected,
  getRecentGenerations,
  recordSuccessfulPattern,
  type VisualPatternSignature,
} from "../../../../engines/memory";

const BodySchema = z.object({
  assetId: z.string().min(1).max(200),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  await getRequestUser(req); // auth gate — throws 401 if not signed in

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "assetId required");

  const { assetId } = parsed.data;

  // Mark the ledger entry as selected (idempotent). Returns false when
  // the ledger has no matching record — e.g. the in-memory ledger was
  // rotated past this generation, or the asset came from a different
  // worker instance. We still return 200 so the UI doesn't gate on it.
  const marked = recordSelection(assetId);

  // When we have a ledger record, also upgrade the pattern memory with
  // a "selection" signal (3× quality weight). No-op if the record
  // doesn't carry a patternSignature (pre-Step 33 records).
  if (marked) {
    const record = getRecentGenerations({}, 200).find(r => r.assetId === assetId);
    const signature = record?.patternSignature as VisualPatternSignature | undefined;
    if (record && signature) {
      try {
        recordSuccessfulPattern(
          signature,
          Math.max(record.qualityScore, 0.5),
          "selection",
        );
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({
    ok:       true,
    marked,
    selected: isSelected(assetId),
  });
});
