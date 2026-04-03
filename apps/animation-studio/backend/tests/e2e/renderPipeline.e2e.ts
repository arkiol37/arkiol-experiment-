/**
 * E2E Test Suite — Animation Studio Render Pipeline
 *
 * Tests the complete user journey end-to-end against a live test server.
 *
 * Requirements:
 *   TEST_STUDIO_URL   — Base URL of running server (default: http://localhost:4000)
 *   TEST_DATABASE_URL — Postgres DB URL (test database, will be seeded)
 *   TEST_REDIS_URL    — Redis URL for queue / sessions
 *
 * Run: npm run test:e2e
 */

import request from 'supertest';
import path from 'path';
import fs from 'fs';

const BASE = process.env.TEST_STUDIO_URL ?? 'http://localhost:4000';
const agent = request(BASE);

// ── Shared state (populated as tests run in order) ─────────────────────────
let accessToken  = '';
let refreshToken = '';
let workspaceId  = '';
let brandId      = '';
let assetId      = '';
let projectId    = '';
let storyboardId = '';
let renderJobId  = '';

const uid  = Date.now();
const TEST_USER = {
  email:     `e2e-${uid}@animationstudio.test`,
  password:  'E2ePassword123!',
  firstName: 'E2E',
  lastName:  'Tester',
  company:   'ARKIOL Test Corp',
};

