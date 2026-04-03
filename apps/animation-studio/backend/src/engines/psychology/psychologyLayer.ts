/**
 * Psychology & Perception Layer — 14 Active Engines
 * Each engine actively shapes candidates via scored directives.
 */
import { logger } from '../../config/logger';

export interface PSCandidate { id: string; scenes: any[]; intent: any; scores: Record<string, PSScore>; directives: PSDirective[]; composite: number; meta: Record<string, unknown>; }
export interface PSScore { engineId: string; score: number; subScores: Record<string, number>; rationale: string; confidence: number; }
export interface PSDirective { engineId: string; target: string; action: string; strength: 'suggest'|'recommend'|'require'; params: Record<string, unknown>; priority: number; }
export interface PSContext { industry: string; mood: string; platform: string; regenHistory: any[]; sessionFps: any[]; allCandidates: PSCandidate[]; }
interface PSEngine { id: string; phase: string; evaluate(c: PSCandidate, ctx: PSContext): { score: PSScore; directives: PSDirective[] }; }

// Category sensitivity
const CS: Record<string,{risk:number;density:number;surprise:number;confFloor:number;compress:number;emotion:number}> = {
  luxury:{risk:0.3,density:0.25,surprise:0.4,confFloor:80,compress:0.7,emotion:0.5},
  fashion:{risk:0.6,density:0.4,surprise:0.6,confFloor:65,compress:0.55,emotion:0.7},
  ecommerce:{risk:0.55,density:0.65,surprise:0.4,confFloor:60,compress:0.75,emotion:0.7},
  saas:{risk:0.3,density:0.35,surprise:0.35,confFloor:72,compress:0.65,emotion:0.5},
  finance:{risk:0.2,density:0.3,surprise:0.2,confFloor:82,compress:0.7,emotion:0.4},
  entertainment:{risk:0.7,density:0.6,surprise:0.7,confFloor:55,compress:0.5,emotion:0.9},
  general:{risk:0.4,density:0.45,surprise:0.4,confFloor:68,compress:0.65,emotion:0.6},
};
function gs(ind:string){const l=(ind||'').toLowerCase();for(const[k,v]of Object.entries(CS)){if(l.includes(k))return v;}return CS.general;}

// Emotion profiles
const EP: Record<string,{color:number;spacing:number;sharp:number;vel:number;density:number;warmth:number}> = {
  Luxury:{color:0.4,spacing:0.8,sharp:0.6,vel:0.3,density:0.25,warmth:0.5},
  Energetic:{color:0.85,spacing:0.35,sharp:0.8,vel:0.85,density:0.6,warmth:0.7},
  Minimal:{color:0.2,spacing:0.9,sharp:0.5,vel:0.2,density:0.15,warmth:0.4},
  Cinematic:{color:0.6,spacing:0.6,sharp:0.7,vel:0.5,density:0.45,warmth:0.4},
  Playful:{color:0.8,spacing:0.5,sharp:0.4,vel:0.7,density:0.5,warmth:0.8},
  Corporate:{color:0.35,spacing:0.7,sharp:0.6,vel:0.3,density:0.35,warmth:0.35},
  Bold:{color:0.75,spacing:0.4,sharp:0.9,vel:0.6,density:0.55,warmth:0.5},
  Calm:{color:0.25,spacing:0.85,sharp:0.35,vel:0.15,density:0.2,warmth:0.6},
  Tech:{color:0.55,spacing:0.55,sharp:0.7,vel:0.5,density:0.4,warmth:0.3},
};

