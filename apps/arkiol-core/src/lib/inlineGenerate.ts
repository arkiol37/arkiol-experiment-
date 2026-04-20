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
// STRICT CANDIDATE PIPELINE:
//   Instead of persisting every rendered candidate, this module
//   over-generates up to ~2x the requested count, evaluates each against
//   the strict rejection rules + marketplace gate (already computed
//   inside renderAsset as PipelineResult.qualityVerdict), and only
//   admits strong, structured, visually rich templates into the gallery.
//   Weak outputs (gradient-only, single text block, asset-poor, weak
//   composition, poor spacing, repetitive) are discarded before the user
//   sees them. If too few survive, a minimum floor is filled from the
//   strongest rejected candidates so the gallery is never empty — those
//   entries are tagged so the audit trail still knows why they shipped.
//
// BEST-N SELECTION:
//   After over-generation, survivors are ranked by the penalty-aware
//   rank score (qualityVerdict.rankScore) and the top `variations`
//   templates are shipped. FIFO is never used: if attempt 4 scores
//   higher than attempts 0..3 it ships; weaker accepted candidates are
//   demoted. Floor-fills are ordered by rank score too so the strongest
//   rescues win.
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

    // Target: `totalVariations` accepted candidates, each strong enough
    // for the gallery. We over-generate up to 2x attempts (bounded), run
    // the strict rejection gate on every render, dedup near-clones by
    // theme palette + typography, and only persist survivors.
    const totalVariations = Math.max(1, variations);
    const MAX_ATTEMPTS    = Math.min(Math.max(totalVariations * 2, totalVariations + 3), 16);

    interface RenderedCandidate {
      vi:             number;
      result:         any;
      orchestrated:   any;
      /** Penalty-aware rank score used for best-N selection. */
      rankScore:      number;
      /** Raw marketplace score (audit only). */
      marketScore:    number;
      /** Top penalty reasons pulled from the verdict (audit only). */
      rankPenalties:  string[];
      accepted:       boolean;
      rejectReasons:  string[];
      failedCriteria: string[];
      themeId:        string;
      paletteKey:     string;
      /** Template type the composer shaped this render for — drives
       *  gallery-level diversity. */
      templateType:   string;
      /** Populated sections (header / content / visual / list_block / cta
       *  / supporting) derived from the actual text zones that render.
       *  Surfaced in the admission audit so gallery ops can verify the
       *  multi-section structural floor held. */
      sections:       string[];
      sectionCount:   number;
    }

    const rendered: RenderedCandidate[] = [];
    let attemptedCount = 0;
    let totalPipelineMs = 0;

    // Signature used to greedy-dedup palette + typography twins. We treat
    // two candidates as near-clones when theme id, primary colour, and
    // surface match — this mirrors the looser `areTooSimilar` rule in
    // candidate-quality but works off the lean snapshot the pipeline
    // already returns. Undefined snapshot → unique-per-call key.
    const paletteKeyOf = (r: any): string => {
      const snap = r?.packStyleSnapshot;
      if (!snap) return `raw:${r?.assetId ?? Math.random()}`;
      return [
        r?.evaluationSignals?.themeId ?? "?",
        snap.primary, snap.surface, snap.ink,
        snap.fontDisplay, snap.fontBody,
      ].join("|").toLowerCase();
    };

    const acceptedCount = () => rendered.filter(r => r.accepted).length;

    while (acceptedCount() < totalVariations && attemptedCount < MAX_ATTEMPTS) {
      const vi = attemptedCount;
      attemptedCount += 1;

      const progressBase = 20 + Math.floor((Math.min(acceptedCount(), totalVariations) / totalVariations) * 65);
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

      const result = orchestrated.render;
      totalPipelineMs += orchestrated.totalPipelineMs ?? 0;

      const verdict = result.qualityVerdict;
      const paletteKey = paletteKeyOf(result);
      const priorPalette = rendered.some(r => r.accepted && r.paletteKey === paletteKey);

      // Strict admission: must pass rejection rules AND not be a palette
      // twin of a previously accepted candidate. Marketplace approval is
      // preferred but not required — the rejection rules already enforce
      // the hard quality floor. Missing verdict = degraded fallback
      // render, which we reject.
      const accepted =
        !!verdict &&
        verdict.rulesAccepted &&
        !priorPalette;

      const rejectReasons: string[] = [];
      if (!verdict)                     rejectReasons.push("verdict_missing");
      else {
        if (!verdict.rulesAccepted)     rejectReasons.push(...verdict.hardReasons);
        if (priorPalette)               rejectReasons.push(`near_duplicate:${paletteKey}`);
      }

      rendered.push({
        vi,
        result,
        orchestrated,
        rankScore:      verdict?.rankScore ?? verdict?.qualityScore ?? 0,
        marketScore:    verdict?.marketplaceScore ?? 0,
        rankPenalties:  verdict?.rankPenalties ?? [],
        accepted,
        rejectReasons,
        failedCriteria: verdict?.failedCriteria ?? [],
        themeId:        verdict?.themeId ?? result?.evaluationSignals?.themeId ?? "unknown",
        paletteKey,
        templateType:   verdict?.templateType ?? "unknown",
        sections:       verdict?.sections ?? [],
        sectionCount:   verdict?.sectionCount ?? 0,
      });

      console.info(
        `[inline-generate] vi=${vi} theme=${verdict?.themeId ?? "?"} ` +
        `type=${verdict?.templateType ?? "?"} ` +
        `sections=${verdict?.sectionCount ?? 0}[${(verdict?.sections ?? []).join("+")}] ` +
        `accepted=${accepted} rank=${(verdict?.rankScore ?? 0).toFixed(2)} ` +
        `market=${(verdict?.marketplaceScore ?? 0).toFixed(2)}` +
        (rejectReasons.length > 0 ? ` reasons=[${rejectReasons.slice(0, 3).join("|")}]` : "") +
        ((verdict?.rankPenalties?.length ?? 0) > 0 ? ` pen=[${verdict!.rankPenalties.slice(0, 3).join("|")}]` : ""),
      );
    }

    // Build the final admission list with *best-N by rank score + template-
    // type variety*. Candidates are picked greedily: each iteration
    // re-sorts the pool by rank score with a small penalty applied to
    // types already admitted, so the gallery surfaces different template
    // types (checklist, tips, quote, step-by-step, list, promotional,
    // educational, minimal) whenever available — without letting a
    // significantly higher-scoring candidate be blocked just because its
    // type was already picked. Floor-fill follows the same greedy logic
    // when accepted candidates alone can't satisfy the requested count.
    type Admission = RenderedCandidate & { floorFill: boolean };
    const TYPE_VARIETY_PENALTY = 0.06;

    const greedyPickN = (pool: RenderedCandidate[], n: number, seen: Set<string>, floorFill: boolean): Admission[] => {
      const remaining = pool.slice();
      const out: Admission[] = [];
      while (out.length < n && remaining.length > 0) {
        remaining.sort((a, b) => {
          const aPen = seen.has(a.templateType) ? TYPE_VARIETY_PENALTY : 0;
          const bPen = seen.has(b.templateType) ? TYPE_VARIETY_PENALTY : 0;
          return (b.rankScore - bPen) - (a.rankScore - aPen);
        });
        const pick = remaining.shift()!;
        out.push({ ...pick, floorFill });
        if (pick.templateType) seen.add(pick.templateType);
      }
      return out;
    };

    const seenTypes = new Set<string>();
    const admitted: Admission[] = greedyPickN(
      rendered.filter(r => r.accepted),
      totalVariations,
      seenTypes,
      false,
    );

    if (admitted.length < totalVariations) {
      const admittedVis = new Set(admitted.map(a => a.vi));
      const fill = greedyPickN(
        rendered.filter(r => !admittedVis.has(r.vi)),
        totalVariations - admitted.length,
        seenTypes,
        true,
      );
      admitted.push(...fill);
    }

    // Stable order by render index so the UI shows variation numbering
    // in the order they were produced.
    admitted.sort((a, b) => a.vi - b.vi);

    const allAssetIds: string[] = [];
    let totalCreditCost = 0;
    let lastThumbnailUrl: string | null = null;
    let lastResult: any = null;

    for (let idx = 0; idx < admitted.length; idx++) {
      const adm    = admitted[idx];
      const result = adm.result;
      const assetId = result.assetId;

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

      // Credit only ACCEPTED admissions. Over-generated rejects are not
      // charged — they never reach the user.
      const creditCost = getCreditCost(format, false);
      totalCreditCost += creditCost;

      await prisma.asset.create({
        data: {
          id:           assetId,
          userId,
          orgId,
          campaignId:   campaignId ?? null,
          name:         `${format}-v${idx + 1}`,
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
            pipelineMs:       adm.orchestrated.totalPipelineMs,
            anyFallback:      adm.orchestrated.anyFallback,
            allStagesPassed:  adm.orchestrated.allStagesPassed,
            inlineGenerated:  true,
            variationIdx:     adm.vi,
            thumbnailUrl,
            // Gallery-grade admission audit.
            strictAdmission:  {
              accepted:         adm.accepted,
              floorFill:        adm.floorFill,
              rankScore:        adm.rankScore,
              marketplaceScore: adm.marketScore,
              rankPenalties:    adm.rankPenalties,
              themeId:          adm.themeId,
              templateType:     adm.templateType,
              sections:         adm.sections,
              sectionCount:     adm.sectionCount,
              rejectReasons:    adm.rejectReasons,
              failedCriteria:   adm.failedCriteria,
              attemptsUsed:     attemptedCount,
              acceptedCount:    acceptedCount(),
              requested:        totalVariations,
            },
          } as any,
        },
      });

      allAssetIds.push(assetId);
      lastThumbnailUrl = thumbnailUrl;
      lastResult = result;
    }

    const uniqueTypes = new Set(admitted.map(a => a.templateType));
    const avgSections = admitted.length
      ? (admitted.reduce((s, a) => s + a.sectionCount, 0) / admitted.length).toFixed(1)
      : "0.0";
    const uniqueSections = new Set(admitted.flatMap(a => a.sections));
    console.info(
      `[inline-generate] Job ${jobId} admission: ` +
      `requested=${totalVariations} attempts=${attemptedCount} ` +
      `accepted=${acceptedCount()} shipped=${admitted.length} ` +
      `floorFilled=${admitted.filter(a => a.floorFill).length} ` +
      `types=[${[...uniqueTypes].join(",")}] ` +
      `avgSections=${avgSections} sections=[${[...uniqueSections].join(",")}]`,
    );

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
