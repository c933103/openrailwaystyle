import {cssRgba} from './polar-paint.mjs';

const WORLD_METRES = 40075016.6856;
const CAP = 128;
const color = (value, fallback) => cssRgba(value ?? fallback);
const clamp = value => Math.max(0, Math.min(1, value));

// The public Atlas style uses fixed, map-anchored light. A cached tile can
// rotate with the map without changing the compass bearing of the light.
export function flatReliefPaint(layer) {
  if (layer.type !== 'hillshade') return null;
  const p = layer.paint ?? {};
  const shadow=color(p['hillshade-shadow-color'],'#000000');
  const highlight=color(p['hillshade-highlight-color'],'#ffffff');
  const accent=color(p['hillshade-accent-color'],'#000000');
  const direction=p['hillshade-illumination-direction']??335;
  const intensity=p['hillshade-exaggeration']??0.5;
  if (p['hillshade-illumination-anchor']!=='map' || (p['hillshade-method']??'standard')!=='standard' ||
      !shadow || !highlight || !accent ||
      !Number.isFinite(direction) || !Number.isFinite(intensity) || intensity<0 || intensity>1) return null;
  return {shadow,highlight,accent,direction,intensity};
}

// Approximate standard hillshade in two dimensions using ground metres,
// signed slope and the style's highlight/shadow/accent colors. Use one-sided
// differences at edges so shading never requests neighboring provider tiles.
// Bound raster work per result; the shared DEM cache retains the full heights.
export function flatReliefPixels({width,height,data}, {z,y}, paint) {
  if (![width,height].every(n=>Number.isInteger(n)&&n>=2&&n<=512) ||
      !(data instanceof Float32Array) || data.length!==width*height ||
      !Number.isInteger(z) || z<0 || z>26 || !Number.isInteger(y) || y<0 || y>=2**z)
    throw new Error('Invalid terrain elevation tile');
  const columns=Math.min(width,CAP), rows=Math.min(height,CAP);
  const pixels=new Uint8ClampedArray(columns*rows*4);
  const {shadow,highlight,accent,direction,intensity}=paint;
  if (intensity===0) return {width:columns,height:rows,pixels};
  const radians=direction*Math.PI/180, lightX=Math.sin(radians),lightY=-Math.cos(radians);
  const scale=2**z, strength=Math.min(1,intensity*2);
  for(let j=0;j<rows;j++){
    const py=Math.min(height-1,Math.floor((j+0.5)*height/rows));
    const north=Math.max(0,py-1),south=Math.min(height-1,py+1);
    const mercator=(y+(py+0.5)/height)/scale;
    const tileMetres=WORLD_METRES/(scale*Math.cosh(Math.PI*(1-2*mercator)));
    const xRatio=width/tileMetres, yRatio=height/(tileMetres*(south-north));
    for(let i=0;i<columns;i++){
      const px=Math.min(width-1,Math.floor((i+0.5)*width/columns));
      const west=Math.max(0,px-1),east=Math.min(width-1,px+1);
      const gx=(data[py*width+east]-data[py*width+west])*xRatio/(east-west);
      const gy=(data[south*width+px]-data[north*width+px])*yRatio;
      if(!Number.isFinite(gx)||!Number.isFinite(gy)||(!gx&&!gy))continue;
      const grade=Math.sqrt(gx*gx+gy*gy);
      const light=clamp(0.5-0.5*(gx*lightX+gy*lightY)/grade);
      const slope=grade*1.25;
      const inv=1/Math.sqrt(1+slope*slope);
      const shadeAlpha=slope*inv*strength;
      const shadowWeight=(1-light)*shadow[3]*shadeAlpha;
      const highlightWeight=light*highlight[3]*shadeAlpha;
      const shade=shadowWeight+highlightWeight;
      const accentWeight=(1-inv)*strength*accent[3]*(1-shade);
      const alpha=shade+accentWeight;
      if(!(alpha>0))continue;
      const out=(j*columns+i)*4;
      for(let k=0;k<3;k++)pixels[out+k]=255*(shadow[k]*shadowWeight+highlight[k]*highlightWeight+accent[k]*accentWeight)/alpha;
      pixels[out+3]=255*alpha;
    }
  }
  return {width:columns,height:rows,pixels};
}