// 1. Creative Risk
const creativeRisk: PSEngine = {id:'creative_risk',phase:'early',evaluate(c,ctx){
  const s=gs(ctx.industry),dirs:PSDirective[]=[]; let timid=0;
  for(const sc of c.scenes){const cb=`${sc.prompt||''} ${sc.visualDirection||''}`.toLowerCase();
    if(/subtle|soft|gentle|muted/.test(cb))timid+=0.15;if(!/bold|dramatic|striking|intense/.test(cb))timid+=0.1;if((sc.emotionTarget||0.5)<0.5)timid+=0.1;}
  timid=Math.min(1,timid/Math.max(1,c.scenes.length));
  if(timid>(1-s.risk)){dirs.push({engineId:'creative_risk',target:'contrast',action:'increase_contrast',strength:timid>0.7?'recommend':'suggest',params:{timid,budget:s.risk},priority:75});
    dirs.push({engineId:'creative_risk',target:'hierarchy',action:'strengthen_hierarchy',strength:'recommend',params:{timid},priority:70});}
  const bold=1-timid,dist=Math.abs(bold-s.risk),score=Math.round(Math.max(0,100-dist*120));
  return {score:{engineId:'creative_risk',score,subScores:{timid:Math.round(timid*100),bold:Math.round(bold*100)},rationale:timid>0.6?`Too cautious (${score})`:`Appropriate (${score})`,confidence:0.78},directives:dirs};
}};

// 2. First Impression
const firstImpression: PSEngine = {id:'first_impression',phase:'early',evaluate(c,ctx){
  const dirs:PSDirective[]=[],hook=c.scenes.find((s:any)=>s.role==='hook')||c.scenes[0];
  if(!hook)return{score:{engineId:'first_impression',score:50,subScores:{},rationale:'No scenes',confidence:0.5},directives:[]};
  const wc=(hook.onScreenText||'').split(/\s+/).filter(Boolean).length;
  const clarity=wc<=5?0.9:wc<=8?0.75:wc<=12?0.55:0.3,punch=(hook.emotionTarget||0.5)>0.7?0.8:(hook.emotionTarget||0.5)>0.5?0.65:0.4;
  const score=Math.round((clarity*0.5+punch*0.5)*100);
  if(score<65){if(clarity<0.6)dirs.push({engineId:'first_impression',target:'content',action:'shorten_hook_text',strength:'recommend',params:{wc,maxWords:6},priority:85});
    if(punch<0.55)dirs.push({engineId:'first_impression',target:'contrast',action:'boost_opening_contrast',strength:'recommend',params:{boost:0.15},priority:80});}
  return {score:{engineId:'first_impression',score,subScores:{clarity:Math.round(clarity*100),punch:Math.round(punch*100)},rationale:score>=70?`Strong (${score})`:`Weak (${score})`,confidence:0.82},directives:dirs};
}};

// 3. Emotional Resonance
const emotionalResonance: PSEngine = {id:'emotional_resonance',phase:'early',evaluate(c,ctx){
  const dirs:PSDirective[]=[],target=EP[ctx.mood]||EP.Corporate;
  const avgE=c.scenes.reduce((s:number,sc:any)=>s+(sc.emotionTarget||0.5),0)/Math.max(1,c.scenes.length);
  let mm=0,mismatched:string[]=[]; if(Math.abs(avgE-target.vel)>0.25){mm+=0.25;mismatched.push('velocity');} if(Math.abs(avgE-target.color)>0.3){mm+=0.2;mismatched.push('colorPressure');}
  let coh=0; for(let i=1;i<c.scenes.length;i++){coh+=Math.abs(c.scenes[i].emotionTarget-c.scenes[i-1].emotionTarget)<0.3?1:0;}
  coh=c.scenes.length>1?coh/(c.scenes.length-1):0.8;
  if(mm>0.2)dirs.push({engineId:'emotional_resonance',target:'emotion',action:'recalibrate_tone',strength:'recommend',params:{mm,mismatched,mood:ctx.mood},priority:72});
  if(coh<0.6)dirs.push({engineId:'emotional_resonance',target:'emotion',action:'stabilize_arc',strength:'recommend',params:{coh},priority:68});
  const score=Math.round((Math.max(0,1-mm)*0.7+coh*0.3)*100);
  return {score:{engineId:'emotional_resonance',score,subScores:{resonance:Math.round((1-mm)*100),coherence:Math.round(coh*100)},rationale:score>=75?`Aligned (${score})`:`Mismatch (${score})`,confidence:0.75},directives:dirs};
}};

