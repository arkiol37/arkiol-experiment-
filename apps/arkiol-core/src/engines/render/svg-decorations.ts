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

    // ── STEP 65: PAINTERLY ILLUSTRATION DECORATIONS ────────────────────────
    // These five kinds are the "scene foliage / mountains / flat-lay" tier
    // used across the Canva-grade reference pack. All are pure SVG — no
    // bitmap assets required — but the layered paths + gradient fills move
    // the output well past "flat geometric decor".

    case "foliage_silhouette": {
      // Painted leaf/grass silhouettes anchored to an edge.
      // Three color tones stacked back-to-front for depth (far→mid→near).
      // Density is the number of "tufts" across the anchor span.
      const [far, mid, near] = shape.palette;
      const op = shape.opacity;
      const d  = Math.max(3, Math.min(40, Math.round(shape.density)));
      const hPct = shape.height;                            // % of canvas
      const band = px(hPct, height);
      const anchor = shape.anchor;                          // capture for inner closures
      const yBase = anchor === "top" ? 0 :
                    anchor === "bottom" ? height :
                    anchor === "left" ? 0 : 0;
      const xBase = anchor === "right" ? width : 0;

      // Helper: one tuft path — a curvy teardrop leaf, rooted at (rx,ry),
      // pointing inward from the anchor by `len` with a sideways sway.
      function tuft(rx: number, ry: number, len: number, sway: number, color: string): string {
        let d1: string;
        if (anchor === "bottom") {
          d1 = `M ${f(rx)} ${f(ry)} C ${f(rx+sway*0.4)} ${f(ry-len*0.5)} ${f(rx+sway)} ${f(ry-len*0.85)} ${f(rx+sway*0.6)} ${f(ry-len)} `
             + `C ${f(rx-sway*0.2)} ${f(ry-len*0.8)} ${f(rx-sway*0.8)} ${f(ry-len*0.4)} ${f(rx)} ${f(ry)} Z`;
        } else if (anchor === "top") {
          d1 = `M ${f(rx)} ${f(ry)} C ${f(rx+sway*0.4)} ${f(ry+len*0.5)} ${f(rx+sway)} ${f(ry+len*0.85)} ${f(rx+sway*0.6)} ${f(ry+len)} `
             + `C ${f(rx-sway*0.2)} ${f(ry+len*0.8)} ${f(rx-sway*0.8)} ${f(ry+len*0.4)} ${f(rx)} ${f(ry)} Z`;
        } else if (anchor === "left") {
          d1 = `M ${f(rx)} ${f(ry)} C ${f(rx+len*0.5)} ${f(ry+sway*0.4)} ${f(rx+len*0.85)} ${f(ry+sway)} ${f(rx+len)} ${f(ry+sway*0.6)} `
             + `C ${f(rx+len*0.8)} ${f(ry-sway*0.2)} ${f(rx+len*0.4)} ${f(ry-sway*0.8)} ${f(rx)} ${f(ry)} Z`;
        } else {
          d1 = `M ${f(rx)} ${f(ry)} C ${f(rx-len*0.5)} ${f(ry+sway*0.4)} ${f(rx-len*0.85)} ${f(ry+sway)} ${f(rx-len)} ${f(ry+sway*0.6)} `
             + `C ${f(rx-len*0.8)} ${f(ry-sway*0.2)} ${f(rx-len*0.4)} ${f(ry-sway*0.8)} ${f(rx)} ${f(ry)} Z`;
        }
        return `<path d="${d1}" fill="${color}"/>`;
      }

      // Build 3 layers: back (far, shorter, less contrast), mid, near.
      function layer(color: string, shrink: number, yOffset: number, xOffset: number, seedBase: number, extraTufts = 0): string {
        const tufts: string[] = [];
        const n = d + extraTufts;
        for (let i = 0; i < n; i++) {
          const t = (i + pseudoRandom(seedBase + i*11.3)*0.6) / n;
          let rx: number, ry: number, len: number, sway: number;
          if (anchor === "bottom" || anchor === "top") {
            rx = t * width + xOffset;
            ry = yBase + yOffset;
            len = band * shrink * (0.62 + pseudoRandom(seedBase + i*17.9) * 0.55);
            sway = band * 0.22 * (pseudoRandom(seedBase + i*23.1)*2 - 1);
          } else {
            rx = xBase + xOffset;
            ry = t * height + yOffset;
            len = px(hPct, width) * shrink * (0.62 + pseudoRandom(seedBase + i*17.9) * 0.55);
            sway = px(hPct, width) * 0.22 * (pseudoRandom(seedBase + i*23.1)*2 - 1);
          }
          tufts.push(tuft(rx, ry, len, sway, color));
        }
        return tufts.join("");
      }

      return `<g opacity="${op}">`
        + layer(far,  0.82,  anchor === "bottom" ? -2 : (anchor === "top" ?  2 : 0),  anchor === "left" ? -2 : (anchor === "right" ?  2 : 0), 103.1,  0)
        + layer(mid,  1.0,   0, 0, 211.7,  2)
        + layer(near, 1.18,  anchor === "bottom" ?  3 : (anchor === "top" ? -3 : 0),  anchor === "left" ?  3 : (anchor === "right" ? -3 : 0), 317.5,  4)
        + `</g>`;
    }

    case "mountain_range": {
      // Parallax mountain silhouettes — back layers lighter/bluer, front
      // darker. Each layer is a zigzag polygon anchored at shape.y (%).
      const layers = Math.max(2, Math.min(5, Math.round(shape.layers)));
      const anchorY = px(shape.y, height);
      const op = shape.opacity;
      const pv = Math.max(0.05, Math.min(0.6, shape.peakVariance));
      let svg = `<g opacity="${op}">`;
      for (let li = 0; li < layers; li++) {
        const color = shape.palette[li] ?? shape.palette[shape.palette.length - 1];
        const depth = (li / Math.max(layers - 1, 1));
        const baseY = anchorY + depth * height * 0.06;      // far layers sit slightly higher
        const peakH = height * (0.08 + pv * (0.22 + 0.18 * (1 - depth)));
        const peaks = 4 + li * 2;
        const pts: string[] = [`0,${f(height)}`];
        for (let i = 0; i <= peaks; i++) {
          const px2 = (i / peaks) * width;
          const noise = pseudoRandom(li * 73.1 + i * 29.7);
          const py2 = baseY - peakH * (0.35 + noise * 0.85);
          pts.push(`${f(px2)},${f(py2)}`);
        }
        pts.push(`${f(width)},${f(height)}`);
        svg += `<polygon points="${pts.join(" ")}" fill="${color}"/>`;
      }
      svg += `</g>`;
      return svg;
    }

    case "watercolor_corner": {
      // Soft painted corner: organic blob + 3 leaf sprigs fanning inward.
      const cornerX = shape.corner === "tr" || shape.corner === "br" ? width : 0;
      const cornerY = shape.corner === "bl" || shape.corner === "br" ? height : 0;
      const sz = px(shape.size, min);
      const inward = { x: shape.corner === "tr" || shape.corner === "br" ? -1 : 1,
                       y: shape.corner === "bl" || shape.corner === "br" ? -1 : 1 };
      const cx = cornerX + inward.x * sz * 0.55;
      const cy = cornerY + inward.y * sz * 0.55;
      const [wash, leaf, bloom] = shape.palette;
      const op = shape.opacity;

      // Organic blob — 10-point catmull-rom
      const blobR = sz * 0.7;
      const blobPts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        const vary = 0.78 + pseudoRandom(301 + i * 41) * 0.35;
        blobPts.push([cx + Math.cos(ang) * blobR * vary, cy + Math.sin(ang) * blobR * vary]);
      }
      const blobPath = catmullRom(blobPts);

      // Leaf sprigs — each is a thin curved path with 3 petals
      const sprigs: string[] = [];
      for (let i = 0; i < 3; i++) {
        const angOff = -45 + i * 40;
        const angRad = (angOff * Math.PI) / 180;
        const stemEndX = cx + inward.x * Math.cos(angRad) * sz * 0.95;
        const stemEndY = cy + inward.y * Math.sin(angRad) * sz * 0.95;
        const stemPath = `M ${f(cx)} ${f(cy)} Q ${f((cx + stemEndX) / 2)} ${f((cy + stemEndY) / 2 - sz * 0.12)} ${f(stemEndX)} ${f(stemEndY)}`;
        sprigs.push(`<path d="${stemPath}" fill="none" stroke="${leaf}" stroke-width="${f(sz * 0.025)}" stroke-linecap="round"/>`);
        for (let j = 1; j <= 3; j++) {
          const t = j / 4;
          const px2 = cx + (stemEndX - cx) * t;
          const py2 = cy + (stemEndY - cy) * t;
          const leafSize = sz * 0.13;
          const leafPath = `M ${f(px2)} ${f(py2)} C ${f(px2 + inward.x * leafSize)} ${f(py2 - leafSize * 0.5)} ${f(px2 + inward.x * leafSize * 0.8)} ${f(py2 - leafSize)} ${f(px2 + inward.x * leafSize * 0.2)} ${f(py2 - leafSize * 0.8)} Z`;
          sprigs.push(`<path d="${leafPath}" fill="${leaf}"/>`);
        }
      }

      // Small bloom accents
      let blooms = "";
      for (let i = 0; i < 2; i++) {
        const bx = cx + inward.x * sz * (0.3 + pseudoRandom(509 + i * 59) * 0.3);
        const by = cy + inward.y * sz * (0.3 + pseudoRandom(613 + i * 67) * 0.3);
        const br = sz * 0.08;
        blooms += `<circle cx="${f(bx)}" cy="${f(by)}" r="${f(br)}" fill="${bloom}" opacity="0.85"/>`;
      }

      return `<g opacity="${op}">`
        + `<path d="${blobPath}" fill="${wash}" opacity="0.55"/>`
        + `<path d="${blobPath}" fill="${wash}" opacity="0.35" transform="translate(${f(inward.x * sz * 0.08)},${f(inward.y * sz * 0.08)})"/>`
        + sprigs.join("")
        + blooms
        + `</g>`;
    }

    case "themed_cluster": {
      // Category-specific prop cluster — flat-lay style composition.
      // Each theme lays out 4-5 small vector icons in a loose arrangement
      // that reads as "food flat-lay" / "spa items" / etc.
      const cx = px(shape.x, width), cy = px(shape.y, height);
      const sz = px(shape.size, min);
      const [c1, c2, c3, c4] = [
        shape.palette[0] ?? "#2e7d32",
        shape.palette[1] ?? "#f57f17",
        shape.palette[2] ?? "#6a1b9a",
        shape.palette[3] ?? "#ffffff",
      ];
      const op = shape.opacity;
      const props: string[] = [];

      // Pack local drawers for each prop type
      const leafProp = (x: number, y: number, rot: number, fill: string, s: number) =>
        `<g transform="translate(${f(x)},${f(y)}) rotate(${rot})"><path d="M 0 0 C ${f(s*0.5)} ${f(-s*0.2)} ${f(s*0.9)} ${f(-s*0.55)} ${f(s*0.6)} ${f(-s)} C ${f(-s*0.05)} ${f(-s*0.75)} ${f(-s*0.3)} ${f(-s*0.35)} 0 0 Z" fill="${fill}"/><line x1="${f(s*0.08)}" y1="${f(-s*0.15)}" x2="${f(s*0.45)}" y2="${f(-s*0.72)}" stroke="${c4}" stroke-width="${f(s*0.04)}" opacity="0.4"/></g>`;
      const circleProp = (x: number, y: number, r: number, fill: string, stroke?: string) =>
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${f(r*0.15)}"` : ""}/>`;
      const bookProp = (x: number, y: number, w: number, h: number, fill: string) =>
        `<g transform="translate(${f(x)},${f(y)}) rotate(-8)"><rect x="${f(-w/2)}" y="${f(-h/2)}" width="${f(w)}" height="${f(h)}" fill="${fill}" rx="${f(w*0.04)}"/><line x1="${f(-w/2+w*0.1)}" y1="${f(-h/2+h*0.25)}" x2="${f(w/2-w*0.1)}" y2="${f(-h/2+h*0.25)}" stroke="${c4}" stroke-width="${f(h*0.03)}" opacity="0.55"/></g>`;
      const cupProp = (x: number, y: number, r: number, fill: string) =>
        `<g transform="translate(${f(x)},${f(y)})"><path d="M ${f(-r)} ${f(-r*0.4)} L ${f(-r*0.85)} ${f(r*0.7)} Q ${f(-r*0.7)} ${f(r*0.95)} ${f(-r*0.2)} ${f(r*0.95)} L ${f(r*0.2)} ${f(r*0.95)} Q ${f(r*0.7)} ${f(r*0.95)} ${f(r*0.85)} ${f(r*0.7)} L ${f(r)} ${f(-r*0.4)} Z" fill="${fill}"/><ellipse cx="0" cy="${f(-r*0.4)}" rx="${f(r)}" ry="${f(r*0.25)}" fill="${c4}" opacity="0.7"/><path d="M ${f(r*0.9)} ${f(-r*0.1)} Q ${f(r*1.4)} ${f(r*0.1)} ${f(r*0.9)} ${f(r*0.35)}" fill="none" stroke="${fill}" stroke-width="${f(r*0.1)}"/></g>`;
      const bottleProp = (x: number, y: number, w: number, h: number, fill: string) =>
        `<g transform="translate(${f(x)},${f(y)})"><rect x="${f(-w*0.18)}" y="${f(-h*0.62)}" width="${f(w*0.36)}" height="${f(h*0.22)}" fill="${fill}"/><path d="M ${f(-w/2)} ${f(-h*0.4)} L ${f(-w/2)} ${f(h/2)} Q ${f(-w/2)} ${f(h*0.58)} ${f(-w*0.35)} ${f(h*0.58)} L ${f(w*0.35)} ${f(h*0.58)} Q ${f(w/2)} ${f(h*0.58)} ${f(w/2)} ${f(h/2)} L ${f(w/2)} ${f(-h*0.4)} Z" fill="${fill}"/><rect x="${f(-w*0.3)}" y="${f(h*0.05)}" width="${f(w*0.6)}" height="${f(h*0.22)}" fill="${c4}" opacity="0.85" rx="${f(w*0.03)}"/></g>`;
      const lemonProp = (x: number, y: number, r: number, fill: string) =>
        `<g transform="translate(${f(x)},${f(y)})"><ellipse cx="0" cy="0" rx="${f(r)}" ry="${f(r*0.78)}" fill="${fill}" transform="rotate(25)"/><ellipse cx="${f(-r*0.3)}" cy="${f(-r*0.2)}" rx="${f(r*0.22)}" ry="${f(r*0.1)}" fill="${c4}" opacity="0.5"/></g>`;
      const laptopProp = (x: number, y: number, w: number, h: number, fill: string) =>
        `<g transform="translate(${f(x)},${f(y)})"><rect x="${f(-w/2)}" y="${f(-h*0.5)}" width="${f(w)}" height="${f(h*0.78)}" fill="${fill}" rx="${f(w*0.03)}"/><rect x="${f(-w*0.45)}" y="${f(-h*0.42)}" width="${f(w*0.9)}" height="${f(h*0.6)}" fill="${c4}" opacity="0.85" rx="${f(w*0.02)}"/><rect x="${f(-w*0.6)}" y="${f(h*0.28)}" width="${f(w*1.2)}" height="${f(h*0.08)}" fill="${fill}" rx="${f(h*0.04)}"/></g>`;
      const flowerProp = (x: number, y: number, r: number, petal: string, core: string) => {
        let g = `<g transform="translate(${f(x)},${f(y)})">`;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 360;
          g += `<ellipse cx="0" cy="${f(-r*0.55)}" rx="${f(r*0.35)}" ry="${f(r*0.6)}" fill="${petal}" transform="rotate(${a})"/>`;
        }
        g += `<circle cx="0" cy="0" r="${f(r*0.28)}" fill="${core}"/></g>`;
        return g;
      };

      switch (shape.theme) {
        case "food":
          props.push(leafProp(cx - sz * 0.4, cy - sz * 0.1, -20, c1, sz * 0.5));
          props.push(circleProp(cx - sz * 0.05, cy - sz * 0.3, sz * 0.22, c2));   // bread/orange
          props.push(lemonProp(cx + sz * 0.35, cy - sz * 0.05, sz * 0.2, c3));
          props.push(leafProp(cx + sz * 0.1, cy + sz * 0.2, 40, c1, sz * 0.42));
          props.push(circleProp(cx - sz * 0.3, cy + sz * 0.3, sz * 0.12, c4));    // side dish
          break;
        case "spa":
          props.push(bottleProp(cx - sz * 0.3, cy, sz * 0.32, sz * 0.75, c1));
          props.push(bottleProp(cx + sz * 0.1, cy - sz * 0.05, sz * 0.28, sz * 0.66, c2));
          props.push(leafProp(cx + sz * 0.4, cy + sz * 0.1, 20, c3, sz * 0.4));
          props.push(circleProp(cx - sz * 0.1, cy + sz * 0.35, sz * 0.1, c4));    // stone
          props.push(circleProp(cx + sz * 0.18, cy + sz * 0.38, sz * 0.08, c3));
          break;
        case "study":
          props.push(bookProp(cx - sz * 0.2, cy, sz * 0.55, sz * 0.45, c1));
          props.push(bookProp(cx + sz * 0.1, cy - sz * 0.18, sz * 0.5, sz * 0.4, c2));
          props.push(cupProp(cx + sz * 0.35, cy + sz * 0.12, sz * 0.2, c3));
          props.push(leafProp(cx - sz * 0.45, cy + sz * 0.25, -35, c3, sz * 0.4));
          break;
        case "office":
          props.push(laptopProp(cx, cy - sz * 0.05, sz * 0.75, sz * 0.55, c1));
          props.push(cupProp(cx + sz * 0.42, cy + sz * 0.15, sz * 0.18, c2));
          props.push(leafProp(cx - sz * 0.45, cy + sz * 0.1, -25, c3, sz * 0.42));
          props.push(bookProp(cx - sz * 0.3, cy + sz * 0.35, sz * 0.3, sz * 0.2, c4));
          break;
        case "travel":
          props.push(leafProp(cx - sz * 0.4, cy - sz * 0.2, -15, c1, sz * 0.5));
          props.push(circleProp(cx + sz * 0.05, cy - sz * 0.1, sz * 0.18, c2, c4)); // compass
          props.push(bookProp(cx - sz * 0.1, cy + sz * 0.2, sz * 0.5, sz * 0.38, c3)); // journal
          props.push(circleProp(cx + sz * 0.38, cy + sz * 0.1, sz * 0.1, c4));       // sun pin
          break;
        case "floral":
          props.push(flowerProp(cx - sz * 0.25, cy - sz * 0.1, sz * 0.3, c2, c3));
          props.push(flowerProp(cx + sz * 0.25, cy + sz * 0.05, sz * 0.26, c3, c4));
          props.push(leafProp(cx - sz * 0.35, cy + sz * 0.25, -40, c1, sz * 0.45));
          props.push(leafProp(cx + sz * 0.35, cy - sz * 0.25, 30, c1, sz * 0.42));
          props.push(flowerProp(cx, cy + sz * 0.3, sz * 0.2, c2, c4));
          break;
      }

      return `<g opacity="${op}">` + props.join("") + `</g>`;
    }

    case "torn_paper_frame": {
      // Irregular jagged-edge paper panel — creates the "notebook page"
      // or "torn scrap" content frame seen in the reference pack.
      const x = px(shape.x, width), y = px(shape.y, height);
      const w = px(shape.w, width), h = px(shape.h, height);
      const seed = shape.seed;
      const steps = 18;                                     // teeth per long edge
      const jag = Math.min(w, h) * 0.022;
      const pts: [number, number][] = [];
      // top edge
      for (let i = 0; i <= steps; i++) {
        const tx = x + (i / steps) * w;
        const ty = y + (pseudoRandom(seed + i * 13.1) * 2 - 1) * jag;
        pts.push([tx, ty]);
      }
      // right edge
      const vSteps = Math.round(steps * (h / w));
      for (let i = 1; i <= vSteps; i++) {
        const ty = y + (i / vSteps) * h;
        const tx = x + w + (pseudoRandom(seed + 200 + i * 17.7) * 2 - 1) * jag;
        pts.push([tx, ty]);
      }
      // bottom edge
      for (let i = steps - 1; i >= 0; i--) {
        const tx = x + (i / steps) * w;
        const ty = y + h + (pseudoRandom(seed + 400 + i * 23.3) * 2 - 1) * jag;
        pts.push([tx, ty]);
      }
      // left edge
      for (let i = vSteps - 1; i >= 1; i--) {
        const ty = y + (i / vSteps) * h;
        const tx = x + (pseudoRandom(seed + 600 + i * 29.9) * 2 - 1) * jag;
        pts.push([tx, ty]);
      }
      const d = `M ${pts.map(([px2, py2]) => `${f(px2)},${f(py2)}`).join(" L ")} Z`;
      const filterId = `tp_${seed}_${Math.round(x)}`;
      return `<filter id="${filterId}" x="-10%" y="-10%" width="120%" height="120%">`
        + `<feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="${shape.shadowColor}" flood-opacity="0.35"/>`
        + `</filter>`
        + `<path d="${d}" fill="${shape.color}" opacity="${shape.opacity}" filter="url(#${filterId})"/>`;
    }

    default: return "";
  }
}

