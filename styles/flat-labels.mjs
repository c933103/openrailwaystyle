import {featureFilter,latest,normalizePropertyExpression} from '@maplibre/maplibre-gl-style-spec';

export function flatPointLabel(layer) {
  return layer.type==='symbol' && layer['source-layer']!=null &&
    (layer.layout?.['symbol-placement']??'point')==='point' &&
    layer.layout?.['text-field']!=null && layer.layout?.['icon-image']==null;
}
const properties={
  text:['layout','text-field'], size:['layout','text-size'], font:['layout','text-font'],
  sort:['layout','symbol-sort-key'], anchor:['layout','text-anchor'], variable:['layout','text-variable-anchor'],
  xOffset:['layout','text-offset'], radial:['layout','text-radial-offset'], padding:['layout','text-padding'],
  transform:['layout','text-transform'], allow:['layout','text-allow-overlap'], ignore:['layout','text-ignore-placement'],
  color:['paint','text-color'], opacity:['paint','text-opacity'], halo:['paint','text-halo-color'],
  haloWidth:['paint','text-halo-width'],
};
export function compileFlatPointLabel(layer) {
  if(!flatPointLabel(layer)) return null;
  const {filter,needGeometry}=featureFilter(layer.filter);
  if(needGeometry) return null;
  const usesLegacyTokens=typeof layer.layout['text-field']==='string';
  const expressions=Object.entries(properties).map(([key,[section,name]])=>{
    const spec=latest[section+'_symbol'][name];
    return [key,normalizePropertyExpression(layer[section]?.[name]??spec.default,spec)];
  });
  return {
    sourceLayer:layer['source-layer'],
    resolve(global,feature,canonical,state={}) {
      if(feature.type!==1 || !filter(global,feature,canonical)) return null;
      const values=Object.fromEntries(expressions.map(([k,e])=>[k,e.evaluate(global,feature,state,canonical)]));
      // Only name text is rendered here. Formatted text, not icon/glyph
      // positioning data, comes from the same MVT property expression.
      let label=values.text?.toString()??'';
      if(usesLegacyTokens)label=label.replace(/\{([^{}]+)\}/g,(_,key)=>String(feature.properties[key]??''));
      label=label.trim();
      if(!label || !(values.size>0) || !(values.opacity>0))return null;
      if(values.transform==='uppercase')label=label.toUpperCase();
      else if(values.transform==='lowercase')label=label.toLowerCase();
      return {...values,label};
    },
  };
}

export function flatLabelCandidates(compiled,features,tile,camera,global,featureState) {
  const [a,b,c,d,tx,ty]=camera.tileTransform(tile);
  const {x,y,z}=tile,canonical={x,y,z};
  const candidates=[];
  for(const feature of features) {
    const {id,extent,paths}=feature;
    if(feature.type!==1)continue;
    let label;
    for(const path of paths) for(const p of path){
      const u=p.x/extent,v=p.y/extent;
      // Ignore buffer duplicates; keep legitimate wrapped copies farther apart.
      if(u<0||u>=1||v<0||v>=1) continue;
      const px=a*u+c*v+tx,py=b*u+d*v+ty;
      if(px< -64||px>camera.width+64||py< -64||py>camera.height+64)continue;
      if(label===undefined)label=compiled.resolve(global,feature,canonical,featureState(id)??{});
      if(label)candidates.push({...label,px,py});
    }
  }
  return candidates;
}

export function drawFlatPointLabels(context,camera,groups) {
  const cell=64,buckets=new Map(), counts=new Map(),drawn=[];
  const visit=(rect,fn)=>{
    const minX=Math.max(0,Math.floor(rect.left/cell)), maxX=Math.min(Math.floor(camera.width/cell),Math.floor(rect.right/cell));
    const minY=Math.max(0,Math.floor(rect.top/cell)), maxY=Math.min(Math.floor(camera.height/cell),Math.floor(rect.bottom/cell));
    for(let y=minY;y<=maxY;y++)
      for(let x=minX;x<=maxX;x++)
        if(fn(x+':'+y))return true;
    return false;
  };
  const collides=rect=>visit(rect,key=>(buckets.get(key)??[]).some(o=>
    rect.left<o.right&&rect.right>o.left&&rect.top<o.bottom&&rect.bottom>o.top));
  const add=rect=>visit(rect,key=>{
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(rect);
  });
  context.save();
  try {
    const alpha=context.globalAlpha;
    context.textBaseline='middle';context.textAlign='left';
    for(const {id,candidates} of groups) {
      let count=0;
      for(const label of candidates.sort((a,b)=>(a.sort??0)-(b.sort??0))){
        const {label:text,size,px,py,haloWidth,padding=0}=label;
        context.font=(label.font?.some(name=>/bold/i.test(name))?'bold ':'')+size+'px sans-serif';
        const lines=text.split(/\n/).filter(Boolean), widths=lines.map(line=>context.measureText(line).width);
        const width=Math.max(...widths), lineHeight=size*1.2,height=lines.length*lineHeight;
        if(!Number.isFinite(width)||!width)continue;
        const margin=Math.max(0,haloWidth)+padding;
        const [ox,oy]=label.xOffset??[0,0];
        const anchors=label.variable?.length?label.variable:[label.anchor];
        for(const anchor of anchors){
          const sideX=anchor?.includes('left')?1:anchor?.includes('right')?-1:0;
          const sideY=anchor?.includes('top')?1:anchor?.includes('bottom')?-1:0;
          const radial=label.variable?.length?(label.radial??0)*size:0;
          const x=px+ox*size+(sideX-1)*width/2+sideX*radial;
          const y=py+oy*size+(sideY-1)*height/2+sideY*radial;
          if(x+width<=0||x>=camera.width||y+height<=0||y>=camera.height) continue;
          const rect={left:x-margin,right:x+width+margin,top:y-margin,bottom:y+height+margin};
          if(!label.allow&&collides(rect))continue;
          if(!label.ignore)add(rect);
          drawn.push({label,lines,widths,width,x,y,lineHeight,font:context.font});
          count++;
          break;
        }
      }
      counts.set(id,count);
    }
    // Placement priority is independent of paint order: accepted labels
    // from a higher-priority group remain on top if overlap is allowed.
    for(const {label,lines,widths,width,x,y,lineHeight,font} of drawn.reverse()){
      context.font=font;
      context.globalAlpha=alpha*label.opacity;
      context.fillStyle=label.color.toString();
      lines.forEach((line,i)=>{
        const left=x+(width-widths[i])/2,midY=y+(i+0.5)*lineHeight;
        if(label.haloWidth>0){
          context.lineJoin='round';context.lineWidth=2*label.haloWidth;
          context.strokeStyle=label.halo.toString();context.strokeText(line,left,midY);
        }
        context.fillText(line,left,midY);
      });
    }
  } finally {context.restore();}
  return counts;
}
