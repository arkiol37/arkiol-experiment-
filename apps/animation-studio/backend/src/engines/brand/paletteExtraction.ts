export interface ExtractedPalette { primary: string; secondary: string; accent: string; background: string; text: string; colors: { hex: string; percentage: number; name: string }[]; }
const IP: Record<string, ExtractedPalette> = {
  'Tech / SaaS': { primary: '#2563EB', secondary: '#7C3AED', accent: '#06B6D4', background: '#0F172A', text: '#F8FAFC', colors: [{ hex: '#2563EB', percentage: 35, name: 'Blue' }, { hex: '#7C3AED', percentage: 25, name: 'Purple' }] },
  'E-commerce': { primary: '#F59E0B', secondary: '#EF4444', accent: '#10B981', background: '#FFFFFF', text: '#1F2937', colors: [{ hex: '#F59E0B', percentage: 30, name: 'Amber' }] },
  'Finance': { primary: '#1E40AF', secondary: '#047857', accent: '#D97706', background: '#F9FAFB', text: '#111827', colors: [{ hex: '#1E40AF', percentage: 40, name: 'Navy' }] },
  'Health & Wellness': { primary: '#059669', secondary: '#8B5CF6', accent: '#F59E0B', background: '#F0FDF4', text: '#1F2937', colors: [{ hex: '#059669', percentage: 35, name: 'Green' }] },
};
export function extractPalette(brandPalette?: string[], industry?: string): ExtractedPalette {
  if (brandPalette && brandPalette.length >= 2) return { primary: brandPalette[0], secondary: brandPalette[1], accent: brandPalette[2] || brandPalette[0], background: brandPalette[3] || '#0F172A', text: brandPalette[4] || '#F8FAFC', colors: brandPalette.map((h, i) => ({ hex: h, percentage: Math.round(100 / brandPalette.length), name: `Color ${i+1}` })) };
  if (industry && IP[industry]) return IP[industry];
  return { primary: '#3B82F6', secondary: '#8B5CF6', accent: '#F59E0B', background: '#111827', text: '#F9FAFB', colors: [{ hex: '#3B82F6', percentage: 40, name: 'Blue' }] };
}
