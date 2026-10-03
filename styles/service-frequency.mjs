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
// All sources share the scale and bundle spacing. A bundle expires together
// at its earliest source expiry so widths and offsets cannot disagree.
export function profileBundle(records) {
  const until=Math.min(...records.map(r=>r?.properties.frequency_until||0));
  const out=records.map(r=>({...r?.properties,frequency_until:Number.isFinite(until)?until:0}));
  for(const profile of FREQUENCY_PROFILES){
    const rates=records.map(r=>r?.profiles[profile]?.rate ?? null);
    const widths=rates.map(frequencyWidth);
    const gap=records.some(Boolean)?0.5:0,total=widths.reduce((a,b)=>a+b,0)+Math.max(0,records.length-1)*gap;
    let used=0;
    widths.forEach((width,i)=>{
      const offset=used+width/2-total/2;used+=width+gap;
      Object.assign(out[i],{[`frequency_width_${profile}`]:rounded(width),[`frequency_offset_${profile}`]:rounded(offset),[`frequency_label_${profile}`]:Math.max(-255,Math.min(255,Math.round(offset*4)))});
      const p=records[i]?.profiles[profile];
      if(rates[i]!==null){Object.assign(out[i],{[`frequency_${profile}`]:rounded(rates[i]),[`frequency_high_${profile}`]:rounded(p.high??rates[i]),[`frequency_quality_${profile}`]:p.quality||'headway_estimate'});
        if(p.headway)out[i][`headway_${profile}`]=p.headway;
        for(const d of ['forward','backward'])if(p[d]!==undefined&&p[d]!==null)out[i][`frequency_${d}_${profile}`]=p[d];
      }
    });
  }
  return out;
}
export function frequencyBundle(routes, lines, catalog) {
  const until=Date.parse(catalog.source.checked+'T00:00:00Z')/1000+catalog.source.review_after_days*86400;
  const records=routes.map(route=>{
    const r=matchHeadway(route,lines,catalog);if(!r)return null;
    return {properties:{frequency_id:r.id,frequency_source:catalog.source.name,frequency_url:catalog.source.url,frequency_checked:catalog.source.checked,frequency_quality:catalog.source.quality,frequency_definition:catalog.source.period_definition,frequency_until:until},
      profiles:Object.fromEntries(FREQUENCY_PROFILES.map(p=>[p,r.profiles[p]?.minutes?{rate:60/r.profiles[p].minutes[1],high:60/r.profiles[p].minutes[0],headway:r.profiles[p].reported,quality:'headway_estimate'}:{}]))};
  });
  // Unknown peers must retain the source expiry so known routes in a mixed
  // OSM bundle remain usable; unknown width is still the baseline.
  return profileBundle(records.map(r=>r||{properties:{frequency_until:records.some(Boolean)?until:0},profiles:{}}));
}
const legacyOffset=['*',['-',['get','i'],['/',['-',['get','n'],1],2]],3.5];
const zoomScale=value=>['interpolate',['linear'],['zoom'],7,['*',value,2/3.5],12,value,16,['*',value,5/3.5]];
const valid=now=>['>=',['coalesce',['get','frequency_until'],0],now/1000];
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
  const rate=`${format(low)}${Number(high)!==Number(low)?'–'+format(high):''}/h/direction`;
  if(properties[`headway_${profile}`])return `${rate} (estimated from ${properties[`headway_${profile}`]} min)`;
  const quality=properties[`frequency_quality_${profile}`]==='headway_estimate'?'headway estimate':'scheduled';
  const forward=properties[`frequency_forward_${profile}`],backward=properties[`frequency_backward_${profile}`];
  const directions=forward!==undefined&&backward!==undefined?`; directions ${format(forward)} / ${format(backward)}; width uses the lower rate`:'';
  return `${rate} (${quality}${properties.frequency_date?' · '+properties.frequency_date:''}${directions})`;
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

// No polling or requests. Reevaluate at the earliest loaded profile expiry,
// then on resume because suspended tabs may defer timers.
export function installFrequencyExpiry({features,active,refresh,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let timer,lastPaint=now();
  const pause=()=>{clearTimer(timer);timer=undefined;};
  function update(){
    pause();if(!active())return;
    const stamp=now(),expiries=[...new Set(features().map(f=>Number(f.properties.frequency_until)*1000).filter(n=>Number.isFinite(n)&&n>0))];
    if(expiries.some(n=>n<stamp&&n>=lastPaint)){refresh();lastPaint=stamp;}
    const next=Math.min(...expiries.filter(n=>n>=stamp));
    if(Number.isFinite(next))timer=setTimer(update,Math.min(2147483647,Math.max(1,next-stamp+1)));
  }
  return {update,pause,resume(){if(active()){refresh();lastPaint=now();}update();}};
}