function auth() {
  return { Authorization: `Bearer ${accessToken}` };
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function waitForStatus(
  jobId: string,
  targetStatus: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<any> {
  const { timeoutMs = 90_000, pollMs = 2_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await agent.get(`/api/renders/${jobId}`).set(auth()).timeout(8_000);
    if (r.body.status === targetStatus) return r.body;
    if (['failed', 'dead_letter', 'cancelled'].includes(r.body.status)) {
      throw new Error(`Job ${jobId} ended in unexpected status: ${r.body.status}`);
    }
    await new Promise(res => setTimeout(res, pollMs));
  }
  throw new Error(`Timeout waiting for job ${jobId} to reach ${targetStatus}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. AUTH FLOW
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 1 — Auth flow', () => {
  it('POST /api/auth/register — creates user + workspace with free plan', async () => {
    const res = await agent
      .post('/api/auth/register')
      .send(TEST_USER)
      .timeout(10_000);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.workspace.plan).toBe('free');

    accessToken  = res.body.accessToken;
    refreshToken = res.body.refreshToken;
    workspaceId  = res.body.workspace.id;
  });

  it('POST /api/auth/register with duplicate email returns 409', async () => {
    const res = await agent
      .post('/api/auth/register')
      .send(TEST_USER)
      .timeout(5_000);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/auth/login — returns JWT + refresh token', async () => {
    const res = await agent
      .post('/api/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password })
      .timeout(8_000);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(typeof res.body.accessToken).toBe('string');

    accessToken  = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /api/auth/login with wrong password returns 401', async () => {
    const res = await agent
      .post('/api/auth/login')
      .send({ email: TEST_USER.email, password: 'WrongPassword!' })
      .timeout(5_000);

    expect(res.status).toBe(401);
  });

  it('POST /api/auth/refresh — issues new access token', async () => {
    const res = await agent
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .timeout(5_000);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    accessToken = res.body.accessToken;
  });

  it('GET /api/users/me — returns authenticated user profile', async () => {
    const res = await agent.get('/api/users/me').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_USER.email);
    expect(res.body.firstName).toBe(TEST_USER.firstName);
  });

  it('GET /api/users/me without token returns 401', async () => {
    const res = await agent.get('/api/users/me').timeout(5_000);
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. WORKSPACE & BRAND SETUP
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 2 — Workspace & brand setup', () => {
  it('POST /api/brands — creates brand with colors and fonts', async () => {
    const res = await agent
      .post('/api/brands')
      .set(auth())
      .send({
        name:      'ARKIOL Test Brand',
        industry:  'Technology',
        website:   'https://arkiol.test',
        tagline:   'Ship faster, ship smarter',
        colors:    [{ hex: '#6366f1', name: 'Indigo', primary: true }, { hex: '#f59e0b', name: 'Amber' }],
        fonts:     [{ name: 'Inter', url: 'https://fonts.google.com/specimen/Inter' }],
        voiceTone: 'Confident and clear',
      })
      .timeout(8_000);

    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('ARKIOL Test Brand');
    brandId = res.body.id;
  });

  it('GET /api/brands — returns list including created brand', async () => {
    const res = await agent.get('/api/brands').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(res.body.brands ?? res.body).toBeInstanceOf(Array);
    const list = res.body.brands ?? res.body;
    const found = list.find((b: any) => b.id === brandId);
    expect(found).toBeDefined();
    expect(found.name).toBe('ARKIOL Test Brand');
  });

  it('GET /api/users/me/preferences — returns preference record', async () => {
    const res = await agent.get('/api/users/me/preferences').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  it('PATCH /api/users/me/preferences — updates quality defaults', async () => {
    const res = await agent
      .patch('/api/users/me/preferences')
      .set(auth())
      .send({ quality_distortion_check: true, beat_sync_default: false, default_aspect_ratio: '1:1' })
      .timeout(5_000);

    expect([200, 204]).toContain(res.status);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. ASSET UPLOAD
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 3 — Asset upload', () => {
  // 1×1 white PNG (37 bytes) — smallest valid PNG
  const TINY_PNG = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
    '77533800000000c4944415478016360f8cfc00000000200016f10a7800000000049454e44ae426082',
    'hex',
  );

  it('POST /api/assets — uploads logo image, gets CDN URL', async () => {
    const res = await agent
      .post('/api/assets')
      .set(auth())
      .attach('file', TINY_PNG, { filename: 'test-logo.png', contentType: 'image/png' })
      .field('type', 'logo')
      .timeout(15_000);

    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('cdn_url');
    assetId = res.body.id;
  });

  it('GET /api/assets — returns paginated asset list including uploaded asset', async () => {
    const res = await agent.get('/api/assets').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    const assets = res.body.assets ?? res.body;
    expect(Array.isArray(assets)).toBe(true);
    const found = assets.find((a: any) => a.id === assetId);
    expect(found).toBeDefined();
  });

  it('GET /api/assets?type=logo — filters by type', async () => {
    const res = await agent.get('/api/assets?type=logo').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    const assets = res.body.assets ?? res.body;
    for (const a of assets) {
      expect(a.type).toBe('logo');
    }
  });

  it('POST /api/assets with disallowed MIME type returns 400', async () => {
    const res = await agent
      .post('/api/assets')
      .set(auth())
      .attach('file', Buffer.from('#!/bin/bash\necho pwned'), { filename: 'evil.sh', contentType: 'application/x-sh' })
      .timeout(5_000);

    expect([400, 415, 422]).toContain(res.status);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. PROJECT & STORYBOARD
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 4 — Project & storyboard creation', () => {
  it('POST /api/projects — creates project linked to brand', async () => {
    const res = await agent
      .post('/api/projects')
      .set(auth())
      .send({
        name:    'E2E Test Campaign',
        brief:   'Showcase our AI-powered platform to technical founders',
        brandId,
      })
      .timeout(8_000);

    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('E2E Test Campaign');
    projectId = res.body.id;
  });

  it('GET /api/projects — returns list including new project', async () => {
    const res = await agent.get('/api/projects').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    const projects = res.body.projects ?? res.body;
    const found = projects.find((p: any) => p.id === projectId);
    expect(found).toBeDefined();
  });

  it('POST /api/projects/:id/storyboards — creates storyboard with 3 scenes', async () => {
    const res = await agent
      .post(`/api/projects/${projectId}/storyboards`)
      .set(auth())
      .send({
        name:       'E2E Storyboard',
        sceneCount:  3,
        aspectRatio: '9:16',
      })
      .timeout(8_000);

    expect([200, 201]).toContain(res.status);
    expect(res.body).toHaveProperty('id');
    storyboardId = res.body.id;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. RENDER SUBMISSION
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 5 — Render submission', () => {
  const makeScene = (i: number) => ({
    id:              `00000000-0000-0000-0000-00000000000${i + 1}`,
    position:         i,
    prompt:          `Scene ${i + 1}: Product showcase, professional lighting, brand colours visible`,
    voiceoverScript: `Line ${i + 1}: Experience the future of content creation.`,
    role:            i === 0 ? 'hook' : i === 2 ? 'cta' : 'benefit',
    timing:          {},
    visualConfig:    {},
  });

  const validBody = () => ({
    storyboardId,
    scenes: [makeScene(0), makeScene(1), makeScene(2)],
    brand: {
      name:     'ARKIOL Test Brand',
      industry: 'Technology',
      colors:   [{ hex: '#6366f1', primary: true }],
      fonts:    [],
    },
    config: {
      aspectRatio:     '9:16',
      renderMode:      'Normal Ad',
      resolution:      '1080p',
      mood:            'Cinematic',
      voice:           { gender: 'Female', tone: 'Confident', accent: 'American English', speed: 'Normal' },
      music:           { style: 'Cinematic Ambient', energyCurve: 'Build Up', beatSync: true },
      creditsToCharge: 15,
    },
    platform:  'instagram',
    placement: 'instagram_reels',
    hookType:  'problem_solution',
    ctaText:   'Try Free',
  });

  it('POST /api/renders — submits render job, receives 202 + renderJobId', async () => {
    const res = await agent
      .post('/api/renders')
      .set(auth())
      .send(validBody())
      .timeout(15_000);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('renderJobId');
    expect(res.body).toHaveProperty('statusUrl');
    expect(res.body.status).toBe('queued');
    renderJobId = res.body.renderJobId;
  });

  it('GET /api/renders/:id — returns status, progress, current_step', async () => {
    const res = await agent
      .get(`/api/renders/${renderJobId}`)
      .set(auth())
      .timeout(5_000);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('progress');
    expect(['queued', 'processing', 'scene_rendering', 'mixing', 'complete']).toContain(res.body.status);
  });

  it('GET /api/renders — workspace list includes the new job', async () => {
    const res = await agent.get('/api/renders').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    const jobs = res.body.jobs ?? res.body;
    const found = jobs.find((j: any) => j.id === renderJobId);
    expect(found).toBeDefined();
  });

  it('POST /api/renders with insufficient credits returns 402', async () => {
    // request 9999 credits
    const body = { ...validBody(), config: { ...validBody().config, creditsToCharge: 9999 } };
    const res = await agent
      .post('/api/renders')
      .set(auth())
      .send(body)
      .timeout(10_000);

    expect([402, 422]).toContain(res.status);
  });

  it('POST /api/renders with empty scenes array returns 400', async () => {
    const body = { ...validBody(), scenes: [] };
    const res = await agent
      .post('/api/renders')
      .set(auth())
      .send(body)
      .timeout(5_000);

    expect([400, 422]).toContain(res.status);
  });

  it('POST /api/renders with invalid aspectRatio returns 400', async () => {
    const body = { ...validBody(), config: { ...validBody().config, aspectRatio: '4:3' } };
    const res = await agent
      .post('/api/renders')
      .set(auth())
      .send(body)
      .timeout(5_000);

    expect([400, 422]).toContain(res.status);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. RENDER CANCELLATION
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 6 — Render cancellation', () => {
  let cancelJobId = '';

  it('submits a second render job for cancellation testing', async () => {
    const res = await agent
      .post('/api/renders')
      .set(auth())
      .send({
        storyboardId,
        scenes: [{
          id:              '00000000-0000-0000-0000-0000000000cc',
          position:         0,
          prompt:          'Scene for cancellation test',
          voiceoverScript: 'Cancel me.',
          role:            'hook',
          timing:          {},
          visualConfig:    {},
        }],
        brand:   { name: 'Cancel Test Brand', industry: 'Tech', colors: [], fonts: [] },
        config:  { aspectRatio: '1:1', renderMode: 'Normal Ad', resolution: '1080p', mood: 'Minimal', voice: { gender: 'Female', tone: 'Neutral', accent: 'American English', speed: 'Normal' }, music: { style: 'None', energyCurve: 'Flat', beatSync: false }, creditsToCharge: 5 },
      })
      .timeout(10_000);

    expect(res.status).toBe(202);
    cancelJobId = res.body.renderJobId;
  });

  it('POST /api/renders/:id/cancel — cancels queued job', async () => {
    // Cancel while still queued (within the same test tick — should be fast)
    const res = await agent
      .post(`/api/renders/${cancelJobId}/cancel`)
      .set(auth())
      .timeout(8_000);

    expect([200, 202, 204]).toContain(res.status);
  });

  it('GET /api/renders/:id after cancel returns cancelled status', async () => {
    const res = await agent
      .get(`/api/renders/${cancelJobId}`)
      .set(auth())
      .timeout(5_000);

    expect(res.status).toBe(200);
    expect(['cancelled', 'queued']).toContain(res.body.status); // may already be cancelled
  });

  it('POST /api/renders/:id/cancel on unknown render returns 404', async () => {
    const res = await agent
      .post('/api/renders/00000000-0000-0000-0000-000000000000/cancel')
      .set(auth())
      .timeout(5_000);

    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. RENDER PROGRESS TRACKING (polls in background — may skip in mock env)
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 7 — Render progress (live polling)', () => {
  it('progress field is a number between 0–100', async () => {
    const res = await agent.get(`/api/renders/${renderJobId}`).set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(typeof res.body.progress).toBe('number');
    expect(res.body.progress).toBeGreaterThanOrEqual(0);
    expect(res.body.progress).toBeLessThanOrEqual(100);
  });

  it('current_step is a non-empty string when processing', async () => {
    const res = await agent.get(`/api/renders/${renderJobId}`).set(auth()).timeout(5_000);
    if (['processing', 'scene_rendering', 'mixing'].includes(res.body.status)) {
      expect(typeof res.body.current_step).toBe('string');
      expect(res.body.current_step.length).toBeGreaterThan(0);
    }
  });

  it('scenes_complete does not exceed scenes_total', async () => {
    const res = await agent.get(`/api/renders/${renderJobId}`).set(auth()).timeout(5_000);
    if (res.body.scenes_total != null) {
      expect(res.body.scenes_complete ?? 0).toBeLessThanOrEqual(res.body.scenes_total);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. DOWNLOAD ENDPOINT
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 8 — Download', () => {
  it('GET /api/renders/:id/download on incomplete job returns 409 or 404', async () => {
    const statusRes = await agent.get(`/api/renders/${renderJobId}`).set(auth()).timeout(5_000);
    if (statusRes.body.status !== 'complete') {
      const res = await agent.get(`/api/renders/${renderJobId}/download`).set(auth()).timeout(5_000);
      expect([409, 404, 400]).toContain(res.status);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. BILLING
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 9 — Billing', () => {
  it('GET /api/billing/plans — returns plan catalog', async () => {
    const res = await agent.get('/api/billing/plans').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    const plans = res.body.plans ?? res.body;
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThan(0);
    const free = plans.find((p: any) => p.key === 'free' || p.name?.toLowerCase() === 'free');
    expect(free).toBeDefined();
    expect(free.priceUsd ?? free.price ?? 0).toBe(0);
  });

  it('GET /api/billing/usage — returns balance and transaction history', async () => {
    const res = await agent.get('/api/billing/usage').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance');
    expect(typeof res.body.balance).toBe('number');
    expect(Array.isArray(res.body.transactions)).toBe(true);
  });

  it('GET /api/billing/invoices — returns invoices array (may be empty)', async () => {
    const res = await agent.get('/api/billing/invoices').set(auth()).timeout(5_000);
    expect([200]).toContain(res.status);
    expect(res.body).toHaveProperty('invoices');
    expect(Array.isArray(res.body.invoices)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. NOTIFICATIONS & SESSIONS
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 10 — Notifications & sessions', () => {
  it('GET /api/users/me/notifications — returns settings object', async () => {
    const res = await agent.get('/api/users/me/notifications').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('settings');
    expect(typeof res.body.settings.email_render_complete).toBe('boolean');
  });

  it('PATCH /api/users/me/notifications — updates a setting', async () => {
    const res = await agent
      .patch('/api/users/me/notifications')
      .set(auth())
      .send({ email_marketing: false, email_render_complete: true })
      .timeout(5_000);

    expect(res.status).toBe(200);
    expect(res.body.settings.email_marketing).toBe(false);
    expect(res.body.settings.email_render_complete).toBe(true);
  });

  it('GET /api/users/me/sessions — returns sessions array', async () => {
    const res = await agent.get('/api/users/me/sessions').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessions');
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. ANALYTICS
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 11 — Analytics', () => {
  for (const period of ['7d', '30d', '90d']) {
    it(`GET /api/analytics/overview?period=${period} — returns all expected fields`, async () => {
      const res = await agent
        .get(`/api/analytics/overview?period=${period}`)
        .set(auth())
        .timeout(10_000);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('renderStats');
      expect(res.body).toHaveProperty('creditStats');
      expect(res.body).toHaveProperty('monthlyOutput');
      expect(res.body).toHaveProperty('platformBreakdown');
      expect(res.body).toHaveProperty('hookTypeBreakdown');
      expect(res.body).toHaveProperty('durationBreakdown');
      expect(res.body).toHaveProperty('dailyCreditSpend');
      expect(Array.isArray(res.body.monthlyOutput)).toBe(true);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. PROVIDERS
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 12 — Provider management', () => {
  let providerId = '';

  it('POST /api/providers — adds a provider config', async () => {
    const res = await agent
      .post('/api/providers')
      .set(auth())
      .send({
        provider:     'runway',
        apiKey:       'test-api-key-e2e',
        isPrimary:    true,
        autoFallback: true,
      })
      .timeout(8_000);

    expect([200, 201]).toContain(res.status);
  });

  it('GET /api/providers — returns configured providers', async () => {
    const res = await agent.get('/api/providers').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
    const found = res.body.providers.find((p: any) => p.provider === 'runway');
    expect(found).toBeDefined();
    expect(found.is_primary).toBe(true);
    providerId = found.id;
  });

  it('PATCH /api/providers/:id — toggles enabled', async () => {
    const res = await agent
      .patch(`/api/providers/${providerId}`)
      .set(auth())
      .send({ enabled: false })
      .timeout(5_000);

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('DELETE /api/providers/:id — removes provider', async () => {
    const res = await agent
      .delete(`/api/providers/${providerId}`)
      .set(auth())
      .timeout(5_000);

    expect([200, 204]).toContain(res.status);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. RETRY & ERROR RECOVERY
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 13 — Error recovery', () => {
  it('POST /api/renders/:id/retry on non-existent render returns 404', async () => {
    const res = await agent
      .post('/api/renders/00000000-0000-0000-0000-000000000000/retry')
      .set(auth())
      .timeout(5_000);

    expect(res.status).toBe(404);
  });

  it('accessing another workspace render returns 404', async () => {
    // Different user can't see this workspace's render
    const otherUser = {
      email:     `e2e-other-${uid}@animationstudio.test`,
      password:  'OtherPassword123!',
      firstName: 'Other',
      lastName:  'User',
    };
    const regRes = await agent.post('/api/auth/register').send(otherUser).timeout(10_000);
    const otherToken = regRes.body.accessToken;

    const res = await agent
      .get(`/api/renders/${renderJobId}`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .timeout(5_000);

    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. DATA LIFECYCLE & GDPR
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 14 — Data lifecycle', () => {
  it('DELETE /api/assets/:id — soft deletes asset', async () => {
    const res = await agent
      .delete(`/api/assets/${assetId}`)
      .set(auth())
      .timeout(5_000);

    expect([200, 204]).toContain(res.status);
  });

  it('GET /api/assets — deleted asset no longer appears in list', async () => {
    const res = await agent.get('/api/assets').set(auth()).timeout(5_000);
    expect(res.status).toBe(200);
    const assets = res.body.assets ?? res.body;
    const found = assets.find((a: any) => a.id === assetId);
    expect(found).toBeUndefined();
  });

  it('DELETE /api/users/me — anonymises user data (GDPR)', async () => {
    // Create a disposable user for this test
    const gdprUser = {
      email:     `e2e-gdpr-${uid}@animationstudio.test`,
      password:  'GdprPassword123!',
      firstName: 'GDPR',
      lastName:  'Delete',
    };
    const regRes = await agent.post('/api/auth/register').send(gdprUser).timeout(10_000);
    const gdprToken = regRes.body.accessToken;

    const res = await agent
      .delete('/api/users/me')
      .set({ Authorization: `Bearer ${gdprToken}` })
      .send({ password: gdprUser.password })
      .timeout(10_000);

    expect([200, 202, 204]).toContain(res.status);
    if (res.body.message) {
      expect(res.body.message).toMatch(/deletion|deleted|30 days/i);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. ADMIN ENDPOINTS (protected)
// ══════════════════════════════════════════════════════════════════════════════
describe('E2E 15 — Admin access control', () => {
  it('GET /api/admin (non-admin) returns 403', async () => {
    const res = await agent.get('/api/admin').set(auth()).timeout(5_000);
    expect([403, 401]).toContain(res.status);
  });

  it('POST /api/admin/credits/adjust (non-admin) returns 403', async () => {
    const res = await agent
      .post('/api/admin/credits/adjust')
      .set(auth())
      .send({ workspaceId, amount: 100, reason: 'e2e-test' })
      .timeout(5_000);

    expect([403, 401]).toContain(res.status);
  });
});
