"use client";
/**
 * ArkiolEditor v3.0 — All 20 Features Implemented
 */

import React, {
  useState, useRef, useCallback, useEffect, useLayoutEffect, useReducer, useMemo,
} from "react";
import { fitZoom, zoomStepUp, zoomStepDown, clampZoom, ZOOM_MIN, ZOOM_MAX, CANVAS_VIEWPORT_CHROME } from "./CanvasViewport";
import { ExportSizeDialog, computeFitRect, type ExportFit, type ExportFormat } from "./ExportSizeDialog";

export type ElementType = "text" | "image" | "rect" | "ellipse" | "line";
export type BlendMode = "normal"|"multiply"|"screen"|"overlay"|"darken"|"lighten"|"color-dodge"|"color-burn"|"difference"|"exclusion";
export type PinAnchor = "none"|"top-left"|"top-right"|"bottom-left"|"bottom-right"|"top-center"|"bottom-center"|"center-left"|"center-right"|"center";

export interface Shadow { x:number;y:number;blur:number;spread:number;color:string; }
export interface CropRect { x:number;y:number;w:number;h:number; }
export interface Comment { id:string;x:number;y:number;text:string;author:string;resolved:boolean;timestamp:number; }
export interface Page { id:string;name:string;elements:EditorElement[];bgColor:string; }
export interface HistoryEntry { elements:EditorElement[];name:string;timestamp:number; }

export interface EditorElement {
  id:string; type:ElementType;
  x:number; y:number; width:number; height:number;
  rotation:number; zIndex:number; locked:boolean; visible:boolean;
  name?:string; groupId?:string; pinAnchor?:PinAnchor;
  opacity:number; blendMode:BlendMode;
  text?:string; fontSize?:number; fontFamily?:string; fontWeight?:number;
  fontStyle?:"normal"|"italic"; textDecoration?:"none"|"underline"|"line-through";
  color?:string; align?:"left"|"center"|"right"|"justify";
  lineHeight?:number; letterSpacing?:number;
  textShadow?:string; textStroke?:string; autoFit?:boolean;
  textTransform?:"none"|"uppercase"|"lowercase"|"capitalize";
  fill?:string; gradient?:string; stroke?:string;
  strokeWidth?:number; strokeDash?:string; borderRadius?:number; shadow?:Shadow;
  src?:string; objectFit?:"cover"|"contain"|"fill"; flipH?:boolean; flipV?:boolean; crop?:CropRect;
}

interface Guide { id:string; axis:"h"|"v"; pos:number; }

interface EditorState {
  elements:EditorElement[]; selected:Set<string>;
  history:HistoryEntry[]; historyIdx:number;
  guides:Guide[]; snapEnabled:boolean; rulerVisible:boolean; gridVisible:boolean;
  groups:Record<string,string[]>; groupCounter:number;
  canvasW:number; canvasH:number; bgColor:string;
  pages:Page[]; currentPageIdx:number; comments:Comment[];
}

type EditorAction =
  | { type:"SELECT"; ids:string[]; additive?:boolean }
  | { type:"DESELECT_ALL" }
  | { type:"UPDATE_ELEMENTS"; updates:Partial<EditorElement>[]; saveHistory?:boolean; historyName?:string }
  | { type:"ADD_ELEMENT"; element:EditorElement }
  | { type:"DELETE_SELECTED" }
  | { type:"UNDO" } | { type:"REDO" }
  | { type:"TOGGLE_SNAP" } | { type:"TOGGLE_RULER" } | { type:"TOGGLE_GRID" }
  | { type:"ADD_GUIDE"; guide:Guide } | { type:"REMOVE_GUIDE"; id:string }
  | { type:"BRING_FORWARD"; id:string } | { type:"SEND_BACKWARD"; id:string }
  | { type:"BRING_TO_FRONT"; id:string } | { type:"SEND_TO_BACK"; id:string }
  | { type:"GROUP_SELECTED" } | { type:"UNGROUP"; groupId:string }
  | { type:"DUPLICATE_SELECTED" }
  | { type:"SET_ELEMENTS"; elements:EditorElement[]; historyName?:string }
  | { type:"RESIZE_CANVAS"; w:number; h:number; keepRelative?:boolean }
  | { type:"SET_BG"; color:string }
  | { type:"ALIGN"; direction:"left"|"right"|"top"|"bottom"|"centerH"|"centerV" }
  | { type:"DISTRIBUTE"; axis:"h"|"v" }
  | { type:"FLIP"; axis:"h"|"v" }
  | { type:"JUMP_HISTORY"; idx:number }
  | { type:"ADD_PAGE" } | { type:"SWITCH_PAGE"; idx:number }
  | { type:"RENAME_PAGE"; idx:number; name:string } | { type:"DELETE_PAGE"; idx:number }
  | { type:"ADD_COMMENT"; comment:Comment }
  | { type:"UPDATE_COMMENT"; id:string; resolved?:boolean }
  | { type:"DELETE_COMMENT"; id:string }
  | { type:"FIND_REPLACE"; find:string; replace:string };

const MAX_HISTORY=80, SNAP_THRESH=6, RULER_SIZE=20, GRID_SIZE=40;

const GRADIENTS=[
  {label:"Indigo",  v:"linear-gradient(135deg,#7c7ffa 0%,#5558e0 100%)"},
  {label:"Aurora",  v:"linear-gradient(135deg,#22d3ee 0%,#7c7ffa 50%,#f472b6 100%)"},
  {label:"Sunset",  v:"linear-gradient(135deg,#f59e6b 0%,#f472b6 100%)"},
  {label:"Emerald", v:"linear-gradient(135deg,#34d399 0%,#22d3ee 100%)"},
  {label:"Night",   v:"linear-gradient(135deg,#0a0a12 0%,#1a1a2a 100%)"},
  {label:"Gold",    v:"linear-gradient(135deg,#fbbf24 0%,#f59e6b 100%)"},
  {label:"Cosmos",  v:"linear-gradient(135deg,#12121e 0%,#7c7ffa 60%,#f472b6 100%)"},
  {label:"Ice",     v:"linear-gradient(135deg,#dbeafe 0%,#7c7ffa 100%)"},
];

const BLEND_MODES: BlendMode[]=["normal","multiply","screen","overlay","darken","lighten","color-dodge","color-burn","difference","exclusion"];
const FONTS=["Syne","DM Sans","Georgia","Impact","Verdana","Trebuchet MS","Courier New","Times New Roman","Arial Black","Palatino Linotype"];
const STROKE_DASH_PRESETS=[{label:"Solid",value:""},{label:"Dashed",value:"8 4"},{label:"Dotted",value:"2 4"},{label:"Dot-dash",value:"2 4 8 4"},{label:"Long",value:"16 6"}];
const PIN_ANCHORS: PinAnchor[]=["none","top-left","top-right","bottom-left","bottom-right","top-center","bottom-center","center-left","center-right","center"];

const SHORTCUT_LIST=[
  {keys:"Ctrl+Z",desc:"Undo"},
  {keys:"Ctrl+Y / Ctrl+⇧Z",desc:"Redo"},
  {keys:"Ctrl+D",desc:"Duplicate selected"},
  {keys:"Ctrl+A",desc:"Select all"},
  {keys:"Ctrl+C",desc:"Copy elements (cross-session)"},
  {keys:"Ctrl+V",desc:"Paste elements"},
  {keys:"Delete / Backspace",desc:"Delete selected"},
  {keys:"Escape",desc:"Deselect / exit edit"},
  {keys:"Space + Drag",desc:"Pan canvas"},
  {keys:"F or Z",desc:"Zoom to selection"},
  {keys:"Arrow keys",desc:"Nudge 1px (Shift = 10px)"},
  {keys:"Ctrl+Scroll",desc:"Zoom in / out"},
  {keys:"⇧+drag handle",desc:"Proportional resize"},
  {keys:"Double-click text",desc:"Edit text inline"},
  {keys:"Right-click element",desc:"Context menu"},
  {keys:"? or /",desc:"Toggle this shortcuts panel"},
];

const PRESETS=[
  {label:"Instagram Post",w:1080,h:1080},{label:"Instagram Story",w:1080,h:1920},
  {label:"YouTube Thumb",w:1280,h:720},{label:"Presentation",w:1920,h:1080},
  {label:"Facebook Post",w:1200,h:630},{label:"Twitter/X",w:1600,h:900},
  {label:"Business Card",w:1050,h:600},{label:"A4 Poster",w:2480,h:3508},
  {label:"Square Logo",w:1000,h:1000},
];