// 4. Regeneration Intelligence
const regenIntelligence: PSEngine = {id:'regeneration_intelligence',phase:'early',evaluate(c,ctx){
  const h=ctx.regenHistory||[],dirs:PSDirective[]=[];
  if(!h.length)return{score:{engineId:'regeneration_intelligence',score:80,subScores:{regens:0},rationale:'First gen',confidence:0.4},directives:[]};
  const counts:Record<string,number>={};for(const e of h){counts[e.inferredReason]=(counts[e.inferredReason]||0)+1;}
  const MAP:Record<string,{target:string;action:string}>={too_cluttered:{target:'density',action:'reduce_density'},too_simple:{target:'density',action:'increase_richness'},
    weak_hook:{target:'content',action:'amplify_hook'},wrong_tone:{target:'emotion',action:'recalibrate_tone'},boring:{target:'contrast',action:'increase_boldness'},
    too_similar:{target:'overall',action:'expand_exploration'},weak_cta:{target:'content',action:'strengthen_cta'},brand_mismatch:{target:'branding',action:'tighten_brand'}};
  for(const[reason,count]of Object.entries(counts)){if(count>=2&&MAP[reason]){const m=MAP[reason],str=count/h.length;
    dirs.push({engineId:'regeneration_intelligence',target:m.target,action:m.action,strength:str>0.6?'require':'recommend',params:{reason,count,total:h.length},priority:Math.round(60+str*30)});}}
  const frust=Math.min(1,h.length/8),score=Math.round(Math.max(0,(1-frust*0.4)*80));
  return {score:{engineId:'regeneration_intelligence',score,subScores:{regens:h.length,frustration:Math.round(frust*100)},rationale:`${h.length} regens analyzed`,confidence:Math.min(0.9,0.4+h.length*0.1)},directives:dirs};
}};

// 5. Anti-Overengineering
const antiOvereng: PSEngine = {id:'anti_overengineering',phase:'mid',evaluate(c,ctx){
  const s=gs(ctx.industry),dirs:PSDirective[]=[]; let complexity=0;
  for(const sc of c.scenes){complexity+=(sc.depthLayers||[]).length/8;complexity+=((sc.prompt||'').match(/gradient|shadow|blur|overlay|particle|texture/g)||[]).length/5;}
  complexity=Math.min(1,complexity/Math.max(1,c.scenes.length));
  if(complexity>s.density)dirs.push({engineId:'anti_overengineering',target:'composition',action:'simplify',strength:'recommend',params:{complexity,tolerance:s.density},priority:74});
  const score=Math.round(Math.max(0,1-complexity)*100);
  return {score:{engineId:'anti_overengineering',score,subScores:{complexity:Math.round(complexity*100)},rationale:score>=70?`Restrained (${score})`:`Over-designed (${score})`,confidence:0.76},directives:dirs};
}};

// 6. Scene Identity Lock
const sceneIdentity: PSEngine = {id:'scene_identity_lock',phase:'mid',evaluate(c,ctx){
  const dirs:PSDirective[]=[]; if(c.scenes.length<2)return{score:{engineId:'scene_identity_lock',score:95,subScores:{},rationale:'Single scene',confidence:0.95},directives:[]};
  let ed=0,pd=0,vdSim=0;
  for(let i=1;i<c.scenes.length;i++){
    ed+=Math.abs(c.scenes[i].emotionTarget-c.scenes[i-1].emotionTarget);
    pd+=Math.abs(c.scenes[i].pacingBpm-c.scenes[i-1].pacingBpm);
    // Visual direction similarity: check if visual keywords overlap between consecutive scenes
    const vd1=(c.scenes[i-1].visualDirection||'').toLowerCase().split(/\s+/);
    const vd2=(c.scenes[i].visualDirection||'').toLowerCase().split(/\s+/);
    const overlap=vd1.filter((w:string)=>w.length>3&&vd2.includes(w)).length;
    vdSim+=vd1.length>0?overlap/Math.max(1,vd1.length):0.5;
  }
  const n=c.scenes.length-1,ae=ed/n,ap=pd/n,avdSim=vdSim/n;
  if(ae>0.3)dirs.push({engineId:'scene_identity_lock',target:'emotion',action:'stabilize_scene_arc',strength:'recommend',params:{drift:ae},priority:75});
  if(ap>40)dirs.push({engineId:'scene_identity_lock',target:'motion',action:'smooth_pacing_transitions',strength:'suggest',params:{drift:ap},priority:60});
  if(avdSim<0.15&&c.scenes.length>2)dirs.push({engineId:'scene_identity_lock',target:'scene_structure',action:'enforce_visual_continuity',strength:'recommend',params:{similarity:avdSim},priority:70});
  const coh=Math.max(0,(1-ae*1.2)*(1-ap/250)*(0.5+avdSim*0.5)),score=Math.round(Math.min(100,coh*100));
  return {score:{engineId:'scene_identity_lock',score,subScores:{emotionDrift:Math.round(ae*100),pacingDrift:Math.round(ap),visualSimilarity:Math.round(avdSim*100)},rationale:score>=75?`Cohesive (${score})`:`Drifting (${score})`,confidence:0.8},directives:dirs};
}};

