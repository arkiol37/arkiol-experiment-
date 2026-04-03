/**
 * Quality Intelligence Layer — 16 Active Engines
 * Each engine: evaluate(candidate, ctx) → { score, directives[] }
 * Directives are CONSUMED by the candidate pipeline directive executor.
 */
import { logger } from '../../config/logger';

export interface QICandidate { id: string; scenes: any[]; intent: any; scores: Record<string, QIScore>; directives: QIDirective[]; composite: number; meta: Record<string, unknown>; }
export interface QIScore { engineId: string; score: number; subScores: Record<string, number>; rationale: string; confidence: number; }
export interface QIDirective { engineId: string; target: string; action: string; strength: 'suggest'|'recommend'|'require'|'block'; params: Record<string, unknown>; priority: number; }
export interface QIContext { industry: string; mood: string; platform: string; renderMode: string; recentFingerprints: string[]; tasteProfile: any; benchmarkBaseline: number; allCandidates: QICandidate[]; }
interface QIEngine { id: string; phase: string; evaluate(c: QICandidate, ctx: QIContext): { score: QIScore; directives: QIDirective[] }; }

// Category profiles
const CP: Record<string, { elegance: number; conversion: number; energy: number; densityMax: number; persuasion: string; typography: number }> = {
  luxury: { elegance: 0.9, conversion: 0.3, energy: 0.3, densityMax: 0.25, persuasion: 'aspiration', typography: 0.95 },
  fashion: { elegance: 0.8, conversion: 0.4, energy: 0.6, densityMax: 0.4, persuasion: 'desire', typography: 0.85 },
  ecommerce: { elegance: 0.4, conversion: 0.9, energy: 0.7, densityMax: 0.65, persuasion: 'urgency', typography: 0.7 },
  saas: { elegance: 0.6, conversion: 0.7, energy: 0.4, densityMax: 0.35, persuasion: 'trust', typography: 0.85 },
  finance: { elegance: 0.7, conversion: 0.5, energy: 0.25, densityMax: 0.3, persuasion: 'trust', typography: 0.9 },
  entertainment: { elegance: 0.5, conversion: 0.5, energy: 0.85, densityMax: 0.6, persuasion: 'excitement', typography: 0.7 },
  food: { elegance: 0.5, conversion: 0.6, energy: 0.65, densityMax: 0.55, persuasion: 'appetite', typography: 0.75 },
  health: { elegance: 0.6, conversion: 0.5, energy: 0.35, densityMax: 0.3, persuasion: 'reassurance', typography: 0.85 },
  tech: { elegance: 0.6, conversion: 0.6, energy: 0.5, densityMax: 0.4, persuasion: 'innovation', typography: 0.8 },
  general: { elegance: 0.5, conversion: 0.5, energy: 0.5, densityMax: 0.45, persuasion: 'balanced', typography: 0.8 },
};
function gp(ind: string) { const l = (ind||'').toLowerCase(); for (const [k,v] of Object.entries(CP)) { if (l.includes(k)) return v; } return CP.general; }

// Helper: scene metrics
function sm(scenes: any[]) {
  const n = Math.max(1, scenes.length);
  let focal=0, clutter=0, spacing=0, typ=0, comp=0, memo=0, emotion=0, pacing=0, elements=0, textLen=0;
  for (const s of scenes) {
    focal += (s.depthLayers||[]).length >= 2 ? 0.8 : 0.4;
    const elCount = (s.depthLayers||[]).reduce((a:number,l:any)=>a+(l.elements?.length||0),0);
    elements += elCount; clutter += Math.min(1, elCount/15);
    const tl = (s.onScreenText||'').length; textLen += tl;
    spacing += tl > 0 && tl <= 50 ? 0.8 : tl > 50 ? 0.4 : 0.6;
    typ += (s.qualityTarget||60) > 70 ? 0.8 : 0.5;
    comp += (s.emotionTarget||0.5) > 0.5 ? 0.7 : 0.5;
    memo += s.role==='hook' ? 0.8 : s.role==='cta' ? 0.75 : 0.55;
    emotion += s.emotionTarget || 0.5; pacing += s.pacingBpm || 100;
  }
  return { n, focal:focal/n, clutter:clutter/n, spacing:spacing/n, typ:typ/n, comp:comp/n, memo:memo/n,
    avgEmotion:emotion/n, avgPacing:pacing/n, avgElements:elements/n, avgTextLen:textLen/n };
}