function uid(){return `el_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;}
function cid(){return `c_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;}
function pid(){return `p_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;}
function cln<T>(v:T):T{return JSON.parse(JSON.stringify(v));}

function hexToRgb(hex:string):[number,number,number]|null{
  const m=hex.replace("#","").match(/.{2}/g);
  if(!m||m.length<3)return null;
  return[parseInt(m[0],16),parseInt(m[1],16),parseInt(m[2],16)];
}
function lum(r:number,g:number,b:number){
  const s=[r,g,b].map(c=>{const v=c/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2];
}
function contrastRatio(h1:string,h2:string){
  const a=hexToRgb(h1),b=hexToRgb(h2);if(!a||!b)return 21;
  const L1=lum(...a),L2=lum(...b);return(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
}
function mkHist(elements:EditorElement[],name="Edit"):HistoryEntry{return{elements:cln(elements),name,timestamp:Date.now()};}


// ─── Reducer ──────────────────────────────────────────────────────────────────

function pushHist(s:EditorState,name="Edit"):Pick<EditorState,"history"|"historyIdx">{
  const h=s.history.slice(0,s.historyIdx+1);
  h.push(mkHist(s.elements,name));
  const sl=h.slice(-MAX_HISTORY);
  return{history:sl,historyIdx:sl.length-1};
}

function syncPage(state:EditorState):EditorState{
  const pages=[...state.pages];
  pages[state.currentPageIdx]={...pages[state.currentPageIdx],elements:state.elements,bgColor:state.bgColor};
  return{...state,pages};
}

function reducer(state:EditorState,action:EditorAction):EditorState{
  switch(action.type){
    case "SELECT":return{...state,selected:new Set(action.additive?[...state.selected,...action.ids]:action.ids)};
    case "DESELECT_ALL":return{...state,selected:new Set()};

    case "UPDATE_ELEMENTS":{
      if(!action.updates.length&&action.saveHistory===true)
        return syncPage({...state,...pushHist(state,action.historyName)});
      const els=state.elements.map(el=>{
        const u=action.updates.find(u=>u.id===el.id);
        if(!u)return el;
        if(el.locked){const{x,y,width,height,...r}=u as any;return{...el,...r};}
        return{...el,...u};
      });
      if(action.saveHistory===false)return syncPage({...state,elements:els});
      return syncPage({...state,elements:els,...pushHist(state,action.historyName??"Edit")});
    }

    case "ADD_ELEMENT":{
      const h=pushHist(state,"Add element");
      return syncPage({...state,elements:[...state.elements,action.element],selected:new Set([action.element.id]),...h});
    }

    case "DELETE_SELECTED":{
      const h=pushHist(state,"Delete");
      const surv=state.elements.filter(e=>!state.selected.has(e.id)||e.locked);
      const ids=new Set(surv.map(e=>e.id));
      const groups:Record<string,string[]>={};
      for(const[gid,mids]of Object.entries(state.groups)){const rem=mids.filter(id=>ids.has(id));if(rem.length)groups[gid]=rem;}
      return syncPage({...state,elements:surv,selected:new Set(),groups,...h});
    }

    case "UNDO":{
      const idx=state.historyIdx-1;if(idx<0)return state;
      return syncPage({...state,elements:cln(state.history[idx]!.elements),historyIdx:idx,selected:new Set<string>()});
    }
    case "REDO":{
      const idx=Math.min(state.history.length-1,state.historyIdx+1);
      if(idx===state.historyIdx)return state;
      return syncPage({...state,elements:cln(state.history[idx]!.elements),historyIdx:idx,selected:new Set<string>()});
    }
    case "JUMP_HISTORY":{
      const idx=Math.max(0,Math.min(state.history.length-1,action.idx));
      return syncPage({...state,elements:cln(state.history[idx]!.elements),historyIdx:idx,selected:new Set<string>()});
    }

    case "TOGGLE_SNAP":return{...state,snapEnabled:!state.snapEnabled};
    case "TOGGLE_RULER":return{...state,rulerVisible:!state.rulerVisible};
    case "TOGGLE_GRID":return{...state,gridVisible:!state.gridVisible};
    case "ADD_GUIDE":return{...state,guides:[...state.guides,action.guide]};
    case "REMOVE_GUIDE":return{...state,guides:state.guides.filter(g=>g.id!==action.id)};

    case "BRING_FORWARD":{
      const el=state.elements.find(e=>e.id===action.id);if(!el)return state;
      const above=state.elements.filter(e=>e.zIndex>el.zIndex).sort((a,b)=>a.zIndex-b.zIndex)[0];
      if(!above)return state;
      return syncPage({...state,...pushHist(state,"Bring forward"),elements:state.elements.map(e=>e.id===el.id?{...e,zIndex:above.zIndex}:e.id===above.id?{...e,zIndex:el.zIndex}:e)});
    }
    case "SEND_BACKWARD":{
      const el=state.elements.find(e=>e.id===action.id);if(!el)return state;
      const below=state.elements.filter(e=>e.zIndex<el.zIndex).sort((a,b)=>b.zIndex-a.zIndex)[0];
      if(!below)return state;
      return syncPage({...state,...pushHist(state,"Send backward"),elements:state.elements.map(e=>e.id===el.id?{...e,zIndex:below.zIndex}:e.id===below.id?{...e,zIndex:el.zIndex}:e)});
    }
    case "BRING_TO_FRONT":{
      const max=Math.max(...state.elements.map(e=>e.zIndex));
      return syncPage({...state,...pushHist(state,"To front"),elements:state.elements.map(e=>e.id===action.id?{...e,zIndex:max+1}:e)});
    }
    case "SEND_TO_BACK":{
      const min=Math.min(...state.elements.map(e=>e.zIndex));
      return syncPage({...state,...pushHist(state,"To back"),elements:state.elements.map(e=>e.id===action.id?{...e,zIndex:min-1}:e)});
    }

    case "GROUP_SELECTED":{
      const groupId=`g_${state.groupCounter+1}`;const ids=[...state.selected];
      return syncPage({...state,...pushHist(state,"Group"),elements:state.elements.map(e=>state.selected.has(e.id)?{...e,groupId}:e),groups:{...state.groups,[groupId]:ids},groupCounter:state.groupCounter+1});
    }
    case "UNGROUP":{
      const els=state.elements.filter(e=>e.groupId===action.groupId);
      const groups={...state.groups};delete groups[action.groupId];
      return syncPage({...state,...pushHist(state,"Ungroup"),elements:state.elements.map(e=>e.groupId===action.groupId?{...e,groupId:undefined}:e),groups,selected:new Set(els.map(e=>e.id))});
    }

    case "DUPLICATE_SELECTED":{
      const ts=Date.now();
      const dupes=state.elements.filter(e=>state.selected.has(e.id)).map((el,i)=>({...cln(el),id:`${el.id}_d${ts}_${i}`,x:el.x+20,y:el.y+20,zIndex:el.zIndex+1,locked:false}));
      return syncPage({...state,...pushHist(state,"Duplicate"),elements:[...state.elements,...dupes],selected:new Set(dupes.map(d=>d.id))});
    }

    case "SET_ELEMENTS":
      return syncPage({...state,elements:cln(action.elements),selected:new Set<string>(),...pushHist(state,action.historyName??"Set elements")});

    case "RESIZE_CANVAS":{
      if(!action.keepRelative)return syncPage({...state,...pushHist(state,"Resize canvas"),canvasW:action.w,canvasH:action.h});
      const sx=action.w/state.canvasW,sy=action.h/state.canvasH;
      const els=state.elements.map(e=>{
        const pin=e.pinAnchor??"none";
        if(pin==="none")return{...e,x:e.x*sx,y:e.y*sy,width:e.width*sx,height:e.height*sy};
        let x=e.x,y=e.y;
        if(pin.includes("right"))x=action.w-(state.canvasW-e.x-e.width)-e.width;
        else if(!pin.includes("center"))x=e.x;
        else x=(action.w-e.width)/2;
        if(pin.includes("bottom"))y=action.h-(state.canvasH-e.y-e.height)-e.height;
        else if(!pin.includes("center"))y=e.y;
        else y=(action.h-e.height)/2;
        if(pin==="center"){x=(action.w-e.width)/2;y=(action.h-e.height)/2;}
        return{...e,x,y};
      });
      return syncPage({...state,...pushHist(state,"Resize canvas"),canvasW:action.w,canvasH:action.h,elements:els});
    }

    case "SET_BG":return syncPage({...state,bgColor:action.color});

    case "ALIGN":{
      const sel=state.elements.filter(e=>state.selected.has(e.id));if(!sel.length)return state;
      let updates:Partial<EditorElement>[]=[];
      if(action.direction==="left")updates=sel.map(e=>({id:e.id,x:Math.min(...sel.map(s=>s.x))}));
      if(action.direction==="right")updates=sel.map(e=>({id:e.id,x:Math.max(...sel.map(s=>s.x+s.width))-e.width}));
      if(action.direction==="top")updates=sel.map(e=>({id:e.id,y:Math.min(...sel.map(s=>s.y))}));
      if(action.direction==="bottom")updates=sel.map(e=>({id:e.id,y:Math.max(...sel.map(s=>s.y+s.height))-e.height}));
      if(action.direction==="centerH"){const avg=sel.reduce((s,e)=>s+e.x+e.width/2,0)/sel.length;updates=sel.map(e=>({id:e.id,x:avg-e.width/2}));}
      if(action.direction==="centerV"){const avg=sel.reduce((s,e)=>s+e.y+e.height/2,0)/sel.length;updates=sel.map(e=>({id:e.id,y:avg-e.height/2}));}
      const els=state.elements.map(el=>{const u=updates.find(u=>u.id===el.id);return u?{...el,...u}:el;});
      return syncPage({...state,...pushHist(state,"Align"),elements:els});
    }

    case "DISTRIBUTE":{
      const sel=[...state.elements.filter(e=>state.selected.has(e.id))];
      if(sel.length<3)return state;
      let els=state.elements;
      if(action.axis==="h"){
        const sorted=[...sel].sort((a,b)=>a.x-b.x);
        const totalW=sorted.reduce((s,e)=>s+e.width,0);
        const span=sorted[sorted.length-1].x+sorted[sorted.length-1].width-sorted[0].x;
        const gap=(span-totalW)/(sorted.length-1);
        let cx=sorted[0].x;
        const updates=sorted.map(e=>{const u={id:e.id,x:cx};cx+=e.width+gap;return u;});
        els=els.map(e=>{const u=updates.find(u=>u.id===e.id);return u?{...e,...u}:e;});
      }else{
        const sorted=[...sel].sort((a,b)=>a.y-b.y);
        const totalH=sorted.reduce((s,e)=>s+e.height,0);
        const span=sorted[sorted.length-1].y+sorted[sorted.length-1].height-sorted[0].y;
        const gap=(span-totalH)/(sorted.length-1);
        let cy=sorted[0].y;
        const updates=sorted.map(e=>{const u={id:e.id,y:cy};cy+=e.height+gap;return u;});
        els=els.map(e=>{const u=updates.find(u=>u.id===e.id);return u?{...e,...u}:e;});
      }
      return syncPage({...state,...pushHist(state,"Distribute"),elements:els});
    }

    case "FLIP":{
      const els=state.elements.map(e=>state.selected.has(e.id)?(action.axis==="h"?{...e,flipH:!e.flipH}:{...e,flipV:!e.flipV}):e);
      return syncPage({...state,...pushHist(state,"Flip"),elements:els});
    }

    case "ADD_PAGE":{
      const newPage:Page={id:pid(),name:`Page ${state.pages.length+1}`,elements:[],bgColor:"#f8f7f4"};
      const pages=[...syncPage(state).pages,newPage];
      return{...state,pages,currentPageIdx:pages.length-1,elements:[],bgColor:"#f8f7f4",selected:new Set(),history:[mkHist([],"Initial")],historyIdx:0};
    }
    case "SWITCH_PAGE":{
      const synced=syncPage(state);const page=synced.pages[action.idx];if(!page)return state;
      return{...synced,currentPageIdx:action.idx,elements:cln(page.elements),bgColor:page.bgColor,selected:new Set(),history:[mkHist(page.elements,"Initial")],historyIdx:0};
    }
    case "RENAME_PAGE":{
      const pages=[...state.pages];pages[action.idx]={...pages[action.idx],name:action.name};
      return{...state,pages};
    }
    case "DELETE_PAGE":{
      if(state.pages.length<=1)return state;
      const synced=syncPage(state);
      const pages=synced.pages.filter((_,i)=>i!==action.idx);
      const newIdx=Math.min(action.idx,pages.length-1);
      const page=pages[newIdx]!;
      return{...synced,pages,currentPageIdx:newIdx,elements:cln(page.elements),bgColor:page.bgColor,selected:new Set(),history:[mkHist(page.elements,"Initial")],historyIdx:0};
    }

    case "ADD_COMMENT":return{...state,comments:[...state.comments,action.comment]};
    case "UPDATE_COMMENT":return{...state,comments:state.comments.map(c=>c.id===action.id?{...c,...action}:c)};
    case "DELETE_COMMENT":return{...state,comments:state.comments.filter(c=>c.id!==action.id)};

    case "FIND_REPLACE":{
      if(!action.find)return state;
      const els=state.elements.map(e=>e.type==="text"&&e.text?{...e,text:e.text.split(action.find).join(action.replace)}:e);
      return syncPage({...state,...pushHist(state,"Find & replace"),elements:els});
    }

    default:return state;
  }
}

// ─── Snap ─────────────────────────────────────────────────────────────────────

function snapEl(moving:{x:number;y:number;w:number;h:number},others:EditorElement[],cW:number,cH:number,guides:Guide[]){
  let{x,y}=moving;let gX:number|undefined,gY:number|undefined;
  const hL=[0,cH/2,cH,...guides.filter(g=>g.axis==="h").map(g=>g.pos)];
  const vL=[0,cW/2,cW,...guides.filter(g=>g.axis==="v").map(g=>g.pos)];
  for(const o of others){hL.push(o.y,o.y+o.height/2,o.y+o.height);vL.push(o.x,o.x+o.width/2,o.x+o.width);}
  for(const[ref,off]of[[y,0],[y+moving.h/2,moving.h/2],[y+moving.h,moving.h]] as[number,number][]){
    for(const l of hL){if(Math.abs(ref-l)<SNAP_THRESH){y=l-off;gY=l;break;}}if(gY!==undefined)break;
  }
  for(const[ref,off]of[[x,0],[x+moving.w/2,moving.w/2],[x+moving.w,moving.w]] as[number,number][]){
    for(const l of vL){if(Math.abs(ref-l)<SNAP_THRESH){x=l-off;gX=l;break;}}if(gX!==undefined)break;
  }
  return{x,y,gX,gY};
}


// ─── Props ────────────────────────────────────────────────────────────────────

export interface ArkiolEditorProps {
  initialElements?:EditorElement[];
  canvasWidth?:number; canvasHeight?:number; canvasBg?:string;
  onSave?:(elements:EditorElement[])=>void;
  readOnly?:boolean; projectId?:string;
  brandKit?:{primaryColor:string;secondaryColor:string;fontDisplay:string;fontBody:string;logoUrl?:string}|null;
  jobId?:string; orgId?:string; userId?:string; format?:string;
}

type HandlePos="nw"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"rot";
const CURSOR2:Record<HandlePos,string>={nw:"nwse-resize",n:"ns-resize",ne:"nesw-resize",e:"ew-resize",se:"nwse-resize",s:"ns-resize",sw:"nesw-resize",w:"ew-resize",rot:"crosshair"};

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ArkiolEditor({
  initialElements=[],canvasWidth=1080,canvasHeight=1080,canvasBg="#f8f7f4",
  onSave,readOnly=false,projectId="default",brandKit=null,userId,format,
}:ArkiolEditorProps){

  const initialPage:Page={id:pid(),name:"Page 1",elements:initialElements,bgColor:canvasBg};

  const[state,dispatch]=useReducer(reducer,{
    elements:initialElements,selected:new Set<string>(),
    history:[mkHist(initialElements,initialElements.length>0?"Generated design":"Blank canvas")],historyIdx:0,
    guides:[],snapEnabled:true,rulerVisible:true,gridVisible:false,
    groups:{},groupCounter:0,canvasW:canvasWidth,canvasH:canvasHeight,bgColor:canvasBg,
    pages:[initialPage],currentPageIdx:0,comments:[],
  });

  const canvasRef=useRef<HTMLDivElement>(null);
  const containerRef=useRef<HTMLDivElement>(null);
  const fileInputRef=useRef<HTMLInputElement>(null);
  const elemRef=useRef(state.elements);
  const lastSaveRef=useRef("");
  const isDragRef=useRef(false);
  const warnTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const saveTimerRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const panRef=useRef<{mx:number;my:number;sx:number;sy:number}|null>(null);

  useEffect(()=>{elemRef.current=state.elements;},[state.elements]);

  const[zoom,setZoom]=useState(()=>fitZoom(canvasWidth,canvasHeight));
  const initialFitDone=useRef(false);

  // Step 26: fit the artboard to the *actual* workspace container size on
  // first mount so different template sizes + different screen sizes all
  // open already centered and fully visible. Key robustness points:
  //   1. Measure after layout via useLayoutEffect (not a window guess).
  //   2. If the container hasn't been sized yet (flex layout not settled,
  //      parent still laying out), retry on the next animation frame
  //      instead of silently giving up — this was the main miss before.
  //   3. Re-run only when canvas dimensions change so user zooming after
  //      the initial fit is preserved.
  useLayoutEffect(()=>{
    initialFitDone.current=false;
    let rafId:number|null=null;
    let attempts=0;
    const tryFit=()=>{
      if(initialFitDone.current)return;
      const el=containerRef.current;
      if(!el){
        if(attempts++<5){rafId=requestAnimationFrame(tryFit);}
        return;
      }
      const rect=el.getBoundingClientRect();
      const availW=rect.width-CANVAS_VIEWPORT_CHROME;
      const availH=rect.height-CANVAS_VIEWPORT_CHROME;
      if(availW<=0||availH<=0){
        // Layout hasn't settled — try again next frame.
        if(attempts++<10){rafId=requestAnimationFrame(tryFit);}
        return;
      }
      initialFitDone.current=true;
      setZoom(fitZoom(canvasWidth,canvasHeight,availW,availH));
    };
    tryFit();
    return()=>{if(rafId!==null)cancelAnimationFrame(rafId);};
  // Re-fit when the artboard size changes (e.g. format switch).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[canvasWidth,canvasHeight]);
  const[editingId,setEditingId]=useState<string|null>(null);
  const[dragging,setDragging]=useState<{id:string;startX:number;startY:number;elX:number;elY:number;origins:{id:string;ox:number;oy:number}[]}|null>(null);
  const[resizing,setResizing]=useState<{id:string;handle:HandlePos;startX:number;startY:number;origX:number;origY:number;origW:number;origH:number}|null>(null);
  const[selecting,setSelecting]=useState<{sx:number;sy:number;cx:number;cy:number}|null>(null);
  const[snapGuide,setSnapGuide]=useState<{x?:number;y?:number}>({});
  const[warnings,setWarnings]=useState<string[]>([]);
  const[autosaveTxt,setAutosaveTxt]=useState("");
  const[crashBanner,setCrashBanner]=useState(false);
  const[tab,setTab]=useState<"layers"|"brand"|"settings">("layers");
  const[rightTab,setRightTab]=useState<"props"|"effects">("props");
  const[showGrad,setShowGrad]=useState(false);
  const[showExport,setShowExport]=useState(false);
  const[exportDialog,setExportDialog]=useState<{format:ExportFormat}|null>(null);
  const[renaming,setRenaming]=useState<string|null>(null);
  const[renameVal,setRenameVal]=useState("");
  const[spaceDown,setSpaceDown]=useState(false);
  const[isPanning,setIsPanning]=useState(false);

  // Feature-specific state
  const[showHistory,setShowHistory]=useState(false);          // #1 History
  const[cropId,setCropId]=useState<string|null>(null);        // #4 Crop
  const[cropRect,setCropRect]=useState<CropRect>({x:0,y:0,w:1,h:1});
  const[commentMode,setCommentMode]=useState(false);           // #10 Comments
  const[activeComment,setActiveComment]=useState<string|null>(null);
  const[newCommentPos,setNewCommentPos]=useState<{x:number;y:number}|null>(null);
  const[newCommentTxt,setNewCommentTxt]=useState("");
  const[showFR,setShowFR]=useState(false);                    // #12 Find/Replace
  const[findTxt,setFindTxt]=useState("");
  const[replaceTxt,setReplaceTxt]=useState("");
  const[showGradEd,setShowGradEd]=useState(false);            // #15 Grad editor
  const[gradAngle,setGradAngle]=useState(135);
  const[gradStops,setGradStops]=useState([{offset:0,color:"#7c7ffa"},{offset:100,color:"#f472b6"}]);
  const[showShortcuts,setShowShortcuts]=useState(false);       // #18 Shortcuts
  const[ctxMenu,setCtxMenu]=useState<{x:number;y:number;elId:string}|null>(null); // #17 Context menu
  const[showTpls,setShowTpls]=useState(false);                // #13 Templates
  const[savedTpls,setSavedTpls]=useState<{name:string;elements:EditorElement[];bg:string}[]>(()=>{
    try{return JSON.parse(localStorage.getItem("ak_tpls")??"[]");}catch{return[];}
  });
  const[layerSearch,setLayerSearch]=useState("");              // #14 Layer search
  const[aiLoading,setAiLoading]=useState<string|null>(null);   // #8 AI text
  const[bgRmLoading,setBgRmLoading]=useState(false);           // #9 AI BG remove
  const[styleBuf,setStyleBuf]=useState<Partial<EditorElement>|null>(null);

  const selEls=useMemo(()=>state.elements.filter(e=>state.selected.has(e.id)),[state.elements,state.selected]);
  const activeEl=selEls.length===1?selEls[0]:null;
  const sorted=useMemo(()=>[...state.elements].sort((a,b)=>a.zIndex-b.zIndex),[state.elements]);

  const toCanvas=useCallback((cx:number,cy:number)=>{
    const r=canvasRef.current?.getBoundingClientRect();
    if(!r)return{x:0,y:0};
    return{x:(cx-r.left)/zoom,y:(cy-r.top)/zoom};
  },[zoom]);

  const buildGradient=useCallback(()=>{
    return `linear-gradient(${gradAngle}deg,${gradStops.map(s=>`${s.color} ${s.offset}%`).join(",")})`;
  },[gradAngle,gradStops]);

  const doFitZoom=useCallback(()=>{
    const el=containerRef.current;
    if(el){const r=el.getBoundingClientRect();setZoom(fitZoom(state.canvasW,state.canvasH,r.width-80,r.height-80));}
    else setZoom(fitZoom(state.canvasW,state.canvasH));
  },[state.canvasW,state.canvasH]);

  // Feature 19: Zoom to selection (F / Z keys)
  const zoomToSel=useCallback(()=>{
    if(!selEls.length)return;
    const minX=Math.min(...selEls.map(e=>e.x)),minY=Math.min(...selEls.map(e=>e.y));
    const maxX=Math.max(...selEls.map(e=>e.x+e.width)),maxY=Math.max(...selEls.map(e=>e.y+e.height));
    const cont=containerRef.current;if(!cont)return;
    const elW=maxX-minX,elH=maxY-minY;if(elW<1||elH<1)return;
    const newZ=clampZoom(Math.min((cont.clientWidth-96)/elW,(cont.clientHeight-96)/elH)*0.85);
    setZoom(newZ);
    setTimeout(()=>{
      const c=canvasRef.current;if(!c)return;
      cont.scrollLeft=(minX+elW/2)*newZ-cont.clientWidth/2;
      cont.scrollTop=(minY+elH/2)*newZ-cont.clientHeight/2;
    },50);
  },[selEls]);

  // Keyboard handler
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const ctrl=e.ctrlKey||e.metaKey;
      const tag=(document.activeElement as HTMLElement)?.tagName;
      if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return;
      if(editingId){if(e.key==="Escape")setEditingId(null);return;}
      if(ctrl&&e.key==="z"&&!e.shiftKey){e.preventDefault();dispatch({type:"UNDO"});}
      if(ctrl&&(e.key==="y"||(e.key==="z"&&e.shiftKey))){e.preventDefault();dispatch({type:"REDO"});}
      if(ctrl&&e.key==="d"){e.preventDefault();dispatch({type:"DUPLICATE_SELECTED"});}
      if(ctrl&&e.key==="a"){e.preventDefault();dispatch({type:"SELECT",ids:state.elements.map(e=>e.id)});}
      // Feature 2: Copy/paste cross-session via localStorage
      if(ctrl&&e.key==="c"&&selEls.length){e.preventDefault();
        try{localStorage.setItem("ak_clipboard",JSON.stringify(selEls));}catch{}
      }
      if(ctrl&&e.key==="v"){e.preventDefault();
        try{const raw=localStorage.getItem("ak_clipboard");
          if(raw){const els:EditorElement[]=JSON.parse(raw);const ts=Date.now();
            els.map((el,i)=>({...cln(el),id:`${el.id}_v${ts}_${i}`,x:el.x+20,y:el.y+20,zIndex:el.zIndex+2,locked:false}))
              .forEach(d=>dispatch({type:"ADD_ELEMENT",element:d}));
          }
        }catch{}
      }
      if((e.key==="Delete"||e.key==="Backspace")&&!editingId)dispatch({type:"DELETE_SELECTED"});
      if(e.key==="Escape"){dispatch({type:"DESELECT_ALL"});setEditingId(null);setCommentMode(false);setCtxMenu(null);}
      if(e.key===" "){e.preventDefault();setSpaceDown(true);}
      if((e.key==="f"||e.key==="z")&&!ctrl){e.preventDefault();zoomToSel();}  // #19
      if(e.key==="?"||e.key==="/")setShowShortcuts(v=>!v);                      // #18
      const nudge=e.shiftKey?10:1;
      const dx=e.key==="ArrowLeft"?-nudge:e.key==="ArrowRight"?nudge:0;
      const dy=e.key==="ArrowUp"?-nudge:e.key==="ArrowDown"?nudge:0;
      if((dx||dy)&&selEls.length){e.preventDefault();dispatch({type:"UPDATE_ELEMENTS",updates:selEls.map(el=>({id:el.id,x:el.x+dx,y:el.y+dy})),saveHistory:false});}
    };
    const onKeyUp=(e:KeyboardEvent)=>{if(e.key===" ")setSpaceDown(false);};
    window.addEventListener("keydown",onKey);window.addEventListener("keyup",onKeyUp);
    return()=>{window.removeEventListener("keydown",onKey);window.removeEventListener("keyup",onKeyUp);};
  },[editingId,selEls,state.elements,zoomToSel]);

  // Wheel zoom
  useEffect(()=>{
    const el=containerRef.current;if(!el)return;
    const onWheel=(e:WheelEvent)=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const f=e.deltaY>0?0.92:1.08;setZoom(z=>clampZoom(z*f));};
    el.addEventListener("wheel",onWheel,{passive:false});
    return()=>el.removeEventListener("wheel",onWheel);
  },[]);

  // ── On mount with initialElements: save a "Generated design" checkpoint ─────
  // This seeds version history so the user always has a baseline to return to.
  // We fire this once, async, after the first render cycle.
  useEffect(()=>{
    if(readOnly||!projectId||initialElements.length===0)return;
    // Small delay so the editor has finished its first render
    const t=setTimeout(async()=>{
      try{
        await fetch("/api/editor/autosave",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            projectId,
            elements:initialElements,
            checkpoint:true,
            label:"Generated design",
          }),
        });
        // Pre-fill lastSaveRef so the autosave loop doesn't immediately re-save
        lastSaveRef.current=JSON.stringify(initialElements);
      }catch{ /* non-fatal — autosave will pick it up */ }
    },1200);
    return()=>clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[projectId]); // run once per projectId

  // Autosave (15-second interval, skips if nothing changed)
  useEffect(()=>{
    if(readOnly)return;
    saveTimerRef.current=setInterval(async()=>{
      const cur=JSON.stringify(elemRef.current);if(cur===lastSaveRef.current)return;
      lastSaveRef.current=cur;setAutosaveTxt("Saving…");
      try{const r=await fetch("/api/editor/autosave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,elements:elemRef.current,checkpoint:false})});setAutosaveTxt(r.ok?"Saved":"Save failed");}
      catch{setAutosaveTxt("Save failed");}
      setTimeout(()=>setAutosaveTxt(""),3000);
    },15000);
    return()=>{if(saveTimerRef.current)clearInterval(saveTimerRef.current);};
  },[readOnly,projectId]);

  // Crash recovery — only show banner if there is a DRAFT (not a checkpoint)
  // AND the draft differs from the initialElements (i.e. was edited before crash)
  useEffect(()=>{
    fetch(`/api/editor/autosave?projectId=${encodeURIComponent(projectId)}`)
      .then(r=>r.json())
      .then(d=>{
        if(!d.hasDraft)return;
        // If initialElements were provided and the draft matches them exactly,
        // don't show the banner — the draft is just the seed, not a user edit.
        if(initialElements.length>0){
          const draftStr=JSON.stringify(d.draft?.elements??[]);
          const initStr=JSON.stringify(initialElements);
          if(draftStr===initStr)return; // same as generated state — not a crash
        }
        setCrashBanner(true);
      })
      .catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[projectId]);

  // Contrast warnings
  useEffect(()=>{
    if(warnTimerRef.current)clearTimeout(warnTimerRef.current);
    warnTimerRef.current=setTimeout(()=>{
      if(isDragRef.current)return;
      const w:string[]=[];
      for(const el of state.elements){
        if(el.type==="text"&&el.text&&el.fontSize){const lines=el.text.split("\n").length;if(lines*(el.fontSize*(el.lineHeight??1.25))>el.height*1.2)w.push(`"${el.text.slice(0,18)}…" may overflow`);}
        if(el.type==="text"&&el.color){
          const bg=state.elements.filter(b=>(b.type==="rect"||b.type==="ellipse")&&b.zIndex<el.zIndex&&b.fill&&b.x<el.x+el.width&&b.x+b.width>el.x&&b.y<el.y+el.height&&b.y+b.height>el.y).sort((a,b)=>b.zIndex-a.zIndex)[0];
          const bgCol=bg?.fill??state.bgColor;
          if(bgCol&&!bgCol.includes("gradient")){const r=contrastRatio(el.color,bgCol);if(r<3)w.push(`Low contrast: "${el.text?.slice(0,12)}" (${r.toFixed(1)}:1)`);}
        }
      }
      setWarnings(w);
    },700);
    return()=>{if(warnTimerRef.current)clearTimeout(warnTimerRef.current);};
  },[state.elements,state.bgColor]);

  const startDrag=useCallback((e:React.MouseEvent,id:string)=>{
    if(readOnly||spaceDown)return;e.stopPropagation();
    const el=state.elements.find(el=>el.id===id);if(!el||el.locked)return;
    if(!state.selected.has(id))dispatch({type:"SELECT",ids:[id],additive:e.shiftKey});
    const pos=toCanvas(e.clientX,e.clientY);
    const eff=state.selected.has(id)?state.selected:new Set([id]);
    const origins=state.elements.filter(e=>eff.has(e.id)&&!e.locked).map(e=>({id:e.id,ox:e.x,oy:e.y}));
    isDragRef.current=true;
    setDragging({id,startX:pos.x,startY:pos.y,elX:el.x,elY:el.y,origins});
  },[readOnly,spaceDown,state.elements,state.selected,toCanvas]);

  const startResize=useCallback((e:React.MouseEvent,id:string,handle:HandlePos)=>{
    if(readOnly)return;e.stopPropagation();
    const el=state.elements.find(el=>el.id===id);if(!el||el.locked)return;
    const pos=toCanvas(e.clientX,e.clientY);
    isDragRef.current=true;
    setResizing({id,handle,startX:pos.x,startY:pos.y,origX:el.x,origY:el.y,origW:el.width,origH:el.height});
  },[readOnly,state.elements,toCanvas]);

  // Feature 6: Canvas pan (Space + drag)
  const onContDown=useCallback((e:React.MouseEvent)=>{
    if(spaceDown&&e.button===0){
      setIsPanning(true);
      panRef.current={mx:e.clientX,my:e.clientY,sx:containerRef.current?.scrollLeft??0,sy:containerRef.current?.scrollTop??0};
      e.preventDefault();
    }
  },[spaceDown]);
  const onContMove=useCallback((e:React.MouseEvent)=>{
    if(isPanning&&panRef.current&&containerRef.current){
      containerRef.current.scrollLeft=panRef.current.sx-(e.clientX-panRef.current.mx);
      containerRef.current.scrollTop=panRef.current.sy-(e.clientY-panRef.current.my);
    }
  },[isPanning]);
  const onContUp=useCallback(()=>{if(isPanning){setIsPanning(false);panRef.current=null;}},[isPanning]);

  const onMouseMove=useCallback((e:React.MouseEvent)=>{
    if(readOnly||isPanning)return;
    const pos=toCanvas(e.clientX,e.clientY);
    if(dragging){
      const dx=pos.x-dragging.startX,dy=pos.y-dragging.startY;
      const primary=state.elements.find(el=>el.id===dragging.id)!;
      const others=state.elements.filter(o=>!dragging.origins.find(s=>s.id===o.id));
      let sdx=dx,sdy=dy,gX:number|undefined,gY:number|undefined;
      if(state.snapEnabled&&primary){
        const r=snapEl({x:dragging.elX+dx,y:dragging.elY+dy,w:primary.width,h:primary.height},others,state.canvasW,state.canvasH,state.guides);
        sdx=r.x-dragging.elX;sdy=r.y-dragging.elY;gX=r.gX;gY=r.gY;
      }
      dispatch({type:"UPDATE_ELEMENTS",updates:dragging.origins.map(o=>({id:o.id,x:o.ox+sdx,y:o.oy+sdy})),saveHistory:false});
      setSnapGuide({x:gX,y:gY});
    }
    if(resizing){
      const{handle,startX,startY,origX,origY,origW,origH}=resizing;
      const dx=pos.x-startX,dy=pos.y-startY;
      let x=origX,y=origY,w=origW,h=origH;
      const prop=e.shiftKey,ratio=origW/origH;
      if(handle.includes("e")){w=Math.max(16,origW+dx);if(prop)h=w/ratio;}
      if(handle.includes("s")){h=Math.max(16,origH+dy);if(prop)w=h*ratio;}
      if(handle.includes("w")){const nw=Math.max(16,origW-dx);x=origX+(origW-nw);w=nw;if(prop){h=w/ratio;y=origY+(origH-h)/2;}}
      if(handle.includes("n")){const nh=Math.max(16,origH-dy);y=origY+(origH-nh);h=nh;if(prop){w=h*ratio;x=origX+(origW-w)/2;}}
      if(handle==="rot"){
        const cx=origX+origW/2,cy=origY+origH/2;
        const angle=Math.atan2(pos.y-cy,pos.x-cx)*180/Math.PI+90;
        dispatch({type:"UPDATE_ELEMENTS",updates:[{id:resizing.id,rotation:Math.round(angle)}],saveHistory:false});return;
      }
      dispatch({type:"UPDATE_ELEMENTS",updates:[{id:resizing.id,x,y,width:w,height:h}],saveHistory:false});
    }
    if(selecting)setSelecting(prev=>prev?{...prev,cx:pos.x,cy:pos.y}:null);
  },[dragging,resizing,selecting,state.elements,state.snapEnabled,state.guides,state.canvasW,state.canvasH,readOnly,toCanvas,isPanning]);

  const onMouseUp=useCallback(()=>{
    if(dragging){
      const el=state.elements.find(e=>e.id===dragging.id);
      if(el&&(Math.abs(el.x-dragging.elX)>0.5||Math.abs(el.y-dragging.elY)>0.5))
        dispatch({type:"UPDATE_ELEMENTS",updates:[],saveHistory:true,historyName:"Move"});
      setDragging(null);setSnapGuide({});
    }
    if(resizing){dispatch({type:"UPDATE_ELEMENTS",updates:[],saveHistory:true,historyName:"Resize"});setResizing(null);}
    if(selecting){
      const minX=Math.min(selecting.sx,selecting.cx),minY=Math.min(selecting.sy,selecting.cy);
      const maxX=Math.max(selecting.sx,selecting.cx),maxY=Math.max(selecting.sy,selecting.cy);
      const hit=state.elements.filter(el=>el.x<maxX&&el.x+el.width>minX&&el.y<maxY&&el.y+el.height>minY).map(e=>e.id);
      if(hit.length)dispatch({type:"SELECT",ids:hit});
      setSelecting(null);
    }
    isDragRef.current=false;
  },[dragging,resizing,selecting,state.elements]);

  const onCanvasDown=useCallback((e:React.MouseEvent)=>{
    if(e.target!==canvasRef.current||spaceDown)return;
    setCtxMenu(null);
    if(commentMode){const pos=toCanvas(e.clientX,e.clientY);setNewCommentPos(pos);setNewCommentTxt("");return;}
    dispatch({type:"DESELECT_ALL"});setEditingId(null);
    const pos=toCanvas(e.clientX,e.clientY);
    setSelecting({sx:pos.x,sy:pos.y,cx:pos.x,cy:pos.y});
  },[toCanvas,spaceDown,commentMode]);

  // Feature 17: right-click context menu
  const onElemRightClick=useCallback((e:React.MouseEvent,id:string)=>{
    e.preventDefault();e.stopPropagation();
    if(!state.selected.has(id))dispatch({type:"SELECT",ids:[id]});
    // Clamp to viewport so menu doesn't go off-screen
    const menuW=172,menuH=260;
    const x=Math.min(e.clientX,window.innerWidth-menuW-8);
    const y=Math.min(e.clientY,window.innerHeight-menuH-8);
    setCtxMenu({x,y,elId:id});
  },[state.selected]);

  const addText=()=>dispatch({type:"ADD_ELEMENT",element:{id:uid(),type:"text",x:100,y:100,width:400,height:80,rotation:0,zIndex:state.elements.length+1,locked:false,visible:true,opacity:1,blendMode:"normal",text:"Edit this text",fontSize:48,fontFamily:brandKit?.fontDisplay??"Syne",fontWeight:700,color:"#ffffff",align:"left",lineHeight:1.25,letterSpacing:0,fontStyle:"normal",textDecoration:"none",textTransform:"none"}});
  const addRect=()=>dispatch({type:"ADD_ELEMENT",element:{id:uid(),type:"rect",x:150,y:150,width:320,height:200,rotation:0,zIndex:state.elements.length+1,locked:false,visible:true,opacity:1,blendMode:"normal",fill:brandKit?.primaryColor??"#7c7ffa",borderRadius:12,strokeWidth:0}});
  const addEllipse=()=>dispatch({type:"ADD_ELEMENT",element:{id:uid(),type:"ellipse",x:200,y:200,width:200,height:200,rotation:0,zIndex:state.elements.length+1,locked:false,visible:true,opacity:1,blendMode:"normal",fill:"#22d3ee",strokeWidth:0}});
  const addLine=()=>dispatch({type:"ADD_ELEMENT",element:{id:uid(),type:"line",x:100,y:300,width:400,height:2,rotation:0,zIndex:state.elements.length+1,locked:false,visible:true,opacity:1,blendMode:"normal",stroke:"#ffffff",strokeWidth:2}});
  const uploadImage=(src:string)=>dispatch({type:"ADD_ELEMENT",element:{id:uid(),type:"image",x:50,y:50,width:500,height:350,rotation:0,zIndex:state.elements.length+1,locked:false,visible:true,opacity:1,blendMode:"normal",src,objectFit:"cover"}});
  const handleFileUpload=(file:File)=>{const r=new FileReader();r.onload=e=>{if(e.target?.result)uploadImage(e.target.result as string);};r.readAsDataURL(file);};

  const upd=useCallback((key:keyof EditorElement,val:any)=>{
    if(!activeEl)return;dispatch({type:"UPDATE_ELEMENTS",updates:[{id:activeEl.id,[key]:val}]});
  },[activeEl]);

  // Feature 8: AI text
  const aiGenerateText=async(elementId:string,currentText:string)=>{
    setAiLoading(elementId);
    try{const r=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:`Write compelling marketing copy. Current: "${currentText}". Return only new text, max 80 chars.`})});
      if(r.ok){const d=await r.json();const txt=d.text||d.result||d.content||currentText;dispatch({type:"UPDATE_ELEMENTS",updates:[{id:elementId,text:txt}],historyName:"AI text"});}
    }catch{}finally{setAiLoading(null);}
  };

  // Feature 9: AI BG remove
  const aiRemoveBg=async(elementId:string,src:string)=>{
    setBgRmLoading(true);
    try{const r=await fetch("/api/bg-remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({src,elementId})});
      if(r.ok){const d=await r.json();if(d.src)dispatch({type:"UPDATE_ELEMENTS",updates:[{id:elementId,src:d.src}],historyName:"Remove BG"});}
      else alert("Connect /api/bg-remove to enable background removal.");
    }catch{alert("BG removal endpoint not available.");}finally{setBgRmLoading(false);}
  };

  // Feature 13: Template save/load
  const saveTpl=()=>{
    const name=prompt("Template name:");if(!name)return;
    const t={name,elements:cln(state.elements),bg:state.bgColor};
    const u=[...savedTpls,t];setSavedTpls(u);
    try{localStorage.setItem("ak_tpls",JSON.stringify(u));}catch{}
  };
  const loadTpl=(t:{name:string;elements:EditorElement[];bg:string})=>{
    dispatch({type:"SET_ELEMENTS",elements:t.elements,historyName:"Load template"});
    dispatch({type:"SET_BG",color:t.bg});setShowTpls(false);
  };

  // Real export using native Canvas API.
  // When targetW/H differ from the artboard, the bitmap is re-composited onto
  // an output canvas with the chosen fit strategy so the design adapts
  // intelligently to the new dimensions.
  const exportCanvas=useCallback(async(
    format:ExportFormat,
    opts?:{targetW?:number;targetH?:number;fit?:ExportFit},
  )=>{
    setShowExport(false);
    setExportDialog(null);
    if(format==="pdf"){window.print();return;}
    const cvs=canvasRef.current;if(!cvs)return;

    const srcW=state.canvasW, srcH=state.canvasH;
    const tgtW=opts?.targetW??srcW;
    const tgtH=opts?.targetH??srcH;
    const fit:ExportFit=opts?.fit??"contain";
    const resized=tgtW!==srcW||tgtH!==srcH;

    try{
      const {default:html2canvas}=await import(/* webpackIgnore: true */ "html2canvas").catch(()=>({default:null}));
      if(!html2canvas){
        alert(`To export as ${format.toUpperCase()}, install html2canvas:\nnpm install html2canvas\n\nAlternatively use browser screenshot or print to PDF.`);
        return;
      }

      // Capture the live artboard at native (zoom-independent) resolution so
      // text and vectors stay crisp before any resize step.
      const src=await html2canvas(cvs,{
        scale:1/Math.max(zoom,0.0001),
        useCORS:true,allowTaint:true,backgroundColor:null,
        width:srcW*zoom,height:srcH*zoom,
      });

      const mime=format==="jpg"?"image/jpeg":"image/png";

      // Fast path: no resize requested.
      if(!resized){
        const url=src.toDataURL(mime,0.95);
        const a=document.createElement("a");a.href=url;a.download=`design.${format}`;a.click();
        return;
      }

      // Compose onto a target-sized canvas with smart fit.
      const out=document.createElement("canvas");
      out.width=Math.max(1,Math.round(tgtW));
      out.height=Math.max(1,Math.round(tgtH));
      const ctx=out.getContext("2d");
      if(!ctx){alert("Export failed: 2D canvas not supported.");return;}
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality="high";

      // Background: solid bg for JPG (no alpha) or letterboxed contain.
      const isGrad=state.bgColor.includes("gradient");
      if(format==="jpg"||fit==="contain"){
        ctx.fillStyle=isGrad?"#ffffff":state.bgColor;
        ctx.fillRect(0,0,out.width,out.height);
      }

      const{dx,dy,dw,dh}=computeFitRect(src.width,src.height,out.width,out.height,fit);
      ctx.drawImage(src,dx,dy,dw,dh);

      const url=out.toDataURL(mime,0.95);
      const a=document.createElement("a");a.href=url;a.download=`design_${tgtW}x${tgtH}.${format}`;a.click();
    }catch(err){alert("Export failed. Try Print → Save as PDF as an alternative.");}
  },[canvasRef,state.canvasW,state.canvasH,state.bgColor,zoom]);

  // Listen for arkiol:export events dispatched by FullPageEditor
  useEffect(()=>{
    const handler=(e:Event)=>{
      const detail=(e as CustomEvent).detail;
      if(!detail)return;
      const fmt=detail.format as ExportFormat;
      if(fmt==="png"||fmt==="jpg"||fmt==="pdf"){
        if(detail.targetW&&detail.targetH){
          exportCanvas(fmt,{targetW:detail.targetW,targetH:detail.targetH,fit:detail.fit??"contain"});
        }else if(fmt==="pdf"){
          exportCanvas(fmt);
        }else{
          setExportDialog({format:fmt});
        }
      }
    };
    window.addEventListener("arkiol:export",handler);
    return()=>window.removeEventListener("arkiol:export",handler);
  },[exportCanvas]);

  const selRect=selecting?{left:Math.min(selecting.sx,selecting.cx)*zoom,top:Math.min(selecting.sy,selecting.cy)*zoom,width:Math.abs(selecting.cx-selecting.sx)*zoom,height:Math.abs(selecting.cy-selecting.sy)*zoom}:null;
  const hTicks=useMemo(()=>{const t=[];const s=GRID_SIZE*zoom;for(let i=0;i<state.canvasW*zoom;i+=s)t.push(Math.round(i/zoom));return t;},[state.canvasW,zoom]);
  const vTicks=useMemo(()=>{const t=[];const s=GRID_SIZE*zoom;for(let i=0;i<state.canvasH*zoom;i+=s)t.push(Math.round(i/zoom));return t;},[state.canvasH,zoom]);
  const isGradBg=state.bgColor.includes("gradient");

  // Feature 14: Filtered layers
  const filteredEls=useMemo(()=>{
    const base=[...state.elements].sort((a,b)=>b.zIndex-a.zIndex);
    if(!layerSearch)return base;
    const q=layerSearch.toLowerCase();
    return base.filter(el=>{const n=(el.name??(el.type==="text"?el.text?.slice(0,14):el.id.slice(0,12)))??"";return n.toLowerCase().includes(q)||el.type.includes(q);});
  },[state.elements,layerSearch]);


  return(
    <div style={{display:"flex",height:"100vh",background:"var(--bg-base)",color:"var(--text-primary)",fontFamily:"var(--font-body)",overflow:"hidden"}} onClick={()=>setCtxMenu(null)}>

      {/* ── LEFT PANEL ── */}
      <div style={{width:220,background:"var(--bg-surface)",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
        <div style={{display:"flex",borderBottom:"1px solid var(--border)",flexShrink:0}}>
          {(["layers","brand","settings"] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"9px 2px",fontSize:10,fontWeight:700,cursor:"pointer",background:"none",border:"none",textTransform:"uppercase",letterSpacing:"0.07em",borderBottom:`2px solid ${tab===t?"var(--accent)":"transparent"}`,color:tab===t?"var(--accent-light)":"var(--text-muted)"}}>{t}</button>
          ))}
        </div>
        <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column"}}>
          {tab==="layers"&&(
            <>
              {!readOnly&&(
                <div style={{padding:"8px",borderBottom:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:4}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                    <ToolBtn icon="T" label="Text" onClick={addText}/>
                    <ToolBtn icon="▭" label="Rect" onClick={addRect}/>
                    <ToolBtn icon="◯" label="Ellipse" onClick={addEllipse}/>
                    <ToolBtn icon="—" label="Line" onClick={addLine}/>
                  </div>
                  <button onClick={()=>fileInputRef.current?.click()} style={{width:"100%",padding:"6px 0",fontSize:11,fontWeight:600,background:"var(--accent-tint)",color:"var(--accent-light)",border:"1px dashed var(--border-accent)",borderRadius:6,cursor:"pointer"}}>⬆ Upload Image</button>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleFileUpload(f);e.target.value="";}}/>
                </div>
              )}
              {/* Feature 14: Layer search */}
              <div style={{padding:"5px 8px",borderBottom:"1px solid var(--border)"}}>
                <input value={layerSearch} onChange={e=>setLayerSearch(e.target.value)} placeholder="🔍 Search layers…" style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:5,padding:"4px 8px",fontSize:11,outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div style={{flex:1,overflow:"auto",padding:"4px"}}>
                {filteredEls.map(el=>(
                  <LayerItem key={el.id} el={el} isSelected={state.selected.has(el.id)} isRenaming={renaming===el.id} renameVal={renameVal}
                    onSelect={e=>dispatch({type:"SELECT",ids:[el.id],additive:e.shiftKey})}
                    onLock={()=>dispatch({type:"UPDATE_ELEMENTS",updates:[{id:el.id,locked:!el.locked}]})}
                    onVisibility={()=>dispatch({type:"UPDATE_ELEMENTS",updates:[{id:el.id,visible:!el.visible}]})}
                    onFwd={()=>dispatch({type:"BRING_FORWARD",id:el.id})}
                    onBwd={()=>dispatch({type:"SEND_BACKWARD",id:el.id})}
                    onRenameStart={()=>{setRenaming(el.id);setRenameVal(el.name??el.id);}}
                    onRenameChange={v=>setRenameVal(v)}
                    onRenameEnd={()=>{dispatch({type:"UPDATE_ELEMENTS",updates:[{id:el.id,name:renameVal}]});setRenaming(null);}}
                    onDelete={()=>{dispatch({type:"SELECT",ids:[el.id]});dispatch({type:"DELETE_SELECTED"});}}
                  />
                ))}
                {state.elements.length===0&&<div style={{padding:"32px 12px",textAlign:"center",color:"var(--text-muted)",fontSize:12}}><div style={{fontSize:32,marginBottom:8,opacity:0.4}}>✦</div>Add elements above or drop an image on the canvas</div>}
              </div>
            </>
          )}
          {tab==="brand"&&<BrandPanel brandKit={brandKit} dispatch={dispatch} state={state}/>}
          {tab==="settings"&&<SettingsPanel state={state} dispatch={dispatch} zoom={zoom} setZoom={setZoom}/>}
        </div>
        <div style={{padding:"8px",borderTop:"1px solid var(--border)",flexShrink:0}}>
          <div style={{display:"flex",gap:4,marginBottom:4}}>
            <TinyBtn onClick={()=>dispatch({type:"UNDO"})} title="Ctrl+Z">↩ Undo</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"REDO"})} title="Ctrl+Y">↪ Redo</TinyBtn>
          </div>
          {/* Feature 1: History panel button */}
          <TinyBtn onClick={()=>setShowHistory(v=>!v)} title="Version history" style={{width:"100%",marginBottom:4}}>🕐 History ({state.history.length})</TinyBtn>
          <div style={{fontSize:10,color:"var(--text-muted)",textAlign:"center"}}>
            {state.historyIdx}/{state.history.length-1} steps
            {autosaveTxt&&<span style={{marginLeft:6,color:"var(--accent-light)"}}>{autosaveTxt}</span>}
          </div>
        </div>
      </div>

      {/* ── CENTER ── */}
      <div ref={containerRef} style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column",alignItems:"stretch",background:"var(--workspace-bg)",boxShadow:"inset 1px 0 0 rgba(0,0,0,0.4), inset -1px 0 0 rgba(0,0,0,0.4)",cursor:isPanning?"grabbing":spaceDown?"grab":commentMode?"crosshair":"default",position:"relative",userSelect:isPanning?"none":"auto",minWidth:0}}
        onMouseDown={onContDown} onMouseMove={onContMove} onMouseUp={onContUp}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f?.type.startsWith("image/"))handleFileUpload(f);}}
        onDragOver={e=>e.preventDefault()}>

        {/* Toolbar */}
        <div style={{width:"100%",borderBottom:"1px solid var(--border)",background:"var(--bg-surface)",display:"flex",alignItems:"center",gap:4,padding:"5px 10px",flexShrink:0,flexWrap:"wrap",position:"sticky",top:0,zIndex:100}}>
          <div style={{display:"flex",alignItems:"center",gap:1,background:"var(--bg-elevated)",borderRadius:6,padding:"2px",border:"1px solid var(--border)"}}>
            <TinyBtn onClick={()=>setZoom(z=>zoomStepDown(z))}>−</TinyBtn>
            <span onClick={()=>{const atFull=Math.abs(zoom-1)<0.02;if(atFull)doFitZoom();else setZoom(1);}} style={{fontSize:11,minWidth:38,textAlign:"center",color:"var(--text-secondary)",fontFamily:"var(--font-mono)",cursor:"pointer",padding:"0 2px"}} title="Toggle 100% / Fit">{Math.round(zoom*100)}%</span>
            <TinyBtn onClick={()=>setZoom(z=>zoomStepUp(z))}>+</TinyBtn>
            <TinyBtn onClick={doFitZoom} title="Fit to screen">⊡</TinyBtn>
            <TinyBtn onClick={zoomToSel} title="Zoom to selection (F/Z)">⊕</TinyBtn>
          </div>
          <VSep/>
          <TogBtn active={state.snapEnabled} onClick={()=>dispatch({type:"TOGGLE_SNAP"})} title="Snap">⊞</TogBtn>
          <TogBtn active={state.rulerVisible} onClick={()=>dispatch({type:"TOGGLE_RULER"})} title="Rulers">📏</TogBtn>
          <TogBtn active={state.gridVisible} onClick={()=>dispatch({type:"TOGGLE_GRID"})} title="Grid">⊟</TogBtn>
          {/* Feature 10: Comment mode */}
          <TogBtn active={commentMode} onClick={()=>{setCommentMode(v=>!v);dispatch({type:"DESELECT_ALL"});}} title="Annotation mode">💬</TogBtn>
          {selEls.length>1&&<>
            <VSep/>
            <TinyBtn onClick={()=>dispatch({type:"ALIGN",direction:"left"})} title="Align left">⬛L</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"ALIGN",direction:"centerH"})} title="Center H">⬛H</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"ALIGN",direction:"right"})} title="Align right">⬛R</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"ALIGN",direction:"top"})} title="Align top">⬛T</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"ALIGN",direction:"centerV"})} title="Center V">⬛V</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"ALIGN",direction:"bottom"})} title="Align bottom">⬛B</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"DISTRIBUTE",axis:"h"})} title="Distribute H">↔</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"DISTRIBUTE",axis:"v"})} title="Distribute V">↕</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"GROUP_SELECTED"})} title="Group">⊞Grp</TinyBtn>
          </>}
          {selEls.length>0&&<>
            <VSep/>
            <TinyBtn onClick={()=>dispatch({type:"FLIP",axis:"h"})} title="Flip H">⇄</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"FLIP",axis:"v"})} title="Flip V">⇅</TinyBtn>
          </>}
          <div style={{flex:1}}/>
          {/* Feature 12 */}
          <TinyBtn onClick={()=>setShowFR(v=>!v)} title="Find & Replace">🔍 Find</TinyBtn>
          {/* Feature 13 */}
          <TinyBtn onClick={()=>setShowTpls(v=>!v)} title="Templates">📁</TinyBtn>
          {/* Feature 18 */}
          <TinyBtn onClick={()=>setShowShortcuts(true)} title="Keyboard shortcuts (?)">?</TinyBtn>
          {warnings.length>0&&<div title={warnings.join("\n")} style={{fontSize:11,padding:"3px 8px",borderRadius:4,cursor:"help",background:"var(--warning-tint)",color:"var(--warning)",border:"1px solid rgba(251,191,36,0.3)"}}>⚠ {warnings.length}</div>}
          {onSave&&<button onClick={()=>onSave(state.elements)} style={{padding:"5px 14px",fontSize:12,fontWeight:700,borderRadius:6,cursor:"pointer",background:"var(--accent)",color:"#fff",border:"none"}}>Save</button>}
          <div style={{position:"relative"}}>
            <button onClick={()=>setShowExport(e=>!e)} style={{padding:"5px 12px",fontSize:12,fontWeight:600,borderRadius:6,cursor:"pointer",background:"var(--bg-elevated)",color:"var(--text-secondary)",border:"1px solid var(--border-strong)"}}>Export ▾</button>
            {showExport&&<div style={{position:"absolute",top:34,right:0,zIndex:1000,background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:8,boxShadow:"var(--shadow-lg)",padding:"4px",minWidth:160}}>
              {([["PNG (screen)","png"],["JPG","jpg"],["Print PDF","pdf"]] as const).map(([l,f])=><button key={l} onClick={()=>{setShowExport(false);if(f==="pdf")exportCanvas(f);else setExportDialog({format:f as ExportFormat});}} style={{display:"block",width:"100%",padding:"7px 12px",textAlign:"left",background:"none",border:"none",color:"var(--text-primary)",fontSize:13,cursor:"pointer",borderRadius:4}}>{l}</button>)}
            </div>}
          </div>
        </div>

        {/* Feature 7: Multi-page bar */}
        <div style={{width:"100%",borderBottom:"1px solid var(--border)",background:"var(--bg-surface)",display:"flex",alignItems:"center",gap:2,padding:"4px 10px",flexShrink:0,overflowX:"auto"}}>
          {state.pages.map((page,i)=>(
            <button key={page.id}
              onDoubleClick={()=>{const n=prompt("Page name:",page.name);if(n)dispatch({type:"RENAME_PAGE",idx:i,name:n});}}
              onClick={()=>dispatch({type:"SWITCH_PAGE",idx:i})}
              style={{padding:"3px 10px",fontSize:11,fontWeight:state.currentPageIdx===i?700:400,borderRadius:4,cursor:"pointer",background:state.currentPageIdx===i?"var(--accent-tint)":"var(--bg-elevated)",color:state.currentPageIdx===i?"var(--accent-light)":"var(--text-secondary)",border:`1px solid ${state.currentPageIdx===i?"var(--border-accent)":"var(--border-strong)"}`,whiteSpace:"nowrap"}}>
              {page.name}
              {state.pages.length>1&&<span onClick={e=>{e.stopPropagation();if(confirm(`Delete "${page.name}"?`))dispatch({type:"DELETE_PAGE",idx:i});}} style={{marginLeft:5,color:"var(--error)",fontSize:9,opacity:0.6}}>✕</span>}
            </button>
          ))}
          <button onClick={()=>dispatch({type:"ADD_PAGE"})} style={{padding:"3px 8px",fontSize:11,borderRadius:4,cursor:"pointer",background:"none",color:"var(--accent)",border:"1px dashed var(--border-accent)"}}>+ Page</button>
        </div>

        {crashBanner&&(
          <div style={{width:"100%",padding:"7px 16px",background:"rgba(124,127,250,0.1)",borderBottom:"1px solid var(--border-accent)",display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:12,flexShrink:0}}>
            <span style={{color:"var(--accent-light)"}}>🔄 Unsaved draft found — restore?</span>
            <div style={{display:"flex",gap:6}}>
              <button onClick={async()=>{const r=await fetch(`/api/editor/autosave?projectId=${encodeURIComponent(projectId)}`).then(r=>r.json()).catch(()=>null);if(r?.draft?.elements)dispatch({type:"SET_ELEMENTS",elements:r.draft.elements});setCrashBanner(false);}} style={{padding:"3px 10px",fontSize:11,fontWeight:600,borderRadius:4,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer"}}>Restore</button>
              <button onClick={()=>setCrashBanner(false)} style={{padding:"3px 10px",fontSize:11,background:"none",border:"1px solid var(--border)",color:"var(--text-muted)",borderRadius:4,cursor:"pointer"}}>Dismiss</button>
            </div>
          </div>
        )}

        {/* Canvas area */}
        <div style={{flex:1,minHeight:0,overflow:"auto",display:"flex",alignItems:"center",justifyContent:"center",padding:"72px 88px",position:"relative",width:"100%",boxSizing:"border-box",backgroundImage:"var(--workspace-bg-accent)"}}>
          <div style={{position:"relative",flexShrink:0}}>
            {state.rulerVisible&&(
              <div style={{position:"absolute",top:-RULER_SIZE,left:0,width:state.canvasW*zoom,height:RULER_SIZE,background:"var(--bg-elevated)",borderBottom:"1px solid var(--border)",overflow:"hidden",fontSize:8,color:"var(--text-muted)",fontFamily:"var(--font-mono)",userSelect:"none"}}>
                {hTicks.map(t=><span key={t} style={{position:"absolute",left:t*zoom,transform:"translateX(-50%)",top:5}}>{t}</span>)}
              </div>
            )}
            {state.rulerVisible&&(
              <div style={{position:"absolute",left:-RULER_SIZE,top:0,width:RULER_SIZE,height:state.canvasH*zoom,background:"var(--bg-elevated)",borderRight:"1px solid var(--border)",overflow:"hidden",fontSize:7,color:"var(--text-muted)",fontFamily:"var(--font-mono)",userSelect:"none"}}>
                {vTicks.map(t=><span key={t} style={{position:"absolute",top:t*zoom,transform:"translateY(-50%)",left:1,writingMode:"vertical-rl"}}>{t}</span>)}
              </div>
            )}
            <div ref={canvasRef} style={{position:"relative",width:state.canvasW*zoom,height:state.canvasH*zoom,background:isGradBg?undefined:state.bgColor,backgroundImage:isGradBg?state.bgColor:undefined,overflow:"hidden",flexShrink:0,boxShadow:"var(--artboard-shadow)",borderRadius:3}}
              onMouseDown={onCanvasDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onContextMenu={e=>e.preventDefault()}>
              {state.gridVisible&&(
                <svg style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:1}} width="100%" height="100%">
                  <defs><pattern id="ak-grid" width={GRID_SIZE*zoom} height={GRID_SIZE*zoom} patternUnits="userSpaceOnUse">
                    <path d={`M ${GRID_SIZE*zoom} 0 L 0 0 0 ${GRID_SIZE*zoom}`} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
                  </pattern></defs>
                  <rect width="100%" height="100%" fill="url(#ak-grid)"/>
                </svg>
              )}
              {sorted.filter(e=>e.visible!==false).map(el=>(
                <ElemRender key={el.id} el={el} zoom={zoom}
                  isSelected={state.selected.has(el.id)} isEditing={editingId===el.id} readOnly={readOnly}
                  onMouseDown={e=>startDrag(e,el.id)}
                  onDoubleClick={()=>{if(!readOnly&&el.type==="text")setEditingId(el.id);}}
                  onTextChange={t=>dispatch({type:"UPDATE_ELEMENTS",updates:[{id:el.id,text:t}],saveHistory:false})}
                  startResize={startResize}
                  onContextMenu={e=>onElemRightClick(e,el.id)}
                />
              ))}
              {snapGuide.x!==undefined&&<div style={{position:"absolute",top:0,bottom:0,left:snapGuide.x*zoom,width:1,background:"#7c7ffa",opacity:0.9,pointerEvents:"none",zIndex:9999}}/>}
              {snapGuide.y!==undefined&&<div style={{position:"absolute",left:0,right:0,top:snapGuide.y*zoom,height:1,background:"#f472b6",opacity:0.9,pointerEvents:"none",zIndex:9999}}/>}
              {state.guides.map(g=>(
                <div key={g.id} onDoubleClick={()=>dispatch({type:"REMOVE_GUIDE",id:g.id})}
                  style={{position:"absolute",pointerEvents:"all",zIndex:9998,cursor:"pointer",...(g.axis==="v"?{top:0,bottom:0,left:g.pos*zoom,width:1,background:"rgba(34,211,238,0.7)"}:{left:0,right:0,top:g.pos*zoom,height:1,background:"rgba(34,211,238,0.7)"})}}/>
              ))}
              {selRect&&<div style={{position:"absolute",pointerEvents:"none",zIndex:9990,borderRadius:2,...selRect,border:"1px dashed var(--accent-light)",background:"rgba(124,127,250,0.06)"}}/>}

              {/* Feature 10: Comments on canvas */}
              {state.comments.map(c=>(
                <div key={c.id} style={{position:"absolute",left:c.x*zoom,top:c.y*zoom,zIndex:9995,pointerEvents:"all",cursor:"pointer"}}
                  onClick={e=>{e.stopPropagation();setActiveComment(activeComment===c.id?null:c.id);}}>
                  <div style={{width:24,height:24,borderRadius:"50%",background:c.resolved?"#22c55e":"var(--accent)",color:"#fff",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #fff",boxShadow:"0 2px 8px rgba(0,0,0,0.4)"}}>💬</div>
                  {activeComment===c.id&&(
                    <div style={{position:"absolute",top:28,left:0,background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:8,padding:8,minWidth:180,zIndex:99999,boxShadow:"var(--shadow-lg)"}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontSize:10,color:"var(--text-muted)",marginBottom:4}}>{c.author} · {new Date(c.timestamp).toLocaleTimeString()}</div>
                      <div style={{fontSize:12,color:"var(--text-primary)",marginBottom:6,wordBreak:"break-word"}}>{c.text}</div>
                      <div style={{display:"flex",gap:4}}>
                        <TinyBtn onClick={()=>dispatch({type:"UPDATE_COMMENT",id:c.id,resolved:!c.resolved})}>{c.resolved?"Reopen":"Resolve"}</TinyBtn>
                        <TinyBtn onClick={()=>{dispatch({type:"DELETE_COMMENT",id:c.id});setActiveComment(null);}}>Delete</TinyBtn>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {newCommentPos&&commentMode&&(
                <div style={{position:"absolute",left:newCommentPos.x*zoom,top:newCommentPos.y*zoom,zIndex:99999,background:"var(--bg-elevated)",border:"1px solid var(--border-accent)",borderRadius:8,padding:8,minWidth:200,boxShadow:"var(--shadow-lg)"}} onClick={e=>e.stopPropagation()}>
                  <textarea value={newCommentTxt} onChange={e=>setNewCommentTxt(e.target.value)} placeholder="Add comment…" autoFocus
                    style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"4px 6px",fontSize:11,resize:"none",height:60,outline:"none",boxSizing:"border-box",marginBottom:6}}/>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>{if(newCommentTxt.trim())dispatch({type:"ADD_COMMENT",comment:{id:cid(),x:newCommentPos.x,y:newCommentPos.y,text:newCommentTxt,author:userId??"User",resolved:false,timestamp:Date.now()}});setNewCommentPos(null);}} style={{flex:1,padding:"4px",fontSize:11,fontWeight:600,background:"var(--accent)",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>Post</button>
                    <TinyBtn onClick={()=>setNewCommentPos(null)}>Cancel</TinyBtn>
                  </div>
                </div>
              )}

              {/* Feature 4: Interactive Crop overlay */}
              {cropId&&(()=>{
                const el=state.elements.find(e=>e.id===cropId);
                if(!el||el.type!=="image")return null;
                const elW=el.width*zoom,elH=el.height*zoom;
                const cx=cropRect.x*elW,cy=cropRect.y*elH,cw=cropRect.w*elW,ch=cropRect.h*elH;
                const onCropHandle=(e:React.MouseEvent,corner:"nw"|"ne"|"se"|"sw")=>{
                  e.stopPropagation();
                  const startX=e.clientX,startY=e.clientY;
                  const origCrop={...cropRect};
                  const onM=(me:MouseEvent)=>{
                    const dx=(me.clientX-startX)/elW,dy=(me.clientY-startY)/elH;
                    setCropRect(prev=>{
                      let{x,y,w,h}=origCrop;
                      if(corner==="nw"){x=Math.max(0,Math.min(x+dx,x+w-0.05));y=Math.max(0,Math.min(y+dy,y+h-0.05));w=origCrop.x+origCrop.w-x;h=origCrop.y+origCrop.h-y;}
                      if(corner==="ne"){w=Math.max(0.05,Math.min(1-x,w+dx));y=Math.max(0,Math.min(y+dy,y+h-0.05));h=origCrop.y+origCrop.h-y;}
                      if(corner==="se"){w=Math.max(0.05,Math.min(1-x,w+dx));h=Math.max(0.05,Math.min(1-y,h+dy));}
                      if(corner==="sw"){x=Math.max(0,Math.min(x+dx,x+w-0.05));w=origCrop.x+origCrop.w-x;h=Math.max(0.05,Math.min(1-y,h+dy));}
                      return{x:Math.max(0,x),y:Math.max(0,y),w:Math.min(1-x,w),h:Math.min(1-y,h)};
                    });
                  };
                  const onU=()=>{window.removeEventListener("mousemove",onM);window.removeEventListener("mouseup",onU);};
                  window.addEventListener("mousemove",onM);window.addEventListener("mouseup",onU);
                };
                return(
                  <div style={{position:"absolute",left:el.x*zoom,top:el.y*zoom,width:elW,height:elH,zIndex:99998,pointerEvents:"none",boxSizing:"border-box"}}>
                    {/* Dark overlay outside crop region */}
                    <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",pointerEvents:"none",clipPath:`polygon(0 0,100% 0,100% 100%,0 100%,0 ${cy/elH*100}%,${cx/elW*100}% ${cy/elH*100}%,${cx/elW*100}% ${(cy+ch)/elH*100}%,${(cx+cw)/elW*100}% ${(cy+ch)/elH*100}%,${(cx+cw)/elW*100}% ${cy/elH*100}%,0 ${cy/elH*100}%)`}}/>
                    {/* Crop frame */}
                    <div style={{position:"absolute",left:cx,top:cy,width:cw,height:ch,border:"2px solid #22d3ee",boxSizing:"border-box",pointerEvents:"none"}}>
                      {/* Rule of thirds */}
                      <div style={{position:"absolute",left:"33.33%",top:0,bottom:0,width:1,background:"rgba(255,255,255,0.3)",pointerEvents:"none"}}/>
                      <div style={{position:"absolute",left:"66.66%",top:0,bottom:0,width:1,background:"rgba(255,255,255,0.3)",pointerEvents:"none"}}/>
                      <div style={{position:"absolute",top:"33.33%",left:0,right:0,height:1,background:"rgba(255,255,255,0.3)",pointerEvents:"none"}}/>
                      <div style={{position:"absolute",top:"66.66%",left:0,right:0,height:1,background:"rgba(255,255,255,0.3)",pointerEvents:"none"}}/>
                    </div>
                    {/* Corner handles */}
                    {(["nw","ne","se","sw"] as const).map(c=>(
                      <div key={c} onMouseDown={e=>onCropHandle(e,c)}
                        style={{position:"absolute",width:12,height:12,background:"#22d3ee",border:"2px solid #fff",borderRadius:2,cursor:c==="nw"||c==="se"?"nwse-resize":"nesw-resize",zIndex:99999,pointerEvents:"all",
                          left:c.includes("w")?cx-6:cx+cw-6,
                          top:c.includes("n")?cy-6:cy+ch-6}}/>
                    ))}
                    {/* Action buttons */}
                    <div style={{position:"absolute",bottom:-(cy+ch+elH>elH?34:34),left:cx,display:"flex",gap:4,pointerEvents:"all",top:cy+ch+4}}>
                      <button onClick={()=>{dispatch({type:"UPDATE_ELEMENTS",updates:[{id:cropId,crop:cropRect}],historyName:"Crop"});setCropId(null);}} style={{padding:"4px 12px",fontSize:11,background:"var(--accent)",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontWeight:600}}>✓ Apply</button>
                      <button onClick={()=>{dispatch({type:"UPDATE_ELEMENTS",updates:[{id:cropId,crop:undefined}],historyName:"Clear crop"});setCropId(null);}} style={{padding:"4px 10px",fontSize:11,background:"var(--error-tint)",color:"var(--error)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:4,cursor:"pointer"}}>✕ Clear</button>
                      <button onClick={()=>setCropId(null)} style={{padding:"4px 10px",fontSize:11,background:"var(--bg-elevated)",color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:4,cursor:"pointer"}}>Cancel</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Feature 20: Status bar */}
        <div style={{width:"100%",borderTop:"1px solid var(--border)",background:"var(--bg-surface)",padding:"3px 12px",fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",display:"flex",gap:16,alignItems:"center",flexShrink:0}}>
          <span>{state.elements.length} elements</span>
          <span>·</span>
          <span>{state.canvasW}×{state.canvasH}</span>
          <span>·</span>
          <span>{Math.round(zoom*100)}% zoom</span>
          {selEls.length>0&&<><span>·</span><span style={{color:"var(--accent-light)"}}>{selEls.length} selected</span></>}
          {activeEl&&<><span>·</span><span>x:{Math.round(activeEl.x)} y:{Math.round(activeEl.y)} w:{Math.round(activeEl.width)} h:{Math.round(activeEl.height)}</span></>}
          {commentMode&&<><span>·</span><span style={{color:"#22d3ee"}}>💬 Comment mode — click canvas to annotate</span></>}
          <span style={{marginLeft:"auto"}}>Page {state.currentPageIdx+1}/{state.pages.length}</span>
        </div>

        {/* Multi-select floating bar */}
        {selEls.length>1&&!readOnly&&(
          <div style={{position:"fixed",bottom:40,left:"50%",transform:"translateX(-50%)",background:"var(--bg-elevated)",border:"1px solid var(--border-accent)",borderRadius:40,padding:"5px 12px",display:"flex",gap:5,alignItems:"center",zIndex:10000,boxShadow:"var(--shadow-lg)"}}>
            <span style={{fontSize:11,fontWeight:700,color:"var(--accent-light)",background:"var(--accent-tint)",padding:"2px 8px",borderRadius:20}}>{selEls.length} selected</span>
            <div style={{width:1,height:14,background:"var(--border)"}}/>
            <TinyBtn onClick={()=>dispatch({type:"GROUP_SELECTED"})}>⊞ Group</TinyBtn>
            <TinyBtn onClick={()=>dispatch({type:"DUPLICATE_SELECTED"})}>⊕ Dupe</TinyBtn>
            <button onClick={()=>dispatch({type:"DELETE_SELECTED"})} style={{padding:"3px 10px",fontSize:11,fontWeight:600,borderRadius:4,cursor:"pointer",background:"var(--error-tint)",color:"var(--error)",border:"1px solid rgba(248,113,113,0.3)"}}>🗑</button>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      {(activeEl||selEls.length>0)&&!readOnly&&(
        <div style={{width:252,background:"var(--bg-surface)",borderLeft:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:"1px solid var(--border)",flexShrink:0}}>
            {(["props","effects"] as const).map(t=>(
              <button key={t} onClick={()=>setRightTab(t)} style={{flex:1,padding:"9px 4px",fontSize:10,fontWeight:700,cursor:"pointer",background:"none",border:"none",textTransform:"uppercase",letterSpacing:"0.07em",borderBottom:`2px solid ${rightTab===t?"var(--accent)":"transparent"}`,color:rightTab===t?"var(--accent-light)":"var(--text-muted)"}}>{t}</button>
            ))}
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {activeEl&&rightTab==="props"&&<PropsPanel el={activeEl} upd={upd} dispatch={dispatch}
              onCrop={id=>{const el=state.elements.find(e=>e.id===id);if(el?.type==="image"){setCropId(id);setCropRect(el.crop??{x:0,y:0,w:1,h:1});}}}
              onAiText={aiGenerateText} onAiBg={aiRemoveBg} aiLoading={aiLoading} bgRmLoading={bgRmLoading}
              onStyleCopy={()=>{if(activeEl){const{id,x,y,width,height,zIndex,locked,visible,...style}=activeEl;setStyleBuf(style);}}}
              onStylePaste={()=>{if(styleBuf&&activeEl)dispatch({type:"UPDATE_ELEMENTS",updates:[{id:activeEl.id,...styleBuf}],historyName:"Paste style"});}}
            />}
            {activeEl&&rightTab==="effects"&&<EffectsPanel el={activeEl} upd={upd} showGrad={showGrad} setShowGrad={setShowGrad} showGradEd={showGradEd} setShowGradEd={setShowGradEd} gradAngle={gradAngle} setGradAngle={setGradAngle} gradStops={gradStops} setGradStops={setGradStops} buildGradient={buildGradient}/>}
            {!activeEl&&selEls.length>0&&<div style={{padding:16,color:"var(--text-muted)",fontSize:12,textAlign:"center"}}>{selEls.length} elements selected.<br/>Use the toolbar to align, distribute, or group.</div>}
          </div>
          {activeEl&&(
            <div style={{padding:"8px",borderTop:"1px solid var(--border)",flexShrink:0}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                <TinyBtn onClick={()=>dispatch({type:"BRING_TO_FRONT",id:activeEl.id})}>To Front</TinyBtn>
                <TinyBtn onClick={()=>dispatch({type:"SEND_TO_BACK",id:activeEl.id})}>To Back</TinyBtn>
                <TinyBtn onClick={()=>dispatch({type:"DUPLICATE_SELECTED"})}>⊕ Dupe</TinyBtn>
                <button onClick={()=>dispatch({type:"DELETE_SELECTED"})} style={{padding:"5px",fontSize:11,fontWeight:600,borderRadius:5,cursor:"pointer",background:"var(--error-tint)",color:"var(--error)",border:"1px solid rgba(248,113,113,0.25)"}}>🗑 Delete</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── OVERLAYS ── */}

      {/* Feature 17: Context menu */}
      {ctxMenu&&(
        <div style={{position:"fixed",left:ctxMenu.x,top:ctxMenu.y,zIndex:99999,background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:8,boxShadow:"var(--shadow-lg)",padding:"4px",minWidth:168}} onClick={e=>e.stopPropagation()}>
          {[
            {label:"Duplicate",     icon:"⊕", fn:()=>dispatch({type:"DUPLICATE_SELECTED"})},
            {label:"Copy Style",    icon:"📋",fn:()=>{const el=state.elements.find(e=>e.id===ctxMenu.elId);if(el){const{id,x,y,width,height,zIndex,locked,visible,...s}=el;setStyleBuf(s);}}},
            {label:"Paste Style",   icon:"📌",fn:()=>{if(styleBuf)dispatch({type:"UPDATE_ELEMENTS",updates:[{id:ctxMenu.elId,...styleBuf}],historyName:"Paste style"});}},
            {label:"---"},
            {label:"Lock/Unlock",   icon:"🔒",fn:()=>{const el=state.elements.find(e=>e.id===ctxMenu.elId);if(el)dispatch({type:"UPDATE_ELEMENTS",updates:[{id:el.id,locked:!el.locked}]});}},
            {label:"Bring Forward", icon:"↑", fn:()=>dispatch({type:"BRING_FORWARD",id:ctxMenu.elId})},
            {label:"Send Backward", icon:"↓", fn:()=>dispatch({type:"SEND_BACKWARD",id:ctxMenu.elId})},
            {label:"To Front",      icon:"⤒", fn:()=>dispatch({type:"BRING_TO_FRONT",id:ctxMenu.elId})},
            {label:"To Back",       icon:"⤓", fn:()=>dispatch({type:"SEND_TO_BACK",id:ctxMenu.elId})},
            {label:"---"},
            {label:"Delete",        icon:"🗑",fn:()=>dispatch({type:"DELETE_SELECTED"})},
          ].map((item,i)=>item.label==="---"
            ?<div key={i} style={{height:1,background:"var(--border)",margin:"2px 0"}}/>
            :<button key={i} onClick={()=>{item.fn?.();setCtxMenu(null);}} style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"6px 10px",textAlign:"left",background:"none",border:"none",color:"var(--text-primary)",fontSize:12,cursor:"pointer",borderRadius:4}}>
              <span style={{width:14,fontSize:11}}>{item.icon}</span>{item.label}
            </button>
          )}
        </div>
      )}

      {/* Feature 1: History panel */}
      {showHistory&&(
        <div style={{position:"fixed",left:220,top:0,bottom:0,width:240,background:"var(--bg-surface)",borderRight:"1px solid var(--border-strong)",zIndex:9000,display:"flex",flexDirection:"column",boxShadow:"4px 0 20px rgba(0,0,0,0.4)"}}>
          <div style={{padding:"12px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontWeight:700,fontSize:13}}>🕐 Version History</span>
            <button onClick={()=>setShowHistory(false)} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:16}}>✕</button>
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
            {[...state.history].reverse().map((entry,ri)=>{
              const i=state.history.length-1-ri;
              const isCurrent=i===state.historyIdx;
              return(
                <div key={i} onClick={()=>dispatch({type:"JUMP_HISTORY",idx:i})}
                  style={{padding:"8px 10px",borderRadius:6,cursor:"pointer",marginBottom:2,background:isCurrent?"var(--accent-tint)":"transparent",border:`1px solid ${isCurrent?"var(--border-accent)":"transparent"}`}}>
                  <div style={{fontSize:12,color:isCurrent?"var(--accent-light)":"var(--text-primary)",fontWeight:isCurrent?700:400}}>{entry.name}</div>
                  <div style={{fontSize:10,color:"var(--text-muted)",marginTop:2}}>{new Date(entry.timestamp).toLocaleTimeString()} · {entry.elements.length} elements</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Feature 12: Find & Replace */}
      {showFR&&(
        <div style={{position:"fixed",top:80,left:"50%",transform:"translateX(-50%)",zIndex:20000,background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:12,padding:16,minWidth:320,boxShadow:"var(--shadow-lg)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <span style={{fontWeight:700,fontSize:13}}>🔍 Find & Replace Text</span>
            <button onClick={()=>setShowFR(false)} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:16}}>✕</button>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:"var(--text-muted)",marginBottom:3}}>Find</div>
            <input value={findTxt} onChange={e=>setFindTxt(e.target.value)} placeholder="Text to find…" style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:5,padding:"6px 8px",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:10,color:"var(--text-muted)",marginBottom:3}}>Replace with</div>
            <input value={replaceTxt} onChange={e=>setReplaceTxt(e.target.value)} placeholder="Replace with…" style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:5,padding:"6px 8px",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{dispatch({type:"FIND_REPLACE",find:findTxt,replace:replaceTxt});setShowFR(false);}} style={{flex:1,padding:"7px",fontSize:12,fontWeight:700,background:"var(--accent)",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"}}>Replace All</button>
            <TinyBtn onClick={()=>setShowFR(false)}>Cancel</TinyBtn>
          </div>
        </div>
      )}

      {/* Feature 13: Templates panel */}
      {showTpls&&(
        <div style={{position:"fixed",top:80,right:20,zIndex:20000,background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:12,padding:16,minWidth:280,maxHeight:"60vh",overflow:"auto",boxShadow:"var(--shadow-lg)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <span style={{fontWeight:700,fontSize:13}}>📁 Templates</span>
            <button onClick={()=>setShowTpls(false)} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:16}}>✕</button>
          </div>
          <button onClick={saveTpl} style={{width:"100%",padding:"8px",fontSize:12,fontWeight:600,background:"var(--accent-tint)",color:"var(--accent-light)",border:"1px dashed var(--border-accent)",borderRadius:6,cursor:"pointer",marginBottom:10}}>+ Save current as template</button>
          {savedTpls.length===0&&<div style={{fontSize:12,color:"var(--text-muted)",textAlign:"center",padding:"12px 0"}}>No saved templates yet.</div>}
          {savedTpls.map((t,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:"var(--bg-surface)",borderRadius:6,marginBottom:4,border:"1px solid var(--border)"}}>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:"var(--text-primary)"}}>{t.name}</div>
                <div style={{fontSize:10,color:"var(--text-muted)"}}>{t.elements.length} elements</div>
              </div>
              <div style={{display:"flex",gap:4}}>
                <TinyBtn onClick={()=>loadTpl(t)}>Load</TinyBtn>
                <TinyBtn onClick={()=>{const u=savedTpls.filter((_,j)=>j!==i);setSavedTpls(u);try{localStorage.setItem("ak_tpls",JSON.stringify(u));}catch{}}}>✕</TinyBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Feature 18: Keyboard shortcuts */}
      {showShortcuts&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:30000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowShortcuts(false)}>
          <div style={{background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:16,padding:24,maxWidth:480,width:"90%",maxHeight:"80vh",overflow:"auto",boxShadow:"var(--shadow-lg)"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <span style={{fontWeight:800,fontSize:15}}>⌨ Keyboard Shortcuts</span>
              <button onClick={()=>setShowShortcuts(false)} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:18}}>✕</button>
            </div>
            {SHORTCUT_LIST.map((s,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,background:i%2===0?"var(--bg-surface)":"transparent"}}>
                <code style={{fontSize:11,background:"var(--bg-base)",padding:"2px 6px",borderRadius:4,border:"1px solid var(--border-strong)",color:"var(--accent-light)",minWidth:130,flexShrink:0,fontFamily:"var(--font-mono)"}}>{s.keys}</code>
                <span style={{fontSize:12,color:"var(--text-secondary)"}}>{s.desc}</span>
              </div>
            ))}
            <div style={{marginTop:14,fontSize:11,color:"var(--text-muted)",textAlign:"center"}}>Press ? or / anytime to toggle</div>
          </div>
        </div>
      )}

      {/* Export size dialog — lets the user keep original / pick a preset /
          enter a custom size, and smart-fits the design when the ratio changes. */}
      {exportDialog&&(
        <ExportSizeDialog
          format={exportDialog.format}
          originalW={state.canvasW}
          originalH={state.canvasH}
          onCancel={()=>setExportDialog(null)}
          onConfirm={(w,h,fit)=>{exportCanvas(exportDialog.format,{targetW:w,targetH:h,fit});}}
        />
      )}
    </div>
  );
}


// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolBtn({icon,label,onClick}:{icon:string;label:string;onClick:()=>void}){
  return(
    <button onClick={onClick} style={{padding:"6px 4px",fontSize:11,fontWeight:600,borderRadius:5,cursor:"pointer",background:"var(--bg-elevated)",color:"var(--text-secondary)",border:"1px solid var(--border-strong)",display:"flex",flexDirection:"column",alignItems:"center",gap:2,transition:"all 0.15s"}}>
      <span style={{fontSize:14}}>{icon}</span>{label}
    </button>
  );
}

function TinyBtn({children,onClick,title,style}:{children:React.ReactNode;onClick?:()=>void;title?:string;style?:React.CSSProperties}){
  return(
    <button onClick={onClick} title={title} style={{padding:"3px 8px",fontSize:11,fontWeight:500,borderRadius:4,cursor:"pointer",background:"var(--bg-elevated)",color:"var(--text-secondary)",border:"1px solid var(--border-strong)",whiteSpace:"nowrap",...style}}>
      {children}
    </button>
  );
}

function TogBtn({active,onClick,title,children}:{active:boolean;onClick:()=>void;title?:string;children:React.ReactNode}){
  return(
    <button onClick={onClick} title={title} style={{padding:"3px 8px",fontSize:11,fontWeight:600,borderRadius:4,cursor:"pointer",background:active?"var(--accent-tint)":"var(--bg-elevated)",color:active?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${active?"var(--border-accent)":"var(--border-strong)"}`}}>
      {children}
    </button>
  );
}