// Catmull-Rom → cubic bezier helper (used by painterly shapes above).
function catmullRom(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + " Z";
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
      // Secondary perpendicular gradient for richer depth
      const rad2=((bg.angle+90)*Math.PI)/180;
      const sx2=50+50*Math.sin(rad2), sy2=50-50*Math.cos(rad2);
      const midColor=bg.colors[Math.floor(bg.colors.length/2)]??"transparent";
      const depthGrad=`<linearGradient id="bg_depth" x1="0%" y1="0%" x2="${f(sx2)}%" y2="${f(sy2)}%"><stop offset="0%" stop-color="${midColor}" stop-opacity="0"/><stop offset="50%" stop-color="${midColor}" stop-opacity="0.08"/><stop offset="100%" stop-color="${midColor}" stop-opacity="0"/></linearGradient>`;
      // Subtle noise texture
      const noiseFil=`<filter id="bg_noise"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`;
      return {
        defs:[
          `<linearGradient id="bg_grad" x1="0%" y1="0%" x2="${f(x2)}%" y2="${f(y2)}%">${stops}</linearGradient>`,
          depthGrad,
          noiseFil,
        ].join(""),
        fill:"url(#bg_grad)",
      };
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

    case "scene": {
      // Step 65 — sky / atmosphere gradient only; the illustrated layers
      // (mountains, water, foliage) are emitted by renderMeshOverlay.
      // palette[0] = sky top, palette[1] = sky bottom / horizon.
      const skyTop = bg.palette[0] ?? "#b9d9eb";
      const skyBot = bg.palette[1] ?? "#f6e0c2";
      return {
        defs:`<linearGradient id="bg_grad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="${skyTop}"/><stop offset="100%" stop-color="${skyBot}"/></linearGradient>`,
        fill:"url(#bg_grad)",
      };
    }

    default: return { defs:"", fill:"#ffffff" };
  }
}