// 1. Aesthetic Reward Model
const aestheticReward: QIEngine = { id:'aesthetic_reward', phase:'scoring',
  evaluate(c,ctx) {
    const p=gp(ctx.industry), m=sm(c.scenes), dirs: QIDirective[]=[];
    const taste = Math.round((m.focal*0.2+(1-m.clutter)*0.15+m.spacing*0.15+m.typ*0.15+m.comp*0.15+m.memo*0.2)*100);
    if (taste<60) dirs.push({engineId:'aesthetic_reward',target:'composition',action:'elevate_perceived_quality',strength:'recommend',params:{taste},priority:80});
    if (m.clutter>p.densityMax) dirs.push({engineId:'aesthetic_reward',target:'density',action:'reduce_clutter',strength:'recommend',params:{clutter:m.clutter,max:p.densityMax},priority:75});
    return {score:{engineId:'aesthetic_reward',score:taste,subScores:{focal:Math.round(m.focal*100),clutter:Math.round(m.clutter*100),spacing:Math.round(m.spacing*100),typ:Math.round(m.typ*100),comp:Math.round(m.comp*100),memo:Math.round(m.memo*100)},rationale:taste>=70?`Premium (${taste})`:`Needs elevation (${taste})`,confidence:0.78},directives:dirs};
  }
};

// 2. Multi-Candidate Search
export interface CandidateVariation { id: string; type: string; description: string; mutations: Record<string, unknown>; }
export function generateVariations(base: QICandidate, ctx: QIContext, max=4): CandidateVariation[] {
  const p=gp(ctx.industry), v: CandidateVariation[]=[];
  // Variation 1: Layout divergence — shifts composition weight, widens spacing
  v.push({id:`${base.id}_layout`,type:'layout',description:'Shifted composition with increased breathing room',
    mutations:{compositionShift:'right_heavy',spacingAdjust:1.15,paddingBoost:0.05}});
  // Variation 2: Focal hierarchy boost — stronger headline, reduced body, sharper contrast
  v.push({id:`${base.id}_focal`,type:'focal',description:'Aggressive focal hierarchy with contrast push',
    mutations:{headlineScale:1.2,bodyScale:0.85,contrastBoost:0.12,qualityBoost:5}});
  // Variation 3: Energy/motion — conditional on category energy target
  if(p.energy>0.4) v.push({id:`${base.id}_energy`,type:'motion',description:'Dynamic energy variant with faster pacing and camera motion',
    mutations:{pacingMultiplier:1.25,motionIntensity:1.2,emotionBoost:0.08,cameraUpgrade:true}});
  // Variation 4: CTA-forward — conditional on conversion weight
  if(p.conversion>0.5) v.push({id:`${base.id}_cta`,type:'cta',description:'Conversion-optimized with prominent CTA and urgency signals',
    mutations:{ctaScale:1.3,urgencyBoost:true,ctaEmotionBoost:0.15,ctaQualityBoost:12}});
  // Variation 5: Premium restraint — for luxury/finance/health categories
  if(p.elegance>0.6) v.push({id:`${base.id}_premium`,type:'density',description:'Premium minimal variant with reduced density and elevated polish',
    mutations:{densityReduction:0.7,qualityBoost:8,spacingAdjust:1.2,emotionDampen:0.05}});
  // Variation 6: Freshness push — uses recent fingerprints to diverge
  if((ctx.recentFingerprints||[]).length>2) v.push({id:`${base.id}_fresh`,type:'freshness',description:'Forced creative divergence from recent outputs',
    mutations:{pacingMultiplier:0.85,emotionShift:0.12,cameraSwap:true,layoutFlip:true}});
  return v.slice(0,max);
}
const multiCandidate: QIEngine = { id:'multi_candidate_search', phase:'generation',
  evaluate(c,ctx) {
    const v=generateVariations(c,ctx);
    return {score:{engineId:'multi_candidate_search',score:85,subScores:{poolSize:v.length+1},rationale:`${v.length} variations generated`,confidence:0.9},
      directives:[{engineId:'multi_candidate_search',target:'pipeline',action:'generate_pool',strength:'require',params:{variations:v,poolSize:v.length+1},priority:95}]};
  }
};

