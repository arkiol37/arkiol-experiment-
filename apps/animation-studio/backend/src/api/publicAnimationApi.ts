import { Router, Request, Response, NextFunction } from 'express';

// Schema validation from shared package
import { validateCreativeIntent } from '@arkiol/shared/src/schemas/creativeIntentSchema';
import { orchestrateAdGeneration } from '../engines/orchestrator/intelligenceOrchestrator';
import { getProvenTemplates, applyTemplate } from '../engines/template/templateLearningEngine';
import { registerWebhook, deliverRenderCompleteWebhook } from '../engines/webhook/webhookDeliveryEngine';
import { logger } from '../config/logger';
const router = Router();
router.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { brief, brandName, industry, mood, hookType, platform, placement, sceneCount, aspectRatio, renderMode, maxDurationSec, brandAssetIds, brandPalette, targetAudience, objective } = req.body;
    // Validate with shared schema
    const validation = validateCreativeIntent(req.body);
    if (!validation.success) return res.status(400).json({ error: 'Validation failed', details: (validation as any).errors });
    const renderJobId = req.body.renderJobId || `gen_${Date.now()}`;
    const workspaceId = ((req as any).workspaceId as string) || 'default';
    const userId = ((req as any).userId as string) || 'system';
    const result = await orchestrateAdGeneration({ renderJobId, workspaceId, userId, brief, brandName, industry: industry || 'Other', mood, hookType, platform, placement: placement || `${platform}_feed`, sceneCount: sceneCount || 5, aspectRatio: aspectRatio || '9:16', renderMode: renderMode || 'Normal Ad', maxDurationSec: maxDurationSec || 30, brandAssetIds, brandPalette, targetAudience, objective });
    res.json({
      success: true,
      renderJobId,
      storyboard: result.storyboard.map((s: any) => ({
        id: s.id, position: s.position, role: s.role, durationSec: s.durationSec,
        prompt: s.prompt, voiceoverScript: s.voiceoverScript, onScreenText: s.onScreenText,
        emotionTarget: s.emotionTarget, shotType: s.shotType, cameraMove: s.cameraMove,
      })),
      timeline: { tracks: result.timeline.length, totalDurationMs: Math.max(0, ...result.timeline.map((t: any) => t.endMs || 0)) },
      shotPlans: result.metadata.shotPlans || [],
      musicProfile: result.metadata.musicProfile || null,
      audioSyncPointCount: result.metadata.audioSyncPointCount || 0,
      performances: result.metadata.performances ? (result.metadata.performances as any[]).map((p: any) => ({
        sceneId: p.sceneId, emotionPeak: p.emotionProgression?.[3]?.emotion, gestureCount: p.gestureSequence?.length, productActing: !!p.productActing,
      })) : [],
      frameContinuity: result.metadata.frameContinuityPlans ? {
        avgScore: Math.round((result.metadata.frameContinuityPlans as any[]).reduce((s: number, p: any) => s + p.continuityScore, 0) / (result.metadata.frameContinuityPlans as any[]).length),
        violations: (result.metadata.frameContinuityViolations as any[] || []).length,
      } : null,
      cinematicDirection: result.metadata.cinematicDirection ? {
        shots: (result.metadata.cinematicDirection as any[]).map((c: any) => ({ sceneId: c.sceneId, shot: c.shotLanguage?.primaryShot, framing: c.shotLanguage?.framingStyle, grade: c.cinematicGrade?.lut })),
      } : null,
      qualityGate: result.metadata.qualityGate || null,
      qualityScores: result.qualityScores.length > 0 ? {
        avg: Math.round(result.qualityScores.reduce((s: number, q: any) => s + q.overall, 0) / result.qualityScores.length),
        issues: result.qualityScores.flatMap((q: any) => q.issues || []).slice(0, 10),
      } : null,
      animaticPreview: result.metadata.animaticPreview || null,
      compiledPrompts: result.metadata.compiledPrompts ? { count: (result.metadata.compiledPrompts as any[]).length, provider: result.metadata.selectedProvider } : null,
      referenceImages: result.metadata.referenceImagePlans ? { needed: (result.metadata.referenceImagePlans as any[]).filter((p: any) => p.needsReference).length, estimatedMs: result.metadata.referenceEstimatedMs } : null,
      engineValidation: result.metadata.engineValidation || null,
      confidence: (result.metadata.confidence as any)?.value,
      stages: result.stages.map((s: any) => ({ name: s.name, status: s.status, durationMs: s.durationMs })),
    });
  } catch (err: any) { logger.error('[AnimationAPI] Generate failed', { error: err.message }); next(err); }
});
router.get('/preview/:renderJobId', async (_req: Request, res: Response) => { res.json({ message: 'Preview data cached in memory during generation' }); });
/**
 * GET /api/v1/animation/templates
 * Get proven ad templates with performance data.
 */
router.get('/templates', async (req: Request, res: Response) => {
  const { platform, objective } = req.query;
  const templates = getProvenTemplates(platform, objective);
  res.json({ templates: templates.map(t => ({ id: t.id, name: t.name, description: t.description, category: t.category, performance: t.performance, config: { mood: t.config.mood, hookType: t.config.hookType, objective: t.config.objective, sceneCount: t.config.sceneCount, platform: t.config.platform, renderMode: t.config.renderMode }, usageCount: t.usageCount })) });
});

/**
 * POST /api/v1/animation/templates/:id/apply
 * Apply a template to pre-populate generation config.
 */
router.post('/templates/:id/apply', async (req: Request, res: Response) => {
  const config = applyTemplate(req.params.id, req.body.overrides);
  if (!config) return res.status(404).json({ error: 'Template not found' });
  res.json({ success: true, config });
});

/**
 * POST /api/v1/animation/webhooks
 * Register a webhook endpoint for render events.
 */
router.post('/webhooks', async (req: Request, res: Response) => {
  const { url, secret, events } = req.body;
  if (!url || !secret) return res.status(400).json({ error: 'url and secret required' });
  const webhook = registerWebhook({ id: `wh_${Date.now()}`, workspaceId: ((req as any).workspaceId as string) || 'default', url, secret, events: events || ['render.complete', 'render.failed'], active: true });
  res.json({ success: true, webhookId: webhook.id });
});

export default router;