function VSep(){return <div style={{width:1,height:18,background:"var(--border)",margin:"0 2px"}}/>;}
function SLabel({children}:{children:React.ReactNode}){return <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:3,marginTop:8}}>{children}</div>;}
function Row({children,gap}:{children:React.ReactNode;gap?:number}){return <div style={{display:"flex",alignItems:"center",gap:gap??6}}>{children}</div>;}

function NInput({value,onChange,min,max,step,label,style}:{value:number;onChange:(v:number)=>void;min?:number;max?:number;step?:number;label?:string;style?:React.CSSProperties}){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:2,...style}}>
      {label&&<span style={{fontSize:9,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</span>}
      <input type="number" value={value} min={min} max={max} step={step??1}
        onChange={e=>onChange(parseFloat(e.target.value)||0)}
        style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"4px 5px",fontSize:11,outline:"none",textAlign:"center",boxSizing:"border-box"}}/>
    </div>
  );
}

// Feature 5: Enhanced ColPick with eyedropper, recent colors, saved swatches
function ColPick({value,onChange,label}:{value:string;onChange:(v:string)=>void;label?:string}){
  const[open,setOpen]=useState(false);
  const[hex,setHex]=useState(value??"#7c7ffa");
  const[recentColors,setRecentColors]=useState<string[]>(()=>{
    try{return JSON.parse(localStorage.getItem("ak_recent_colors")??"[]");}catch{return[];}
  });
  const[swatches,setSwatches]=useState<string[]>(()=>{
    try{return JSON.parse(localStorage.getItem("ak_swatches")??"[]");}catch{return[];}
  });
  const[mode,setMode]=useState<"hex"|"rgb"|"hsl">("hex");

  const commit=(c:string)=>{
    onChange(c);setHex(c);
    const u=[c,...recentColors.filter(r=>r!==c)].slice(0,8);
    setRecentColors(u);try{localStorage.setItem("ak_recent_colors",JSON.stringify(u));}catch{}
    setOpen(false);
  };
  const addSwatch=(c:string)=>{
    const u=[...swatches.filter(s=>s!==c),c].slice(0,16);
    setSwatches(u);try{localStorage.setItem("ak_swatches",JSON.stringify(u));}catch{}
  };

  const hexToRgbStr=(h:string)=>{const r=hexToRgb(h);return r?`rgb(${r[0]},${r[1]},${r[2]})`:"";};
  const hexToHsl=(h:string)=>{
    const r=hexToRgb(h);if(!r)return"";
    const[R,G,B]=r.map(v=>v/255);const max=Math.max(R,G,B),min=Math.min(R,G,B);
    const l=(max+min)/2;let s=0,hv=0;
    if(max!==min){s=l>0.5?(max-min)/(2-max-min):(max-min)/(max+min);
      if(max===R)hv=((G-B)/(max-min)+(G<B?6:0))/6;
      else if(max===G)hv=((B-R)/(max-min)+2)/6;
      else hv=((R-G)/(max-min)+4)/6;}
    return`hsl(${Math.round(hv*360)},${Math.round(s*100)}%,${Math.round(l*100)}%)`;
  };

  const displayVal=mode==="hex"?hex:mode==="rgb"?hexToRgbStr(hex):hexToHsl(hex);

  return(
    <div style={{position:"relative"}}>
      {label&&<div style={{fontSize:9,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:2}}>{label}</div>}
      <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",background:"var(--bg-input)",border:"1px solid var(--border-strong)",borderRadius:5,padding:"4px 7px"}}>
        <div style={{width:14,height:14,borderRadius:3,background:value||hex,border:"1px solid rgba(255,255,255,0.2)",flexShrink:0}}/>
        <span style={{fontSize:10,color:"var(--text-secondary)",fontFamily:"var(--font-mono)",flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>{value||hex}</span>
      </div>
      {open&&(
        <div style={{position:"absolute",top:"100%",left:0,zIndex:50000,background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:10,padding:10,minWidth:200,boxShadow:"var(--shadow-lg)"}}>
          {/* Native color input */}
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <input type="color" value={hex} onChange={e=>{setHex(e.target.value);}}
              style={{width:36,height:36,borderRadius:6,border:"none",cursor:"pointer",padding:0,background:"none",flexShrink:0}}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:2,marginBottom:4}}>
                {(["hex","rgb","hsl"] as const).map(m=><button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"2px 0",fontSize:9,fontWeight:700,borderRadius:3,background:mode===m?"var(--accent-tint)":"none",color:mode===m?"var(--accent-light)":"var(--text-muted)",border:"none",cursor:"pointer",textTransform:"uppercase"}}>{m}</button>)}
              </div>
              <input value={displayVal} onChange={e=>setHex(e.target.value)} onBlur={()=>commit(hex)}
                style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"3px 5px",fontSize:10,outline:"none",fontFamily:"var(--font-mono)",boxSizing:"border-box"}}/>
            </div>
          </div>
          {/* Eyedropper */}
          {typeof (window as any).EyeDropper!=="undefined"&&(
            <button onClick={async()=>{try{const d=await new (window as any).EyeDropper().open();commit(d.sRGBHex);}catch{}}}
              style={{width:"100%",padding:"4px",fontSize:11,background:"none",border:"1px solid var(--border)",borderRadius:5,color:"var(--text-secondary)",cursor:"pointer",marginBottom:6}}>
              💉 Eyedropper
            </button>
          )}
          {/* Gradient presets */}
          <div style={{fontSize:9,color:"var(--text-muted)",textTransform:"uppercase",marginBottom:4}}>Gradient Presets</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>
            {GRADIENTS.map(g=>(
              <button key={g.label} title={g.label} onClick={()=>commit(g.v)} style={{width:20,height:20,borderRadius:3,background:g.v,border:"1px solid rgba(255,255,255,0.15)",cursor:"pointer",padding:0}}/>
            ))}
          </div>
          {/* Recent colors */}
          {recentColors.length>0&&<>
            <div style={{fontSize:9,color:"var(--text-muted)",textTransform:"uppercase",marginBottom:4}}>Recent</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>
              {recentColors.map(c=><button key={c} onClick={()=>commit(c)} style={{width:16,height:16,borderRadius:2,background:c,border:"1px solid rgba(255,255,255,0.15)",cursor:"pointer",padding:0}}/>)}
            </div>
          </>}
          {/* Saved swatches */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:9,color:"var(--text-muted)",textTransform:"uppercase"}}>Brand Swatches</span>
            <button onClick={()=>addSwatch(hex)} style={{fontSize:9,background:"none",border:"none",color:"var(--accent-light)",cursor:"pointer"}}>+ Save</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>
            {swatches.map(c=><button key={c} onClick={()=>commit(c)} style={{width:16,height:16,borderRadius:2,background:c,border:"1px solid rgba(255,255,255,0.15)",cursor:"pointer",padding:0}}/>)}
            {swatches.length===0&&<span style={{fontSize:10,color:"var(--text-muted)"}}>None yet</span>}
          </div>
          <button onClick={()=>commit(hex)} style={{width:"100%",padding:"6px",fontSize:12,fontWeight:600,background:"var(--accent)",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"}}>Apply</button>
        </div>
      )}
    </div>
  );
}