// 3. Attention/Focal Hierarchy
const attentionFocal: QIEngine = { id:'attention_focal', phase:'scoring',
  evaluate(c,ctx) {
    const dirs: QIDirective[]=[]; let focalScore=0;
    for(const s of c.scenes){const h=(s.onScreenText||'').length>0,p=/product|hero|brand/.test((s.visualDirection||'').toLowerCase()),ct=s.role==='cta';
      focalScore+=[h,p,ct].filter(Boolean).length>=2?0.8:0.6;}
    const score=Math.round(focalScore/Math.max(1,c.scenes.length)*100);
    if(score<65) dirs.push({engineId:'attention_focal',target:'hierarchy',action:'establish_focal_sequence',strength:'recommend',params:{score},priority:78});
    return {score:{engineId:'attention_focal',score,subScores:{avgFocal:score},rationale:score>=70?`Clear hierarchy (${score})`:`Weak focal (${score})`,confidence:0.8},directives:dirs};
  }
};

// 4. Commercial Persuasion
const commercialPersuasion: QIEngine = { id:'commercial_persuasion', phase:'scoring',
  evaluate(c,ctx) {
    const p=gp(ctx.industry), dirs: QIDirective[]=[], ss=c.scenes;
    const hasHook=ss.some(s=>s.role==='hook'), hasCta=ss.some(s=>s.role==='cta'), hasProof=ss.some(s=>s.role==='proof'||s.role==='testimonial');
    const hookStr=hasHook?0.8:0.3, ctaStr=hasCta?0.85:0.2, proofStr=hasProof?0.75:0.4;
    const score=Math.round((hookStr*0.3+ctaStr*0.3+proofStr*0.2+0.5*0.2)*100*p.conversion+(1-p.conversion)*50);
    if(!hasCta) dirs.push({engineId:'commercial_persuasion',target:'content',action:'add_cta',strength:'require',params:{reason:'No CTA scene'},priority:90});
    if(!hasHook) dirs.push({engineId:'commercial_persuasion',target:'content',action:'strengthen_hook',strength:'recommend',params:{reason:'No hook scene — opening impact will be weak',emotionBoost:0.12,qualityBoost:8},priority:85});
    return {score:{engineId:'commercial_persuasion',score,subScores:{hook:Math.round(hookStr*100),cta:Math.round(ctaStr*100),proof:Math.round(proofStr*100)},rationale:`Persuasion ${score} (${p.persuasion})`,confidence:0.77},directives:dirs};
  }
};

// 5. Semantic Coherence
const semanticCoherence: QIEngine = { id:'semantic_coherence', phase:'scoring',
  evaluate(c,ctx) {
    const dirs: QIDirective[]=[], ss=c.scenes; let moodCon=0,paceCon=0;
    const roles=ss.map(s=>s.role), hasProg=roles.includes('hook')&&(roles.includes('cta')||roles.includes('close'));
    for(let i=1;i<ss.length;i++){moodCon+=Math.abs(ss[i].emotionTarget-ss[i-1].emotionTarget)<0.3?1:0;paceCon+=Math.abs(ss[i].pacingBpm-ss[i-1].pacingBpm)<30?1:0;}
    const n=Math.max(1,ss.length-1), score=Math.round(((moodCon/n)*0.35+(paceCon/n)*0.3+(hasProg?0.85:0.4)*0.35)*100);
    if(score<60) dirs.push({engineId:'semantic_coherence',target:'scene_structure',action:'enforce_semantic_unity',strength:'recommend',params:{score},priority:72});
    return {score:{engineId:'semantic_coherence',score,subScores:{mood:Math.round(moodCon/n*100),pacing:Math.round(paceCon/n*100),progression:hasProg?100:40},rationale:`Coherence ${score}`,confidence:0.75},directives:dirs};
  }
};

