# providers/

External video provider integrations (Runway, Pika, Sora) have been moved to
`../_future_3d/providers/` because the v27 architecture renders ALL 2D and 2.5D
output exclusively via the internal Template Execution Engine.

These providers are preserved for future 3D video capabilities only.
The active rendering pipeline (renderQueue.ts → engineGate.ts → hybridRouter.ts →
internalRenderPipeline.ts) has zero provider imports or dependencies.
