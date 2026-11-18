// Conservative topology evidence: matching mapped electrical pairs and shared
// endpoint nodes. Proximity alone never establishes electrical connectivity.
const list=value=>String(value??'').split(';').map(v=>v.trim()).filter(Boolean);
export function electricalPairs(tags={}) {
  const voltages=String(tags.voltage??'').split(';').map(v=>v.trim()),frequencies=String(tags.frequency??'').split(';').map(v=>v.trim());
  if([...voltages,...frequencies].some(value=>!value))return [];
  if(!voltages.length||!frequencies.length)return [];
  if(voltages.length!==frequencies.length&&voltages.length!==1&&frequencies.length!==1)return [];
  return Array.from({length:Math.max(voltages.length,frequencies.length)},(_,i)=>[voltages[voltages.length===1?0:i],frequencies[frequencies.length===1?0:i]])
    .filter(pair=>pair.every(value=>/^\d+(?:\.\d+)?$/.test(value)))
    .map(([voltage,frequency])=>`${Number(voltage)}/${Number(frequency)}`);
}
export const matchingElectricalPairs=(a,b)=>electricalPairs(a).filter(pair=>electricalPairs(b).includes(pair));
export function tractionCircuitEvidence(elements) {
  const current=elements.filter(e=>!['construction','proposed','disused','abandoned','razed','demolished','removed'].some(state=>e.tags?.[state]==='yes'));
  const lines=current.filter(e=>e.type==='way'&&['line','cable','minor_line'].includes(e.tags?.power)&&!['bay','busbar'].includes(e.tags?.line));
  const facilities=current.filter(e=>['substation','converter','frequency_converter','transformer','plant','generator'].includes(e.tags?.power)&&(list(e.tags?.usage).some(v=>['traction','railway'].includes(v))||list(e.tags?.substation).includes('traction')));
  const nodes=new Map(),evidence=new Map(),queue=[];
  const seed=(line,pairs,basis)=>{if(!pairs.length)return;let known=evidence.get(line);if(!known){known={pairs:new Set(),basis};evidence.set(line,known);}for(const pair of pairs)if(!known.pairs.has(pair)){known.pairs.add(pair);queue.push([line,pair]);}};
  for(const line of lines) {
    for(const node of new Set(line.nodes||[])){if(!nodes.has(node))nodes.set(node,[]);nodes.get(node).push(line);}
    if(list(line.tags.usage).some(v=>['traction','railway'].includes(v)))seed(line,electricalPairs(line.tags),'Explicit traction line with matched electrical pair');
  }
  for(const facility of facilities)for(const node of facility.type==='node'?[facility.id]:(facility.nodes||[]))for(const line of nodes.get(node)||[])
    seed(line,matchingElectricalPairs(facility.tags,line.tags),'Shared node with mapped traction facility; matched voltage/frequency');
  for(let i=0;i<queue.length;i++) {
    const [line,pair]=queue[i];
    for(const node of new Set(line.nodes||[]))for(const next of nodes.get(node)||[]) {
      if(next===line)continue;
      if(![line.nodes?.[0],line.nodes?.at(-1),next.nodes?.[0],next.nodes?.at(-1)].includes(node))continue;
      if(electricalPairs(next.tags).includes(pair))seed(next,[pair],'Mapped endpoint circuit; matched voltage/frequency');
    }
  }
  return new Map([...evidence].map(([line,{pairs,basis}])=>[`${line.type}-${line.id}`,{circuit_connection_basis:basis,circuit_electrical_pairs:[...pairs].sort().join(';')} ]));
}
