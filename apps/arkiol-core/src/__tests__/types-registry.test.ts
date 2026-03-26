/**
 * apps/arkiol-core/src/__tests__/types-registry.test.ts
 *
 * Unit tests for lib/types.ts
 *
 * Pure constants and functions — no DB, no HTTP, no Next.js.
 *
 * Covers:
 *  - FORMAT_DIMS — all 9 formats present, positive dimensions
 *  - ARKIOL_CATEGORIES — 9 entries, matches FORMAT_DIMS keys
 *  - CATEGORY_LABELS — all 9 categories have human-readable labels
 *  - getCategoryLabel — known formats return labels, unknown returns format string
 *  - getCreditCost — heavy vs light formats, GIF surcharge
 *  - EXPORT_PROFILES — all 9 categories, required fields
 *  - GIF_ELIGIBLE_FORMATS — derived correctly from EXPORT_PROFILES
 *  - ApiError — instanceof Error, statusCode, name
 */

import {
  FORMAT_DIMS,
  ARKIOL_CATEGORIES,
  CATEGORY_LABELS,
  getCategoryLabel,
  getCreditCost,
  EXPORT_PROFILES,
  GIF_ELIGIBLE_FORMATS,
  ApiError,
  type ArkiolCategory,
} from '../lib/types';

const ALL_CATEGORIES: ArkiolCategory[] = [
  'instagram_post', 'instagram_story', 'youtube_thumbnail',
  'flyer', 'poster', 'presentation_slide',
  'business_card', 'resume', 'logo',
];

