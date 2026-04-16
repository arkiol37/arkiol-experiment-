// src/engines/render/svg-decorations.ts  — Arkiol Ultimate v4
// Renders every DecorShape type to pixel-perfect SVG.
// New v4 shapes: arc_stroke, corner_bracket, diagonal_band, noise_overlay
// Blob upgraded: 12-point smooth cubic bezier (organic, Canva-quality)

import { DecorShape } from "./design-themes";
import type { BgTreatment } from "./design-themes";

export function renderDecoration(shape: DecorShape, width: number, height: number): string {
  const px  = (pct: number, total: number) => (pct / 100) * total;
  const min = Math.min(width, height);

  switch (shape.kind) {

    case "circle": {
      const cx = px(shape.x, width), cy = px(shape.y, height), r = px(shape.r, min);
      if (shape.stroke || shape.strokeWidth) {
        const sw = shape.strokeWidth ?? 1.5;
        return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${shape.color}" stroke-width="${sw}" opacity="${shape.opacity}"/>`;
      }
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
    }

    case "rect": {
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${shape.color}" opacity="${shape.opacity}" rx="${shape.rx}"/>`;
    }

    case "blob": {
      const cx=px(shape.x,width), cy=px(shape.y,height), sz=px(shape.size,min);
      return `<path d="${generateBlobPath(cx, cy, sz, shape.seed)}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
    }

    case "line": {
      const x1=px(shape.x1,width), y1=px(shape.y1,height), x2=px(shape.x2,width), y2=px(shape.y2,height);
      const dash = shape.dash ? ` stroke-dasharray="${shape.dash}"` : "";
      return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${shape.color}" stroke-width="${shape.width}" stroke-linecap="round" opacity="${shape.opacity}"${dash}/>`;
    }

    case "dots_grid": {
      const ox=px(shape.x,width), oy=px(shape.y,height), gap=px(shape.gap,min);
      let svg = `<g opacity="${shape.opacity}">`;
      for (let row=0; row<shape.rows; row++) for (let col=0; col<shape.cols; col++)
        svg += `<circle cx="${f(ox+col*gap)}" cy="${f(oy+row*gap)}" r="${shape.r}" fill="${shape.color}"/>`;
      return svg + `</g>`;
    }

    case "diagonal_stripe": {
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${shape.color}" opacity="${shape.opacity}" transform="skewX(-15)"/>`;
    }

    case "half_circle": {
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const sx=cx-r, ex=cx+r;
      return `<path d="M ${f(sx)} ${f(cy)} A ${f(r)} ${f(r)} 0 0 1 ${f(ex)} ${f(cy)}" fill="${shape.color}" opacity="${shape.opacity}" transform="rotate(${shape.rotation},${f(cx)},${f(cy)})"/>`;
    }

    case "accent_bar": {
      const x=px(shape.x,width), y=px(shape.y,height), w=Math.max(px(shape.w,width),1), h=px(shape.h,height);
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${shape.color}" rx="${shape.rx}"/>`;
    }

    case "badge_pill": {
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      const rx=h/2, tx=x+w/2, ty=y+h/2+shape.fontSize*0.35;
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${shape.color}" rx="${f(rx)}"/>`
        + `<text x="${f(tx)}" y="${f(ty)}" font-size="${shape.fontSize}" font-weight="700" fill="${shape.textColor}" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" letter-spacing="0.1em">${esc(shape.text)}</text>`;
    }

    case "deco_ring": {
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const dash=shape.dash ? ` stroke-dasharray="${shape.dash}"` : "";
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${shape.color}" stroke-width="${shape.strokeWidth}" opacity="${shape.opacity}"${dash}/>`;
    }

    case "triangle": {
      const cx=px(shape.x,width), cy=px(shape.y,height), s=px(shape.size,min), h2=s*0.866;
      const p=[[cx,cy-h2*0.667],[cx+s/2,cy+h2*0.333],[cx-s/2,cy+h2*0.333]];
      const pts=p.map(([x,y])=>`${f(x)},${f(y)}`).join(" ");
      return `<polygon points="${pts}" fill="${shape.color}" opacity="${shape.opacity}" transform="rotate(${shape.rotation},${f(cx)},${f(cy)})"/>`;
    }

    case "cross": {
      const cx=px(shape.x,width), cy=px(shape.y,height), s=px(shape.size,min)/2, t=px(shape.thickness,min)/2;
      const hBar=`<rect x="${f(cx-s)}" y="${f(cy-t)}" width="${f(s*2)}" height="${f(t*2)}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
      const vBar=`<rect x="${f(cx-t)}" y="${f(cy-s)}" width="${f(t*2)}" height="${f(s*2)}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
      return `<g transform="rotate(${shape.rotation},${f(cx)},${f(cy)})">${hBar}${vBar}</g>`;
    }

    case "wave": {
      const x=px(shape.x,width), y=px(shape.y,height), ww=px(shape.w,width);
      const amp=px(shape.amplitude,height), freq=shape.frequency, steps=80;
      const pts:string[]=[];
      for(let i=0;i<=steps;i++){const t=i/steps;pts.push(`${f(x+t*ww)},${f(y+Math.sin(t*freq*Math.PI*2)*amp)}`);}
      const pathD=`M ${pts[0]} L ${pts.slice(1).join(" L ")} L ${f(x+ww)},${f(y+amp*6)} L ${f(x)},${f(y+amp*6)} Z`;
      return `<path d="${pathD}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
    }

    case "card_panel": {
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      const id=`cpf_${Math.round(x*10)}`;
      if(shape.shadow){
        return `<filter id="${id}"><feDropShadow dx="0" dy="6" stdDeviation="16" flood-color="rgba(0,0,0,0.12)"/></filter>`
          + `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${shape.color}" opacity="${shape.opacity}" rx="${shape.rx}" filter="url(#${id})"/>`;
      }
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${shape.color}" opacity="${shape.opacity}" rx="${shape.rx}"/>`;
    }

    case "glow_circle": {
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const id=`glw_${Math.round(cx)}_${Math.round(cy)}`;
      return `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">`
        + `<stop offset="0%" stop-color="${shape.color}" stop-opacity="${shape.opacity}"/>`
        + `<stop offset="100%" stop-color="${shape.color}" stop-opacity="0"/>`
        + `</radialGradient>`
        + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="url(#${id})"/>`;
    }

    case "flower": {
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const pRx=r*0.42, pRy=r*1.08, off=r*0.52;
      let svg=`<g opacity="${shape.opacity}">`;
      for(let i=0;i<shape.petals;i++){
        const angle=(i/shape.petals)*360, rad=(angle*Math.PI)/180;
        const px2=cx+Math.cos(rad)*off, py2=cy+Math.sin(rad)*off;
        svg+=`<ellipse cx="${f(px2)}" cy="${f(py2)}" rx="${f(pRx)}" ry="${f(pRy)}" fill="${shape.color}" transform="rotate(${angle},${f(px2)},${f(py2)})"/>`;
      }
      svg+=`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r*0.28)}" fill="${shape.color}"/></g>`;
      return svg;
    }

    case "squiggle": {
      const x=px(shape.x,width), y=px(shape.y,height), ww=px(shape.w,width);
      const amp=ww*0.065, seg=ww/5;
      let d=`M ${f(x)} ${f(y)}`;
      for(let i=0;i<5;i++){
        const x1=x+i*seg+seg*0.25, y1=y-amp*(i%2===0?1:-1);
        const x2=x+i*seg+seg*0.75, y2=y+amp*(i%2===0?1:-1);
        d+=` C ${f(x1)} ${f(y1)}, ${f(x2)} ${f(y2)}, ${f(x+(i+1)*seg)} ${f(y)}`;
      }
      return `<path d="${d}" fill="none" stroke="${shape.color}" stroke-width="${shape.strokeWidth}" opacity="${shape.opacity}" stroke-linecap="round"/>`;
    }

    // ── NEW v4 SHAPES ──────────────────────────────────────────────────────

    case "arc_stroke": {
      // Partial arc stroke — elegant circular accent
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const s=(shape.startAngle*Math.PI)/180, e=(shape.endAngle*Math.PI)/180;
      const x1=cx+r*Math.cos(s), y1=cy+r*Math.sin(s);
      const x2=cx+r*Math.cos(e), y2=cy+r*Math.sin(e);
      const large=Math.abs(shape.endAngle-shape.startAngle)>180?1:0;
      return `<path d="M ${f(x1)} ${f(y1)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(x2)} ${f(y2)}" fill="none" stroke="${shape.color}" stroke-width="${shape.strokeWidth}" stroke-linecap="round" opacity="${shape.opacity}"/>`;
    }

    case "corner_bracket": {
      // L-shaped corner bracket — editorial, architectural feel
      const cx=px(shape.x,width), cy=px(shape.y,height), s=px(shape.size,min);
      const sw=shape.strokeWidth, op=shape.opacity;
      let d="";
      switch(shape.corner){
        case "tl": d=`M ${f(cx)} ${f(cy+s)} L ${f(cx)} ${f(cy)} L ${f(cx+s)} ${f(cy)}`; break;
        case "tr": d=`M ${f(cx-s)} ${f(cy)} L ${f(cx)} ${f(cy)} L ${f(cx)} ${f(cy+s)}`; break;
        case "bl": d=`M ${f(cx)} ${f(cy-s)} L ${f(cx)} ${f(cy)} L ${f(cx+s)} ${f(cy)}`; break;
        case "br": d=`M ${f(cx-s)} ${f(cy)} L ${f(cx)} ${f(cy)} L ${f(cx)} ${f(cy-s)}`; break;
      }
      return `<path d="${d}" fill="none" stroke="${shape.color}" stroke-width="${sw}" stroke-linecap="square" opacity="${op}"/>`;
    }

    case "diagonal_band": {
      // Full-canvas diagonal band — adds sense of motion/energy
      const angle=shape.angle, t=shape.thickness;
      // Use a parallelogram covering entire canvas with rotation
      const cx=width/2, cy=height/2, len=Math.max(width,height)*1.5;
      const rad=(angle*Math.PI)/180;
      const dx=Math.sin(rad)*len, dy=Math.cos(rad)*len;
      const nx=Math.cos(rad)*(t*min/100), ny=-Math.sin(rad)*(t*min/100);
      const p=[
        [cx-dx/2, cy-dy/2],
        [cx+dx/2, cy+dy/2],
        [cx+dx/2+nx, cy+dy/2+ny],
        [cx-dx/2+nx, cy-dy/2+ny],
      ];
      const pts=p.map(([x,y])=>`${f(x)},${f(y)}`).join(" ");
      return `<polygon points="${pts}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
    }

    case "noise_overlay": {
      // SVG feTurbulence noise — adds subtle texture depth like Canva premium templates
      const id=`noise_${Math.round(Math.random()*9999)}`;
      return `<filter id="${id}" x="0" y="0" width="100%" height="100%">`
        + `<feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noiseOut"/>`
        + `<feColorMatrix type="saturate" values="0" in="noiseOut" result="grayNoise"/>`
        + `<feBlend in="SourceGraphic" in2="grayNoise" mode="soft-light" result="blend"/>`
        + `<feComposite in="blend" in2="SourceGraphic" operator="in"/>`
        + `</filter>`
        + `<rect width="100%" height="100%" filter="url(#${id})" opacity="${shape.opacity}"/>`;
    }

    // ── STEP 3: RICHER DECORATIONS & COMPONENTS ────────────────────────────

    case "ribbon": {
      // Corner ribbon / banner — classic promo element ("SALE", "NEW", etc.)
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      const isLeft = shape.corner === "tl";
      // Ribbon is a rotated rectangle pinned to the corner
      const cx=isLeft ? x : x+w, cy=y;
      const rot=isLeft ? -45 : 45;
      const rw=w*1.42, rh=h;
      const rx=cx-rw/2, ry=cy-rh/2;
      const tx=cx, ty=cy+shape.fontSize*0.35;
      return `<g transform="rotate(${rot},${f(cx)},${f(cy)})" opacity="${shape.opacity}">`
        + `<rect x="${f(rx)}" y="${f(ry)}" width="${f(rw)}" height="${f(rh)}" fill="${shape.color}"/>`
        + `<text x="${f(tx)}" y="${f(ty)}" font-size="${shape.fontSize}" font-weight="700" fill="${shape.textColor}" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" letter-spacing="0.08em">${esc(shape.text)}</text>`
        + `</g>`;
    }

    case "sticker_circle": {
      // Round sticker with text — Instagram-story style element
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const bw=shape.borderWidth??0, bc=shape.borderColor??shape.color;
      const tx=cx, ty=cy+shape.fontSize*0.35;
      let svg=`<g transform="rotate(${shape.rotation},${f(cx)},${f(cy)})" opacity="${shape.opacity}">`;
      if(bw>0) svg+=`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r+bw)}" fill="none" stroke="${bc}" stroke-width="${bw}"/>`;
      svg+=`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${shape.color}"/>`
        + `<text x="${f(tx)}" y="${f(ty)}" font-size="${shape.fontSize}" font-weight="800" fill="${shape.textColor}" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" letter-spacing="0.06em">${esc(shape.text)}</text>`
        + `</g>`;
      return svg;
    }

    case "icon_symbol": {
      // Simple SVG icon — star, check, heart, arrow, lightning, play, fire, sparkle
      const cx=px(shape.x,width), cy=px(shape.y,height), s=px(shape.size,min)/2;
      let path="";
      switch(shape.icon){
        case "star": {
          const pts:string[]=[];
          for(let i=0;i<10;i++){const a=(i/10)*Math.PI*2-Math.PI/2;const rr=i%2===0?s:s*0.4;pts.push(`${f(cx+Math.cos(a)*rr)},${f(cy+Math.sin(a)*rr)}`);}
          return `<polygon points="${pts.join(" ")}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
        }
        case "check":
          path=`M ${f(cx-s*0.5)} ${f(cy)} L ${f(cx-s*0.1)} ${f(cy+s*0.4)} L ${f(cx+s*0.5)} ${f(cy-s*0.35)}`;
          return `<path d="${path}" fill="none" stroke="${shape.color}" stroke-width="${s*0.18}" stroke-linecap="round" stroke-linejoin="round" opacity="${shape.opacity}"/>`;
        case "heart": {
          const hs=s*0.55;
          path=`M ${f(cx)} ${f(cy+hs*0.8)} C ${f(cx-hs*2)} ${f(cy-hs*0.4)} ${f(cx-hs*0.6)} ${f(cy-hs*1.6)} ${f(cx)} ${f(cy-hs*0.5)} C ${f(cx+hs*0.6)} ${f(cy-hs*1.6)} ${f(cx+hs*2)} ${f(cy-hs*0.4)} ${f(cx)} ${f(cy+hs*0.8)} Z`;
          return `<path d="${path}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
        }
        case "arrow":
          path=`M ${f(cx-s*0.5)} ${f(cy)} L ${f(cx+s*0.3)} ${f(cy)} M ${f(cx+s*0.05)} ${f(cy-s*0.3)} L ${f(cx+s*0.5)} ${f(cy)} L ${f(cx+s*0.05)} ${f(cy+s*0.3)}`;
          return `<path d="${path}" fill="none" stroke="${shape.color}" stroke-width="${s*0.16}" stroke-linecap="round" stroke-linejoin="round" opacity="${shape.opacity}"/>`;
        case "lightning":
          path=`M ${f(cx+s*0.1)} ${f(cy-s*0.6)} L ${f(cx-s*0.15)} ${f(cy+s*0.05)} L ${f(cx+s*0.08)} ${f(cy+s*0.05)} L ${f(cx-s*0.1)} ${f(cy+s*0.6)} L ${f(cx+s*0.3)} ${f(cy-s*0.1)} L ${f(cx+s*0.02)} ${f(cy-s*0.1)} Z`;
          return `<path d="${path}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
        case "play": {
          const pts=[`${f(cx-s*0.3)},${f(cy-s*0.45)}`,`${f(cx+s*0.45)},${f(cy)}`,`${f(cx-s*0.3)},${f(cy+s*0.45)}`];
          return `<polygon points="${pts.join(" ")}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
        }
        case "fire":
          path=`M ${f(cx)} ${f(cy+s*0.5)} C ${f(cx-s*0.4)} ${f(cy+s*0.1)} ${f(cx-s*0.35)} ${f(cy-s*0.3)} ${f(cx)} ${f(cy-s*0.55)} C ${f(cx+s*0.35)} ${f(cy-s*0.3)} ${f(cx+s*0.4)} ${f(cy+s*0.1)} ${f(cx)} ${f(cy+s*0.5)} Z`;
          return `<path d="${path}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
        case "sparkle": {
          // 4-pointed sparkle
          const pts=[
            `${f(cx)},${f(cy-s*0.6)}`,`${f(cx+s*0.12)},${f(cy-s*0.12)}`,
            `${f(cx+s*0.6)},${f(cy)}`,`${f(cx+s*0.12)},${f(cy+s*0.12)}`,
            `${f(cx)},${f(cy+s*0.6)}`,`${f(cx-s*0.12)},${f(cy+s*0.12)}`,
            `${f(cx-s*0.6)},${f(cy)}`,`${f(cx-s*0.12)},${f(cy-s*0.12)}`,
          ];
          return `<polygon points="${pts.join(" ")}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
        }
      }
      return "";
    }

    case "checklist": {
      // Visual checklist block — productivity, tips, how-to templates
      const ox=px(shape.x,width), oy=px(shape.y,height), ww=px(shape.w,width);
      const lh=shape.lineHeight ?? shape.fontSize*1.8;
      const checkR=shape.fontSize*0.38;
      let svg=`<g opacity="${shape.opacity}">`;
      shape.items.forEach((item, i) => {
        const iy=oy+i*lh;
        // Check circle
        svg+=`<circle cx="${f(ox+checkR)}" cy="${f(iy+checkR)}" r="${f(checkR)}" fill="none" stroke="${shape.checkColor}" stroke-width="1.5"/>`;
        // Checkmark inside
        svg+=`<path d="M ${f(ox+checkR*0.5)} ${f(iy+checkR)} L ${f(ox+checkR*0.85)} ${f(iy+checkR*1.35)} L ${f(ox+checkR*1.5)} ${f(iy+checkR*0.55)}" fill="none" stroke="${shape.checkColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
        // Text
        svg+=`<text x="${f(ox+checkR*3)}" y="${f(iy+checkR+shape.fontSize*0.35)}" font-size="${shape.fontSize}" font-weight="500" fill="${shape.color}" font-family="DM Sans,Lato,Arial,sans-serif">${esc(item)}</text>`;
      });
      svg+=`</g>`;
      return svg;
    }

    case "frame_border": {
      // Double-border decorative frame — editorial, luxury templates
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      const gap=px(shape.gap,min), sw=shape.strokeWidth;
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="${shape.color}" stroke-width="${sw}" rx="${shape.rx}" opacity="${shape.opacity}"/>`
        + `<rect x="${f(x+gap)}" y="${f(y+gap)}" width="${f(w-gap*2)}" height="${f(h-gap*2)}" fill="none" stroke="${shape.color}" stroke-width="${sw*0.6}" rx="${Math.max(0,shape.rx-gap*0.5)}" opacity="${shape.opacity*0.65}"/>`;
    }

    case "section_divider": {
      // Decorative horizontal divider with center ornament
      const ox=px(shape.x,width), oy=px(shape.y,height), ww=px(shape.w,width);
      const mid=ox+ww/2, sw=shape.strokeWidth, ornSize=sw*4;
      // Left line
      let svg=`<line x1="${f(ox)}" y1="${f(oy)}" x2="${f(mid-ornSize)}" y2="${f(oy)}" stroke="${shape.color}" stroke-width="${sw}" opacity="${shape.opacity}"/>`;
      // Right line
      svg+=`<line x1="${f(mid+ornSize)}" y1="${f(oy)}" x2="${f(ox+ww)}" y2="${f(oy)}" stroke="${shape.color}" stroke-width="${sw}" opacity="${shape.opacity}"/>`;
      // Center ornament
      switch(shape.ornament){
        case "diamond":
          svg+=`<polygon points="${f(mid)},${f(oy-ornSize)} ${f(mid+ornSize)},${f(oy)} ${f(mid)},${f(oy+ornSize)} ${f(mid-ornSize)},${f(oy)}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
          break;
        case "dot":
          svg+=`<circle cx="${f(mid)}" cy="${f(oy)}" r="${f(ornSize*0.6)}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
          break;
        case "circle":
          svg+=`<circle cx="${f(mid)}" cy="${f(oy)}" r="${f(ornSize*0.8)}" fill="none" stroke="${shape.color}" stroke-width="${sw}" opacity="${shape.opacity}"/>`;
          break;
        case "star": {
          const pts:string[]=[];
          for(let i=0;i<10;i++){const a=(i/10)*Math.PI*2-Math.PI/2;const rr=i%2===0?ornSize:ornSize*0.4;pts.push(`${f(mid+Math.cos(a)*rr)},${f(oy+Math.sin(a)*rr)}`);}
          svg+=`<polygon points="${pts.join(" ")}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
          break;
        }
        case "dash":
          svg+=`<line x1="${f(mid-ornSize*0.6)}" y1="${f(oy)}" x2="${f(mid+ornSize*0.6)}" y2="${f(oy)}" stroke="${shape.color}" stroke-width="${sw*2}" stroke-linecap="round" opacity="${shape.opacity}"/>`;
          break;
      }
      return svg;
    }

    case "texture_fill": {
      // Repeating micro-pattern fill — adds tactile depth to sections
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      const sc=shape.scale, gap=sc*8;
      let svg=`<g opacity="${shape.opacity}" clip-path="url(#tf_clip_${Math.round(x)})">`;
      svg+=`<clipPath id="tf_clip_${Math.round(x)}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/></clipPath>`;
      const cols=Math.ceil(w/gap), rows=Math.ceil(h/gap);
      const maxItems=Math.min(cols*rows, 200); // cap for performance
      let count=0;
      for(let r=0;r<rows&&count<maxItems;r++){
        for(let c=0;c<cols&&count<maxItems;c++){
          const cx=x+c*gap+gap/2, cy=y+r*gap+gap/2;
          count++;
          switch(shape.pattern){
            case "crosses":
              svg+=`<line x1="${f(cx-sc)}" y1="${f(cy)}" x2="${f(cx+sc)}" y2="${f(cy)}" stroke="${shape.color}" stroke-width="0.8"/>`
                + `<line x1="${f(cx)}" y1="${f(cy-sc)}" x2="${f(cx)}" y2="${f(cy+sc)}" stroke="${shape.color}" stroke-width="0.8"/>`;
              break;
            case "lines":
              svg+=`<line x1="${f(cx-sc)}" y1="${f(cy)}" x2="${f(cx+sc)}" y2="${f(cy)}" stroke="${shape.color}" stroke-width="0.6"/>`;
              break;
            case "zigzag":
              svg+=`<polyline points="${f(cx-sc)},${f(cy+sc*0.5)} ${f(cx)},${f(cy-sc*0.5)} ${f(cx+sc)},${f(cy+sc*0.5)}" fill="none" stroke="${shape.color}" stroke-width="0.7"/>`;
              break;
            case "confetti": {
              const rot=pseudoRandom(count*37.7)*360;
              svg+=`<rect x="${f(cx-sc*0.4)}" y="${f(cy-sc*0.15)}" width="${f(sc*0.8)}" height="${f(sc*0.3)}" fill="${shape.color}" transform="rotate(${f(rot)},${f(cx)},${f(cy)})"/>`;
              break;
            }
          }
        }
      }
      svg+=`</g>`;
      return svg;
    }

    case "photo_circle": {
      // Circular photo placeholder — avatar or product shot framing
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const id=`pc_${Math.round(cx)}_${Math.round(cy)}`;
      let svg="";
      if(shape.shadow){
        svg+=`<filter id="${id}"><feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="rgba(0,0,0,0.15)"/></filter>`;
      }
      const filterAttr=shape.shadow?` filter="url(#${id})"` : "";
      svg+=`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${shape.bgColor}" opacity="${shape.opacity}"${filterAttr}/>`;
      if(shape.borderWidth>0){
        svg+=`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r+shape.borderWidth/2)}" fill="none" stroke="${shape.borderColor}" stroke-width="${shape.borderWidth}" opacity="${shape.opacity}"/>`;
      }
      return svg;
    }

    case "starburst": {
      // Radiating sunburst/starburst — attention-grabbing accent (sale, promo)
      const cx=px(shape.x,width), cy=px(shape.y,height), r=px(shape.r,min);
      const n=shape.rays;
      let svg=`<g opacity="${shape.opacity}" transform="rotate(${shape.rotation},${f(cx)},${f(cy)})">`;
      for(let i=0;i<n;i++){
        const a1=(i/n)*Math.PI*2, a2=((i+0.35)/n)*Math.PI*2;
        const x1=cx+Math.cos(a1)*r, y1=cy+Math.sin(a1)*r;
        const x2=cx+Math.cos(a2)*r, y2=cy+Math.sin(a2)*r;
        svg+=`<polygon points="${f(cx)},${f(cy)} ${f(x1)},${f(y1)} ${f(x2)},${f(y2)}" fill="${shape.color}"/>`;
      }
      svg+=`</g>`;
      return svg;
    }

    case "price_tag": {
      // Price tag / label shape — e-commerce, sale templates
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      const notch=h*0.25; // left notch depth
      const tx=x+w/2, ty=y+h/2+shape.fontSize*0.35;
      // Tag shape with left notch
      const d=`M ${f(x+notch)} ${f(y)} L ${f(x+w)} ${f(y)} L ${f(x+w)} ${f(y+h)} L ${f(x+notch)} ${f(y+h)} L ${f(x)} ${f(y+h/2)} Z`;
      return `<path d="${d}" fill="${shape.color}" opacity="${shape.opacity}"/>`
        + `<circle cx="${f(x+notch*1.2)}" cy="${f(y+h/2)}" r="${f(h*0.08)}" fill="${shape.textColor}" opacity="0.6"/>`
        + `<text x="${f(tx+notch*0.3)}" y="${f(ty)}" font-size="${shape.fontSize}" font-weight="800" fill="${shape.textColor}" text-anchor="middle" font-family="Montserrat,Arial,sans-serif">${esc(shape.text)}</text>`;
    }

    case "banner_strip": {
      // Horizontal banner strip with text — section headers, promo strips
      const x=px(shape.x,width), y=px(shape.y,height), w=px(shape.w,width), h=px(shape.h,height);
      const skew=shape.skew??0;
      const tx=x+w/2, ty=y+h/2+shape.fontSize*0.35;
      let svg="";
      if(skew){
        svg+=`<g transform="skewX(${skew})">`;
      }
      svg+=`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${shape.color}" opacity="${shape.opacity}"/>`;
      if(skew) svg+=`</g>`;
      svg+=`<text x="${f(tx)}" y="${f(ty)}" font-size="${shape.fontSize}" font-weight="700" fill="${shape.textColor}" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" letter-spacing="0.1em" opacity="${shape.opacity}">${esc(shape.text)}</text>`;
      return svg;
    }

    default: return "";
  }
}

// ── Smooth blob — 12-point cubic bezier (Canva-quality organic shape) ─────────
function generateBlobPath(cx: number, cy: number, size: number, seed: number): string {
  const n   = 12;
  const r   = size * 0.5;
  const pts: [number,number][] = [];
  for (let i=0; i<n; i++) {
    const angle    = (i/n)*Math.PI*2 - Math.PI/2;
    const variance = pseudoRandom(seed + i*97.3)*0.38 + 0.78; // tighter range = smoother
    pts.push([cx+Math.cos(angle)*r*variance, cy+Math.sin(angle)*r*variance]);
  }
  // Smooth cubic bezier through all points
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i=0; i<n; i++) {
    const p0 = pts[(i-1+n)%n];
    const p1 = pts[i];
    const p2 = pts[(i+1)%n];
    const p3 = pts[(i+2)%n];
    // Catmull-Rom to cubic bezier
    const cp1x = p1[0]+(p2[0]-p0[0])/6;
    const cp1y = p1[1]+(p2[1]-p0[1])/6;
    const cp2x = p2[0]-(p3[0]-p1[0])/6;
    const cp2y = p2[1]-(p3[1]-p1[1])/6;
    d += ` C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + " Z";
}

function pseudoRandom(seed: number): number { const x=Math.sin(seed)*10000; return x-Math.floor(x); }

export function renderDecorations(decorations: DecorShape[], width: number, height: number): string {
  return decorations.map(d => renderDecoration(d, width, height)).join("\n  ");
}

export function buildBackgroundDefs(bg: BgTreatment): { defs: string; fill: string } {
  switch (bg.kind) {
    case "solid":
      return { defs:"", fill:bg.color };

    case "linear_gradient": {
      const rad=(bg.angle*Math.PI)/180;
      const x2=50+50*Math.sin(rad), y2=50-50*Math.cos(rad);
      const stops=bg.colors.map((c,i)=>`<stop offset="${Math.round(i/Math.max(bg.colors.length-1,1)*100)}%" stop-color="${c}"/>`).join("");
      return { defs:`<linearGradient id="bg_grad" x1="0%" y1="0%" x2="${f(x2)}%" y2="${f(y2)}%">${stops}</linearGradient>`, fill:"url(#bg_grad)" };
    }

    case "radial_gradient": {
      const rcx=(bg as any).cx??50, rcy=(bg as any).cy??50;
      const stops=bg.colors.map((c,i)=>`<stop offset="${Math.round(i/Math.max(bg.colors.length-1,1)*100)}%" stop-color="${c}"/>`).join("");
      return { defs:`<radialGradient id="bg_grad" cx="${rcx}%" cy="${rcy}%" r="70%">${stops}</radialGradient>`, fill:"url(#bg_grad)" };
    }

    case "mesh": {
      const c=bg.colors, s0=c[0]??"#000", s1=c[1]??s0, s2=c[2]??s0;
      return {
        defs:[
          `<linearGradient id="bg_grad" x1="0%" y1="0%" x2="58%" y2="100%"><stop offset="0%" stop-color="${s0}"/><stop offset="58%" stop-color="${s1}"/><stop offset="100%" stop-color="${s2}"/></linearGradient>`,
          `<radialGradient id="bg_mesh1" cx="78%" cy="22%" r="58%"><stop offset="0%" stop-color="${s0}"/><stop offset="100%" stop-color="${s1}" stop-opacity="0"/></radialGradient>`,
          `<radialGradient id="bg_mesh2" cx="22%" cy="78%" r="52%"><stop offset="0%" stop-color="${s2}"/><stop offset="100%" stop-color="${s0}" stop-opacity="0"/></radialGradient>`,
        ].join(""),
        fill:"url(#bg_grad)",
      };
    }

    case "split": {
      const sy=bg.splitY??50;
      return { defs:`<linearGradient id="bg_grad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="${sy}%" stop-color="${bg.colors[0]}"/><stop offset="${sy}%" stop-color="${bg.colors[1]}"/></linearGradient>`, fill:"url(#bg_grad)" };
    }

    default: return { defs:"", fill:"#ffffff" };
  }
}

export function renderMeshOverlay(bg: BgTreatment, width: number, height: number): string {
  if (bg.kind !== "mesh") return "";
  return [
    `<rect width="${width}" height="${height}" fill="url(#bg_mesh1)" opacity="0.62"/>`,
    `<rect width="${width}" height="${height}" fill="url(#bg_mesh2)" opacity="0.44"/>`,
  ].join("\n  ");
}

function f(n: number): string { return n.toFixed(1); }
function esc(s: string): string { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
