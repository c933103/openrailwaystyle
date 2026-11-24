import vtPbf from 'vt-pbf';

export function flatVectorFixture({railY=900}={}) {
  return vtPbf.fromGeojsonVt({
    rail: {features: [{id:83, type:2, tags:{railway:'rail',name:'Fixture Line'},
      geometry:[[[300,railY],[3800,railY]]]}]},
    area: {features: [{type:3, tags:{kind:'water'},
      geometry:[[[850,1400],[3250,1400],[3250,3600],[850,3600],[850,1400]],
        [[1600,2000],[1600,3000],[2750,3000],[2750,2000],[1600,2000]]]}]},
    station: {features: [{id:7, type:1, tags:{name:'Fixture Station'},geometry:[[2048,2500]]}]},
  }, {version:2,extent:4096});
}
