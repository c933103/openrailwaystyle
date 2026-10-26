// Maintenance-only planar geometry for Overpass `out geom` elements. Areas are
// small enough that longitude/latitude can be treated as planar coordinates.
export const validPoint=p=>Number.isFinite(p?.lon)&&Number.isFinite(p?.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90;
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];

// Join relation member ways into closed outer rings by shared end coordinates.
export function outerRings(members=[]) {
  const open=members.filter(m=>m.type==='way'&&m.role!=='inner'&&m.geometry?.length>=2&&m.geometry.every(validPoint)).map(m=>m.geometry.map(p=>[p.lon,p.lat]));
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
// The ring of a closed way, or none.
export function wayRing(element) {
  const points=(element.geometry||[]).filter(validPoint).map(p=>[p.lon,p.lat]);
  return points.length>=4&&points.length===element.geometry.length&&same(points[0],points.at(-1))?[points]:[];
}
// Areas of a way or multipolygon relation.
export const areaRings=element=>element.type==='way'?wayRing(element):element.type==='relation'?outerRings(element.members):[];
export function inside([x,y],ring) {
  let result=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)result=!result;
  }
  return result;
}
export const bounds=points=>points.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
export const boxesOverlap=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const orient=(a,b,c)=>Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
const onSegment=(a,b,p)=>Math.min(a[0],b[0])<=p[0]&&p[0]<=Math.max(a[0],b[0])&&Math.min(a[1],b[1])<=p[1]&&p[1]<=Math.max(a[1],b[1]);
// Whether segments ab and cd intersect, including touching.
export function segmentsMeet(a,b,c,d) {
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  if(o1!==o2&&o3!==o4)return true;
  return o1===0&&onSegment(a,b,c)||o2===0&&onSegment(a,b,d)||o3===0&&onSegment(c,d,a)||o4===0&&onSegment(c,d,b);
}
// Whether a line enters an area: a vertex inside it or a segment meeting its edge.
export function lineMeetsRing(line,ring) {
  if(line.some(p=>inside(p,ring)))return true;
  for(let i=1;i<line.length;i++)for(let j=1;j<ring.length;j++)if(segmentsMeet(line[i-1],line[i],ring[j-1],ring[j]))return true;
  return false;
}
