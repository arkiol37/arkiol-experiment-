// src/app/api/editor/load/route.ts
//
// GET /api/editor/load?assetId=<id>
//
// Fetches a generated asset from the database and converts its stored zone +
// SVG metadata into an ArkiolEditor-compatible EditorElement[].
//
// Priority order for conversion:
//   1. zones + svgContent stored in asset metadata  (richest — full fidelity)
//   2. svgSource parsed directly                    (fallback — SVG text parsing)
//   3. Empty canvas                                 (last resort)
//
// The endpoint also returns the assetId to use as projectId for autosave,
// plus the canonical canvas dimensions for the format.

import { NextRequest, NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { getRequestUser }               from "../../../../lib/auth";
import { withErrorHandling }         from "../../../../lib/error-handling";
import { ApiError, FORMAT_DIMS }     from "../../../../lib/types";
import { prisma }                    from "../../../../lib/prisma";
import { dbUnavailable } from "../../../../lib/error-handling";
import {
  convertGenerationToEditorElements,
  convertSvgSourceToEditorElements,
} from "../../../../lib/editor-elements-converter";
import type { EditorElement } from "../../../../lib/editor-elements-converter";

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user    = await getRequestUser(req);
  const url     = new URL(req.url);
  const assetId = url.searchParams.get("assetId");

  if (!assetId) throw new ApiError(400, "assetId query parameter required");

  // ── Fetch the asset (ownership-scoped) ─────────────────────────────────────
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId: user.id },
    select: {
      id:           true,
      format:       true,
      width:        true,
      height:       true,
      svgSource:    true,
      metadata:     true,
      layoutFamily: true,
    },
  });

  if (!asset) throw new ApiError(404, "Asset not found");

  // ── Determine canvas dimensions ────────────────────────────────────────────
  const dims     = FORMAT_DIMS[asset.format] ?? { width: asset.width, height: asset.height };
  const canvasW  = dims.width;
  const canvasH  = dims.height;
  const meta     = (asset.metadata ?? {}) as Record<string, unknown>;

  // ── Attempt rich conversion via stored zone + svgContent metadata ──────────
  // The generation worker stores these in asset.metadata when available.
  const storedZones      = meta.editorZones      as unknown[] | undefined;
  const storedSvgContent = meta.editorSvgContent as Record<string, unknown> | undefined;
  const onDemandAssets   = meta.onDemandAssets   as { elements?: unknown[] } | undefined;

  let elements: EditorElement[] | undefined;
  let conversionMethod: string = "empty_fallback";

  if (storedZones && storedSvgContent) {
    // Best path: zones + content stored at generation time
    try {
      elements = convertGenerationToEditorElements(
        storedZones      as unknown as Parameters<typeof convertGenerationToEditorElements>[0],
        storedSvgContent as unknown as Parameters<typeof convertGenerationToEditorElements>[1],
        canvasW,
        canvasH,
        onDemandAssets   as unknown as Parameters<typeof convertGenerationToEditorElements>[4],
      );
      conversionMethod = "zone_metadata";
    } catch (err) {
      console.warn("[editor/load] zone conversion failed, falling back to SVG parse", err);
      elements = undefined;
      conversionMethod = "zone_metadata_failed";
    }
  }

  // ── Fallback: parse svgSource directly ────────────────────────────────────
  if (!elements && asset.svgSource) {
    try {
      elements = convertSvgSourceToEditorElements(asset.svgSource, canvasW, canvasH);
      conversionMethod = "svg_parse";
    } catch (err) {
      console.warn("[editor/load] SVG parse failed", err);
      elements = [];
      conversionMethod = "empty_fallback";
    }
  }

  if (!elements) {
    elements = [];
    conversionMethod = "empty_fallback";
  }

  return NextResponse.json({
    assetId:          asset.id,
    projectId:        asset.id,          // used by editor as autosave key
    format:           asset.format,
    canvasWidth:      canvasW,
    canvasHeight:     canvasH,
    elements,
    elementCount:     elements.length,
    conversionMethod,
  });
});
