// src/__tests__/api-generate.test.ts
// Integration-style tests for /api/generate
// Uses mocked Prisma and auth — no real DB needed

jest.mock("../lib/prisma", () => ({
  prisma: {
    job:  { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    org:  { update: jest.fn() },
    asset:{ findMany: jest.fn() },
    brand:{ findFirst: jest.fn() },
    campaign: { findFirst: jest.fn() },
    usage:{ create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("../lib/queue", () => ({
  generationQueue: {
    add: jest.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
}));

jest.mock("../lib/rate-limit", () => ({
  rateLimit:        jest.fn().mockResolvedValue({ success: true, remaining: 19, reset: Date.now() + 60000, limit: 20 }),
  rateLimitHeaders: jest.fn().mockReturnValue({}),
}));

import { prisma }  from "../lib/prisma";
import { NextRequest } from "next/server";

const mockPrisma = prisma as any;

function makeRequest(body: object, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/generate", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Mock session helper
async function setupAuthSession(role = "DESIGNER") {
  const { getServerSession } = await import("next-auth");
  (getServerSession as jest.Mock).mockResolvedValue({
    user: { id: "user-1", email: "test@arkiol.ai", name: "Test", role, orgId: "org-1" },
  });

  mockPrisma.user.findUnique.mockResolvedValue({
    id: "user-1", email: "test@arkiol.ai", role,
    org: { id: "org-1", plan: "PRO", creditLimit: 1000, creditsUsed: 100 },
  });
}

describe("POST /api/generate — validation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects request with prompt too short", async () => {
    await setupAuthSession();
    const { POST } = await import("../app/api/generate/route");
    const res = await POST(makeRequest({ prompt: "short", formats: ["instagram_post"] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid request");
  });

  it("rejects empty formats array", async () => {
    await setupAuthSession();
    const { POST } = await import("../app/api/generate/route");
    const res = await POST(makeRequest({ prompt: "A valid prompt that is long enough", formats: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects variations > 5", async () => {
    await setupAuthSession();
    const { POST } = await import("../app/api/generate/route");
    const res = await POST(makeRequest({
      prompt: "A valid prompt that is long enough to pass validation",
      formats: ["instagram_post"],
      variations: 10,
    }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/generate — auth", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as jest.Mock).mockResolvedValue(null);

    const { POST } = await import("../app/api/generate/route");
    const res = await POST(makeRequest({
      prompt: "A valid prompt that is long enough",
      formats: ["instagram_post"],
    }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for VIEWER role (no GENERATE_ASSETS permission)", async () => {
    await setupAuthSession("VIEWER");
    const { POST } = await import("../app/api/generate/route");
    const res = await POST(makeRequest({
      prompt: "A valid prompt that is long enough",
      formats: ["instagram_post"],
    }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/generate — credit checking", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 402 when insufficient credits", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { id: "user-1", email: "test@arkiol.ai", name: "Test", role: "DESIGNER", orgId: "org-1" },
    });

    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1", role: "DESIGNER",
      org: { id: "org-1", plan: "FREE", creditLimit: 0, creditsUsed: 0 }, // 0 remaining
    });

    const { POST } = await import("../app/api/generate/route");
    const res = await POST(makeRequest({
      prompt: "A valid prompt that is long enough",
      formats: ["instagram_post", "youtube_thumbnail"],
    }));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.error).toContain("credits");
  });
});

describe("POST /api/generate — success path", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 202 with jobId when valid", async () => {
    await setupAuthSession("DESIGNER");

    mockPrisma.job.create.mockResolvedValue({ id: "job-abc123" });

    const { POST } = await import("../app/api/generate/route");
    const res = await POST(makeRequest({
      prompt:     "Eco water bottle for health-conscious millennials",
      formats:    ["instagram_post"],
      stylePreset:"modern_minimal",
      variations: 1,
    }));

    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.jobId).toBeDefined();
    expect(data.status).toBe("queued");
    expect(data.creditCost).toBe(1);
  });
});
