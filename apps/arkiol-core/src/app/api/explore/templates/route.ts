// src/app/api/explore/templates/route.ts
// GET /api/explore/templates — curated starter template library for the mobile Explore screen.
// No auth required — public endpoint, cached at edge.
// The mobile app merges these with its local seed templates.

import { NextResponse } from "next/server";
import { detectCapabilities } from '@arkiol/shared';
import { dbUnavailable } from "../../../../lib/error-handling";

const TEMPLATES = [
  { id: "t1",  title: "Summer Sale",         category: "Social",    format: "Instagram Post", emoji: "🌅", accent: "#f59e0b", prompt: "Vibrant summer sale Instagram post with bold text and warm golden gradient, 50% OFF" },
  { id: "t2",  title: "Tech Product Launch",  category: "Marketing", format: "Poster",         emoji: "⚡", accent: "#2DD4BF", prompt: "Modern tech product launch poster with dark background and electric neon blue accents" },
  { id: "t3",  title: "Brand Identity",       category: "Brand",     format: "Logo",           emoji: "◈", accent: "#22d3ee", prompt: "Minimalist professional brand logo with clean typography and a geometric diamond mark" },
  { id: "t4",  title: "Gaming Thumbnail",     category: "Video",     format: "YouTube Thumb",  emoji: "🎮", accent: "#f472b6", prompt: "Epic gaming YouTube thumbnail with dramatic lighting and bold impact title text" },
  { id: "t5",  title: "Creative CV",          category: "Print",     format: "Résumé",         emoji: "📋", accent: "#10b981", prompt: "Modern creative résumé with sidebar column layout and teal accent color blocks" },
  { id: "t6",  title: "Night Story",          category: "Social",    format: "Story",          emoji: "🌙", accent: "#a5b4fc", prompt: "Elegant dark Instagram story with minimal design and crescent moon motif, deep navy" },
  { id: "t7",  title: "Product Drop",         category: "Marketing", format: "Flyer",          emoji: "📦", accent: "#fbbf24", prompt: "Bold streetwear product launch flyer with high contrast and grunge typography" },
  { id: "t8",  title: "Agency Card",          category: "Brand",     format: "Business Card",  emoji: "🖤", accent: "#8b8ca6", prompt: "Premium matte black business card for creative agency with subtle embossed texture" },
  { id: "t9",  title: "Podcast Cover",        category: "Social",    format: "Instagram Post", emoji: "🎙", accent: "#f59e0b", prompt: "Professional podcast cover art with bold sans-serif typography and dynamic waveform icon" },
  { id: "t10", title: "Course Promo",         category: "Marketing", format: "YouTube Thumb",  emoji: "📚", accent: "#2DD4BF", prompt: "Educational course YouTube thumbnail — clean, professional, bright colors, text overlay" },
  { id: "t11", title: "Wedding Invite",       category: "Print",     format: "Flyer",          emoji: "💍", accent: "#f9a8d4", prompt: "Elegant floral wedding invitation with gold foil accents and romantic script typography" },
  { id: "t12", title: "SaaS Pitch Deck",      category: "Brand",     format: "Slide",          emoji: "📱", accent: "#22d3ee", prompt: "Modern SaaS startup pitch deck slide with dark theme, clean layout and blue gradients" },
  { id: "t13", title: "Fitness Story",        category: "Social",    format: "Story",          emoji: "💪", accent: "#f87171", prompt: "High-energy fitness motivation Instagram story with neon red accents on dark background" },
  { id: "t14", title: "Food Menu",            category: "Print",     format: "Flyer",          emoji: "🍽", accent: "#fbbf24", prompt: "Elegant restaurant dinner menu cover with sophisticated gold typography on dark linen" },
  { id: "t15", title: "Event Poster",         category: "Marketing", format: "Poster",         emoji: "🎵", accent: "#f472b6", prompt: "Vibrant music event poster with geometric shapes, neon colors and bold headline text" },
  { id: "t16", title: "Startup Logo",         category: "Brand",     format: "Logo",           emoji: "🚀", accent: "#2DD4BF", prompt: "Modern startup logo with abstract rocket motif, gradient from indigo to violet, minimal" },
  { id: "t17", title: "Real Estate Ad",       category: "Marketing", format: "Display Ad",     emoji: "🏡", accent: "#f59e0b", prompt: "Luxury real estate listing ad — architectural photography feel, gold accents, premium type" },
  { id: "t18", title: "App Store Banner",     category: "Marketing", format: "Banner",         emoji: "📲", accent: "#2DD4BF", prompt: "Clean app store feature banner — iOS style, gradient background, device mockup, bold headline" },
  { id: "t19", title: "LinkedIn Banner",      category: "Brand",     format: "Banner",         emoji: "💼", accent: "#22d3ee", prompt: "Professional LinkedIn profile banner — dark tech gradient, clean sans-serif, subtle grid" },
  { id: "t20", title: "Newsletter Header",    category: "Social",    format: "Banner",         emoji: "📧", accent: "#a5b4fc", prompt: "Elegant email newsletter header with brand logo space, warm neutral tones, editorial type" },
];

export async function GET() {
  if (!detectCapabilities().database) return dbUnavailable();

  return NextResponse.json(
    { templates: TEMPLATES },
    { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } }
  );
}
