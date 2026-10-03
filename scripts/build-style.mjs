import {readFile, writeFile} from 'node:fs/promises';
import {validateStationCountries, majorStationsGeoJSON, selectMajorStations, curatedStationFilter} from './major-stations.mjs';
import {composeStyle} from './style/compose-style.mjs';

const majorStations = JSON.parse(await readFile(new URL('../styles/data-src/major-stations.json', import.meta.url)));
validateStationCountries(majorStations);
const majorStationData = majorStationsGeoJSON(majorStations);
const curatedFilter = curatedStationFilter(selectMajorStations(majorStations).filter(entry => entry.tier <= 6));
const style = composeStyle({majorStationData, curatedFilter});
await writeFile(new URL('../styles/major-stations.geojson', import.meta.url), JSON.stringify(majorStationData) + '\n');
await writeFile(new URL('../styles/world.style.json', import.meta.url), JSON.stringify(style, null, 2) + '\n');
console.log(`Built world.style.json: ${style.layers.length} layers`);