// Feature 3: text wraps at box width via inline editing div
function ElemRender({el,zoom,isSelected,isEditing,readOnly,onMouseDown,onDoubleClick,onTextChange,startResize,onContextMenu}:{
  el:EditorElement;zoom:number;isSelected:boolean;isEditing:boolean;readOnly:boolean;
  onMouseDown:(e:React.MouseEvent)=>void;onDoubleClick:()=>void;
  onTextChange:(t:string)=>void;
  startResize:(e:React.MouseEvent,id:string,h:HandlePos)=>void;
  onContextMenu:(e:React.MouseEvent)=>void;
}){
  const rot=el.rotation??0;
  const handles: HandlePos[]=["nw","n","ne","e","se","s","sw","w","rot"];
  const HSIZE=7,ROT_DIST=20;
  const HPOS:Record<HandlePos,{left:string|number;top:string|number}> = {
    nw:{left:-HSIZE/2,top:-HSIZE/2},n:{left:"calc(50% - 3.5px)",top:-HSIZE/2},ne:{left:"calc(100% - 3.5px)",top:-HSIZE/2},
    e:{left:"calc(100% - 3.5px)",top:"calc(50% - 3.5px)"},se:{left:"calc(100% - 3.5px)",top:"calc(100% - 3.5px)"},
    s:{left:"calc(50% - 3.5px)",top:"calc(100% - 3.5px)"},sw:{left:-HSIZE/2,top:"calc(100% - 3.5px)"},
    w:{left:-HSIZE/2,top:"calc(50% - 3.5px)"},rot:{left:"calc(50% - 3.5px)",top:-(HSIZE/2+ROT_DIST)},
  };

  const flipX=el.flipH?-1:1,flipY=el.flipV?-1:1;
  const crop=el.crop;
  const clipStyle=crop&&el.type==="image"?{clipPath:`inset(${crop.y*100}% ${(1-crop.x-crop.w)*100}% ${(1-crop.y-crop.h)*100}% ${crop.x*100}%)`}:{};

  const style:React.CSSProperties={
    position:"absolute",left:el.x*zoom,top:el.y*zoom,width:el.width*zoom,height:el.height*zoom,
    transform:`rotate(${rot}deg) scaleX(${flipX}) scaleY(${flipY})`,transformOrigin:"center",
    opacity:el.opacity??1,mixBlendMode:el.blendMode??"normal",cursor:readOnly?"default":"move",
    pointerEvents:readOnly?"none":"auto",zIndex:el.zIndex,
    outline:isSelected?"2px solid var(--accent)":"none",outlineOffset:1,
    ...clipStyle,
  };

  const inner = (()=>{
    if(el.type==="image")return(
      <img src={el.src??""} alt="" draggable={false}
        style={{width:"100%",height:"100%",objectFit:el.objectFit??"cover",display:"block",userSelect:"none"}}/>
    );
    if(el.type==="ellipse")return(
      <div style={{width:"100%",height:"100%",borderRadius:"50%",background:el.gradient||el.fill||"transparent",
        outline:el.strokeWidth?`${el.strokeWidth*zoom}px solid ${el.stroke||"#fff"}`:"none"}}/>
    );
    if(el.type==="line")return(
      <svg width="100%" height="100%" style={{overflow:"visible",display:"block"}}>
        <line x1="0" y1={el.height*zoom/2} x2={el.width*zoom} y2={el.height*zoom/2}
          stroke={el.stroke||"#fff"} strokeWidth={(el.strokeWidth||2)*zoom}
          strokeDasharray={el.strokeDash?el.strokeDash.split(" ").map(v=>parseFloat(v)*zoom).join(" "):undefined}/>
      </svg>
    );
    if(el.type==="rect")return(
      <div style={{width:"100%",height:"100%",borderRadius:(el.borderRadius??0)*zoom,background:el.gradient||el.fill||"transparent",
        border:el.strokeWidth?`${el.strokeWidth*zoom}px solid ${el.stroke||"transparent"}`:"none",
        boxSizing:"border-box",
        boxShadow:el.shadow?`${el.shadow.x*zoom}px ${el.shadow.y*zoom}px ${el.shadow.blur*zoom}px ${el.shadow.spread*zoom}px ${el.shadow.color}`:"none",
        backgroundImage:el.gradient||undefined}}/>
    );
    if(el.type==="text"){
      // Feature 3: auto-wrap at box width. autoFit shrinks font to fit.
      const autoFontSize=el.autoFit&&el.text
        ? Math.min((el.fontSize??32), (el.width / (el.text.length * 0.55 + 1)) * (1/zoom) * zoom)
        : (el.fontSize??32);
      if(isEditing)return(
        // Feature 3: contentEditable div auto-wraps text at box width
        <div contentEditable suppressContentEditableWarning
          onInput={e=>onTextChange((e.target as HTMLElement).innerText)}
          style={{width:"100%",height:"100%",fontSize:autoFontSize*zoom,fontFamily:el.fontFamily??"Syne",fontWeight:el.fontWeight??700,
            fontStyle:el.fontStyle??"normal",textDecoration:el.textDecoration??"none",
            color:el.color??"#fff",textAlign:el.align??"left",
            lineHeight:el.lineHeight??1.25,letterSpacing:(el.letterSpacing??0)*zoom,
            textTransform:el.textTransform??"none",
            outline:"none",whiteSpace:"pre-wrap",wordBreak:"break-word",overflowWrap:"break-word",
            padding:"2px",cursor:"text",background:"rgba(124,127,250,0.06)",borderRadius:2,
            boxSizing:"border-box",overflow:"hidden"}}
          dangerouslySetInnerHTML={{__html:el.text??""}}/>
      );
      return(
        <div style={{width:"100%",height:"100%",fontSize:autoFontSize*zoom,fontFamily:el.fontFamily??"Syne",fontWeight:el.fontWeight??700,
          fontStyle:el.fontStyle??"normal",textDecoration:el.textDecoration??"none",
          color:el.color??"#fff",textAlign:el.align??"left",
          lineHeight:el.lineHeight??1.25,letterSpacing:(el.letterSpacing??0)*zoom,
          textTransform:el.textTransform??"none",
          whiteSpace:"pre-wrap",wordBreak:"break-word",overflowWrap:"break-word",
          userSelect:"none",padding:"2px",boxSizing:"border-box",overflow:"hidden",
          textShadow:el.textShadow,WebkitTextStroke:el.textStroke}}>
          {el.text??""}
        </div>
      );
    }
    return null;
  })();

  return(
    <div style={style} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
      {inner}
      {isSelected&&!readOnly&&handles.map(h=>(
        <div key={h} onMouseDown={e=>startResize(e,el.id,h)}
          style={{position:"absolute",width:HSIZE,height:HSIZE,background:h==="rot"?"#22d3ee":"#fff",border:`1.5px solid ${h==="rot"?"#22d3ee":"var(--accent)"}`,borderRadius:h==="rot"?4:1,...HPOS[h],cursor:CURSOR2[h],zIndex:9999,pointerEvents:"all"}}/>
      ))}
      {isSelected&&el.locked&&<div style={{position:"absolute",inset:0,background:"rgba(124,127,250,0.06)",pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:14,opacity:0.5}}>🔒</span></div>}
    </div>
  );
}

