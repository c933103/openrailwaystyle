// One scale across AM peak, PM peak and off-peak; unknown is not zero.
export const FREQUENCY_PROFILES = ['am', 'pm', 'offpeak'];
export const FREQUENCY_LABELS = {am:'Weekday morning peak',pm:'Weekday evening peak',offpeak:'Weekday off-peak'};
const STOPS = [[0,1.5],[1,1.5],[2,2],[4,2.5],[6,3],[12,4],[24,5],[30,5.5]];
export function frequencyWidth(rate) {
  if (rate === null || !Number.isFinite(rate) || rate < 0) return 3.5;
  for (let i=1;i<STOPS.length;i++) if(rate<=STOPS[i][0]) {
    const [a,wa]=STOPS[i-1],[b,wb]=STOPS[i];return wa+(wb-wa)*(rate-a)/(b-a);
  }
  return 5.5;
}
export const selectedFrequencyProfile = settings => settings.frequencyPeriod==='peak' ? (settings.peakPhase==='pm'?'pm':'am') : 'offpeak';
export function matchHeadway(route, lines, catalog) {
  if(catalog?.schema!==1 || catalog.source?.id!=='mtr-hk')return null;
  // Ref alone is never enough. Scope by audited network/kind and Hong Kong
  // geometry; never apply a section row to a complete branched route.
  const points=lines.flat();
  if(!points.length || points.some(([x,y])=>x<113.8||x>114.45||y<22.15||y>22.6))return null;
  return catalog.routes.find(r=>r.scope==='whole_route' && r.match?.ref===route.ref && r.match.network===route.network && r.match.kind===route.kind) || null;
}
const rounded = n=>Math.round(n*1e6)/1e6;
export function frequencyBundle(routes, lines, catalog) {
  const records=routes.map(r=>matchHeadway(r,lines,catalog));
  const until=records.some(Boolean)?Date.parse(catalog.source.checked+'T00:00:00Z')/1000+catalog.source.review_after_days*86400:0;
  const out=records.map(r=>r?{frequency_id:r.id,frequency_source:catalog.source.name,frequency_url:catalog.source.url,frequency_checked:catalog.source.checked,frequency_quality:catalog.source.quality,frequency_definition:catalog.source.period_definition}:{});
  for(const profile of FREQUENCY_PROFILES){
    const rates=records.map(r=>r?.profiles[profile]?.minutes || null);
    const widths=rates.map(r=>frequencyWidth(r?60/r[1]:null));
    // A small separation only in frequency mode. The default equal-width
    // paint/labels retain their existing geometry.
    const gap=records.some(Boolean)?0.5:0,total=widths.reduce((a,b)=>a+b,0)+Math.max(0,routes.length-1)*gap;
    let used=0;
    widths.forEach((width,i)=>{
      const offset=used+width/2-total/2;used+=width+gap;
      Object.assign(out[i],{frequency_until:until,[`frequency_width_${profile}`]:rounded(width),[`frequency_offset_${profile}`]:rounded(offset),[`frequency_label_${profile}`]:Math.max(-255,Math.min(255,Math.round(offset*4)))});
      if(rates[i])Object.assign(out[i],{[`frequency_${profile}`]:rounded(60/rates[i][1]),[`frequency_high_${profile}`]:rounded(60/rates[i][0]),[`headway_${profile}`]:records[i].profiles[profile].reported});
    });
  }
  return out;
}
const legacyOffset=['*',['-',['get','i'],['/',['-',['get','n'],1],2]],3.5];
const zoomScale=value=>['interpolate',['linear'],['zoom'],7,['*',value,2/3.5],12,value,16,['*',value,5/3.5]];
const valid=now=>['>=',['coalesce',['get','frequency_until'],0],Math.floor(now/1000)];
const legacyLabels=()=>['match',['get','slot'],...Array.from({length:127},(_,k)=>k-63).filter(k=>k).flatMap(k=>[k,['literal',[0,k*.65]]]),['literal',[0,0]]];
export function serviceFrequencyPaint(settings={},now=Date.now()) {
  if(settings.serviceWidth!=='frequency')return {width:zoomScale(3.5),offset:zoomScale(legacyOffset),opacity:1,labelOffset:legacyLabels()};
  const profile=selectedFrequencyProfile(settings),fresh=valid(now);
  const value=field=>['case',fresh,['coalesce',['get',`frequency_${field}_${profile}`],field==='width'?3.5:legacyOffset],field==='width'?3.5:legacyOffset];
  const frequencyLabels=['match',['coalesce',['get',`frequency_label_${profile}`],0],...Array.from({length:511},(_,k)=>k-255).filter(k=>k).flatMap(k=>[k,['literal',[0,k*.25*1.3/3.5]]]),['literal',[0,0]]];
  return {width:zoomScale(value('width')),offset:zoomScale(value('offset')),
    opacity:['case',['all',fresh,['has',`frequency_${profile}`]],['case',['==',['get',`frequency_${profile}`],0],.35,1],.45],
    labelOffset:['case',fresh,frequencyLabels,legacyLabels()]};
}
export function frequencyOffset(properties,zoom,settings,now=Date.now()) {
  const profile=selectedFrequencyProfile(settings),fresh=Number(properties.frequency_until)*1000>=now;
  const base=settings.serviceWidth==='frequency'&&fresh&&Number.isFinite(Number(properties[`frequency_offset_${profile}`]))?Number(properties[`frequency_offset_${profile}`]):(properties.i-(properties.n-1)/2)*3.5;
  const scale=zoom<=12?(2+(Math.max(7,zoom)-7)*.3)/3.5:(3.5+(Math.min(16,zoom)-12)*.375)/3.5;
  return base*scale;
}
export function frequencyDetails(properties,profile,now=Date.now()) {
  if(!FREQUENCY_PROFILES.includes(profile))return null;
  const low=properties[`frequency_${profile}`],high=properties[`frequency_high_${profile}`];
  if(low===undefined||low===null||!Number.isFinite(Number(low))||Number(properties.frequency_until)*1000<now)return null;
  const format=n=>Number(n).toLocaleString('en',{maximumFractionDigits:1});
  return `${format(low)}${Number(high)!==Number(low)?'–'+format(high):''}/h/direction (estimated from ${properties[`headway_${profile}`]} min)`;
}

export function nearestServiceFeature(services, point, project, z, settings, now=Date.now()) {
  let best = services[0], bestDistance = Infinity;
  for (const f of services) {
    const offset = frequencyOffset(f.properties,z,settings,now);
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) for (let k = 1; k < line.length; k++) {
      const a = project(line[k - 1]), b = project(line[k]), dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (!len) continue;
      // The segment shifted to the right of its direction (screen y points down).
      const nx = -dy / len * offset, ny = dx / len * offset;
      const t = Math.max(0, Math.min(1, ((point.x - a.x - nx) * dx + (point.y - a.y - ny) * dy) / (len * len)));
      const d = Math.hypot(a.x + nx + t * dx - point.x, a.y + ny + t * dy - point.y);
      if (d < bestDistance) { bestDistance = d; best = f; }
    }
  }
  return best;
}