// 6. Temporal Beauty
const temporalBeauty: QIEngine = { id:'temporal_beauty', phase:'refinement',
  evaluate(c,ctx) {
    const p=gp(ctx.industry), dirs: QIDirective[]=[]; let pacing=0,reveal=0,rhythm=0;
    for(const s of c.scenes){const ideal=p.energy*140+60;pacing+=1-Math.min(1,Math.abs(s.pacingBpm-ideal)/80);reveal+=s.durationSec>=2&&s.durationSec<=8?0.8:0.4;rhythm+=s.transitionIn!=='cut'?0.7:0.4;}
    const n=Math.max(1,c.scenes.length), score=Math.round(((pacing/n)*0.4+(reveal/n)*0.3+(rhythm/n)*0.3)*100);
    if(score<65) dirs.push({engineId:'temporal_beauty',target:'motion',action:'refine_temporal_rhythm',strength:'suggest',params:{score},priority:60});
    return {score:{engineId:'temporal_beauty',score,subScores:{pacing:Math.round(pacing/n*100),reveal:Math.round(reveal/n*100),rhythm:Math.round(rhythm/n*100)},rationale:`Temporal ${score}`,confidence:0.72},directives:dirs};
  }
};

// 7. Frame Stability
const frameStability: QIEngine = { id:'frame_stability', phase:'refinement',
  evaluate(c,ctx) {
    let s=80; for(const sc of c.scenes){if(sc.pacingBpm>140)s-=5;if((sc.depthLayers||[]).length>5)s-=3;if(sc.durationSec<2)s-=4;}
    s=Math.max(0,Math.min(100,s)); const dirs: QIDirective[]=[];
    if(s<70) dirs.push({engineId:'frame_stability',target:'motion',action:'apply_stability_refinement',strength:'recommend',params:{s},priority:68});
    return {score:{engineId:'frame_stability',score:s,subScores:{},rationale:`Stability ${s}`,confidence:0.7},directives:dirs};
  }
};

// 8. Premium Lighting/Depth
const premiumLighting: QIEngine = { id:'premium_lighting', phase:'refinement',
  evaluate(c,ctx) {
    let d=0; for(const s of c.scenes){d+=(s.depthLayers||[]).length>=2&&(s.depthLayers||[]).some((l:any)=>l.blurRadius>0)?0.8:0.4;}
    const score=Math.round(d/Math.max(1,c.scenes.length)*100), dirs: QIDirective[]=[];
    if(score<60) dirs.push({engineId:'premium_lighting',target:'composition',action:'enhance_depth',strength:'suggest',params:{score},priority:55});
    return {score:{engineId:'premium_lighting',score,subScores:{depth:score},rationale:`Depth ${score}`,confidence:0.7},directives:dirs};
  }
};

// 9. Ugliness Detector (BLOCKING)
const uglinessDetector: QIEngine = { id:'ugliness_detector', phase:'blocking',
  evaluate(c,ctx) {
    let signals=0; for(const s of c.scenes){if((s.onScreenText||'').length>100)signals++;if(!(s.depthLayers||[]).length)signals++;if((s.qualityTarget||60)<50)signals++;if((s.emotionTarget||0.5)<0.2&&s.role==='hook')signals+=2;}
    const n=Math.max(1,c.scenes.length), ratio=Math.min(1,signals/(n*3)), score=Math.round((1-ratio)*100), dirs: QIDirective[]=[];
    if(score<40) dirs.push({engineId:'ugliness_detector',target:'overall',action:'block_output',strength:'block',params:{score,signals},priority:98});
    else if(score<60) dirs.push({engineId:'ugliness_detector',target:'overall',action:'flag_mediocre',strength:'recommend',params:{score},priority:82});
    return {score:{engineId:'ugliness_detector',score,subScores:{signals,ratio:Math.round(ratio*100)},rationale:score>=70?`Clean (${score})`:`Ugly signals (${score})`,confidence:0.82},directives:dirs};
  }
};

// 10. Cross-Freshness
const crossFreshness: QIEngine = { id:'cross_freshness', phase:'scoring',
  evaluate(c,ctx) {
    const fps=ctx.recentFingerprints||[], thisFp=c.scenes.map(s=>`${s.role}_${s.cameraMove}_${Math.round((s.emotionTarget||0.5)*10)}`).join('|');
    const similar=fps.filter(fp=>{const ov=fp.split('|').filter((p:string)=>thisFp.includes(p)).length;return ov>thisFp.split('|').length*0.6;}).length;
    const score=Math.max(0,100-similar*20), dirs: QIDirective[]=[];
    if(score<60) dirs.push({engineId:'cross_freshness',target:'overall',action:'increase_divergence',strength:'recommend',params:{score,similar},priority:70});
    return {score:{engineId:'cross_freshness',score,subScores:{similar},rationale:`Freshness ${score}`,confidence:0.73},directives:dirs};
  }
};

