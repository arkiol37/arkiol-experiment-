/**
 * Audience Engine — builds audience profile from intent for targeting.
 */
import type { DirectorIntent, AudienceProfile, Platform } from '../types';

const PLAT_DEMO: Record<Platform, { age: [number, number]; attention: number; peak: number; pref: string }> = {
  tiktok: { age: [16, 34], attention: 1800, peak: 7, pref: 'raw authentic, creator-native' },
  instagram: { age: [18, 40], attention: 2500, peak: 10, pref: 'polished aesthetic, aspirational' },
  facebook: { age: [25, 55], attention: 3500, peak: 12, pref: 'informative, share-worthy' },
  youtube: { age: [18, 55], attention: 5000, peak: 15, pref: 'narrative storytelling, high production' },
};
const IND_AUD: Record<string, { interests: string[]; psycho: string[] }> = {
  'Tech / SaaS': { interests: ['technology','productivity','innovation'], psycho: ['early adopter','efficiency-driven'] },
  'E-commerce': { interests: ['shopping','deals','lifestyle'], psycho: ['value-seeker','convenience-driven'] },
  'Finance': { interests: ['investing','financial planning'], psycho: ['security-focused','goal-oriented'] },
  'Health & Wellness': { interests: ['fitness','nutrition','mental health'], psycho: ['health-conscious','aspirational'] },
};

export function buildAudienceProfile(intent: DirectorIntent): AudienceProfile {
  const pd = PLAT_DEMO[intent.platform] || PLAT_DEMO.youtube;
  const ia = IND_AUD[intent.brand.industry] || { interests: ['general'], psycho: ['mainstream'] };
  const custom = intent.brand.targetAudience ? intent.brand.targetAudience.split(',').map(s => s.trim()) : [];
  return { ageRange: pd.age, gender: 'all', interests: [...new Set([...ia.interests, ...custom])], psychographics: ia.psycho, platform: intent.platform, attentionSpanMs: pd.attention, peakEngagementSec: pd.peak };
}
