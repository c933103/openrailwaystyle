import {pathToFileURL} from 'node:url';
const {samePlaceName: old} = await import(pathToFileURL(`${process.argv[2]}/styles/map-model.mjs`));
const {samePlaceName: current} = await import(pathToFileURL(`${process.argv[3]}/styles/map-model.mjs`));
const stems=['Central','Central Park','中央','大埔墟','東京','서울','München','Łódź','Paris','Αθήνα','Москва','قرطبة','עכו','a',''];
const names=[...stems,...stems.flatMap(n=>[`${n} Station`,`${n}駅`,`${n}站`,`${n}역`,` ${n.toUpperCase()} `,`(${n})`,`${n} / `]),...stems.flatMap(a=>stems.map(b=>`${a} ${b}`))];
let mismatches=[];let checks=0;
for(const a of names)for(const b of names){checks++;if(old(a,b)!==current(a,b))mismatches.push([a,b,old(a,b),current(a,b)]);}
console.log(JSON.stringify({checks,mismatches},null,2));
if(mismatches.length)process.exitCode=1;