function LayerItem({el,isSelected,isRenaming,renameVal,onSelect,onLock,onVisibility,onFwd,onBwd,onRenameStart,onRenameChange,onRenameEnd,onDelete}:{
  el:EditorElement;isSelected:boolean;isRenaming:boolean;renameVal:string;
  onSelect:(e:React.MouseEvent)=>void;onLock:()=>void;onVisibility:()=>void;
  onFwd:()=>void;onBwd:()=>void;
  onRenameStart:()=>void;onRenameChange:(v:string)=>void;onRenameEnd:()=>void;
  onDelete:()=>void;
}){
  const ICONS:Record<ElementType,string>={text:"T",image:"🖼",rect:"▭",ellipse:"◯",line:"—"};
  const label=el.name??(el.type==="text"?`"${(el.text??"").slice(0,14)}"`:el.type);
  return(
    <div onClick={onSelect} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 5px",borderRadius:5,cursor:"pointer",marginBottom:1,background:isSelected?"var(--accent-tint)":"transparent",border:`1px solid ${isSelected?"var(--border-accent)":"transparent"}`}}>
      <span style={{fontSize:10,opacity:0.5,width:12,textAlign:"center",flexShrink:0}}>{ICONS[el.type]}</span>
      {isRenaming?(
        <input autoFocus value={renameVal} onChange={e=>onRenameChange(e.target.value)} onBlur={onRenameEnd} onKeyDown={e=>{if(e.key==="Enter")onRenameEnd();}} style={{flex:1,background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:3,padding:"2px 4px",fontSize:11,outline:"none"}} onClick={e=>e.stopPropagation()}/>
      ):(
        <span onDoubleClick={e=>{e.stopPropagation();onRenameStart();}} title={label} style={{flex:1,fontSize:11,color:isSelected?"var(--accent-light)":"var(--text-secondary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
      )}
      <button onClick={e=>{e.stopPropagation();onFwd();}} title="Bring forward" style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:9,padding:"1px 2px",opacity:0.6}}>↑</button>
      <button onClick={e=>{e.stopPropagation();onBwd();}} title="Send backward" style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:9,padding:"1px 2px",opacity:0.6}}>↓</button>
      <button onClick={e=>{e.stopPropagation();onVisibility();}} title="Toggle visibility" style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:10,padding:"1px 2px"}}>{el.visible===false?"👁‍🗨":"👁"}</button>
      <button onClick={e=>{e.stopPropagation();onLock();}} title="Lock" style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:10,padding:"1px 2px"}}>{el.locked?"🔒":"🔓"}</button>
      <button onClick={e=>{e.stopPropagation();onDelete();}} style={{background:"none",border:"none",color:"var(--error)",cursor:"pointer",fontSize:10,padding:"1px 3px",opacity:0.6}}>✕</button>
    </div>
  );
}


