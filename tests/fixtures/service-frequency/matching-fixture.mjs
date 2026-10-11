import {addResult,commitStage,toTable} from '../../../scripts/service-routes.mjs';
export const now=Date.parse('2026-10-10T00:00:00Z');
export const points=[[139.7,35.68],[139.71,35.68],[139.72,35.68],[139.73,35.68]];
export function table(){
 const t={routes:new Map(),ways:new Map()};
 addResult(t,toTable({elements:[{type:'relation',id:10,tags:{route:'subway',ref:'G',name:'銀座線',colour:'#f39700',network:'東京メトロ'},members:[1,2,3].map(ref=>({type:'way',ref,role:''}))},...points.slice(1).map((b,i)=>({type:'way',id:i+1,geometry:[points[i],b].map(([lon,lat])=>({lon,lat}))}))]}),'japan');commitStage(t,'japan');return t;
}
export function feed(){return {schema:1,source:{id:'jp-metro',name:'Metro timetable',sha256:'a'.repeat(64),checked:'2026-10-10',retrieved:'2026-10-09',valid_until:now/1000+86400*30,service_date:'2026-10-12',count_anchor:'departure at the preceding served stop; no inferred pass times',terms_url:'https://example.test/terms',attribution:'Metro',license:'CC0'},profiles:{am:{start:'07:00:00',end:'09:00:00'},h08:{start:'08:00:00',end:'09:00:00'}},agencies:[{agency_id:'metro',agency_name:'東京メトロ',agency_timezone:'Asia/Tokyo'}],routes:[{route_id:'ginza',agency_id:'metro',route_short_name:'G',route_long_name:'銀座線',route_type:'1'}],segments:points.slice(1).map((b,i)=>({route_id:'ginza',agency_id:'metro',geometry:[points[i],b],expected_directions:[0,1],profiles:{am:{forward_tph:12-i*3,backward_tph:10-i*3,display_tph:10-i*3,quality:'scheduled'},h08:{forward_tph:20,backward_tph:18,display_tph:18,quality:'scheduled'}}}))};}
