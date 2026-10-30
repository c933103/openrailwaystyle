// Maintenance-only planar geometry for Overpass `out geom` elements. Areas are
// small enough that longitude/latitude can be treated as planar coordinates.
export const validPoint=p=>Number.isFinite(p?.lon)&&Number.isFinite(p?.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90;
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];

// Join member ways with the given role test into closed rings by shared end
// coordinates.
function joinRings(members,keep) {
  const open=members.filter(m=>m.type==='way'&&keep(m.role)&&m.geometry?.length>=2&&m.geometry.every(validPoint)).map(m=>m.geometry.map(p=>[p.lon,p.lat]));
  const closed=[];
  while(open.length) {
    let ring=open.shift();
    for(let joined=true;joined&&!same(ring[0],ring.at(-1));) {
      joined=false;
      for(let i=0;i<open.length;i++) {
        const part=open[i],end=ring.at(-1);
        const next=same(part[0],end)?part:same(part.at(-1),end)?[...part].reverse():null;
        if(next){ring=[...ring,...next.slice(1)];open.splice(i,1);joined=true;break;}
      }
    }
    if(ring.length>=4&&same(ring[0],ring.at(-1)))closed.push(ring);
  }
  return closed;
}
export const outerRings=(members=[])=>joinRings(members,role=>role!=='inner');
// The ring of a closed way, or none.
export function wayRing(element) {
  const points=(element.geometry||[]).filter(validPoint).map(p=>[p.lon,p.lat]);
  return points.length>=4&&points.length===element.geometry.length&&same(points[0],points.at(-1))?[points]:[];
}
// Polygons of a closed way or multipolygon relation: each outer ring with the
// inner rings (holes) that lie inside it.
export function areaPolygons(element) {
  if(element.type==='way')return wayRing(element).map(outer=>({outer,inners:[],box:bounds(outer)}));
  if(element.type!=='relation')return [];
  const polygons=outerRings(element.members).map(outer=>({outer,inners:[],box:bounds(outer)}));
  for(const inner of joinRings(element.members||[],role=>role==='inner')) {
    const holder=polygons.find(p=>inside(inner[0],p.outer));
    if(holder)holder.inners.push(inner);
  }
  return polygons;
}
export function inside([x,y],ring) {
  let result=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)result=!result;
  }
  return result;
}
export const bounds=points=>points.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
