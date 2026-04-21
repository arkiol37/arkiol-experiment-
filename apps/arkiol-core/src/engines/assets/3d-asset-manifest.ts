// src/engines/assets/3d-asset-manifest.ts
//
// Canonical list of 3D asset slugs the system expects when
// ARKIOL_3D_ASSET_BASE is populated. Deployments that want the "3D"
// visualStyle path to win over inline-SVG illustrations must serve a
// PNG (ideally WebP for size) at each slug below from the CDN base.
//
// URL convention:
//   ${ARKIOL_3D_ASSET_BASE}/${slug}.png
//
// Example deployment recipe:
//   1. Source / commission one 3D render per slug. Recommended style:
//      claymorphism or softly lit 3D, consistent camera angle, clean
//      background, 1200×1200 minimum (or 1920×1200 for 1.6-ratio
//      slugs flagged below).
//   2. Upload to a public CDN under a single prefix, e.g.
//      https://cdn.arkiol.com/3d/<slug>.png
//   3. Set ARKIOL_3D_ASSET_BASE=https://cdn.arkiol.com/3d on the
//      worker. The render3d() helper in data.ts picks it up
//      automatically; no code change needed.
//   4. The marketplace-gate's styleConsistent criterion will then
//      prefer "3d" over "illustration" for categories with full
//      coverage.
//
// Every slug carries its ideal aspect ratio + suggested license /
// source so ops can budget and attribute correctly. The manifest is
// read-only — update it here when a new 3D slug lands in the library.

export interface Asset3DSlug {
  slug:        string;
  label:       string;
  category:    string;     // primary library category this asset serves
  realm:       "nature" | "animal" | "lifestyle" | "object" | "scene";
  aspectRatio: number;     // w / h
  suggestedSize: { w: number; h: number };
  notes?:      string;
  // Step 47: quality expectations. Every curated slug in this manifest
  // must ship as a premium-tier render — modern, clean, high-resolution
  // 3D with consistent lighting and camera angle. A "standard" slug is
  // acceptable decorative supporting art. "draft" entries are dev-only
  // placeholders and MUST NOT appear in production. Defaulting the
  // field to "premium" for the whole manifest enforces the platform's
  // hero-grade visual contract.
  qualityTier: "premium" | "standard";
  // Style contract — every 3D manifest entry is always visualStyle="3d".
  // Declared here explicitly so downstream code can trust the guarantee
  // without re-reading every asset record.
  visualStyle: "3d";
}