// 7. Surprise Injection
const surprise: PSEngine = {id:'surprise_injection',phase:'late',evaluate(c,ctx){
  const s=gs(ctx.industry),dirs:PSDirective[]=[],avg=Object.values(c.scores).reduce((s,p)=>s+(p?.score||0),0)/Math.max(1,Object.keys(c.scores).length);
  if(avg>=60&&s.surprise>0.25){
    const allTechniques=['asymmetric_framing','elegant_reveal','motion_accent','fresh_crop','type_play','color_moment','depth_emphasis','pace_shift'];
    // Track recently used techniques via session fingerprints to avoid repeats
    const recentMotion=(ctx.sessionFps||[]).slice(-4).map(f=>f.motionStyle);
    const recentLayout=(ctx.sessionFps||[]).slice(-4).map(f=>f.layoutSignature);
    // Filter out techniques that map to recently-used patterns
    const available=allTechniques.filter(t=>{
      if(t==='motion_accent'&&recentMotion.filter(m=>m==='fast').length>2)return false;
      if(t==='asymmetric_framing'&&recentLayout.filter(l=>l.includes('hook')).length>3)return false;
      return true;
    });
    // Select technique based on candidate hash for determinism
    const selected=available[Math.abs(c.id.charCodeAt(0)+c.id.charCodeAt(c.id.length-1))%available.length]||available[0];
    dirs.push({engineId:'surprise_injection',target:'composition',action:`apply_${selected}`,strength:'suggest',
      params:{technique:selected,appetite:s.surprise,poolSize:available.length,recentTracked:recentMotion.length},priority:45});
  }
  return {score:{engineId:'surprise_injection',score:dirs.length>0?80:55,subScores:{base:Math.round(avg),appetite:Math.round(s.surprise*100)},rationale:dirs.length>0?`Surprise: technique applied (${dirs[0]?.params?.technique})`:'No surprise — base too low or appetite too low',confidence:0.7},directives:dirs};
}};

// 8. Balance Engine
const balance: PSEngine = {id:'balance_engine',phase:'mid',evaluate(c,ctx){
  const dirs:PSDirective[]=[]; let tb=0;
  for(const sc of c.scenes){let tW=0,bW=0,lW=0,rW=0;
    for(const l of(sc.depthLayers||[])){for(const e of(l.elements||[])){const w=(e.opacity||1)*((e.position?.width||0.3)*(e.position?.height||0.3));
      if((e.position?.y||0.5)<0.5)tW+=w;else bW+=w;if((e.position?.x||0.5)<0.5)lW+=w;else rW+=w;}}
    const vb=1-Math.abs(tW-bW)/Math.max(0.01,tW+bW),hb=1-Math.abs(lW-rW)/Math.max(0.01,lW+rW);tb+=(vb+hb)/2;}
  const avg=c.scenes.length>0?tb/c.scenes.length:0.7;
  if(avg<0.55)dirs.push({engineId:'balance_engine',target:'composition',action:'redistribute_weight',strength:'recommend',params:{balance:avg},priority:72});
  const score=Math.round(Math.min(100,avg*110));
  return {score:{engineId:'balance_engine',score,subScores:{avg:Math.round(avg*100)},rationale:score>=70?`Balanced (${score})`:`Imbalanced (${score})`,confidence:0.73},directives:dirs};
}};

