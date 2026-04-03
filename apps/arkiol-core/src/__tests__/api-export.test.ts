// src/__tests__/api-export.test.ts
// Tests for /api/export route

jest.mock("../lib/prisma", () => ({
  prisma: {
    asset: { findMany: jest.fn() },
    user:  { findUnique: jest.fn() },
  },
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("../lib/rate-limit", () => ({
  rateLimit: jest.fn().mockResolvedValue({ success: true, remaining: 49, reset: Date.now() + 60000, limit: 50 }),
}));

jest.mock("sharp", () => {
  const chain: any = {};
  chain.resize = () => chain;
  chain.png    = () => chain;
  chain.toBuffer = () => Promise.resolve(Buffer.from("fake-png-data"));
  return jest.fn(() => chain);
});

import { prisma } from "../lib/prisma";
const mockPrisma = prisma as any;

const MOCK_SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#1a1a2e"/><text x="540" y="540" fill="white">Test</text></svg>`;

const mockAsset = {
  id:          "asset-001",
  userId:      "user-1",
  name:        "instagram-post-v1",
  format:      "instagram_post",
  category:    "social",
  mimeType:    "image/png",
  s3Key:       "orgs/org-1/2026-02/assets/asset-001.png",
  s3Bucket:    "arkiol-test",
  width:       1080,
  height:      1080,
  fileSize:    245000,
  tags:        ["summer", "product"],
  layoutFamily:"ig_hero_split",
  svgSource:   MOCK_SVG,
  brandScore:  92.5,
  hierarchyValid: true,
  metadata:    { brief: { headline: "Summer Launch", tone: "bold" } },
  createdAt:   new Date(),
};

async function setupAuth(role = "DESIGNER") {
  const { getServerSession } = await import("next-auth");
  (getServerSession as jest.Mock).mockResolvedValue({
    user: { id: "user-1", email: "test@arkiol.ai", role, orgId: "org-1" },
  });
}

function makeExportRequest(body: object) {
  const { NextRequest } = require("next/server");
  return new NextRequest("http://localhost/api/export", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

describe("POST /api/export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as jest.Mock).mockResolvedValue(null);

    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: ["asset-001"], format: "json" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for empty assetIds", async () => {
    await setupAuth();
    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: [], format: "json" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid format", async () => {
    await setupAuth();
    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: ["asset-001"], format: "docx" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when asset not found for user", async () => {
    await setupAuth();
    mockPrisma.asset.findMany.mockResolvedValue([]); // Empty — not found

    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: ["asset-nonexistent"], format: "json" }));
    expect(res.status).toBe(404);
  });

  it("returns JSON metadata for json format", async () => {
    await setupAuth();
    mockPrisma.asset.findMany.mockResolvedValue([mockAsset]);

    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: ["asset-001"], format: "json" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.assets[0].id).toBe("asset-001");
  });

  it("returns SVG for svg format", async () => {
    await setupAuth();
    mockPrisma.asset.findMany.mockResolvedValue([mockAsset]);

    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: ["asset-001"], format: "svg" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const text = await res.text();
    expect(text).toContain("<svg");
  });

  it("returns 400 for SVG with multiple assets", async () => {
    await setupAuth();
    mockPrisma.asset.findMany.mockResolvedValue([mockAsset, { ...mockAsset, id: "asset-002" }]);

    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: ["asset-001", "asset-002"], format: "svg" }));
    expect(res.status).toBe(400);
  });

  it("returns PNG for png format", async () => {
    await setupAuth();
    mockPrisma.asset.findMany.mockResolvedValue([mockAsset]);

    const { POST } = await import("../app/api/export/route");
    const res = await POST(makeExportRequest({ assetIds: ["asset-001"], format: "png" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
