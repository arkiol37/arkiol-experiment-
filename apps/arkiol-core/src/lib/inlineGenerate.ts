// src/lib/inlineGenerate.ts
// ─────────────────────────────────────────────────────────────────────────────
// Inline generation — runs the AI pipeline WITHIN the API request.
//
// WHY: Arkiol's generation architecture is queue-based (BullMQ Worker).
// The worker runs as a separate long-lived process on Railway/Fly/EC2.
// On Vercel-only deployments, there IS NO worker process — jobs sit in the
// queue forever. This module runs the same pipeline inline so generation
// works without an external worker.
//
// FIXES:
//   1. thumbnailUrl stored in job result — GeneratePanel can show preview
//      immediately after inline generation completes, without a second fetch.
//   2. SVG data-URL fallback when S3 is not configured — the thumbnail is
//      encoded as a base64 data URL so the <img> tag renders it inline.
//   3. Credit deduction uses creditBalance decrement (matches schema).
// ─────────────────────────────────────────────────────────────────────────────
import "server-only";
import { prisma } from "./prisma";
import { detectCapabilities } from "@arkiol/shared";

export interface InlineGenerateParams {
  jobId: string;
  userId: string;
  orgId: string;
  prompt: string;
  formats: string[];
  stylePreset: string;
  variations: number;
  brandId?: string | null;
  campaignId?: string | null;
  includeGif: boolean;
  locale: string;
  archetypeOverride?: { archetypeId: string; presetId: string };
  expectedCreditCost: number;
}