// 9. Context Compression
const compression: PSEngine = {id:'context_compression',phase:'mid',evaluate(c,ctx){
  const s=gs(ctx.industry),dirs:PSDirective[]=[]; let td=0,cr=0;
  for(const sc of c.scenes){td+=(sc.onScreenText||'').length/200;cr+=(sc.onScreenText||'').split(/\s+/).length<=10?1:0;}
  const n=Math.max(1,c.scenes.length);td=Math.min(1,td/n);cr=cr/n;
  if(td>s.compress)dirs.push({engineId:'context_compression',target:'content',action:'reduce_text_density',strength:'recommend',params:{td,tolerance:s.compress},priority:76});
  const score=Math.round(Math.max(0,1-td*0.5-(1-cr)*0.5)*100);
  return {score:{engineId:'context_compression',score,subScores:{textDensity:Math.round(td*100),clarity:Math.round(cr*100)},rationale:score>=70?`Compressed (${score})`:`Dense (${score})`,confidence:0.77},directives:dirs};
}};

// 10. Creative Confidence
const confidence: PSEngine = {id:'creative_confidence',phase:'late',evaluate(c,ctx){
  const s=gs(ctx.industry),dirs:PSDirective[]=[]; let conf=0;
  for(const sc of c.scenes){conf+=(sc.depthLayers||[]).length>=2?0.2:0.1;conf+=(sc.onScreenText||'').length>0&&(sc.onScreenText||'').length<=40?0.2:0.1;
    conf+=sc.shotType==='close_up'||sc.shotType==='medium'?0.2:0.12;conf+=(sc.emotionTarget||0.5)>0.5?0.18:0.1;}
  const avg=conf/Math.max(1,c.scenes.length),score=Math.round(Math.min(100,avg*130));
  if(score<s.confFloor)dirs.push({engineId:'creative_confidence',target:'hierarchy',action:'strengthen_decisive',strength:'recommend',params:{score,floor:s.confFloor},priority:78});
  return {score:{engineId:'creative_confidence',score,subScores:{avg:Math.round(avg*100)},rationale:score>=75?`Decisive (${score})`:`Hesitant (${score})`,confidence:0.8},directives:dirs};
}};

// 11. Micro-Speed
const microSpeed: PSEngine = {id:'micro_speed',phase:'cross',evaluate(c,ctx){
  return {score:{engineId:'micro_speed',score:85,subScores:{stages:5},rationale:'Progressive feedback configured',confidence:0.9},
    directives:[{engineId:'micro_speed',target:'pipeline',action:'emit_progressive_feedback',strength:'require',params:{stages:[{at:0.1,type:'composition'},{at:0.3,type:'color'},{at:0.5,type:'text'},{at:0.7,type:'motion'},{at:0.9,type:'quality'}]},priority:90}]};
}};

// 12. Output Comparison
const outputComp: PSEngine = {id:'output_comparison',phase:'late',evaluate(c,ctx){
  const dirs:PSDirective[]=[]; if(ctx.allCandidates.length>1){let strongest='overall',sv=0;
    for(const[k,ps]of Object.entries(c.scores)){if(ps&&ps.score>sv){sv=ps.score;strongest=k;}}
    dirs.push({engineId:'output_comparison',target:'overall',action:'attach_label',strength:'suggest',params:{dim:strongest,label:`Best in ${strongest.replace(/_/g,' ')}`},priority:40});}
  return {score:{engineId:'output_comparison',score:80,subScores:{compared:ctx.allCandidates.length},rationale:`Compared ${ctx.allCandidates.length}`,confidence:0.72},directives:dirs};
}};

