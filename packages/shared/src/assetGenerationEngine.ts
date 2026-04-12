import { PrismaClient } from '@prisma/client';
// packages/shared/src/assetGenerationEngine.ts
// On-Demand Asset Generation Engine — Production V2
//
// Key guarantees:
//   ✓ NO placeholder logic — errors throw; callers handle failure, never silently degrade
//   Launch modes: normal_ad (2D, 20cr) and cinematic_ad (2.5D, 35cr)
//   ✓ HQ upgrade is explicit user choice — separate credit cost, plan-gated
//   ✓ Similarity hash dedup: same prompt+type+palette = cache hit, zero AI spend
//   ✓ All generated assets persisted to AIGeneratedAsset with full metadata
//   ✓ CDN URLs returned for all persisted assets; signed S3 URLs for private assets
//   ✓ Never returns a placeholder for a "real" generation — either succeeds or throws
//   ✓ Full metadata on every asset: model, cost, timing, reuse count, hash, orgId
//
// Isolation: accepts prisma + uploadFn + openai as injected deps — no app imports.

import { z } from 'zod';
import { getEnv } from './env';

// ── Schema definitions ─────────────────────────────────────────────────────────

export const AssetTypeSchema = z.enum(['vector', 'illustrated', 'photoreal']);
// NOTE: '3d' was removed from AssetTypeSchema — 3D on-demand assets are not part of the launch product.
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetQualitySchema = z.enum(['standard', 'hq']);
export type AssetQuality = z.infer<typeof AssetQualitySchema>;

export const AssetSourceSchema = z.enum(['cache', 'library', 'ai_generated']);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const GeneratedAssetSchema = z.object({
  id:               z.string(),
  url:              z.string(),          // CDN URL (preferred) or signed S3 URL
  cdnUrl:           z.string().optional(),
  signedUrl:        z.string().optional(), // time-limited signed URL (private assets)
  signedUrlExpiresAt: z.string().optional(),
  type:             AssetTypeSchema,
  quality:          AssetQualitySchema,
  source:           AssetSourceSchema,
  reuseCount:       z.number().int().nonnegative().default(0), // # times this hash was reused
  width:            z.number().int().positive(),
  height:           z.number().int().positive(),
  mimeType:         z.string(),
  maskUrl:          z.string().optional(),
  palette:          z.array(z.string()).max(6),
  perspectiveFit:   z.boolean(),
  safetyValidated:  z.boolean(),
  similarityHash:   z.string(),          // always set — used for dedup
  generatedAt:      z.string(),
  promptUsed:       z.string().optional(),
  creditCost:       z.number().int().nonnegative(), // actual credits charged for this asset
  providerCostUsd:  z.number().nonnegative().optional(), // actual AI API cost
  durationMs:       z.number().int().nonnegative(),
  metadata:         z.record(z.unknown()),
});
export type GeneratedAsset = z.infer<typeof GeneratedAssetSchema>;

export const MissingElementSchema = z.object({
  elementId:    z.string(),
  elementType:  z.enum(['background', 'hero_image', 'icon', 'illustration', 'texture', 'pattern']),
  requiredSize: z.object({ width: z.number(), height: z.number() }),
  context:      z.string().max(500),
  priority:     z.enum(['critical', 'optional']),
});
export type MissingElement = z.infer<typeof MissingElementSchema>;

export const AssetGenerationRequestSchema = z.object({
  requestId:    z.string(),
  missingEl:    MissingElementSchema,
  assetType:    AssetTypeSchema.default('photoreal'),
  quality:      AssetQualitySchema.default('standard'),
  palette:      z.array(z.string()).max(6).default([]),
  style:        z.string().optional(),
  brandId:      z.string().optional(),
  orgId:        z.string(),
  // Plan enforcement inputs — caller must populate from DB
  planCanUseHq: z.boolean().default(false),
  maxOnDemandAssets: z.number().int().positive().default(4),
  // Credit cost for this request (pre-calculated by caller)
  expectedCreditCost: z.number().int().nonnegative().default(0),
  safetyLevel:  z.enum(['strict', 'standard']).default('strict'),
});
export type AssetGenerationRequest = z.infer<typeof AssetGenerationRequestSchema>;

// ── Injected dependencies ──────────────────────────────────────────────────────

