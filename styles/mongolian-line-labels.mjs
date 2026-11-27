// Route names containing shaped traditional Mongolian need a stationary
// text block on a line anchor. Other scripts keep their along-line layout.
const LETTERS=/[\u1820-\u18AA\u{11660}-\u{1167F}]/u;
const LABEL_FIELDS=/^(?:atlas_name|name(?::[^|]+)?|label|ref|owner)$/;
export const MONGOLIAN_LABEL_FIELDS='atlas_mongolian_label_fields';
const BASE='atlas:mongolian-base-filter', CLONE='atlas:mongolian-line-clone';
const layerId=id=>id+'-mongolian-anchor';
export const mongolianAnchorLayer=name=>name+'__atlas_mongolian_anchors';

// Vector sources with TileJSON reject style layers that are not in their
// advertised schema, even if the provider tiles were decorated correctly.
export function withMongolianVectorLayers(metadata) {
  if(!Array.isArray(metadata.vector_layers))return metadata;
  const ids=new Set(metadata.vector_layers.map(layer=>layer.id));
  const companions=metadata.vector_layers.flatMap(layer=>{
    if(typeof layer.id!=='string'||layer.id.endsWith('__atlas_mongolian_anchors'))return [];
    const id=mongolianAnchorLayer(layer.id);
    if(ids.has(id))return [];
    ids.add(id);
    return [{...layer,id,fields:{...layer.fields,[MONGOLIAN_LABEL_FIELDS]:'String'}}];
  });
  return companions.length?{...metadata,vector_layers:[...metadata.vector_layers,...companions]}:metadata;
}


export const hasTraditionalMongolian=value=>typeof value==='string'&&LETTERS.test(value);

// Record exact property names, not just whether the feature has any
// Mongolian value. E.g. selecting English should not rotate an English
// label merely because a different name:mn-Mong exists on the same line.
export function markMongolianTextFields(properties) {
  const marked=Object.keys(properties).filter(key=>
    LABEL_FIELDS.test(key)&&hasTraditionalMongolian(properties[key]));
  if(marked.length) properties[MONGOLIAN_LABEL_FIELDS]='|'+marked.join('|')+'|';
  else delete properties[MONGOLIAN_LABEL_FIELDS];
  return properties;
}

export function mongolianFieldFilter(fields) {
  const marked=['coalesce',['get',MONGOLIAN_LABEL_FIELDS],''];
  return ['case', ...fields.flatMap(key=>[
    ['!=',['coalesce',['get',key],''],''],
    ['in','|'+key+'|',marked],
  ]),false];
}

export function splitMongolianLineLabels(style, namedFields, localizable) {
  const originalLayers=style.layers.filter(layer=>!layer.metadata?.[CLONE]);
  style.layers=originalLayers.flatMap(layer=>{
    const metadata=layer.metadata??{};
    const previous=Object.hasOwn(metadata,BASE) ? metadata[BASE] : layer.filter??null;
    const fields=localizable(layer)?namedFields : layer.id==='owner-labels'?['owner']:null;
    if(!fields||layer.type!=='symbol'||!layer['source-layer']||!['line','line-center'].includes(layer.layout?.['symbol-placement'])||
      layer.layout['icon-image']!==undefined)return [layer];
    const mgl=mongolianFieldFilter(fields);
    const withOriginal=filter=>previous?['all',previous,filter]:filter;
    const original={...layer,metadata:{...metadata,[BASE]:previous},filter:withOriginal(['!',mgl])};
    const layout={...layer.layout,'symbol-placement':'point','text-rotation-alignment':'viewport','text-pitch-alignment':'viewport'};
    for(const name of ['symbol-spacing','text-max-angle','text-keep-upright']) delete layout[name];
    const anchor={...layer,id:layerId(layer.id),'source-layer':mongolianAnchorLayer(layer['source-layer']),
      metadata:{...metadata,[BASE]:previous,[CLONE]:layer.id},layout,filter:withOriginal(mgl)};
    return [original,anchor];
  });
  return style;
}
export const isMongolianLineLabelOf=(layer,id)=>layer.id===id||layer.metadata?.[CLONE]===id;


// Clip first so adjacent buffered tiles do not place anchors on the same
// off-tile section. Choose the midpoint by length of the longest visible
// piece rather than by vertex count; unevenly digitized curves stay on-line.
export function mongolianRouteAnchor(lines,extent) {
  let best=[],bestLength=0;
  for(const line of lines) {
    let piece=[],length=0;
    const finish=()=>{if(length>bestLength){best=piece;bestLength=length;}piece=[];length=0;};
    for(let i=1;i<line.length;i++) {
      const a=line[i-1],b=line[i],dx=b.x-a.x,dy=b.y-a.y;
      let lo=0,hi=1;
      for(const [p,q] of [[-dx,a.x],[dx,extent-1-a.x],[-dy,a.y],[dy,extent-1-a.y]]) {
        if(!p){if(q<0){lo=1;hi=0;break;}continue;}
        if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);
      }
      const span=(hi-lo)*Math.hypot(dx,dy);
      if(span<=0){finish();continue;}
      if(lo>0)finish();
      piece.push({x:a.x+lo*dx,y:a.y+lo*dy,dx:(hi-lo)*dx,dy:(hi-lo)*dy,span});
      length+=span;
      if(hi<1)finish();
    }
    finish();
  }
  if(bestLength<extent/64)return null;
  let middle=bestLength/2;
  for(const part of best){
    if(middle<=part.span)return{x:Math.round(part.x+part.dx*middle/part.span),y:Math.round(part.y+part.dy*middle/part.span)};
    middle-=part.span;
  }
  return null;
}