export const ASSET_3D_MANIFEST: readonly Asset3DSlug[] = Object.freeze([
  // ── Nature (32) ────────────────────────────────────────────────────
  // Step 48: expanded the nature realm into a first-class environment
  // library. Every slug is a modern claymorphic 3D render — consistent
  // lighting, soft shadows, pastel or true-to-life palette, rendered
  // at 1200–2000 px on the long edge. Layout grouping (mountain /
  // water / sky / flora / stone / beach) keeps the manifest readable
  // and the diff reviewable. When ARKIOL_3D_ASSET_BASE is configured
  // the CDN must serve each slug below at `${base}/${slug}.png`.
  // Mountains
  { slug: "nature-mountain-range", label: "Mountain range",    category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-mountain-snowy", label: "Snowy mountain",    category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-mountain-misty", label: "Misty mountain",    category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Rivers & waterfalls
  { slug: "nature-river",          label: "River stream",      category: "wellness",    realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-river-bend",     label: "River bend",        category: "wellness",    realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-waterfall",      label: "Waterfall",         category: "wellness",    realm: "nature",    aspectRatio: 0.8, suggestedSize: { w: 1200, h: 1500 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-waterfall-tropical", label: "Tropical waterfall", category: "travel",  realm: "nature",    aspectRatio: 0.8, suggestedSize: { w: 1200, h: 1500 }, qualityTier: "premium", visualStyle: "3d" },
  // Forests
  { slug: "nature-forest",         label: "Forest scene",      category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-pine-forest",    label: "Pine forest",       category: "wellness",    realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-autumn-forest",  label: "Autumn forest",     category: "wellness",    realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Ocean & beach
  { slug: "nature-ocean-waves",    label: "Ocean waves",       category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-beach",          label: "Beach cove",        category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-beach-palms",    label: "Beach with palms",  category: "travel",      realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Sky & atmosphere
  { slug: "nature-sky-clouds",     label: "Sky clouds",        category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-cloud-cluster",  label: "Cloud cluster",     category: "motivation",  realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-sky-dawn",       label: "Dawn sky",          category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-sky-dusk",       label: "Dusk sky",          category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-sky-starlit",    label: "Starlit sky",       category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-sunset",         label: "Golden hour",       category: "motivation",  realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Plants & flora
  { slug: "nature-potted-plant",   label: "Potted plant",      category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-cactus",         label: "Potted cactus",     category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-succulent",      label: "Succulent",         category: "beauty",      realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-fern",           label: "Fern frond",        category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-leaf",           label: "Leaf",              category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-autumn-leaves",  label: "Autumn leaves",     category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Flowers
  { slug: "nature-flower-rose",    label: "Rose bloom",        category: "beauty",      realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-flower-tulip",   label: "Tulip",             category: "beauty",      realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-flower-bouquet", label: "Flower bouquet",    category: "beauty",      realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-wildflower-field", label: "Wildflower field", category: "wellness",   realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Grass & stones
  { slug: "nature-grass-meadow",   label: "Grass meadow",      category: "wellness",    realm: "nature",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-stone-stack",    label: "Zen stone stack",   category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "nature-pebbles",        label: "Smooth pebbles",    category: "wellness",    realm: "nature",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Animal (5) ─────────────────────────────────────────────────────
  { slug: "animal-dog",            label: "Dog",               category: "wellness",    realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-cat",            label: "Cat",               category: "wellness",    realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-bird-flight",    label: "Bird in flight",    category: "motivation",  realm: "animal",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-butterfly",      label: "Butterfly",         category: "beauty",      realm: "animal",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "animal-deer",           label: "Deer",              category: "wellness",    realm: "animal",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Lifestyle (26) ─────────────────────────────────────────────────
  // Step 49: expanded the lifestyle realm into a first-class interior-scene
  // library. Step 51: added spa / yoga / bathroom setups so the wellness
  // and self-care briefs have dedicated scene art. Step 52: added gym,
  // home-gym, and outdoor running setups so fitness briefs have their own
  // scene art instead of borrowing from studios or nature. Every slug is
  // a modern real-life 3D render — consistent soft lighting, clean camera
  // angle, realistic materials and props, rendered at 1600–2000 px on the
  // long edge. Groupings (workspaces, reading, green interiors, kitchens,
  // bedrooms, living areas, studios, wellness, fitness) keep the manifest
  // readable and the diff reviewable. When ARKIOL_3D_ASSET_BASE is
  // configured the CDN must serve each slug below at `${base}/${slug}.png`.
  // Workspaces
  { slug: "lifestyle-workspace",         label: "Workspace",           category: "productivity",realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-desk-flatlay",      label: "Desk flat-lay",       category: "productivity",realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-dual-monitor-desk", label: "Dual-monitor desk",   category: "productivity",realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-minimal-desk",      label: "Minimal desk",        category: "productivity",realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-coworking",         label: "Coworking space",     category: "business",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-home-office",       label: "Home office",         category: "business",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Reading areas
  { slug: "lifestyle-reading-nook",      label: "Reading nook",        category: "education",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-reading-armchair",  label: "Reading armchair",    category: "education",   realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Green interiors
  { slug: "lifestyle-plant-room",        label: "Plant-filled room",   category: "wellness",    realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-botanical-corner",  label: "Botanical corner",    category: "wellness",    realm: "lifestyle", aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Kitchens
  { slug: "lifestyle-kitchen",           label: "Kitchen counter",     category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-modern-kitchen",    label: "Modern kitchen",      category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-sunlit-kitchen",    label: "Sunlit kitchen",      category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Bedrooms
  { slug: "lifestyle-bedroom",           label: "Bedroom",             category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-cozy-bedroom",      label: "Cozy bedroom",        category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-scandi-bedroom",    label: "Scandi bedroom",      category: "beauty",      realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Living areas
  { slug: "lifestyle-living-room",       label: "Living room",         category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Studios
  { slug: "lifestyle-photo-studio",      label: "Photography studio",  category: "marketing",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-art-studio",        label: "Art studio",          category: "education",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-podcast-studio",    label: "Podcast studio",      category: "marketing",   realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Wellness & self-care setups
  { slug: "lifestyle-spa-setup",         label: "Spa setup",           category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-yoga-setup",        label: "Yoga setup",          category: "fitness",     realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-bathroom",          label: "Bathroom",            category: "wellness",    realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Fitness setups
  { slug: "lifestyle-gym",               label: "Gym interior",        category: "fitness",     realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-home-gym",          label: "Home gym corner",     category: "fitness",     realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "lifestyle-running-trail",     label: "Running trail",       category: "fitness",     realm: "lifestyle", aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Object (47) ────────────────────────────────────────────────────
  // Step 50: expanded the object realm into a real-life daily-use catalog.
  // Step 51: added food / wellness / self-care props so the object realm
  // also covers healthy meals (salad, smoothie, breakfast, fruit, meal
  // prep) and beauty/spa kit (serum, makeup, bath essentials).
  // Step 52: added fitness gear (running shoes, gym bag, activewear),
  // travel gear (passport, travel kit, backpack), and fashion props
  // (outfit flat-lay, handbag, heels, sunglasses, watch) so fitness /
  // travel / fashion briefs have dedicated prop art. Every slug is a
  // premium 3D render with consistent soft lighting, a clean neutral
  // backdrop, and a ¾ / front-on camera so props can be composited onto
  // any template without visual mismatch. Grouped by theme (books /
  // stationery / tech / drinks / food / fitness / travel / beauty /
  // self-care / fashion / toys) so the diff is reviewable and coverage
  // is obvious.
  // Books & reading
  { slug: "object-books-stack",    label: "Books stack",       category: "education",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-book-open",      label: "Open book",         category: "education",   realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Stationery
  { slug: "object-notebook",       label: "Notebook",          category: "education",   realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-notebook-pen",   label: "Notebook with pen", category: "productivity",realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-pen-set",        label: "Pen set",           category: "productivity",realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-pencil-set",     label: "Pencil set",        category: "education",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Tech
  { slug: "object-laptop",         label: "Laptop",            category: "business",    realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-phone",          label: "Smartphone",        category: "marketing",   realm: "object",    aspectRatio: 0.8, suggestedSize: { w: 1200, h: 1500 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-camera",         label: "Camera",            category: "marketing",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-headphones",     label: "Headphones",        category: "productivity",realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Drinks
  { slug: "object-coffee-cup",     label: "Coffee cup",        category: "productivity",realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-coffee-mug",     label: "Coffee mug",        category: "productivity",realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-tea-cup",        label: "Tea cup",           category: "wellness",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Food
  { slug: "object-salad-bowl",     label: "Salad bowl",        category: "wellness",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-balanced-meal",  label: "Balanced meal bowl", category: "wellness",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-breakfast-spread", label: "Breakfast spread", category: "wellness",   realm: "object",    aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-smoothie-bowl",  label: "Smoothie bowl",     category: "wellness",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-fruit-platter",  label: "Fruit platter",     category: "wellness",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-meal-prep",      label: "Meal-prep containers", category: "fitness",  realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Fitness
  { slug: "object-water-bottle",   label: "Water bottle",      category: "fitness",     realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-dumbbell",       label: "Dumbbell",          category: "fitness",     realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-yoga-mat",       label: "Yoga mat",          category: "fitness",     realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-running-shoes",  label: "Running shoes",     category: "fitness",     realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-gym-bag",        label: "Gym bag",           category: "fitness",     realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-activewear",     label: "Activewear flat-lay", category: "fitness",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Travel
  { slug: "object-suitcase",       label: "Suitcase",          category: "travel",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-passport",       label: "Passport",          category: "travel",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-travel-kit",     label: "Travel kit flat-lay", category: "travel",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-backpack",       label: "Travel backpack",   category: "travel",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Beauty & wellness
  { slug: "object-skincare-bottle",label: "Skincare bottle",   category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-perfume-bottle", label: "Perfume bottle",    category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-candle",         label: "Candle",            category: "wellness",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-diffuser",       label: "Essential-oil diffuser", category: "wellness", realm: "object",   aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-serum-dropper",  label: "Serum dropper",     category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Makeup
  { slug: "object-makeup-brushes", label: "Makeup brush set",  category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-lipstick",       label: "Lipstick",          category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-makeup-palette", label: "Makeup palette",    category: "beauty",      realm: "object",    aspectRatio: 1.3, suggestedSize: { w: 1600, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  // Bath essentials
  { slug: "object-bath-salts",     label: "Bath salts jar",    category: "wellness",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-bath-soap-set",  label: "Bath soap set",     category: "wellness",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Fashion
  { slug: "object-outfit-flatlay", label: "Outfit flat-lay",   category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-handbag",        label: "Handbag",           category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-heels",          label: "Heels",             category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-sunglasses",     label: "Sunglasses",        category: "beauty",      realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-watch",          label: "Wristwatch",        category: "business",    realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  // Toys
  { slug: "object-toy-rocket",     label: "Toy rocket",        category: "marketing",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-plush-bear",     label: "Plush bear",        category: "marketing",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "object-building-blocks",label: "Building blocks",   category: "education",   realm: "object",    aspectRatio: 1.0, suggestedSize: { w: 1600, h: 1600 }, qualityTier: "premium", visualStyle: "3d" },

  // ── Scene (5) ──────────────────────────────────────────────────────
  { slug: "scene-city-skyline",    label: "City skyline",      category: "business",    realm: "scene",     aspectRatio: 2.0, suggestedSize: { w: 2000, h: 1000 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-beach-horizon",   label: "Beach horizon",     category: "travel",      realm: "scene",     aspectRatio: 2.0, suggestedSize: { w: 2000, h: 1000 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-cafe-interior",   label: "Café interior",     category: "marketing",   realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-living-room",     label: "Living room",       category: "wellness",    realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
  { slug: "scene-urban-street",    label: "Urban street",      category: "marketing",   realm: "scene",     aspectRatio: 1.6, suggestedSize: { w: 1920, h: 1200 }, qualityTier: "premium", visualStyle: "3d" },
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

export function asset3dBaseUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const v = (process.env as Record<string, string | undefined>).ARKIOL_3D_ASSET_BASE;
  return v && v.length > 0 ? v.replace(/\/+$/, "") : undefined;
}

export function asset3dUrl(slug: string): string | undefined {
  const base = asset3dBaseUrl();
  return base ? `${base}/${slug}.png` : undefined;
}

export function isAsset3dConfigured(): boolean {
  return asset3dBaseUrl() !== undefined;
}

// Diagnostic summary — useful in health endpoints or startup logs so
// ops can see at a glance whether the 3D catalog is live.
export function asset3dManifestStats(): {
  configured:     boolean;
  baseUrl:        string | undefined;
  totalSlugs:     number;
  premiumSlugs:   number;
  byRealm:        Record<string, number>;
  byCategory:     Record<string, number>;
} {
  const byRealm:    Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let premiumCount = 0;
  for (const m of ASSET_3D_MANIFEST) {
    byRealm[m.realm]       = (byRealm[m.realm]       ?? 0) + 1;
    byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
    if (m.qualityTier === "premium") premiumCount += 1;
  }
  return {
    configured:   isAsset3dConfigured(),
    baseUrl:      asset3dBaseUrl(),
    totalSlugs:   ASSET_3D_MANIFEST.length,
    premiumSlugs: premiumCount,
    byRealm,
    byCategory,
  };
}

// ── Quality gate ─────────────────────────────────────────────────────────────
// Step 47: the 3D manifest is the platform's hero-grade visual contract —
// every slug must be a premium, modern, high-resolution 3D render with
// consistent lighting and camera angle. These helpers make that contract
// checkable so ops can fail fast when a regression lands.

/** True when every manifest entry is tagged as premium-tier. */
export function is3dManifestPremiumOnly(): boolean {
  return ASSET_3D_MANIFEST.every(m => m.qualityTier === "premium");
}

/** All manifest entries at or above the given quality tier. */
export function asset3dSlugsByQualityTier(
  tier: "premium" | "standard",
): readonly Asset3DSlug[] {
  if (tier === "premium") {
    return ASSET_3D_MANIFEST.filter(m => m.qualityTier === "premium");
  }
  return ASSET_3D_MANIFEST;
}

/** Look up a single manifest entry by slug. */
export function getAsset3dSlug(slug: string): Asset3DSlug | undefined {
  return ASSET_3D_MANIFEST.find(m => m.slug === slug);
}

// ── Realm groups (Step 48) ───────────────────────────────────────────────────
// Realms are the primary subject axis for 3D assets — nature / animal /
// lifestyle / object / scene. Callers that want the whole "nature asset
// group" (clouds, mountains, rivers, forests, flowers, stones, etc.) can
// pull it here without reimplementing the filter every time.

/** All manifest entries whose realm matches. Order preserved. */
export function asset3dSlugsByRealm(
  realm: Asset3DSlug["realm"],
): readonly Asset3DSlug[] {
  return ASSET_3D_MANIFEST.filter(m => m.realm === realm);
}

/**
 * Nature asset group — mountains, rivers, waterfalls, forests, ocean,
 * beach, sky, sunsets, plants, flowers, grass, stones. A convenience
 * alias for `asset3dSlugsByRealm("nature")` because this is the most
 * frequently-queried group (the platform's hero environment catalog).
 */
export function natureAsset3dSlugs(): readonly Asset3DSlug[] {
  return asset3dSlugsByRealm("nature");
}

/**
 * Lifestyle asset group — workspaces, desks, reading areas, plant-filled
 * rooms, kitchens, bedrooms, home offices, living rooms, photo / art /
 * podcast studios. Convenience alias for `asset3dSlugsByRealm("lifestyle")`
 * so templates that want the interior-scene catalog don't have to
 * reimplement the filter.
 */
export function lifestyleAsset3dSlugs(): readonly Asset3DSlug[] {
  return asset3dSlugsByRealm("lifestyle");
}

/**
 * Object / daily-use asset group — books, notebooks, stationery, laptops,
 * phones, cameras, headphones, cups, water bottles, dumbbells, yoga mats,
 * suitcases, skincare / perfume / candles / diffusers, and toys. Convenience
 * alias for `asset3dSlugsByRealm("object")` — this is the prop catalog
 * that pairs with any lifestyle or nature scene.
 */
export function objectAsset3dSlugs(): readonly Asset3DSlug[] {
  return asset3dSlugsByRealm("object");
}