// ══════════════════════════════════════════════════════════════════════════════
// FORMAT_DIMS
// ══════════════════════════════════════════════════════════════════════════════
describe('FORMAT_DIMS', () => {
  it('has all 9 formats', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(FORMAT_DIMS[cat]).toBeDefined();
    }
  });

  it('all dimensions have positive width and height', () => {
    for (const [, dims] of Object.entries(FORMAT_DIMS)) {
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
    }
  });

  it('instagram_post is square (1080×1080)', () => {
    expect(FORMAT_DIMS.instagram_post.width).toBe(FORMAT_DIMS.instagram_post.height);
    expect(FORMAT_DIMS.instagram_post.width).toBe(1080);
  });

  it('instagram_story is portrait (height > width)', () => {
    expect(FORMAT_DIMS.instagram_story.height).toBeGreaterThan(FORMAT_DIMS.instagram_story.width);
  });

  it('youtube_thumbnail is landscape (width > height)', () => {
    expect(FORMAT_DIMS.youtube_thumbnail.width).toBeGreaterThan(FORMAT_DIMS.youtube_thumbnail.height);
    expect(FORMAT_DIMS.youtube_thumbnail.width).toBe(1280);
    expect(FORMAT_DIMS.youtube_thumbnail.height).toBe(720);
  });

  it('flyer is portrait (height > width)', () => {
    expect(FORMAT_DIMS.flyer.height).toBeGreaterThan(FORMAT_DIMS.flyer.width);
  });

  it('logo is square', () => {
    expect(FORMAT_DIMS.logo.width).toBe(FORMAT_DIMS.logo.height);
  });

  it('all dimension values are positive integers', () => {
    for (const [, dims] of Object.entries(FORMAT_DIMS)) {
      expect(Number.isInteger(dims.width)).toBe(true);
      expect(Number.isInteger(dims.height)).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ARKIOL_CATEGORIES
// ══════════════════════════════════════════════════════════════════════════════
describe('ARKIOL_CATEGORIES', () => {
  it('has exactly 9 entries', () => {
    expect(ARKIOL_CATEGORIES.length).toBe(9);
  });

  it('all entries are strings', () => {
    for (const cat of ARKIOL_CATEGORIES) {
      expect(typeof cat).toBe('string');
    }
  });

  it('all entries are unique', () => {
    expect(new Set(ARKIOL_CATEGORIES).size).toBe(ARKIOL_CATEGORIES.length);
  });

  it('each category has a corresponding FORMAT_DIMS entry', () => {
    for (const cat of ARKIOL_CATEGORIES) {
      expect(FORMAT_DIMS[cat]).toBeDefined();
    }
  });

  it('contains all expected categories', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(ARKIOL_CATEGORIES).toContain(cat);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORY_LABELS
// ══════════════════════════════════════════════════════════════════════════════
describe('CATEGORY_LABELS', () => {
  it('has labels for all 9 categories', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).toBeDefined();
    }
  });

  it('all labels are non-empty strings', () => {
    for (const [, label] of Object.entries(CATEGORY_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('all labels are human-readable (start with uppercase)', () => {
    for (const [, label] of Object.entries(CATEGORY_LABELS)) {
      expect(label[0]).toBe(label[0]?.toUpperCase());
    }
  });

  it('instagram_post label is "Instagram Post"', () => {
    expect(CATEGORY_LABELS.instagram_post).toBe('Instagram Post');
  });

  it('youtube_thumbnail label contains "YouTube"', () => {
    expect(CATEGORY_LABELS.youtube_thumbnail).toContain('YouTube');
  });

  it('all labels are distinct', () => {
    const labels = Object.values(CATEGORY_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getCategoryLabel
// ══════════════════════════════════════════════════════════════════════════════
describe('getCategoryLabel', () => {
  it('returns the correct label for all known formats', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(getCategoryLabel(cat)).toBe(CATEGORY_LABELS[cat]);
    }
  });

  it('returns the format string itself for unknown formats', () => {
    expect(getCategoryLabel('unknown_format')).toBe('unknown_format');
    expect(getCategoryLabel('custom_xyz')).toBe('custom_xyz');
  });

  it('is deterministic', () => {
    expect(getCategoryLabel('instagram_post')).toBe(getCategoryLabel('instagram_post'));
  });

  it('does not throw for empty string', () => {
    expect(() => getCategoryLabel('')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getCreditCost
// ══════════════════════════════════════════════════════════════════════════════
describe('getCreditCost', () => {
  const HEAVY_FORMATS = ['flyer', 'poster', 'resume', 'logo'];
  const LIGHT_FORMATS = ['instagram_post', 'instagram_story', 'youtube_thumbnail', 'presentation_slide', 'business_card'];

  it('heavy formats cost 2 credits without GIF', () => {
    for (const fmt of HEAVY_FORMATS) {
      expect(getCreditCost(fmt, false)).toBe(2);
    }
  });

  it('light formats cost 1 credit without GIF', () => {
    for (const fmt of LIGHT_FORMATS) {
      expect(getCreditCost(fmt, false)).toBe(1);
    }
  });

  it('heavy formats cost 4 credits with GIF', () => {
    for (const fmt of HEAVY_FORMATS) {
      expect(getCreditCost(fmt, true)).toBe(4);
    }
  });

  it('light formats cost 3 credits with GIF', () => {
    for (const fmt of LIGHT_FORMATS) {
      expect(getCreditCost(fmt, true)).toBe(3);
    }
  });

  it('GIF surcharge is always exactly +2 credits', () => {
    for (const fmt of [...HEAVY_FORMATS, ...LIGHT_FORMATS]) {
      const withGif    = getCreditCost(fmt, true);
      const withoutGif = getCreditCost(fmt, false);
      expect(withGif - withoutGif).toBe(2);
    }
  });

  it('unknown format costs 1 credit (treated as light)', () => {
    expect(getCreditCost('unknown_format', false)).toBe(1);
  });

  it('all costs are positive integers', () => {
    for (const fmt of ALL_CATEGORIES) {
      expect(Number.isInteger(getCreditCost(fmt, false))).toBe(true);
      expect(getCreditCost(fmt, false)).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT_PROFILES
// ══════════════════════════════════════════════════════════════════════════════
describe('EXPORT_PROFILES', () => {
  it('has profiles for all 9 categories', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(EXPORT_PROFILES[cat]).toBeDefined();
    }
  });

  it('all profiles have supportsSvg, supportsPng, supportsGif, defaultPngScale', () => {
    for (const [, profile] of Object.entries(EXPORT_PROFILES)) {
      expect(typeof profile.supportsSvg).toBe('boolean');
      expect(typeof profile.supportsPng).toBe('boolean');
      expect(typeof profile.supportsGif).toBe('boolean');
      expect(typeof profile.defaultPngScale).toBe('number');
    }
  });

  it('all profiles support PNG', () => {
    for (const [, profile] of Object.entries(EXPORT_PROFILES)) {
      expect(profile.supportsPng).toBe(true);
    }
  });

  it('instagram formats support GIF', () => {
    expect(EXPORT_PROFILES.instagram_post.supportsGif).toBe(true);
    expect(EXPORT_PROFILES.instagram_story.supportsGif).toBe(true);
  });

  it('print formats (flyer, poster, resume) do not support GIF', () => {
    expect(EXPORT_PROFILES.flyer.supportsGif).toBe(false);
    expect(EXPORT_PROFILES.poster.supportsGif).toBe(false);
    expect(EXPORT_PROFILES.resume.supportsGif).toBe(false);
  });

  it('resume does not support SVG', () => {
    expect(EXPORT_PROFILES.resume.supportsSvg).toBe(false);
  });

  it('defaultPngScale is a positive number', () => {
    for (const [, profile] of Object.entries(EXPORT_PROFILES)) {
      expect(profile.defaultPngScale).toBeGreaterThan(0);
    }
  });

  it('high-detail formats (business_card, logo) use defaultPngScale=2', () => {
    expect(EXPORT_PROFILES.business_card.defaultPngScale).toBe(2);
    expect(EXPORT_PROFILES.logo.defaultPngScale).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GIF_ELIGIBLE_FORMATS
// ══════════════════════════════════════════════════════════════════════════════
describe('GIF_ELIGIBLE_FORMATS', () => {
  it('is a Set', () => {
    expect(GIF_ELIGIBLE_FORMATS).toBeInstanceOf(Set);
  });

  it('contains exactly the formats where supportsGif=true', () => {
    for (const cat of ALL_CATEGORIES) {
      if (EXPORT_PROFILES[cat].supportsGif) {
        expect(GIF_ELIGIBLE_FORMATS.has(cat)).toBe(true);
      } else {
        expect(GIF_ELIGIBLE_FORMATS.has(cat)).toBe(false);
      }
    }
  });

  it('contains instagram_post', () => {
    expect(GIF_ELIGIBLE_FORMATS.has('instagram_post')).toBe(true);
  });

  it('contains instagram_story', () => {
    expect(GIF_ELIGIBLE_FORMATS.has('instagram_story')).toBe(true);
  });

  it('does not contain flyer', () => {
    expect(GIF_ELIGIBLE_FORMATS.has('flyer')).toBe(false);
  });

  it('does not contain resume', () => {
    expect(GIF_ELIGIBLE_FORMATS.has('resume')).toBe(false);
  });

  it('is consistent with EXPORT_PROFILES (derived correctly)', () => {
    const fromProfiles = new Set(
      ALL_CATEGORIES.filter(cat => EXPORT_PROFILES[cat].supportsGif)
    );
    expect(GIF_ELIGIBLE_FORMATS).toEqual(fromProfiles);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ApiError
// ══════════════════════════════════════════════════════════════════════════════
describe('ApiError', () => {
  it('is an instance of Error', () => {
    expect(new ApiError(400, 'Bad request')).toBeInstanceOf(Error);
  });

  it('is an instance of ApiError', () => {
    expect(new ApiError(400, 'Bad request')).toBeInstanceOf(ApiError);
  });

  it('statusCode is set from constructor', () => {
    expect(new ApiError(404, 'Not found').statusCode).toBe(404);
    expect(new ApiError(500, 'Server error').statusCode).toBe(500);
  });

  it('message is set from constructor', () => {
    expect(new ApiError(400, 'Invalid input').message).toBe('Invalid input');
  });

  it('name is ApiError', () => {
    expect(new ApiError(400, 'test').name).toBe('ApiError');
  });

  it('status property mirrors statusCode', () => {
    const err = new ApiError(403, 'Forbidden');
    expect((err as any).status).toBe(403);
  });

  it('can be thrown and caught as Error', () => {
    expect(() => { throw new ApiError(401, 'Unauthorized'); }).toThrow(Error);
  });

  it('different status codes produce different statusCode values', () => {
    const a = new ApiError(400, 'msg');
    const b = new ApiError(404, 'msg');
    expect(a.statusCode).not.toBe(b.statusCode);
  });
});
