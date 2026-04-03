/**
 * apps/animation-studio/backend/tests/smoke/health.smoke.test.ts
 *
 * HTTP-level smoke tests for the Animation Studio backend.
 * Requires the Express server to be running on TEST_STUDIO_URL (default: http://localhost:4000).
 *
 * These tests are run by the CI smoke-tests job after the build step.
 * They can also be run locally with `npm run test:e2e` when the server is up.
 */

import request from 'supertest';

const BASE_URL = process.env.TEST_STUDIO_URL ?? 'http://localhost:4000';

// supertest can test a live URL by passing the full base URL string
const agent = request(BASE_URL);

describe('Animation Studio — Health endpoints', () => {
  it('GET /api/health responds 200 with status field', async () => {
    const res = await agent.get('/api/health').timeout(5000);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('service');
  });

  it('GET /api/health/live responds 200', async () => {
    const res = await agent.get('/api/health/live').timeout(5000);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'alive');
  });

  it('GET /api/health/ready responds with checks object', async () => {
    const res = await agent.get('/api/health/ready').timeout(8000);
    // In CI with a real DB and Redis this should be 200
    // Without real S3/Stripe it may be 503 — both are acceptable
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('checks');
    const { checks } = res.body;
    // DB and Redis must always be ok in CI
    if (checks.database) {
      expect(checks.database.status).toBe('ok');
    }
    if (checks.redis) {
      expect(checks.redis.status).toBe('ok');
    }
  });
});

describe('Animation Studio — Auth routes (unauthenticated)', () => {
  it('POST /api/auth/register with empty body returns 400 or 422', async () => {
    const res = await agent.post('/api/auth/register').send({}).timeout(5000);
    expect([400, 422]).toContain(res.status);
  });

  it('POST /api/auth/login with empty body returns 400 or 401', async () => {
    const res = await agent.post('/api/auth/login').send({}).timeout(5000);
    expect([400, 401, 422]).toContain(res.status);
  });
});

describe('Animation Studio — Protected routes return 401', () => {
  const protectedRoutes = [
    ['GET',  '/api/renders'],
    ['GET',  '/api/assets'],
    ['GET',  '/api/projects'],
    ['GET',  '/api/brands'],
    ['GET',  '/api/users/me'],
    ['GET',  '/api/billing'],
    ['GET',  '/api/analytics'],
  ] as const;

  for (const [method, route] of protectedRoutes) {
    it(`${method} ${route} returns 401 without Authorization header`, async () => {
      const res = method === 'GET'
        ? await agent.get(route).timeout(5000)
        : await agent.post(route).send({}).timeout(5000);
      expect(res.status).toBe(401);
    });
  }
});

describe('Animation Studio — Request validation (POST routes)', () => {
  it('POST /api/renders with invalid body returns 400 or 401 (not 500)', async () => {
    const res = await agent
      .post('/api/renders')
      .set('Content-Type', 'application/json')
      .send({ invalid: true })
      .timeout(5000);
    // 401 = auth guard fires first, 400 = schema validation fires
    expect([400, 401, 422]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});
