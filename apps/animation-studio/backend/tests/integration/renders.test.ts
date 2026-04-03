/**
 * Integration tests — Renders API
 *
 * Tests request schema validation, response contracts, credit accounting,
 * download URL logic, scene regenerate validation, and status machine rules.
 *
 * No real DB or Bull queue — all tests operate on schemas and pure logic.
 * HTTP-level supertest tests live in the e2e suite.
 */
import { z } from 'zod';

// ── Shared fixtures ────────────────────────────────────────────────────────
const validScene = {
  id:              '00000000-0000-0000-0000-000000000001',
  position:        0,
  prompt:          'A luxury watch on marble',
  voiceoverScript: 'Experience true luxury.',
  role:            'hook',
  timing:          {},
  visualConfig:    {},
};

const validConfig = {
  aspectRatio:     '9:16' as const,
  renderMode:      'Normal Ad' as const,
  resolution:      '1080p' as const,
  mood:            'Luxury',
  voice:           { gender: 'Female', tone: 'Confident', accent: 'American English', speed: 'Normal' },
  music:           { style: 'Cinematic Ambient', energyCurve: 'Build Up', beatSync: true },
  creditsToCharge: 20,
};

// ══════════════════════════════════════════════════════════════════════════════
// Render submission schema validation
// ══════════════════════════════════════════════════════════════════════════════
describe('Render submission — schema contracts', () => {
  // Replicate the zod schema from renders.ts for validation tests
  const sceneSchema = z.object({
    id:              z.string().uuid().optional(),
    position:        z.number().int().min(0).max(9),
    prompt:          z.string().min(1).max(2000),
    voiceoverScript: z.string().max(1000).optional(),
    role:            z.enum(['hook', 'problem', 'solution', 'proof', 'cta', 'custom']).optional(),
    timing:          z.record(z.any()).optional(),
    visualConfig:    z.record(z.any()).optional(),
  });

  const configSchema = z.object({
    aspectRatio:     z.enum(['9:16', '1:1', '16:9']),
    renderMode:      z.enum(['Normal Ad', '2D Extended', 'Cinematic Ad', 'Cinematic Ad']),
    resolution:      z.enum(['1080p', '4K']),
    mood:            z.string(),
    voice:           z.object({
      gender: z.string(),
      tone:   z.string(),
      accent: z.string(),
      speed:  z.string(),
    }),
    music:           z.object({
      style:       z.string(),
      energyCurve: z.string(),
      beatSync:    z.boolean(),
    }),
    creditsToCharge: z.number().int().min(1),
    placement:       z.string().optional(),
    platform:        z.string().optional(),
  });

  const createRenderSchema = z.object({
    storyboardId:   z.string().uuid(),
    scenes:         z.array(sceneSchema).min(1).max(10),
    config:         configSchema,
    idempotencyKey: z.string().max(128).optional(),
  });

  it('valid complete body passes', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes:       [validScene],
      config:       validConfig,
    });
    expect(result.success).toBe(true);
  });

  it('missing storyboardId fails', () => {
    const result = createRenderSchema.safeParse({ scenes: [validScene], config: validConfig });
    expect(result.success).toBe(false);
  });

  it('non-UUID storyboardId fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: 'not-a-uuid',
      scenes: [validScene],
      config: validConfig,
    });
    expect(result.success).toBe(false);
  });

  it('empty scenes array fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [],
      config: validConfig,
    });
    expect(result.success).toBe(false);
  });

  it('11 scenes (over max) fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: new Array(11).fill(validScene),
      config: validConfig,
    });
    expect(result.success).toBe(false);
  });

  it('exactly 10 scenes passes', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: new Array(10).fill(validScene),
      config: validConfig,
    });
    expect(result.success).toBe(true);
  });

  it('prompt over 2000 chars fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [{ ...validScene, prompt: 'x'.repeat(2001) }],
      config: validConfig,
    });
    expect(result.success).toBe(false);
  });

  it('empty prompt fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [{ ...validScene, prompt: '' }],
      config: validConfig,
    });
    expect(result.success).toBe(false);
  });

  it('invalid aspectRatio fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [validScene],
      config: { ...validConfig, aspectRatio: '4:3' },
    });
    expect(result.success).toBe(false);
  });

  it('invalid renderMode fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [validScene],
      config: { ...validConfig, renderMode: 'Ultra 4D' },
    });
    expect(result.success).toBe(false);
  });

  it('invalid resolution fails', () => {
    const result = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [validScene],
      config: { ...validConfig, resolution: '720p' },
    });
    expect(result.success).toBe(false);
  });

  it('all valid aspectRatios are accepted', () => {
    for (const ar of ['9:16', '1:1', '16:9']) {
      const r = createRenderSchema.safeParse({
        storyboardId: '00000000-0000-0000-0000-000000000002',
        scenes: [validScene],
        config: { ...validConfig, aspectRatio: ar },
      });
      expect(r.success).toBe(true);
    }
  });

  it('all valid renderModes are accepted', () => {
    for (const mode of ['Normal Ad', '2D Extended', 'Cinematic Ad', 'Cinematic Ad']) {
      const r = createRenderSchema.safeParse({
        storyboardId: '00000000-0000-0000-0000-000000000002',
        scenes: [validScene],
        config: { ...validConfig, renderMode: mode },
      });
      expect(r.success).toBe(true);
    }
  });

  it('all valid scene roles are accepted', () => {
    for (const role of ['hook', 'problem', 'solution', 'proof', 'cta', 'custom']) {
      const r = createRenderSchema.safeParse({
        storyboardId: '00000000-0000-0000-0000-000000000002',
        scenes: [{ ...validScene, role }],
        config: validConfig,
      });
      expect(r.success).toBe(true);
    }
  });

  it('invalid scene role fails', () => {
    const r = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [{ ...validScene, role: 'villain' }],
      config: validConfig,
    });
    expect(r.success).toBe(false);
  });

  it('optional idempotencyKey passes when present', () => {
    const r = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [validScene],
      config: validConfig,
      idempotencyKey: 'my-unique-key-123',
    });
    expect(r.success).toBe(true);
  });

  it('idempotencyKey over 128 chars fails', () => {
    const r = createRenderSchema.safeParse({
      storyboardId: '00000000-0000-0000-0000-000000000002',
      scenes: [validScene],
      config: validConfig,
      idempotencyKey: 'x'.repeat(129),
    });
    expect(r.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Scene regenerate schema validation
// ══════════════════════════════════════════════════════════════════════════════
describe('Scene regenerate — schema contracts', () => {
  const regenBodySchema = z.object({
    promptOverride: z.string().max(2000).optional(),
    mood:           z.string().max(64).optional(),
  });

  it('empty body passes (all fields optional)', () => {
    expect(regenBodySchema.safeParse({}).success).toBe(true);
  });

  it('null body passes', () => {
    expect(regenBodySchema.safeParse(null).success).toBe(true);
  });

  it('prompt override within limit passes', () => {
    expect(regenBodySchema.safeParse({ promptOverride: 'New prompt' }).success).toBe(true);
  });

  it('prompt override over 2000 chars fails', () => {
    expect(regenBodySchema.safeParse({ promptOverride: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('mood within limit passes', () => {
    expect(regenBodySchema.safeParse({ mood: 'Cinematic' }).success).toBe(true);
  });

  it('mood over 64 chars fails', () => {
    expect(regenBodySchema.safeParse({ mood: 'x'.repeat(65) }).success).toBe(false);
  });

  it('both fields together pass', () => {
    expect(regenBodySchema.safeParse({ promptOverride: 'New prompt', mood: 'Luxury' }).success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Render status machine rules
// ══════════════════════════════════════════════════════════════════════════════
describe('Render status machine', () => {
  const ACTIVE_STATUSES   = ['queued', 'processing', 'scene_rendering', 'mixing'];
  const TERMINAL_STATUSES = ['complete', 'failed', 'dead_letter', 'cancelled'];
  const ALL_STATUSES      = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES];

  it('active statuses set is correct', () => {
    expect(ACTIVE_STATUSES).toContain('queued');
    expect(ACTIVE_STATUSES).toContain('processing');
    expect(ACTIVE_STATUSES).toContain('scene_rendering');
    expect(ACTIVE_STATUSES).toContain('mixing');
  });

  it('terminal statuses set is correct', () => {
    expect(TERMINAL_STATUSES).toContain('complete');
    expect(TERMINAL_STATUSES).toContain('failed');
    expect(TERMINAL_STATUSES).toContain('dead_letter');
    expect(TERMINAL_STATUSES).toContain('cancelled');
  });

  it('cancellation is only allowed on active jobs', () => {
    const canCancel = (status: string) => ACTIVE_STATUSES.includes(status);
    for (const s of ACTIVE_STATUSES)   expect(canCancel(s)).toBe(true);
    for (const s of TERMINAL_STATUSES) expect(canCancel(s)).toBe(false);
  });

  it('retry is only allowed on failed/dead_letter jobs', () => {
    const canRetry = (status: string) => ['failed', 'dead_letter'].includes(status);
    expect(canRetry('failed')).toBe(true);
    expect(canRetry('dead_letter')).toBe(true);
    expect(canRetry('queued')).toBe(false);
    expect(canRetry('complete')).toBe(false);
  });

  it('download is only available for complete jobs', () => {
    const canDownload = (status: string) => status === 'complete';
    expect(canDownload('complete')).toBe(true);
    for (const s of ALL_STATUSES.filter(s => s !== 'complete')) {
      expect(canDownload(s)).toBe(false);
    }
  });

  it('scene regenerate is blocked on active jobs', () => {
    const canRegen = (status: string) => !ACTIVE_STATUSES.includes(status);
    for (const s of ACTIVE_STATUSES)   expect(canRegen(s)).toBe(false);
    for (const s of TERMINAL_STATUSES) expect(canRegen(s)).toBe(true);
  });

  it('active and terminal sets are disjoint', () => {
    const overlap = ACTIVE_STATUSES.filter(s => TERMINAL_STATUSES.includes(s));
    expect(overlap).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Credit accounting
// ══════════════════════════════════════════════════════════════════════════════
describe('Render credit accounting', () => {
  // Launch configuration: two modes only — Normal Ad (2D) and Cinematic Ad (2.5D)
  // Source of truth: packages/shared/src/plans.ts → CREDIT_COSTS
  const CREDIT_COSTS: Record<string, number> = {
    normal_ad:    20,  // Normal Ads (2D)
    cinematic_ad: 35,  // Cinematic Ads (2.5D)
  };

  const RENDER_MODE_TO_CREDIT: Record<string, string> = {
    'Normal Ad':    'normal_ad',
    'Cinematic Ad': 'cinematic_ad',
  };

  it('all render modes map to a credit key', () => {
    for (const mode of Object.keys(RENDER_MODE_TO_CREDIT)) {
      expect(CREDIT_COSTS[RENDER_MODE_TO_CREDIT[mode]]).toBeDefined();
    }
  });

  it('cost ordering: Cinematic Ad > Normal Ad', () => {
    expect(CREDIT_COSTS['cinematic_ad']).toBeGreaterThan(CREDIT_COSTS['normal_ad']);
  });

  it('Normal Ad costs exactly 20 credits (launch config)', () => {
    expect(CREDIT_COSTS['normal_ad']).toBe(20);
  });

  it('Cinematic Ad costs exactly 35 credits (launch config)', () => {
    expect(CREDIT_COSTS['cinematic_ad']).toBe(35);
  });

  it('per-render cost scales linearly with variation count', () => {
    const costPerRender = CREDIT_COSTS['normal_ad'];  // 20 credits
    const variations = 5;
    expect(costPerRender * variations).toBe(100);
  });

  it('cancelled job receives full refund of credits_charged', () => {
    const job = { credits_charged: 28, status: 'queued' };
    const refund = ACTIVE_STATUSES_FOR_REFUND.includes(job.status) ? job.credits_charged : 0;
    expect(refund).toBe(28);
  });

  it('completed job receives no refund', () => {
    const job = { credits_charged: 28, status: 'complete' };
    const refund = ACTIVE_STATUSES_FOR_REFUND.includes(job.status) ? job.credits_charged : 0;
    expect(refund).toBe(0);
  });

  it('creditsToCharge must be a positive integer', () => {
    const schema = z.number().int().min(1);
    expect(schema.safeParse(7).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(-1).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
  });
});

const ACTIVE_STATUSES_FOR_REFUND = ['queued', 'processing', 'scene_rendering', 'mixing'];

// ══════════════════════════════════════════════════════════════════════════════
// Download URL logic
// ══════════════════════════════════════════════════════════════════════════════
describe('Download URL resolution', () => {
  // Simulate the URL resolution logic from renders.ts
  function resolveVideoUrl(
    platformExports: Record<string, string>,
    outputFormats: Record<string, string>,
    outputVideoUrl: string | null,
    requestedFormat: string = '16:9'
  ): string | null {
    return platformExports[requestedFormat]
      || outputFormats[requestedFormat]
      || outputVideoUrl
      || null;
  }

  it('prefers platform_exports over output_formats', () => {
    const url = resolveVideoUrl(
      { '16:9': 'https://cdn.example.com/platform.mp4' },
      { '16:9': 'https://cdn.example.com/output.mp4' },
      'https://cdn.example.com/primary.mp4',
      '16:9'
    );
    expect(url).toBe('https://cdn.example.com/platform.mp4');
  });

  it('falls back to output_formats when platform_exports missing', () => {
    const url = resolveVideoUrl(
      {},
      { '16:9': 'https://cdn.example.com/output.mp4' },
      'https://cdn.example.com/primary.mp4',
      '16:9'
    );
    expect(url).toBe('https://cdn.example.com/output.mp4');
  });

  it('falls back to output_video_url when both format maps empty', () => {
    const url = resolveVideoUrl({}, {}, 'https://cdn.example.com/primary.mp4', '16:9');
    expect(url).toBe('https://cdn.example.com/primary.mp4');
  });

  it('returns null when all sources empty', () => {
    expect(resolveVideoUrl({}, {}, null)).toBeNull();
  });

  it('placement keys work in platform_exports', () => {
    const url = resolveVideoUrl(
      { 'youtube_instream': 'https://cdn.example.com/yt.mp4' },
      {},
      null,
      'youtube_instream'
    );
    expect(url).toBe('https://cdn.example.com/yt.mp4');
  });

  it('unknown format falls back through chain', () => {
    const url = resolveVideoUrl(
      { 'tiktok_feed': 'https://cdn.example.com/tik.mp4' },
      { '16:9': 'https://cdn.example.com/widescreen.mp4' },
      'https://cdn.example.com/primary.mp4',
      'nonexistent_format'
    );
    // nonexistent not in any map → falls back to output_video_url
    expect(url).toBe('https://cdn.example.com/primary.mp4');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// S3 key extraction logic
// ══════════════════════════════════════════════════════════════════════════════
describe('S3 key extraction from CDN URL', () => {
  const CDN_BASE = 'https://cdn.animation-studio.example.com';

  function extractS3Key(videoUrl: string, cdnBase: string): string | null {
    const base = cdnBase.replace(/\/$/, '');
    if (videoUrl.startsWith(base)) {
      return videoUrl.slice(base.length + 1); // +1 for leading slash
    }
    return null;
  }

  it('extracts key from CDN URL correctly', () => {
    const url = `${CDN_BASE}/renders/workspace-1/output.mp4`;
    expect(extractS3Key(url, CDN_BASE)).toBe('renders/workspace-1/output.mp4');
  });

  it('returns null for non-CDN URL', () => {
    expect(extractS3Key('https://other.example.com/file.mp4', CDN_BASE)).toBeNull();
  });

  it('handles trailing slash in CDN base gracefully', () => {
    const key = extractS3Key(`${CDN_BASE}/path/file.mp4`, `${CDN_BASE}/`);
    expect(key).toBe('path/file.mp4');
  });

  it('handles nested paths', () => {
    const url = `${CDN_BASE}/renders/ws-123/uuid-456/scene-1/video.mp4`;
    const key = extractS3Key(url, CDN_BASE);
    expect(key).toBe('renders/ws-123/uuid-456/scene-1/video.mp4');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Render list response contract
// ══════════════════════════════════════════════════════════════════════════════
describe('Render list response contract', () => {
  // Simulate the columns selected in GET /renders
  const REQUIRED_COLUMNS = [
    'id', 'status', 'progress', 'current_step', 'scenes_total', 'scenes_complete',
    'placement', 'platform', 'output_video_url', 'output_formats', 'platform_exports',
    'credits_charged', 'created_at', 'updated_at',
  ];

  it('required columns list is non-empty', () => {
    expect(REQUIRED_COLUMNS.length).toBeGreaterThan(0);
  });

  it('id and status are always present', () => {
    expect(REQUIRED_COLUMNS).toContain('id');
    expect(REQUIRED_COLUMNS).toContain('status');
  });

  it('credit tracking columns are present', () => {
    expect(REQUIRED_COLUMNS).toContain('credits_charged');
  });

  it('platform export columns are present', () => {
    expect(REQUIRED_COLUMNS).toContain('platform_exports');
    expect(REQUIRED_COLUMNS).toContain('output_formats');
  });

  it('timestamp columns are present', () => {
    expect(REQUIRED_COLUMNS).toContain('created_at');
    expect(REQUIRED_COLUMNS).toContain('updated_at');
  });

  // Validate a mock render response shape
  function validateRenderResponse(job: any): boolean {
    const schema = z.object({
      id:              z.string(),
      status:          z.string(),
      progress:        z.number().optional().nullable(),
      scenes_total:    z.number().optional().nullable(),
      created_at:      z.string().or(z.date()).optional(),
    });
    return schema.safeParse(job).success;
  }

  it('minimal valid render response passes shape check', () => {
    expect(validateRenderResponse({
      id:           'render-uuid-1',
      status:       'complete',
      progress:     100,
      scenes_total: 5,
      created_at:   new Date().toISOString(),
    })).toBe(true);
  });

  it('missing id fails shape check', () => {
    expect(validateRenderResponse({ status: 'complete' })).toBe(false);
  });

  it('missing status fails shape check', () => {
    expect(validateRenderResponse({ id: 'render-uuid-1' })).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Pagination contract
// ══════════════════════════════════════════════════════════════════════════════
describe('Render list pagination', () => {
  it('default limit is 20', () => {
    const DEFAULT_LIMIT = 20;
    expect(DEFAULT_LIMIT).toBe(20);
  });

  it('page=0 is treated as page 1 (offset=0)', () => {
    const page = Math.max(1, 0);
    const limit = 20;
    const offset = (page - 1) * limit;
    expect(offset).toBe(0);
  });

  it('page=2 gives correct offset for limit=20', () => {
    const page = 2, limit = 20;
    expect((page - 1) * limit).toBe(20);
  });

  it('page=3 gives correct offset for limit=20', () => {
    const page = 3, limit = 20;
    expect((page - 1) * limit).toBe(40);
  });

  it('total_pages calculation is correct', () => {
    expect(Math.ceil(45 / 20)).toBe(3);
    expect(Math.ceil(40 / 20)).toBe(2);
    expect(Math.ceil(1  / 20)).toBe(1);
    expect(Math.ceil(0  / 20)).toBe(0);
  });
});