export function renderMeshOverlay(bg: BgTreatment, width: number, height: number): string {
  if (bg.kind === "mesh") {
    return [
      `<rect width="${width}" height="${height}" fill="url(#bg_mesh1)" opacity="0.62"/>`,
      `<rect width="${width}" height="${height}" fill="url(#bg_mesh2)" opacity="0.44"/>`,
    ].join("\n  ");
  }
  // Linear gradients get a depth layer and subtle noise texture
  if (bg.kind === "linear_gradient") {
    return [
      `<rect width="${width}" height="${height}" fill="url(#bg_depth)"/>`,
      `<rect width="${width}" height="${height}" filter="url(#bg_noise)" opacity="0.025"/>`,
    ].join("\n  ");
  }
  // Step 65 — painterly scene composed above the sky gradient.
  if (bg.kind === "scene") {
    return renderScene(bg.scene, bg.palette, width, height);
  }
  return "";
}

/**
 * Renders a painterly scene (mountains + water, jungle, sunset, etc.) as
 * layered SVG paths on top of the already-emitted sky gradient. Kept
 * deterministic — all randomness goes through `pseudoRandom(seed)` so the
 * same scene kind + palette yields byte-identical output.
 */
export function renderScene(
  scene: "mountain_lake" | "jungle" | "sunset_sky" | "meadow" | "ocean_horizon" | "forest",
  palette: string[],
  width: number,
  height: number,
): string {
  const p = (i: number, fallback: string) => palette[i] ?? fallback;
  switch (scene) {
    case "mountain_lake": {
      // sky is already painted. Add distant mountains, sun disc,
      // near mountain, lake with horizon reflection, subtle ripples.
      const sunCx = width * 0.7, sunCy = height * 0.32, sunR = Math.min(width, height) * 0.09;
      const horizonY = height * 0.62;
      const farColor = p(2, "#6b8eb1");
      const nearColor = p(3, "#34495e");
      const lakeTop = p(4, "#9fbedc");
      const lakeBot = p(5, "#5a7fa3");

      // distant mountain silhouette
      const farPts: string[] = [`0,${f(horizonY)}`];
      const farPeaks = 7;
      for (let i = 0; i <= farPeaks; i++) {
        const x = (i / farPeaks) * width;
        const y = horizonY - height * (0.10 + pseudoRandom(91.7 + i * 19.3) * 0.10);
        farPts.push(`${f(x)},${f(y)}`);
      }
      farPts.push(`${f(width)},${f(horizonY)}`);

      // near mountain — taller, darker, jagged
      const nearPts: string[] = [`0,${f(horizonY)}`];
      const nearPeaks = 4;
      for (let i = 0; i <= nearPeaks; i++) {
        const x = (i / nearPeaks) * width;
        const y = horizonY - height * (0.18 + pseudoRandom(211.3 + i * 31.1) * 0.14);
        nearPts.push(`${f(x)},${f(y)}`);
      }
      nearPts.push(`${f(width)},${f(horizonY)}`);

      // lake gradient
      const lakeGradId = `scene_lake_${scene}`;
      const lakeGradDef = `<defs><linearGradient id="${lakeGradId}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="${lakeTop}"/><stop offset="100%" stop-color="${lakeBot}"/></linearGradient></defs>`;

      // ripples
      let ripples = "";
      for (let i = 0; i < 4; i++) {
        const ry = horizonY + height * (0.08 + i * 0.07);
        const rw = width * (0.5 - i * 0.08);
        const rx = width * 0.5 - rw / 2;
        ripples += `<line x1="${f(rx)}" y1="${f(ry)}" x2="${f(rx + rw)}" y2="${f(ry)}" stroke="#ffffff" stroke-width="1.2" opacity="${f(0.25 - i * 0.04)}"/>`;
      }

      return lakeGradDef
        + `<circle cx="${f(sunCx)}" cy="${f(sunCy)}" r="${f(sunR)}" fill="${p(6, "#fcd27b")}" opacity="0.85"/>`
        + `<circle cx="${f(sunCx)}" cy="${f(sunCy)}" r="${f(sunR * 1.8)}" fill="${p(6, "#fcd27b")}" opacity="0.22"/>`
        + `<polygon points="${farPts.join(" ")}" fill="${farColor}" opacity="0.78"/>`
        + `<polygon points="${nearPts.join(" ")}" fill="${nearColor}"/>`
        + `<rect x="0" y="${f(horizonY)}" width="${width}" height="${f(height - horizonY)}" fill="url(#${lakeGradId})"/>`
        + ripples;
    }

    case "jungle": {
      // Dense painterly jungle: gradient mist, multiple leaf fronds layered
      // from back (faded) to front (saturated), with 2-3 large palm fronds.
      const backLeaf = p(2, "#3d6b4b");
      const midLeaf  = p(3, "#2f5a3e");
      const frontLeaf= p(4, "#1f4532");

      // Soft mist band
      const mistId = `scene_mist_${scene}`;
      const defs = `<defs><linearGradient id="${mistId}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="${p(1, "#cfe5d4")}" stop-opacity="0"/><stop offset="60%" stop-color="${p(1, "#cfe5d4")}" stop-opacity="0.25"/><stop offset="100%" stop-color="${p(1, "#cfe5d4")}" stop-opacity="0"/></linearGradient></defs>`;

      function palmFrond(cx: number, cy: number, len: number, rot: number, fill: string): string {
        // central stem + 8 leaflets
        let g = `<g transform="translate(${f(cx)},${f(cy)}) rotate(${rot})">`;
        g += `<path d="M 0 0 Q ${f(len * 0.3)} ${f(-len * 0.1)} ${f(len)} ${f(-len * 0.25)}" stroke="${fill}" stroke-width="${f(len * 0.035)}" fill="none"/>`;
        for (let i = 1; i <= 8; i++) {
          const t = i / 9;
          const bx = len * t, by = -len * 0.18 * t;
          const llen = len * 0.38 * (1 - t * 0.4);
          g += `<ellipse cx="${f(bx + llen * 0.4)}" cy="${f(by - llen * 0.3)}" rx="${f(llen * 0.5)}" ry="${f(llen * 0.18)}" fill="${fill}" transform="rotate(${-35 + t * 10},${f(bx)},${f(by)})"/>`;
          g += `<ellipse cx="${f(bx + llen * 0.4)}" cy="${f(by + llen * 0.3)}" rx="${f(llen * 0.5)}" ry="${f(llen * 0.18)}" fill="${fill}" transform="rotate(${35 - t * 10},${f(bx)},${f(by)})"/>`;
        }
        g += `</g>`;
        return g;
      }

      // Far backdrop: large blurred leaf blobs
      let body = defs;
      body += `<rect width="${width}" height="${height}" fill="${backLeaf}" opacity="0.3"/>`;
      body += `<rect width="${width}" height="${height}" fill="url(#${mistId})"/>`;
      // Mid fronds from left & right edges
      body += palmFrond(-width * 0.05, height * 0.2, width * 0.55, 20, midLeaf);
      body += palmFrond(width * 1.05, height * 0.15, width * 0.55, 160, midLeaf);
      body += palmFrond(width * 0.1, height * 1.0, width * 0.45, -60, midLeaf);
      // Front fronds (bottom corners, more saturated)
      body += palmFrond(-width * 0.1, height * 1.05, width * 0.7, -25, frontLeaf);
      body += palmFrond(width * 1.1, height * 1.05, width * 0.7, 205, frontLeaf);
      return body;
    }

    case "sunset_sky": {
      // Warm gradient already laid down by sky. Add soft sun, cloud bands,
      // and a silhouette horizon line.
      const sunCx = width * 0.5, sunCy = height * 0.55, sunR = Math.min(width, height) * 0.14;
      const sun = p(2, "#ffc887");
      const cloud = p(3, "#f7a37a");
      const horizon = p(4, "#321c36");
      let body = "";
      // big soft sun glow
      const glowId = `scene_sun_${scene}`;
      body += `<defs><radialGradient id="${glowId}"><stop offset="0%" stop-color="${sun}" stop-opacity="0.9"/><stop offset="100%" stop-color="${sun}" stop-opacity="0"/></radialGradient></defs>`;
      body += `<circle cx="${f(sunCx)}" cy="${f(sunCy)}" r="${f(sunR * 3)}" fill="url(#${glowId})"/>`;
      body += `<circle cx="${f(sunCx)}" cy="${f(sunCy)}" r="${f(sunR)}" fill="${sun}"/>`;
      // cloud bands — horizontal ellipses
      for (let i = 0; i < 4; i++) {
        const cy = sunCy - height * (0.05 + i * 0.06);
        const cw = width * (0.9 - i * 0.08);
        body += `<ellipse cx="${f(width / 2)}" cy="${f(cy)}" rx="${f(cw / 2)}" ry="${f(height * 0.012)}" fill="${cloud}" opacity="${f(0.55 - i * 0.1)}"/>`;
      }
      // horizon silhouette
      body += `<rect x="0" y="${f(height * 0.78)}" width="${width}" height="${f(height * 0.22)}" fill="${horizon}"/>`;
      return body;
    }

    case "meadow": {
      // Rolling hills + wildflower specks. Back-to-front hill gradient.
      const hillA = p(2, "#9ac47a");
      const hillB = p(3, "#74a859");
      const hillC = p(4, "#4d8640");
      const flowerA = p(5, "#f4a261");
      const flowerB = p(6, "#e76f51");

      function hill(yBase: number, color: string, peakH: number, waves: number, seed: number): string {
        const pts: string[] = [`0,${f(height)}`];
        for (let i = 0; i <= waves; i++) {
          const x = (i / waves) * width;
          const y = yBase - peakH * (0.4 + pseudoRandom(seed + i * 13.7) * 0.6);
          pts.push(`${f(x)},${f(y)}`);
        }
        pts.push(`${f(width)},${f(height)}`);
        return `<polygon points="${pts.join(" ")}" fill="${color}"/>`;
      }

      let body = "";
      body += hill(height * 0.70, hillA, height * 0.12, 3, 71);
      body += hill(height * 0.80, hillB, height * 0.10, 4, 137);
      body += hill(height * 0.88, hillC, height * 0.08, 5, 211);

      // wildflowers on front hill
      for (let i = 0; i < 22; i++) {
        const fx = pseudoRandom(311 + i * 17.3) * width;
        const fy = height * (0.87 + pseudoRandom(413 + i * 29.1) * 0.1);
        const fc = i % 2 === 0 ? flowerA : flowerB;
        body += `<circle cx="${f(fx)}" cy="${f(fy)}" r="${f(Math.min(width, height) * 0.008)}" fill="${fc}"/>`;
      }
      return body;
    }

    case "ocean_horizon": {
      // Horizon line, water gradient, soft waves, sun.
      const horizonY = height * 0.55;
      const waterTop = p(2, "#5aa6c4");
      const waterBot = p(3, "#1a4769");
      const sun = p(4, "#fff0cf");
      const gradId = `scene_ocean_${scene}`;
      let body = `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="${waterTop}"/><stop offset="100%" stop-color="${waterBot}"/></linearGradient></defs>`;
      const sunCx = width * 0.68, sunCy = horizonY - height * 0.06;
      body += `<circle cx="${f(sunCx)}" cy="${f(sunCy)}" r="${f(Math.min(width, height) * 0.07)}" fill="${sun}" opacity="0.9"/>`;
      body += `<circle cx="${f(sunCx)}" cy="${f(sunCy)}" r="${f(Math.min(width, height) * 0.14)}" fill="${sun}" opacity="0.18"/>`;
      body += `<rect x="0" y="${f(horizonY)}" width="${width}" height="${f(height - horizonY)}" fill="url(#${gradId})"/>`;
      // waves
      for (let i = 0; i < 6; i++) {
        const wy = horizonY + height * (0.03 + i * 0.06);
        const ww = width * (0.3 - i * 0.03);
        const wx = width * (0.4 + pseudoRandom(509 + i * 13.9) * 0.2);
        body += `<line x1="${f(wx)}" y1="${f(wy)}" x2="${f(wx + ww)}" y2="${f(wy)}" stroke="#ffffff" stroke-width="1" opacity="${f(0.3 - i * 0.04)}"/>`;
      }
      return body;
    }

    case "forest": {
      // Tall tree silhouettes with a hazy gradient between layers.
      const treeBack = p(2, "#486651");
      const treeMid  = p(3, "#2e4a38");
      const treeFront= p(4, "#152a20");
      const fogId = `scene_fog_${scene}`;
      let body = `<defs><linearGradient id="${fogId}" x1="0%" y1="50%" x2="0%" y2="100%"><stop offset="0%" stop-color="${p(1, "#e8ede0")}" stop-opacity="0"/><stop offset="100%" stop-color="${p(1, "#e8ede0")}" stop-opacity="0.25"/></linearGradient></defs>`;

      function tree(cx: number, cy: number, h2: number, w2: number, color: string): string {
        // triangular pine silhouette — stacked triangles
        const trunk = `<rect x="${f(cx - w2 * 0.08)}" y="${f(cy - h2 * 0.05)}" width="${f(w2 * 0.16)}" height="${f(h2 * 0.15)}" fill="${color}"/>`;
        let g = trunk;
        for (let i = 0; i < 3; i++) {
          const t = i / 3;
          const ty = cy - h2 * (0.1 + t * 0.55);
          const tw = w2 * (1 - t * 0.35);
          g += `<polygon points="${f(cx - tw / 2)},${f(ty)} ${f(cx + tw / 2)},${f(ty)} ${f(cx)},${f(ty - h2 * 0.35)}" fill="${color}"/>`;
        }
        return g;
      }

      // Back layer — smaller, lighter trees
      for (let i = 0; i < 6; i++) {
        const cx = (i / 5) * width + pseudoRandom(71 + i * 19) * 30 - 15;
        const cy = height * 0.7;
        body += tree(cx, cy, height * 0.35, width * 0.14, treeBack);
      }
      body += `<rect width="${width}" height="${height}" fill="url(#${fogId})"/>`;
      // Mid layer
      for (let i = 0; i < 5; i++) {
        const cx = (i / 4) * width + pseudoRandom(137 + i * 23) * 40 - 20;
        const cy = height * 0.85;
        body += tree(cx, cy, height * 0.5, width * 0.19, treeMid);
      }
      // Front layer
      for (let i = 0; i < 4; i++) {
        const cx = (i / 3) * width + pseudoRandom(211 + i * 29) * 50 - 25;
        const cy = height * 1.0;
        body += tree(cx, cy, height * 0.65, width * 0.25, treeFront);
      }
      return body;
    }

    default: return "";
  }
}

function f(n: number): string { return n.toFixed(1); }
function esc(s: string): string { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