// 11. Taste Memory
const tasteMemory: QIEngine = { id:'taste_memory', phase:'scoring',
  evaluate(c,ctx) {
    if(!ctx.tasteProfile || !ctx.tasteProfile.sampleCount) return {score:{engineId:'taste_memory',score:70,subScores:{sampleCount:0},rationale:'Seeded defaults — no learned preference yet',confidence:0.4},directives:[]};
    const t=ctx.tasteProfile, m=sm(c.scenes);
    const energyFit=1-Math.abs(m.avgEmotion-t.preferredEnergy), qualFit=Math.min(1,m.typ/t.preferredPolish);
    const score=Math.round((energyFit*0.5+qualFit*0.5)*100), dirs: QIDirective[]=[];
    if(score<55) dirs.push({engineId:'taste_memory',target:'overall',action:'adjust_toward_taste',strength:'suggest',params:{score,pref:t},priority:55});
    return {score:{engineId:'taste_memory',score,subScores:{energyFit:Math.round(energyFit*100),qualFit:Math.round(qualFit*100)},rationale:`Taste alignment ${score}`,confidence:0.65},directives:dirs};
  }
};

// 12. Benchmark Arena (BLOCKING)
const benchmarkArena: QIEngine = { id:'benchmark_arena', phase:'blocking',
  evaluate(c,ctx) {
    const baseline=ctx.benchmarkBaseline||60;
    // Use weighted composite from scored engines (not raw composite which may be 0 during first pass)
    const scoredAvg=Object.values(c.scores).reduce((s,q)=>s+(q?.score||0),0)/Math.max(1,Object.keys(c.scores).length);
    const effectiveScore=c.composite>0?c.composite:scoredAvg;
    const delta=effectiveScore-baseline, score=Math.round(Math.min(100,Math.max(0,50+delta*2))), dirs: QIDirective[]=[];
    if(score<45) dirs.push({engineId:'benchmark_arena',target:'overall',action:'reject_below_benchmark',strength:'block',params:{score,baseline},priority:95});
    return {score:{engineId:'benchmark_arena',score,subScores:{delta,baseline},rationale:`Benchmark ${delta>=0?'above':'below'} by ${Math.abs(Math.round(delta))}`,confidence:0.8},directives:dirs};
  }
};

// 13. Category Excellence
const categoryExcellence: QIEngine = { id:'category_excellence', phase:'scoring',
  evaluate(c,ctx) {
    const p=gp(ctx.industry), m=sm(c.scenes), energyFit=1-Math.abs(m.avgEmotion-p.energy)*2;
    const hasCta=c.scenes.some(s=>s.role==='cta'), convFit=hasCta?p.conversion:p.conversion*0.3;
    const score=Math.round(Math.max(0,Math.min(100,(energyFit*0.4+p.elegance*0.3+convFit*0.3)*100))), dirs: QIDirective[]=[];
    if(score<60) dirs.push({engineId:'category_excellence',target:'overall',action:'apply_category_refinement',strength:'recommend',params:{industry:ctx.industry,score},priority:65});
    return {score:{engineId:'category_excellence',score,subScores:{energyFit:Math.round(energyFit*100),elegance:Math.round(p.elegance*100)},rationale:`Category ${score}`,confidence:0.72},directives:dirs};
  }
};

// 14. High-Speed Refinement
const highSpeedRefinement: QIEngine = { id:'highspeed_refinement', phase:'refinement',
  evaluate(c,ctx) {
    const isTop=ctx.allCandidates.length<=1||ctx.allCandidates.every(x=>x.composite<=c.composite);
    return {score:{engineId:'highspeed_refinement',score:isTop?90:60,subScores:{isTop:isTop?1:0},rationale:isTop?'Full refinement':'Light only',confidence:0.9},
      directives:[{engineId:'highspeed_refinement',target:'pipeline',action:isTop?'deep_refinement':'light_refinement',strength:isTop?'require':'suggest',params:{pass:isTop?'deep':'light'},priority:isTop?88:40}]};
  }
};

