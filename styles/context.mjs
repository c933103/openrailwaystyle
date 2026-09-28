// Facilities and planning context use the basemap archive. Local stops are
// distinguished from interchanges and enter only at street zoom.
export const CONTEXT_CATEGORIES = [
  {id:'airport', group:'transport', label:'Airport', color:'#52639a', icon:'plane'},
  {id:'bus', group:'transport', label:'Bus / coach interchange', color:'#007b83', icon:'bus', values:['bus_station']},
  {id:'bus-stop', group:'transport', label:'Bus stop', color:'#438487', icon:'bus', values:['bus_stop'], zoom:15, local:true},
  {id:'taxi', group:'transport', label:'Taxi stand', color:'#927326', icon:'taxi', values:['taxi'], zoom:15, local:true},
  {id:'bike-rental', group:'transport', label:'Bicycle rental / bike share', color:'#54886d', icon:'bike', values:['bicycle_rental'], zoom:15, local:true},
  {id:'bike-parking', group:'transport', label:'Bicycle parking', color:'#54886d', icon:'parking', values:['bicycle_parking'], zoom:17, local:true},
  {id:'religious', group:'constraints', label:'Religious institution / place of worship', color:'#89705c', icon:'civic', classes:['place_of_worship'], values:['monastery','place_of_worship'], zoom:13},
  {id:'heritage', group:'constraints', label:'Heritage / historic site', color:'#956837', icon:'castle', values:['castle','monument','ruins','archaeological_site','memorial','historic','battlefield'], zoom:12},
  {id:'ferry', group:'transport', label:'Ferry terminal', color:'#007b83', icon:'ferry', values:['ferry_terminal']},
  {id:'aerialway', group:'transport', label:'Cable car station', color:'#007b83', icon:'cable', classes:['aerialway']},
  {id:'port', group:'transport', label:'Port / harbour', color:'#397a8f', icon:'anchor', values:['port','harbour','harbor','marina','dock'], zoom:15},
  {id:'hospital', group:'destinations', label:'Hospital', color:'#b04a59', icon:'cross', values:['hospital']},
  {id:'university', group:'destinations', label:'University / college', color:'#61669a', icon:'school', values:['university','college']},
  {id:'school', group:'destinations', label:'School', color:'#61669a', icon:'school', values:['school','kindergarten'], zoom:14},
  {id:'shopping', group:'destinations', label:'Shopping centre / market', color:'#93651d', icon:'shop', values:['mall','department_store','marketplace']},
  {id:'sport', group:'destinations', label:'Stadium / sports centre', color:'#6c7730', icon:'stadium', values:['stadium','sports_centre']},
  {id:'visitor', group:'destinations', label:'Visitor attraction', color:'#8a5a87', icon:'castle', values:['theme_park','water_park','zoo','aquarium','attraction']},
  {id:'culture', group:'destinations', label:'Museum / culture', color:'#8a5a87', icon:'civic', values:['museum','gallery','theatre','arts_centre','library','cinema'], zoom:13},
  {id:'civic', group:'destinations', label:'Government / community facility', color:'#61669a', icon:'civic', values:['government','townhall','town_hall','courthouse','public_building','community_centre','conference_centre','exhibition_centre'], zoom:13},
];
export const AREA_CATEGORIES = [
  {id:'employment', label:'Industrial / commercial area', color:'#937ca2', values:['industrial','commercial']},
  {id:'shopping', label:'Retail area', color:'#bf985c', values:['retail']},
  {id:'hospital', label:'Hospital grounds', color:'#c18188', values:['hospital']},
  {id:'education', label:'School / university grounds', color:'#909ec5', values:['school','university','college','kindergarten','library']},
  {id:'visitor', label:'Stadium / attraction grounds', color:'#a1ad73', values:['stadium','sports_centre','theme_park','zoo']},
];
const categoryById = new Map(CONTEXT_CATEGORIES.map(c=>[c.id,c]));
export function contextCategory(properties, sourceLayer) {
  if (sourceLayer === 'aerodrome_label') return ['military','private'].includes(properties.class) ? null : categoryById.get('airport');
  if (sourceLayer !== 'poi') return null;
  const value = properties.subclass || properties.class;
  return CONTEXT_CATEGORIES.find(c=>c.values?.includes(value) || c.classes?.includes(properties.class)) || null;
}
export function contextDescription(properties, sourceLayer) {
  const category = contextCategory(properties, sourceLayer);
  if (category) return category;
  if (sourceLayer === 'boundary' && properties.class === 'aboriginal_lands') return {group:'constraints',label:'Indigenous territory / non-administrative jurisdiction'};
  if (sourceLayer === 'park') return {group:'constraints',label:properties.class==='aboriginal_lands'?'Indigenous territory / non-administrative jurisdiction':['archaeological_site','battlefield','district','historic'].includes(properties.class)?'Protected historic area':'Nature reserve / protected area'};
  if (sourceLayer === 'landuse') {
    if (['military','religious','cemetery'].includes(properties.class)) return {group:'constraints',label:{military:'Military area',religious:'Religious grounds',cemetery:'Cemetery'}[properties.class]};
    if (properties.class === 'bus_station') return categoryById.get('bus');
    if (properties.class === 'railway') return {group:'transport',label:'Railway grounds'};
    const area = AREA_CATEGORIES.find(c=>c.values.includes(properties.class));
    if (area) return {...area,group:'destinations'};
  }
  if (sourceLayer === 'aeroway') return {group:'transport',label:'Airport '+(properties.class || 'grounds')};
  if (sourceLayer === 'transportation' && properties.class === 'ferry') return {group:'transport',label:'Mapped ferry route'};
  return null;
}
export function distanceMetres(a,b) {
  const rad = Math.PI/180, dLat = (b[1]-a[1])*rad, dLon = (b[0]-a[0])*rad;
  const h = Math.sin(dLat/2)**2 + Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLon/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function nearbyTransport(origin, features, radius=500, zoom=20) {
  const result = [], seen = new Set();
  for (const f of features) {
    const category = contextCategory(f.properties, f.sourceLayer);
    if (f.geometry?.type !== 'Point' || category?.group !== 'transport' || category.id === 'port' || (category.local && zoom < category.zoom)) continue;
    const distance = distanceMetres(origin,f.geometry.coordinates);
    if (distance > radius) continue;
    // Tile buffers repeat the same feature. Do not merge different terminals
    // just because their name is identical.
    const key = `${category.id}:${f.id ?? f.geometry.coordinates.map(n=>n.toFixed(5)).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key); result.push({feature:f,category,distance});
  }
  return result.sort((a,b)=>Number(!!a.category.local)-Number(!!b.category.local)||a.distance-b.distance).slice(0,8);
}
// Small, self-contained pictograms, drawn as vector paths on a 2× canvas.
// No external sprite service or font glyphs are needed.
const ICON_PATHS = {
  plane:'M12 3 L14 10 L21 14 L21 16 L14 14 L14 19 L17 21 L17 22 L12 20 L7 22 L7 21 L10 19 L10 14 L3 16 L3 14 L10 10 Z',
  bus:'M6 4 H18 V19 H6 Z M6 7 H18 M6 13 H18 M9 7 V13 M7 16 H9 M15 16 H17 M8 19 V21 M16 19 V21',
  parking:'M7 21 V4 H13 Q21 4 21 10 Q21 16 13 16 H7',
  taxi:'M4 11 L7 6 H17 L20 11 V18 H4 Z M4 11 H20 M8 6 V3 H16 V6 M6 18 V21 M18 18 V21 M6 14 H8 M16 14 H18',
  bike:'M8 16 A5 5 0 1 1 7.9 15 M22 16 A5 5 0 1 1 21.9 15 M3 16 L8 8 L15 16 H3 M8 8 H16 M15 4 L17 16 M12 4 H17 M6 6 H10',
  ferry:'M5 11 L12 8 L19 11 L17 17 H7 Z M8 9 V5 H16 V9 M5 20 Q8 17 12 20 Q16 23 20 20',
  cable:'M3 4 L21 2 M12 3 V8 M6 8 H18 V20 H6 Z M6 15 H18 M12 8 V15',
  anchor:'M12 3 V20 M8 8 H16 M4 13 Q4 20 12 20 Q20 20 20 13 M3 15 L4 12 L7 14 M17 14 L20 12 L21 15',
  cross:'M9 4 H15 V9 H20 V15 H15 V20 H9 V15 H4 V9 H9 Z',
  school:'M3 8 L12 4 L21 8 L12 12 Z M6 10 V16 Q12 21 18 16 V10 M21 8 V17',
  shop:'M5 9 H19 V21 H5 Z M8 9 V6 Q12 1 16 6 V9',
  stadium:'M3 8 Q12 1 21 8 V17 Q12 24 3 17 Z M3 8 Q12 15 21 8 M7 12 V19 M17 12 V19',
  castle:'M4 21 V6 H7 V9 H10 V4 H14 V9 H17 V6 H20 V21 Z M10 21 V16 Q12 12 14 16 V21',
  civic:'M3 8 L12 3 L21 8 Z M5 11 V19 M10 11 V19 M14 11 V19 M19 11 V19 M3 21 H21',
};
export function contextIcon(id, document) {
  const category = categoryById.get(id.replace('context-',''));
  if (!category) return null;
  const canvas = document.createElement('canvas'); canvas.width=48;canvas.height=48;
  const ctx = canvas.getContext('2d');ctx.scale(2,2);
  ctx.fillStyle='#fffef8';ctx.strokeStyle=category.color;ctx.lineWidth=1;
  ctx.beginPath();ctx.roundRect(0.75,0.75,22.5,22.5,5);ctx.fill();ctx.stroke();
  ctx.save();ctx.translate(2,2);ctx.scale(20/24,20/24);
  ctx.lineWidth=1.8;ctx.lineJoin='round';ctx.lineCap='round';
  ctx.stroke(new Path2D(ICON_PATHS[category.icon]));ctx.restore();
  return ctx.getImageData(0,0,48,48);
}