export async function runInlineGeneration(params: InlineGenerateParams): Promise<void> {
  const {
    jobId, userId, orgId, prompt, formats, stylePreset,
    variations, brandId, campaignId, locale, archetypeOverride,
  } = params;

  try {
    // Initialize fonts for Vercel/serverless — downloads Google Fonts TTFs
    // to /tmp so buildUltimateFontFaces() can base64-embed them in SVG.
    // Critical for sharp PNG rendering with custom typography.
    try {
      const { initUltimateFonts } = require("../engines/render/font-registry-ultimate");
      await initUltimateFonts();
    } catch (fontErr: any) {
      console.warn("[inline-generate] Font init failed (non-fatal):", fontErr.message);
    }

    // Mark job as RUNNING
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "RUNNING" as any, startedAt: new Date(), attempts: { increment: 1 } },
    }).catch(() => {});

    // Load brand if specified
    const brand = brandId
      ? await prisma.brand.findUnique({ where: { id: brandId } }).catch(() => null)
      : null;

    // Brief analysis (~2-5s)
    const { analyzeBrief } = require("../engines/ai/brief-analyzer");
    const brief = await analyzeBrief({
      prompt,
      stylePreset,
      format: formats[0],
      locale: locale ?? "en",
      brand: brand ? {
        primaryColor:   brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        voiceAttribs:   brand.voiceAttribs as Record<string, number>,
        fontDisplay:    brand.fontDisplay,
      } : undefined,
    });

    await prisma.job.update({ where: { id: jobId }, data: { progress: 15 } }).catch(() => {});

    const format = formats[0];
    const { runGenerationPipeline } = require("../engines/ai/pipeline-orchestrator");
    const { getCreditCost, getCategoryLabel } = require("./types");

    const brandInput = brand ? {
      primaryColor:   brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      fontDisplay:    brand.fontDisplay,
      fontBody:       brand.fontBody,
      voiceAttribs:   brand.voiceAttribs as Record<string, number>,
      colors:         [brand.primaryColor, brand.secondaryColor],
      fonts:          brand.fontDisplay ? [{ family: brand.fontDisplay }] : [],
      tone:           brand.voiceAttribs ? Object.keys(brand.voiceAttribs as object) : [],
    } : undefined;

    // Generate each variation with a distinct variationIdx so the pipeline
    // picks different themes, layouts, and copy per variation.
    const totalVariations = Math.max(1, variations);
    const allAssetIds: string[] = [];
    let totalCreditCost = 0;
    let lastThumbnailUrl: string | null = null;
    let lastResult: any = null;
    let totalPipelineMs = 0;

    for (let vi = 0; vi < totalVariations; vi++) {
      const progressBase = 20 + Math.floor((vi / totalVariations) * 65);
      await prisma.job.update({ where: { id: jobId }, data: { progress: progressBase } }).catch(() => {});

      const orchestrated = await runGenerationPipeline({
        jobId,
        orgId,
        campaignId: campaignId ?? jobId,
        format,
        variationIdx: vi,
        stylePreset,
        archetypeOverride: archetypeOverride as any,
        outputFormat: "png",
        pngScale: 1,
        brief,
        brand: brandInput,
        requestedVariations:  totalVariations,
        maxAllowedVariations: totalVariations,
      });

      const result  = orchestrated.render;
      const assetId = result.assetId;
      totalPipelineMs += orchestrated.totalPipelineMs ?? 0;

      // Upload to S3 if configured
      let s3Key:  string | null = null;
      let svgKey: string | null = null;

      if (detectCapabilities().storage) {
        try {
          const { uploadToS3, buildS3Key } = require("./s3");
          s3Key  = buildS3Key(orgId, assetId, "png");
          svgKey = buildS3Key(orgId, assetId, "svg");
          await Promise.all([
            uploadToS3(s3Key,  result.buffer,                          "image/png"),
            uploadToS3(svgKey, Buffer.from(result.svgSource, "utf-8"), "image/svg+xml"),
          ]);
        } catch (s3Err: any) {
          console.warn("[inline-generate] S3 upload failed, using inline SVG:", s3Err.message);
          s3Key  = null;
          svgKey = null;
        }
      }

      // Resolve thumbnailUrl
      let thumbnailUrl: string | null = null;
      if (s3Key && detectCapabilities().storage) {
        try {
          const { getSignedDownloadUrl } = require("./s3");
          thumbnailUrl = await getSignedDownloadUrl(s3Key, 3600).catch(() => null);
        } catch { /* no-op */ }
      }
      if (!thumbnailUrl && result.svgSource) {
        thumbnailUrl = `data:image/svg+xml;base64,${Buffer.from(result.svgSource).toString("base64")}`;
      }

      // Create asset record
      const creditCost = getCreditCost(format, false);
      totalCreditCost += creditCost;

      await prisma.asset.create({
        data: {
          id:           assetId,
          userId,
          orgId,
          campaignId:   campaignId ?? null,
          name:         `${format}-v${vi + 1}`,
          format,
          category:     getCategoryLabel(format),
          mimeType:     "image/png",
          s3Key:        s3Key ?? `inline:${assetId}`,
          s3Bucket:     process.env.S3_BUCKET_NAME ?? "inline",
          width:        result.width,
          height:       result.height,
          fileSize:     result.fileSize,
          layoutFamily: result.layoutFamily,
          svgSource:    result.svgSource,
          brandScore:   result.brandScore,
          hierarchyValid: result.hierarchyValid,
          metadata: {
            layoutVariation:  result.layoutVariation,
            violations:       result.violations?.slice(0, 10) ?? [],
            svgKey:           svgKey ?? null,
            durationMs:       result.durationMs,
            pipelineMs:       orchestrated.totalPipelineMs,
            anyFallback:      orchestrated.anyFallback,
            allStagesPassed:  orchestrated.allStagesPassed,
            inlineGenerated:  true,
            variationIdx:     vi,
            thumbnailUrl,
          } as any,
        },
      });

      allAssetIds.push(assetId);
      lastThumbnailUrl = thumbnailUrl;
      lastResult = result;
    }

    await prisma.job.update({ where: { id: jobId }, data: { progress: 90 } }).catch(() => {});

    // Deduct credits (creditBalance = canonical credit field)
    try {
      await prisma.org.update({
        where: { id: orgId },
        data:  { creditBalance: { decrement: totalCreditCost } },
      });
    } catch (creditErr: any) {
      console.warn("[inline-generate] Credit deduction failed:", creditErr.message);
    }

    // Mark job COMPLETED
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status:      "COMPLETED" as any,
        progress:    100,
        completedAt: new Date(),
        result: {
          assetIds:        allAssetIds,
          creditCost:      totalCreditCost,
          totalAssets:     allAssetIds.length,
          durationMs:      totalPipelineMs,
          inlineGenerated: true,
          thumbnailUrl:    lastThumbnailUrl,
          svgSource:       lastResult?.svgSource ?? null,
          format,
          width:           lastResult?.width,
          height:          lastResult?.height,
        } as any,
      },
    });

    console.info(`[inline-generate] Job ${jobId} completed: ${allAssetIds.length} assets, ${totalPipelineMs}ms`);

  } catch (err: any) {
    console.error(`[inline-generate] Job ${jobId} failed:`, err.message);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status:   "FAILED" as any,
        failedAt: new Date(),
        result: {
          error:           err.message ?? "Generation failed",
          failReason:      err.message,
          inlineGenerated: true,
        } as any,
      },
    }).catch(() => {});
  }
}
