import vtPbf from 'vt-pbf';

export function flatVectorFixture({railY=900,sameNameNeighbour=false,missingStation=false}={}) {
  const station=(id,x)=>({id,type:1,tags:{name:'Fixture Station',osm_type:'node',osm_id:id},geometry:[[x,2500]]});
  return vtPbf.fromGeojsonVt({
    rail: {features: [{id:83, type:2, tags:{railway:'rail',name:'Fixture Line'},
      geometry:[[[300,railY],[3800,railY]]]}]},
    area: {features: [{type:3, tags:{kind:'water'},
      geometry:[[[850,1400],[3250,1400],[3250,3600],[850,3600],[850,1400]],
        [[1600,2000],[1600,3000],[2750,3000],[2750,2000],[1600,2000]]]}]},
    station: {features: [...(missingStation?[]:[station(7,2048)]),...(sameNameNeighbour?[station(8,2078)]:[])]},
  }, {version:2,extent:4096});
}