// 15. Delight Calibration
const delightCalibration: QIEngine = { id:'delight_calibration', phase:'refinement',
  evaluate(c,ctx) {
    const avg=Object.values(c.scores).reduce((s,q)=>s+(q?.score||0),0)/Math.max(1,Object.keys(c.scores).length), dirs: QIDirective[]=[];
    const boringScore=c.scores['anti_boring']?.score||70; // cross-ref: if anti-boring flagged blandness, delight becomes more important
    const delightThreshold=boringScore<60?55:65; // lower threshold when output is bland
    if(avg>=delightThreshold){const types=['elegant_reveal','perfect_crop','beautiful_text','satisfying_loop','premium_accent'];
      dirs.push({engineId:'delight_calibration',target:'composition',action:`apply_delight_${types[Math.abs(c.id.charCodeAt(0)-48)%types.length]}`,strength:'suggest',params:{baseQuality:avg},priority:50});}
    return {score:{engineId:'delight_calibration',score:avg>=65?80:55,subScores:{base:Math.round(avg)},rationale:avg>=65?'Delight injected':'Base too low',confidence:0.68},directives:dirs};
  }
};

// 16. Anti-Boring (BLOCKING)
const antiBoring: QIEngine = { id:'anti_boring', phase:'blocking',
  evaluate(c,ctx) {
    let flat=0; for(const s of c.scenes){if((s.emotionTarget||0.5)<0.4&&(s.emotionTarget||0.5)>0.25)flat++;if(s.pacingBpm>=85&&s.pacingBpm<=105)flat++;if(s.cameraMove==='static_lock')flat++;}
    const n=Math.max(1,c.scenes.length), ratio=Math.min(1,flat/(n*2.5)), score=Math.round((1-ratio)*100), dirs: QIDirective[]=[];
    if(score<55) dirs.push({engineId:'anti_boring',target:'overall',action:'inject_energy',strength:'recommend',params:{score,flat},priority:74});
    return {score:{engineId:'anti_boring',score,subScores:{flat,ratio:Math.round(ratio*100)},rationale:score>=65?`Engaging (${score})`:`Bland (${score})`,confidence:0.75},directives:dirs};
  }
};

// ═══════════ COORDINATOR ═══════════
const ALL_QI: QIEngine[] = [multiCandidate,aestheticReward,attentionFocal,commercialPersuasion,semanticCoherence,crossFreshness,tasteMemory,categoryExcellence,temporalBeauty,frameStability,premiumLighting,highSpeedRefinement,delightCalibration,uglinessDetector,benchmarkArena,antiBoring];
const QI_W: Record<string,number> = {aesthetic_reward:0.12,multi_candidate_search:0.03,attention_focal:0.10,commercial_persuasion:0.10,semantic_coherence:0.08,temporal_beauty:0.07,frame_stability:0.06,premium_lighting:0.05,ugliness_detector:0.09,cross_freshness:0.05,taste_memory:0.04,benchmark_arena:0.06,category_excellence:0.06,highspeed_refinement:0.03,delight_calibration:0.03,anti_boring:0.03};

export function evaluateQI(candidates: QICandidate[], ctx: QIContext): {ranked: QICandidate[]; blocked: QICandidate[]; blockReasons: string[]} {
  const blocked: QICandidate[]=[], blockReasons: string[]=[];
  for(const c of candidates){
    for(const eng of ALL_QI){try{const r=eng.evaluate(c,{...ctx,allCandidates:candidates});c.scores[eng.id]=r.score;c.directives.push(...r.directives);}catch(e:any){logger.warn(`[QI] ${eng.id} failed: ${e.message}`);}}
    let ws=0,wt=0; for(const[eid,w] of Object.entries(QI_W)){const s=c.scores[eid];if(s){ws+=s.score*w;wt+=w;}} c.composite=wt>0?Math.round(ws/wt):50;
    if(c.directives.some(d=>d.strength==='block')){blocked.push(c);blockReasons.push(...c.directives.filter(d=>d.strength==='block').map(d=>`${d.engineId}: ${d.params.reason||d.action}`));}
  }
  const viable=candidates.filter(c=>!blocked.includes(c)).sort((a,b)=>b.composite-a.composite);
  logger.info(`[QI] ${candidates.length} candidates: ${viable.length} viable, ${blocked.length} blocked`);
  return {ranked:viable,blocked,blockReasons};
}

export function createQICandidate(id: string, scenes: any[], intent: any): QICandidate {
  return {id,scenes,intent,scores:{},directives:[],composite:0,meta:{}};
}