function PropsPanel({el,upd,dispatch,onCrop,onAiText,onAiBg,aiLoading,bgRmLoading,onStyleCopy,onStylePaste}:{
  el:EditorElement;upd:(k:keyof EditorElement,v:any)=>void;dispatch:React.Dispatch<EditorAction>;
  onCrop:(id:string)=>void;onAiText:(id:string,text:string)=>void;onAiBg:(id:string,src:string)=>void;
  aiLoading:string|null;bgRmLoading:boolean;onStyleCopy:()=>void;onStylePaste:()=>void;
}){
  const[showPin,setShowPin]=useState(false);
  return(
    <div style={{padding:"8px 10px"}}>
      <SLabel>Transform</SLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
        <NInput label="X" value={Math.round(el.x)} onChange={v=>upd("x",v)}/>
        <NInput label="Y" value={Math.round(el.y)} onChange={v=>upd("y",v)}/>
        <NInput label="W" value={Math.round(el.width)} min={1} onChange={v=>upd("width",v)}/>
        <NInput label="H" value={Math.round(el.height)} min={1} onChange={v=>upd("height",v)}/>
        <NInput label="Rotate" value={el.rotation??0} min={-360} max={360} onChange={v=>upd("rotation",v)}/>
        <NInput label="Opacity" value={Math.round((el.opacity??1)*100)} min={0} max={100} onChange={v=>upd("opacity",v/100)}/>
      </div>
      {/* Feature 11: Pin anchor */}
      <div style={{marginTop:6}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <SLabel>Pin Anchor</SLabel>
          <button onClick={()=>setShowPin(v=>!v)} style={{background:"none",border:"none",color:"var(--accent)",fontSize:10,cursor:"pointer"}}>{showPin?"▲":"▼"}</button>
        </div>
        {showPin&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:2,marginBottom:6}}>
            {PIN_ANCHORS.map(a=>(
              <button key={a} onClick={()=>upd("pinAnchor",a)} title={a}
                style={{padding:"4px 2px",fontSize:9,borderRadius:3,cursor:"pointer",background:el.pinAnchor===a?"var(--accent-tint)":"var(--bg-elevated)",color:el.pinAnchor===a?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${el.pinAnchor===a?"var(--border-accent)":"var(--border-strong)"}`,textTransform:"capitalize",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {a.split("-").map(w=>w[0]).join("")||"●"}
              </button>
            ))}
          </div>
        )}
      </div>

      <SLabel>Blend Mode</SLabel>
      <select value={el.blendMode??"normal"} onChange={e=>upd("blendMode",e.target.value as BlendMode)}
        style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"4px 5px",fontSize:11,outline:"none",boxSizing:"border-box"}}>
        {BLEND_MODES.map(m=><option key={m} value={m}>{m}</option>)}
      </select>

      {(el.type==="text")&&(
        <>
          <SLabel>Text Content</SLabel>
          <textarea value={el.text??""} onChange={e=>upd("text",e.target.value)} rows={3}
            style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"5px",fontSize:11,outline:"none",resize:"vertical",boxSizing:"border-box"}}/>
          {/* Feature 8: AI text generation */}
          <button onClick={()=>onAiText(el.id,el.text??"")} disabled={aiLoading===el.id}
            style={{width:"100%",padding:"5px",fontSize:11,fontWeight:600,marginBottom:4,borderRadius:5,cursor:"pointer",background:"linear-gradient(135deg,#7c7ffa,#f472b6)",color:"#fff",border:"none",opacity:aiLoading===el.id?0.6:1}}>
            {aiLoading===el.id?"✦ Generating…":"✦ Write with AI"}
          </button>
          <SLabel>Font</SLabel>
          <select value={el.fontFamily??"Syne"} onChange={e=>upd("fontFamily",e.target.value)}
            style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"4px 5px",fontSize:11,outline:"none",boxSizing:"border-box",marginBottom:4}}>
            {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
            <NInput label="Size" value={el.fontSize??32} min={6} onChange={v=>upd("fontSize",v)}/>
            <NInput label="Weight" value={el.fontWeight??700} min={100} max={900} step={100} onChange={v=>upd("fontWeight",v)}/>
            <NInput label="Line H" value={el.lineHeight??1.25} min={0.8} max={4} step={0.05} onChange={v=>upd("lineHeight",v)}/>
            <NInput label="Spacing" value={el.letterSpacing??0} min={-10} max={40} onChange={v=>upd("letterSpacing",v)}/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5}}>
            <button onClick={()=>upd("autoFit",!el.autoFit)} style={{padding:"3px 8px",fontSize:10,fontWeight:600,borderRadius:4,cursor:"pointer",background:el.autoFit?"var(--accent-tint)":"var(--bg-elevated)",color:el.autoFit?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${el.autoFit?"var(--border-accent)":"var(--border-strong)"}`}}>
              Auto-fit font
            </button>
            <span style={{fontSize:9,color:"var(--text-muted)"}}>Shrinks text to fit width</span>
          </div>
          <SLabel>Align</SLabel>
          <Row>
            {(["left","center","right","justify"] as const).map(a=>(
              <button key={a} onClick={()=>upd("align",a)} style={{flex:1,padding:"4px 2px",fontSize:10,borderRadius:3,cursor:"pointer",background:el.align===a?"var(--accent-tint)":"var(--bg-elevated)",color:el.align===a?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${el.align===a?"var(--border-accent)":"var(--border-strong)"}`}}>{a[0].toUpperCase()}</button>
            ))}
          </Row>
          <SLabel>Style</SLabel>
          <Row>
            {([["I","fontStyle","normal","italic"],["U","textDecoration","none","underline"],["S","textDecoration","none","line-through"]] as [string,keyof EditorElement,string,string][]).map(([icon,key,off,on])=>(
              <button key={icon} onClick={()=>upd(key,(el[key]===on?off:on))} style={{flex:1,padding:"4px",fontSize:12,borderRadius:3,cursor:"pointer",fontStyle:icon==="I"?"italic":"normal",textDecoration:icon==="U"?"underline":icon==="S"?"line-through":"none",background:el[key]===on?"var(--accent-tint)":"var(--bg-elevated)",color:el[key]===on?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${el[key]===on?"var(--border-accent)":"var(--border-strong)"}`}}>{icon}</button>
            ))}
          </Row>
          <SLabel>Transform</SLabel>
          <Row>
            {(["none","uppercase","lowercase","capitalize"] as const).map(t=>(
              <button key={t} onClick={()=>upd("textTransform",t)} style={{flex:1,padding:"3px 1px",fontSize:8,borderRadius:3,cursor:"pointer",background:el.textTransform===t?"var(--accent-tint)":"var(--bg-elevated)",color:el.textTransform===t?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${el.textTransform===t?"var(--border-accent)":"var(--border-strong)"}`,textTransform:"none"}}>{t==="none"?"Aa":t[0].toUpperCase()}</button>
            ))}
          </Row>
          <SLabel>Color</SLabel>
          <ColPick value={el.color??"#ffffff"} onChange={v=>upd("color",v)}/>
        </>
      )}

      {(el.type==="rect"||el.type==="ellipse")&&(
        <>
          <SLabel>Fill</SLabel>
          <ColPick value={el.fill??"transparent"} onChange={v=>upd("fill",v)}/>
          <SLabel>Border Radius</SLabel>
          <NInput value={el.borderRadius??0} min={0} max={500} onChange={v=>upd("borderRadius",v)}/>
        </>
      )}

      {(el.type==="rect"||el.type==="ellipse"||el.type==="line")&&(
        <>
          <SLabel>Stroke</SLabel>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:5}}>
            <ColPick value={el.stroke??"#ffffff"} onChange={v=>upd("stroke",v)}/>
            <NInput label="Width" value={el.strokeWidth??0} min={0} max={80} onChange={v=>upd("strokeWidth",v)}/>
          </div>
          {/* Feature 16: Stroke dash presets */}
          <SLabel>Stroke Style</SLabel>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {STROKE_DASH_PRESETS.map(p=>(
              <button key={p.label} onClick={()=>upd("strokeDash",p.value)} style={{padding:"3px 7px",fontSize:10,borderRadius:4,cursor:"pointer",background:el.strokeDash===p.value?"var(--accent-tint)":"var(--bg-elevated)",color:el.strokeDash===p.value?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${el.strokeDash===p.value?"var(--border-accent)":"var(--border-strong)"}`}}>{p.label}</button>
            ))}
          </div>
        </>
      )}

      {el.type==="image"&&(
        <>
          <SLabel>Object Fit</SLabel>
          <Row>
            {(["cover","contain","fill"] as const).map(f=>(
              <button key={f} onClick={()=>upd("objectFit",f)} style={{flex:1,padding:"4px 2px",fontSize:10,borderRadius:3,cursor:"pointer",background:el.objectFit===f?"var(--accent-tint)":"var(--bg-elevated)",color:el.objectFit===f?"var(--accent-light)":"var(--text-muted)",border:`1px solid ${el.objectFit===f?"var(--border-accent)":"var(--border-strong)"}`}}>{f}</button>
            ))}
          </Row>
          <SLabel>Image Actions</SLabel>
          {/* Feature 4: Enter crop mode */}
          <button onClick={()=>onCrop(el.id)} style={{width:"100%",padding:"5px",fontSize:11,fontWeight:600,background:"var(--bg-elevated)",color:"var(--text-secondary)",border:"1px solid var(--border-strong)",borderRadius:5,cursor:"pointer",marginBottom:4}}>
            ✂ Enter Crop Mode
          </button>
          {el.crop&&<button onClick={()=>upd("crop",undefined)} style={{width:"100%",padding:"5px",fontSize:11,fontWeight:600,background:"none",color:"var(--error)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:5,cursor:"pointer",marginBottom:4}}>✕ Clear Crop</button>}
          {/* Feature 9: AI BG remove */}
          <button onClick={()=>onAiBg(el.id,el.src??"")} disabled={bgRmLoading}
            style={{width:"100%",padding:"5px",fontSize:11,fontWeight:600,background:"linear-gradient(135deg,#7c7ffa,#22d3ee)",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",opacity:bgRmLoading?0.6:1}}>
            {bgRmLoading?"✦ Removing BG…":"✦ Remove Background"}
          </button>
        </>
      )}

      {/* Style copy/paste */}
      <SLabel>Style</SLabel>
      <Row>
        <TinyBtn onClick={onStyleCopy} style={{flex:1}}>Copy Style</TinyBtn>
        <TinyBtn onClick={onStylePaste} style={{flex:1}}>Paste Style</TinyBtn>
      </Row>
    </div>
  );
}

function EffectsPanel({el,upd,showGrad,setShowGrad,showGradEd,setShowGradEd,gradAngle,setGradAngle,gradStops,setGradStops,buildGradient}:{
  el:EditorElement;upd:(k:keyof EditorElement,v:any)=>void;
  showGrad:boolean;setShowGrad:(v:boolean)=>void;
  showGradEd:boolean;setShowGradEd:(v:boolean)=>void;
  gradAngle:number;setGradAngle:(v:number)=>void;
  gradStops:{offset:number;color:string}[];setGradStops:(v:{offset:number;color:string}[])=>void;
  buildGradient:()=>string;
}){
  const[showShadow,setShowShadow]=useState(false);
  const shadow=el.shadow?{...el.shadow}:{x:2,y:4,blur:12,spread:0,color:"rgba(0,0,0,0.5)"};
  return(
    <div style={{padding:"8px 10px"}}>
      <SLabel>Gradient Fill</SLabel>
      <Row>
        <TogBtn active={showGrad} onClick={()=>setShowGrad(!showGrad)}>Preset</TogBtn>
        {/* Feature 15: Custom gradient editor */}
        <TogBtn active={showGradEd} onClick={()=>setShowGradEd(!showGradEd)}>Custom ✎</TogBtn>
        {(el.gradient)&&<TinyBtn onClick={()=>upd("gradient",undefined)}>Clear</TinyBtn>}
      </Row>
      {showGrad&&!showGradEd&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
          {GRADIENTS.map(g=>(
            <button key={g.label} onClick={()=>upd("gradient",g.v)} title={g.label} style={{padding:"4px 8px",fontSize:10,borderRadius:4,cursor:"pointer",background:g.v,color:"#fff",border:"none",textShadow:"0 1px 2px rgba(0,0,0,0.6)",width:"calc(50% - 2px)",fontWeight:600}}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      {showGradEd&&(
        <div style={{marginTop:8,background:"var(--bg-elevated)",border:"1px solid var(--border-strong)",borderRadius:8,padding:10}}>
          <div style={{height:24,borderRadius:4,marginBottom:8,background:buildGradient()}}/>
          <NInput label="Angle °" value={gradAngle} min={0} max={360} onChange={setGradAngle}/>
          <div style={{marginTop:8}}>
            <div style={{fontSize:10,color:"var(--text-muted)",marginBottom:4}}>Color Stops</div>
            {gradStops.map((stop,i)=>(
              <div key={i} style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
                <ColPick value={stop.color} onChange={c=>{const u=[...gradStops];u[i]={...u[i],color:c};setGradStops(u);}}/>
                <NInput value={stop.offset} min={0} max={100} label="%" onChange={v=>{const u=[...gradStops];u[i]={...u[i],offset:v};setGradStops(u);}} style={{width:60}}/>
                {gradStops.length>2&&<button onClick={()=>setGradStops(gradStops.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"var(--error)",cursor:"pointer",fontSize:12,padding:"0 3px"}}>✕</button>}
              </div>
            ))}
            <button onClick={()=>setGradStops([...gradStops,{offset:100,color:"#ffffff"}])} style={{width:"100%",padding:"4px",fontSize:11,background:"none",border:"1px dashed var(--border)",borderRadius:4,color:"var(--accent-light)",cursor:"pointer",marginBottom:6}}>+ Add Stop</button>
            <button onClick={()=>upd("gradient",buildGradient())} style={{width:"100%",padding:"6px",fontSize:12,fontWeight:600,background:"var(--accent)",color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>Apply Gradient</button>
          </div>
        </div>
      )}

      <SLabel>Drop Shadow</SLabel>
      <TogBtn active={showShadow} onClick={()=>setShowShadow(!showShadow)}>{showShadow?"Hide":"Show"} Shadow Controls</TogBtn>
      {(el.shadow||showShadow)&&(
        <div style={{marginTop:6,display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
          <NInput label="X" value={shadow.x} min={-100} max={100} onChange={v=>upd("shadow",{...shadow,x:v})}/>
          <NInput label="Y" value={shadow.y} min={-100} max={100} onChange={v=>upd("shadow",{...shadow,y:v})}/>
          <NInput label="Blur" value={shadow.blur} min={0} max={100} onChange={v=>upd("shadow",{...shadow,blur:v})}/>
          <NInput label="Spread" value={shadow.spread} min={-50} max={50} onChange={v=>upd("shadow",{...shadow,spread:v})}/>
          <div style={{gridColumn:"1/-1"}}><ColPick label="Shadow Color" value={shadow.color} onChange={c=>upd("shadow",{...shadow,color:c})}/></div>
          <div style={{gridColumn:"1/-1"}}>
            <TinyBtn onClick={()=>upd("shadow",undefined)} style={{width:"100%"}}>Remove Shadow</TinyBtn>
          </div>
        </div>
      )}

      {el.type==="text"&&(
        <>
          <SLabel>Text Shadow</SLabel>
          <input value={el.textShadow??""} onChange={e=>upd("textShadow",e.target.value)} placeholder="e.g. 2px 2px 6px #000"
            style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"4px 6px",fontSize:11,outline:"none",boxSizing:"border-box"}}/>
          <SLabel>Text Stroke</SLabel>
          <input value={el.textStroke??""} onChange={e=>upd("textStroke",e.target.value)} placeholder="e.g. 1px #000"
            style={{width:"100%",background:"var(--bg-input)",color:"var(--text-primary)",border:"1px solid var(--border-strong)",borderRadius:4,padding:"4px 6px",fontSize:11,outline:"none",boxSizing:"border-box"}}/>
        </>
      )}
    </div>
  );
}

function BrandPanel({brandKit,dispatch,state}:{brandKit:ArkiolEditorProps["brandKit"];dispatch:React.Dispatch<EditorAction>;state:EditorState}){
  if(!brandKit)return(
    <div style={{padding:20,textAlign:"center",color:"var(--text-muted)",fontSize:12}}>
      <div style={{fontSize:28,marginBottom:8,opacity:0.4}}>🎨</div>
      No brand kit connected.<br/>Pass a <code style={{fontSize:10}}>brandKit</code> prop to enable.
    </div>
  );
  return(
    <div style={{padding:"8px 10px"}}>
      <SLabel>Brand Colors</SLabel>
      <div style={{display:"flex",gap:4,marginBottom:8}}>
        {[brandKit.primaryColor,brandKit.secondaryColor].map(c=>(
          <button key={c} onClick={()=>dispatch({type:"SET_BG",color:c})} title={`Set BG to ${c}`}
            style={{width:28,height:28,borderRadius:5,background:c,border:"2px solid rgba(255,255,255,0.15)",cursor:"pointer"}}/>
        ))}
      </div>
      <SLabel>Brand Fonts</SLabel>
      <div style={{fontSize:12,color:"var(--text-secondary)",marginBottom:4}}>Display: <strong>{brandKit.fontDisplay}</strong></div>
      <div style={{fontSize:12,color:"var(--text-secondary)",marginBottom:8}}>Body: <strong>{brandKit.fontBody}</strong></div>
      {brandKit.logoUrl&&<>
        <SLabel>Logo</SLabel>
        <button onClick={()=>dispatch({type:"ADD_ELEMENT",element:{id:`bk_logo_${Date.now()}`,type:"image",x:50,y:50,width:200,height:80,rotation:0,zIndex:state.elements.length+1,locked:false,visible:true,opacity:1,blendMode:"normal",src:brandKit.logoUrl,objectFit:"contain"}})}
          style={{width:"100%",padding:"6px",fontSize:11,fontWeight:600,background:"var(--accent-tint)",color:"var(--accent-light)",border:"1px dashed var(--border-accent)",borderRadius:5,cursor:"pointer"}}>
          + Insert Logo
        </button>
      </>}
    </div>
  );
}

function SettingsPanel({state,dispatch,zoom,setZoom}:{state:EditorState;dispatch:React.Dispatch<EditorAction>;zoom:number;setZoom:(v:number)=>void}){
  const[customW,setCustomW]=useState(state.canvasW);
  const[customH,setCustomH]=useState(state.canvasH);
  return(
    <div style={{padding:"8px 10px"}}>
      <SLabel>Canvas Background</SLabel>
      <ColPick value={state.bgColor} onChange={c=>dispatch({type:"SET_BG",color:c})}/>
      <SLabel>Gradient Background</SLabel>
      <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>
        {GRADIENTS.map(g=>(
          <button key={g.label} onClick={()=>dispatch({type:"SET_BG",color:g.v})} title={g.label}
            style={{padding:"4px 7px",fontSize:10,borderRadius:4,cursor:"pointer",background:g.v,color:"#fff",border:"none",textShadow:"0 1px 2px rgba(0,0,0,0.6)",fontWeight:600}}>
            {g.label}
          </button>
        ))}
      </div>
      <SLabel>Canvas Size Presets</SLabel>
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        {PRESETS.map(p=>(
          <button key={p.label} onClick={()=>{setCustomW(p.w);setCustomH(p.h);dispatch({type:"RESIZE_CANVAS",w:p.w,h:p.h,keepRelative:true});}}
            style={{padding:"5px 8px",textAlign:"left",fontSize:11,borderRadius:4,cursor:"pointer",background:"var(--bg-elevated)",color:"var(--text-secondary)",border:"1px solid var(--border-strong)"}}>
            <strong>{p.label}</strong> <span style={{color:"var(--text-muted)",fontSize:10}}>{p.w}×{p.h}</span>
          </button>
        ))}
      </div>
      <SLabel>Custom Size</SLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
        <NInput label="W px" value={customW} min={100} max={8192} onChange={setCustomW}/>
        <NInput label="H px" value={customH} min={100} max={8192} onChange={setCustomH}/>
      </div>
      <button onClick={()=>dispatch({type:"RESIZE_CANVAS",w:customW,h:customH,keepRelative:true})}
        style={{width:"100%",padding:"6px",fontSize:12,fontWeight:600,background:"var(--accent)",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",marginTop:6}}>
        Apply Size
      </button>
      <SLabel>Zoom</SLabel>
      <Row>
        <TinyBtn onClick={()=>setZoom(0.25)}>25%</TinyBtn>
        <TinyBtn onClick={()=>setZoom(0.5)}>50%</TinyBtn>
        <TinyBtn onClick={()=>setZoom(0.75)}>75%</TinyBtn>
        <TinyBtn onClick={()=>setZoom(1)}>100%</TinyBtn>
        <TinyBtn onClick={()=>setZoom(1.5)}>150%</TinyBtn>
        <TinyBtn onClick={()=>setZoom(2)}>200%</TinyBtn>
      </Row>
    </div>
  );
}

export default ArkiolEditor;