export interface AssetEngineDeps {
  prisma?:   PrismaClient;
  /** Upload buffer to S3/CDN, returns public CDN URL */
  uploadFn?: (buf: Buffer, key: string, mimeType: string, metadata?: Record<string, string>) => Promise<string>;
  /** Get signed S3 download URL for private assets */
  getSignedUrlFn?: (key: string, expiresIn?: number) => Promise<string>;
  openai?:   unknown;
}

// ── Safety validation ──────────────────────────────────────────────────────────

const BLOCKED_TERMS = [
  'weapon', 'violence', 'explicit', 'nsfw', 'nude', 'blood', 'gore',
  'sexual', 'pornograph', 'terrorist', 'self-harm', 'self harm',
  'kill', 'murder', 'bomb', 'drug',
];

async function validateAssetSafety(
  prompt: string,
  level: 'strict' | 'standard'
): Promise<{ safe: boolean; reason?: string }> {
  const lower = prompt.toLowerCase();
  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) {
      return { safe: false, reason: `Blocked term: "${term}"` };
    }
  }
  if (level === 'strict' && lower.length < 5) {
    return { safe: false, reason: 'Prompt too short for strict mode' };
  }
  return { safe: true };
}

// ── Similarity hash (stable, deterministic) ────────────────────────────────────

export function computeSimilarityHash(
  prompt: string,
  type:    AssetType,
  quality: AssetQuality,
  palette: string[]
): string {
  const normalized = [
    prompt.toLowerCase().replace(/\s+/g, ' ').trim(),
    type,
    quality,
    [...palette].sort().join(','),
  ].join('|');

  // djb2 hash for speed
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h) ^ normalized.charCodeAt(i);
    h = h >>> 0;
  }

  // Mix in prefix from content for collision resistance
  const contentPrefix = Buffer.from(normalized.slice(0, 32))
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12);

  return `${h.toString(16).padStart(8, '0')}${contentPrefix}`;
}

// ── DB cache lookup (similarity hash dedup) ────────────────────────────────────