// 13. Creative Fatigue
const fatigue: PSEngine = {id:'creative_fatigue',phase:'early',evaluate(c,ctx){
  const fps=ctx.sessionFps||[],dirs:PSDirective[]=[]; if(fps.length<2)return{score:{engineId:'creative_fatigue',score:90,subScores:{depth:fps.length},rationale:'Session short',confidence:0.5},directives:[]};
  const lays=fps.slice(-8).map((f:any)=>f.layoutSignature),uL=new Set(lays).size,lr=1-uL/Math.max(1,lays.length);
  const pals=fps.slice(-8).map((f:any)=>f.paletteMood),uP=new Set(pals).size,pr=1-uP/Math.max(1,pals.length);
  const fat=lr*0.5+pr*0.5; if(fat>0.4)dirs.push({engineId:'creative_fatigue',target:'overall',action:'expand_exploration',strength:fat>0.7?'require':'recommend',params:{fat,lr,pr},priority:80});
  const score=Math.round(Math.max(0,1-fat)*100);
  return {score:{engineId:'creative_fatigue',score,subScores:{fatigue:Math.round(fat*100),uniqueLayouts:uL,uniquePalettes:uP},rationale:score>=70?`Fresh (${score})`:`Fatigued (${score})`,confidence:Math.min(0.85,0.5+fps.length*0.05)},directives:dirs};
}};

// 14. Visual Signature
const signature: PSEngine = {id:'visual_signature',phase:'late',evaluate(c,ctx){
  const dirs:PSDirective[]=[];
  const struct=c.scenes.every((s:any)=>(s.depthLayers||[]).length>=2)?0.85:0.5;
  const qual=c.scenes.reduce((s:number,sc:any)=>s+(sc.qualityTarget||60),0)/Math.max(1,c.scenes.length)/100;
  const restScore=(c.scores.anti_overengineering?.score||70)/100;
  const hasCta=c.scenes.some((s:any)=>s.role==='cta')?0.85:0.3;
  const confScore=(c.scores.creative_confidence?.score||65)/100;
  const emotScore=(c.scores.emotional_resonance?.score||65)/100;
  const sig=struct*0.15+qual*0.15+restScore*0.15+hasCta*0.15+confScore*0.2+emotScore*0.2;
  const score=Math.round(Math.min(100,sig*100));
  if(score<65)dirs.push({engineId:'visual_signature',target:'overall',action:'elevate_signature',strength:score<50?'require':'recommend',params:{score},priority:85});
  return {score:{engineId:'visual_signature',score,subScores:{struct:Math.round(struct*100),qual:Math.round(qual*100),restraint:Math.round(restScore*100),cta:Math.round(hasCta*100),conf:Math.round(confScore*100),emot:Math.round(emotScore*100)},rationale:score>=70?`Signature met (${score})`:`Below signature (${score})`,confidence:0.83},directives:dirs};
}};

// ═══════════ COORDINATOR ═══════════
const ALL_PS: PSEngine[]=[creativeRisk,firstImpression,emotionalResonance,regenIntelligence,fatigue,balance,antiOvereng,sceneIdentity,compression,confidence,surprise,outputComp,signature,microSpeed];
const PS_W:Record<string,number>={creative_risk:0.08,first_impression:0.12,emotional_resonance:0.10,regeneration_intelligence:0.06,anti_overengineering:0.08,scene_identity_lock:0.07,surprise_injection:0.04,balance_engine:0.08,context_compression:0.07,creative_confidence:0.09,micro_speed:0.03,output_comparison:0.03,creative_fatigue:0.05,visual_signature:0.10};

export function evaluatePS(candidates: PSCandidate[], ctx: PSContext): {ranked:PSCandidate[];profile:Record<string,number>;directives:PSDirective[]} {
  for(const c of candidates){for(const eng of ALL_PS){try{const r=eng.evaluate(c,{...ctx,allCandidates:candidates});c.scores[eng.id]=r.score;c.directives.push(...r.directives);}catch(e:any){logger.warn(`[PS] ${eng.id} failed: ${e.message}`);}}
    let ws=0,wt=0;for(const[eid,w]of Object.entries(PS_W)){const s=c.scores[eid];if(s){ws+=s.score*w;wt+=w;}}c.composite=wt>0?Math.round(ws/wt):50;}
  const ranked=[...candidates].sort((a,b)=>b.composite-a.composite);const w=ranked[0];
  const profile:Record<string,number>={};for(const[k,ps]of Object.entries(w?.scores||{})){if(ps)profile[k]=ps.score;}profile.composite=w?.composite||0;
  return {ranked,profile,directives:ranked.flatMap(c=>c.directives)};
}

export function createPSCandidate(id:string,scenes:any[],intent:any):PSCandidate{return{id,scenes,intent,scores:{},directives:[],composite:0,meta:{}};}