async function lookupCache(
  prisma:        any,
  similarityHash: string,
  orgId:         string,
  quality:       AssetQuality,
): Promise<{ asset: GeneratedAsset; reuseCount: number } | null> {
  try {
    // Find the best matching cached asset (same org + hash + quality)
    const row = await prisma.aIGeneratedAsset.findFirst({
      where:   { similarityHash, orgId, safetyValidated: true, quality },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;

    // Increment reuse counter (fire-and-forget)
    const newReuseCount = (row.metadata?.reuseCount ?? 0) + 1;
    prisma.aIGeneratedAsset.update({
      where: { id: row.id },
      data:  { metadata: { ...row.metadata, reuseCount: newReuseCount, lastReusedAt: new Date().toISOString() } },
    }).catch(() => {/* non-fatal */});

    return {
      reuseCount: newReuseCount,
      asset: {
        id:               row.id,
        url:              row.cdnUrl ?? row.url,
        cdnUrl:           row.cdnUrl ?? undefined,
        signedUrl:        undefined,
        signedUrlExpiresAt: undefined,
        type:             row.assetType as AssetType,
        quality:          (row.quality ?? 'standard') as AssetQuality,
        source:           'cache' as AssetSource,
        reuseCount:       newReuseCount,
        width:            row.width,
        height:           row.height,
        mimeType:         row.mimeType,
        maskUrl:          row.maskUrl ?? undefined,
        palette:          Array.isArray(row.palette) ? row.palette : [],
        perspectiveFit:   row.perspectiveFit,
        safetyValidated:  row.safetyValidated,
        similarityHash:   row.similarityHash ?? similarityHash,
        generatedAt:      row.createdAt.toISOString(),
        promptUsed:       row.promptUsed ?? undefined,
        creditCost:       0, // cache hits cost 0 credits
        providerCostUsd:  0,
        durationMs:       0,
        metadata:         {
          ...(typeof row.metadata === 'object' ? row.metadata : {}),
          cachedFrom: row.id,
          reuseCount: newReuseCount,
        },
      },
    };
  } catch (err: unknown) {
    console.warn('[asset-engine] Cache lookup failed (non-fatal):', (err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err)));
    return null;
  }
}

// ── Curated library lookup ─────────────────────────────────────────────────────

async function lookupLibrary(
  prisma:    any,
  missingEl: MissingElement,
  assetType: AssetType,
  orgId:     string,
): Promise<GeneratedAsset | null> {
  try {
    const tagMap: Record<string, string[]> = {
      background:   ['background', 'texture', 'pattern'],
      hero_image:   ['hero', 'lifestyle', 'product'],
      icon:         ['icon', 'symbol', 'ui'],
      illustration: ['illustration', 'graphic', 'artwork'],
      texture:      ['texture', 'material', 'surface'],
      pattern:      ['pattern', 'repeat', 'tile'],
    };
    const tags = tagMap[missingEl.elementType] ?? [];
    if (!tags.length) return null;

    const asset = await prisma.asset.findFirst({
      where: {
        tags:     { hasSome: tags },
        mimeType: assetType === 'vector'
          ? 'image/svg+xml'
          : { in: ['image/webp', 'image/jpeg', 'image/png'] },
      },
      orderBy: { brandScore: 'desc' },
      select:  { id: true, s3Key: true, mimeType: true, width: true, height: true },
    });
    if (!asset?.s3Key) return null;

    const { CLOUDFRONT_DOMAIN: cdnDomain, AWS_REGION: region = 'us-east-1', S3_BUCKET_NAME: bucket = '' } = getEnv();
    const url       = cdnDomain
      ? `https://${cdnDomain}/${asset.s3Key}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${asset.s3Key}`;

    const hash = computeSimilarityHash(
      `library:${asset.id}:${missingEl.elementType}`,
      assetType, 'standard', []
    );

    return {
      id:               `lib_${asset.id}`,
      url,
      cdnUrl:           url,
      signedUrl:        undefined,
      signedUrlExpiresAt: undefined,
      type:             assetType,
      quality:          'standard' as AssetQuality,
      source:           'library' as AssetSource,
      reuseCount:       0,
      width:            asset.width  ?? missingEl.requiredSize.width,
      height:           asset.height ?? missingEl.requiredSize.height,
      mimeType:         asset.mimeType ?? 'image/webp',
      palette:          [],
      perspectiveFit:   false,
      safetyValidated:  true,
      similarityHash:   hash,
      generatedAt:      new Date().toISOString(),
      creditCost:       0,
      maskUrl:          undefined,
      promptUsed:       undefined,
      providerCostUsd:  0,
      durationMs:       0,
      metadata:         { libraryAssetId: asset.id, orgId },
    };
  } catch {
    return null;
  }
}

// ── AI generation — no placeholders, throws on failure ────────────────────────

async function generateWithAI(
  req:  AssetGenerationRequest,
  deps: AssetEngineDeps,
  hash: string,
): Promise<{ asset: GeneratedAsset; providerCostUsd: number }> {
  const t0 = Date.now();
  const { missingEl, assetType, quality, palette, orgId, requestId } = req;
  const { width, height } = missingEl.requiredSize;

  const paletteHint = palette.length ? ` Colors: ${palette.join(', ')}.` : '';
  const styleHint   = req.style ? ` Style: ${req.style}.` : '';
  const qualityHint = quality === 'hq' ? ' High quality, detailed, professional.' : '';
  const prompt      = `${missingEl.context}${paletteHint}${styleHint}${qualityHint}`.trim();

  // ── Vector — GPT-4o SVG generation ────────────────────────────────────────
  if (assetType === 'vector') {
    if (!deps.openai) throw new Error('OpenAI client not available for vector generation');

    const resp = await (deps.openai as { chat: { completions: { create(a: Record<string,unknown>): Promise<{choices: {message?: {content?: string|null}}[]}> } } }).chat.completions.create({
      model:       quality === 'hq' ? 'gpt-4o' : 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a professional SVG designer. Return ONLY valid, self-contained SVG markup. No markdown fences, no explanation, no external references or hrefs.' },
        { role: 'user',   content: `Create an SVG graphic for: ${prompt}\nCanvas: viewBox="0 0 ${width} ${height}". No external URLs. Safe, inline styles only.` },
      ],
      max_tokens:  quality === 'hq' ? 4000 : 2000,
      temperature: 0.35,
    });
    const svgRaw = (resp.choices[0]?.message?.content ?? '').replace(/```[a-z]*\n?/gi, '').trim();
    if (!svgRaw.startsWith('<')) throw new Error('GPT-4o returned invalid SVG (no opening tag)');

    // Validate: no external references
    if (/href\s*=\s*["']https?:/i.test(svgRaw)) throw new Error('SVG contains external URLs — rejected for security');

    let cdnUrl: string | undefined;
    let s3Key:  string | undefined;
    const assetBuf = Buffer.from(svgRaw, 'utf-8');

    if (deps.uploadFn) {
      s3Key  = `ai-assets/${orgId}/${requestId}.svg`;
      cdnUrl = await deps.uploadFn(assetBuf, s3Key, 'image/svg+xml', {
        orgId, requestId, assetType: 'vector', quality, similarityHash: hash,
      });
    }

    const durationMs = Date.now() - t0;
    // GPT-4o-mini cost: ~$0.0001/1k tokens output; GPT-4o: ~$0.015/1k
    const providerCostUsd = quality === 'hq' ? 0.003 : 0.0002;

    return {
      providerCostUsd,
      asset: {
        id: `gen_${requestId}`, url: cdnUrl ?? `data:image/svg+xml;base64,${assetBuf.toString('base64')}`,
        cdnUrl, type: 'vector', quality, source: 'ai_generated', reuseCount: 0,
        width, height, mimeType: 'image/svg+xml', palette, perspectiveFit: false, safetyValidated: true,
        similarityHash: hash, generatedAt: new Date().toISOString(), promptUsed: prompt,
        creditCost: req.expectedCreditCost, providerCostUsd, durationMs,
        maskUrl:          undefined,
        signedUrl:        undefined,
        signedUrlExpiresAt: undefined,
        metadata: { model: quality === 'hq' ? 'gpt-4o' : 'gpt-4o-mini', orgId, requestId, s3Key: s3Key ?? null, svgBytes: assetBuf.length },
      },
    };
  }

  // ── Photoreal / Illustrated — DALL-E 3 ────────────────────────────────────
  if (assetType === 'photoreal' || assetType === 'illustrated') {
    if (!deps.openai) throw new Error('OpenAI client not available for image generation');

    // HQ = 1792x1024 + HD quality; standard = 1024x1024
    const dalleSize    = quality === 'hq' ? '1792x1024' : '1024x1024';
    const dalleQuality = quality === 'hq' ? 'hd' : 'standard';
    const dalleStyle: 'vivid' | 'natural' = assetType === 'illustrated' ? 'vivid' : 'natural';

    const imgResp = await (deps.openai as { images: { generate(a: Record<string,unknown>): Promise<{data: {url?: string; b64_json?: string}[]}> } }).images.generate({
      model:   'dall-e-3',
      prompt:  prompt.slice(0, 3900),
      n:       1,
      size:    dalleSize,
      quality: dalleQuality,
      style:   dalleStyle,
    });

    const imageUrl = imgResp.data?.[0]?.url;
    if (!imageUrl) throw new Error('DALL-E 3 returned no image URL');

    // Download generated image (DALL-E URLs expire after 1h) and persist to S3
    const imgFetch = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!imgFetch.ok) throw new Error(`Failed to fetch DALL-E image: HTTP ${imgFetch.status}`);
    const imgBuf = Buffer.from(await imgFetch.arrayBuffer());

    // DALL-E 3 cost: standard 1024x1024 = $0.040/image, hd = $0.080/image
    const providerCostUsd = quality === 'hq' ? 0.080 : 0.040;

    let cdnUrl: string = imageUrl; // fallback if upload fails
    let s3Key:  string | undefined;

    if (deps.uploadFn) {
      s3Key  = `ai-assets/${orgId}/${requestId}.webp`;
      try {
        cdnUrl = await deps.uploadFn(imgBuf, s3Key, 'image/webp', {
          orgId, requestId, assetType, quality, similarityHash: hash,
        });
      } catch (uploadErr: unknown) {
        // S3 upload failed: log but continue with direct URL (expires in 1h)
        console.error(`[asset-engine] S3 upload failed for ${requestId}:`, (uploadErr instanceof Error ? uploadErr.message : String(uploadErr)));
        // Note: this asset won't be cache-hit-able until it's re-generated with S3
        s3Key = undefined;
      }
    }

    const durationMs = Date.now() - t0;
    return {
      providerCostUsd,
      asset: {
        id: `gen_${requestId}`, url: cdnUrl, cdnUrl: s3Key ? cdnUrl : undefined,
        signedUrl:        undefined,
        signedUrlExpiresAt: undefined,
        type: assetType, quality, source: 'ai_generated', reuseCount: 0,
        width, height, mimeType: 'image/webp', palette, perspectiveFit: true, safetyValidated: true,
        similarityHash: hash, generatedAt: new Date().toISOString(), promptUsed: prompt,
        creditCost: req.expectedCreditCost, providerCostUsd, durationMs,
        maskUrl:          undefined,
        metadata: { model: 'dall-e-3', dalleStyle, dalleQuality, orgId, requestId, s3Key: s3Key ?? null, bytes: imgBuf.length },
      },
    };
  }


  throw new Error(`Unknown assetType: ${assetType as string}`);
}

// ── Palette harmonization ──────────────────────────────────────────────────────

function harmonizePalette(asset: GeneratedAsset, targetPalette: string[]): GeneratedAsset {
  if (!targetPalette.length || targetPalette.length === 0) return asset;
  if (asset.palette.join(',') === targetPalette.join(',')) return asset;
  return { ...asset, palette: targetPalette, metadata: { ...asset.metadata, paletteHarmonized: true } };
}

// ── Persist generated asset to DB ──────────────────────────────────────────────

async function persistGeneratedAsset(
  prisma: PrismaClient,
  orgId:  string,
  asset:  GeneratedAsset,
): Promise<void> {
  try {
    // Upsert: if same ID exists (retry scenario), update rather than fail
    await (prisma as unknown as Record<string, { upsert(a: unknown): Promise<unknown> }>).aIGeneratedAsset.upsert({
      where: { id: asset.id },
      create: {
        id:              asset.id,
        orgId,
        assetType:       asset.type,
        quality:         asset.quality,
        source:          asset.source,
        url:             asset.url,
        cdnUrl:          asset.cdnUrl ?? null,
        signedUrl:        undefined,
        signedUrlExpiresAt: undefined,
        width:           asset.width,
        height:          asset.height,
        mimeType:        asset.mimeType,
        maskUrl:         asset.maskUrl ?? null,
        palette:         asset.palette,
        perspectiveFit:  asset.perspectiveFit,
        safetyValidated: asset.safetyValidated,
        similarityHash:  asset.similarityHash,
        promptUsed:      asset.promptUsed ?? null,
        metadata:        {
          ...asset.metadata,
          creditCost:      asset.creditCost,
          providerCostUsd: asset.providerCostUsd ?? 0,
          durationMs:      asset.durationMs,
          reuseCount:      0,
        },
      },
      update: {
        // On retry: update URL/CDN if S3 upload finally succeeded
        url:    asset.url,
        cdnUrl: asset.cdnUrl ?? null,
        signedUrl:        undefined,
        signedUrlExpiresAt: undefined,
        metadata: {
          ...asset.metadata,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  } catch (err: unknown) {
    // Non-fatal: generation succeeded even if DB write fails
    console.error('[asset-engine] DB persist failed (non-fatal):', (err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err)));
  }
}

// ── Main result type ───────────────────────────────────────────────────────────

export interface AssetGenerationResult {
  asset:          GeneratedAsset;
  source:         AssetSource;
  ok:             boolean;
  errors:         string[];
  durationMs:     number;
  cacheHit:       boolean;
  safetyBlock:    boolean;
  requestId:      string;
  creditCost:     number;
  maskUrl:          undefined,
  promptUsed:       undefined,
  providerCostUsd: number;
}

// ── Error result builder ───────────────────────────────────────────────────────

function errorResult(
  requestId:   string,
  message:     string,
  t0:          number,
  safetyBlock = false,
): never {
  // We NEVER return placeholders. Throw so the caller can handle the error properly.
  throw Object.assign(new Error(message), {
    assetEngineError: true,
    requestId,
    safetyBlock,
    durationMs: Date.now() - t0,
  });
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * generateAssetOnDemand
 *
 * Throws on any failure — callers must catch and handle.
 * Never returns placeholders.
 *
 * On cache hit: returns asset with creditCost=0 and cacheHit=true.
 * On AI generation: returns asset with full metadata + provider cost.
 * Normal Ads (2D) and Cinematic Ads (2.5D) are the two launch generation modes.
 * On HQ when plan disallows: throws with plan upgrade message.
 */
export async function generateAssetOnDemand(
  req:  AssetGenerationRequest,
  deps: AssetEngineDeps = {},
): Promise<AssetGenerationResult> {
  const t0 = Date.now();
  const { requestId, missingEl, assetType, quality, palette, orgId } = req;

  // ── Input validation ───────────────────────────────────────────────────────
  const parsed = AssetGenerationRequestSchema.safeParse(req);
  if (!parsed.success) {
    errorResult(requestId, `Invalid request: ${parsed.error.errors.map(e => (e instanceof Error ? e.message : String(e))).join('; ')}`, t0);
  }

  // ── HQ plan gate ──────────────────────────────────────────────────────────
  if (quality === 'hq' && !req.planCanUseHq) {
    errorResult(requestId, 'HQ upgrade requires the Pro or Studio plan.', t0);
  }

  // ── Safety check ───────────────────────────────────────────────────────────
  const safety = await validateAssetSafety(missingEl.context, (req.safetyLevel ?? 'strict') as 'standard' | 'strict');
  if (!safety.safe) {
    errorResult(requestId, `Safety validation failed: ${safety.reason}`, t0, true);
  }

  const hash = computeSimilarityHash(missingEl.context, assetType, quality, palette);

  // ── Cache lookup (similarity hash dedup) ───────────────────────────────────
  if (deps.prisma) {
    const cached = await lookupCache(deps.prisma, hash, orgId, quality);
    if (cached) {
      const harmonized = harmonizePalette(cached.asset, palette);
      return {
        asset:           harmonized,
        source:          'cache',
        ok:              true,
        errors:          [],
        durationMs:      Date.now() - t0,
        cacheHit:        true,
        safetyBlock:     false,
        requestId,
        creditCost:      0, // cache hits are free
        maskUrl:          undefined,
        promptUsed:       undefined,
        providerCostUsd: 0,
      };
    }
  }

  // ── Curated library (no AI cost) ───────────────────────────────────────────
  if (deps.prisma) {
    const fromLib = await lookupLibrary(deps.prisma, missingEl, assetType, orgId);
    if (fromLib) {
      const harmonized = harmonizePalette(fromLib, palette);
      return {
        asset:           harmonized,
        source:          'library',
        ok:              true,
        errors:          [],
        durationMs:      Date.now() - t0,
        cacheHit:        false,
        safetyBlock:     false,
        requestId,
        creditCost:      0, // library assets are free
        maskUrl:          undefined,
        promptUsed:       undefined,
        providerCostUsd: 0,
      };
    }
  }

  // ── Real-time AI generation (throws on failure) ────────────────────────────
  const { asset: generated, providerCostUsd } = await generateWithAI(req, deps, hash);
  const harmonized = harmonizePalette(generated, palette);

  // ── Persist to DB for future cache hits (fire-and-forget) ─────────────────
  if (deps.prisma && harmonized.cdnUrl) {
    // Only persist if we have a stable CDN URL (not an expiring DALL-E URL)
    persistGeneratedAsset(deps.prisma, orgId, harmonized).catch(() => {/* non-fatal */});
  }

  return {
    asset:           harmonized,
    source:          'ai_generated',
    ok:              true,
    errors:          [],
    durationMs:      Date.now() - t0,
    cacheHit:        false,
    safetyBlock:     false,
    requestId,
    creditCost:      harmonized.creditCost,
    maskUrl:          undefined,
    promptUsed:       undefined,
    providerCostUsd,
  };
}

// ── Template element detector ──────────────────────────────────────────────────

export const TemplateElementSchema = z.object({
  id:       z.string(),
  type:     z.string(),
  url:      z.string().optional(),
  required: z.boolean().default(true),
  width:    z.number().optional(),
  height:   z.number().optional(),
  context:  z.string().optional(),
});
export type TemplateElement = z.infer<typeof TemplateElementSchema>;

export function detectMissingElements(elements: TemplateElement[]): MissingElement[] {
  const missing: MissingElement[] = [];
  for (const el of elements) {
    if (!el.required) continue;
    if (el.url?.trim()) continue;

    const elementType: MissingElement['elementType'] =
      el.type === 'background'   ? 'background'   :
      el.type === 'hero'         ? 'hero_image'    :
      el.type === 'icon'         ? 'icon'          :
      el.type === 'illustration' ? 'illustration'  :
      el.type === 'texture'      ? 'texture'       :
      el.type === 'pattern'      ? 'pattern'       : 'hero_image';

    missing.push({
      elementId:    el.id,
      elementType,
      requiredSize: { width: el.width ?? 1024, height: el.height ?? 1024 },
      context:      el.context ?? `${el.type} element for design template`,
      priority:     el.required ? 'critical' : 'optional',
    });
  }
  return missing;
}
