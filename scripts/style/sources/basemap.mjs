import {CARTO_TILES} from '../../../styles/map-model.mjs';

// The OpenMapTiles-compatible data provider is independent of Atlas's style.
export const GLYPHS = 'https://tuiles.enliberte.fr/fonts/{fontstack}/{range}.pbf';

export function basemapSources() {
  return {
    openmaptiles: {
      type: 'vector',
      url: 'pmtiles://https://tuiles.enliberte.fr/planet.pmtiles',
      attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · <a href="https://tuiles.enliberte.fr/">En Liberté tiles</a>',
    },
    // Keep the imagery's native resolution and attribution when overzooming.
    satellite: {type:'raster', tiles:['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'], tileSize:256, maxzoom:14,
      attribution:'<a href="https://cloudless.eox.at">EOxCloudless https://cloudless.eox.at</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025), <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>'},
    carto: {type:'raster', tiles:[CARTO_TILES], tileSize:256, maxzoom:19,
      attribution:'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>'},
  };
}
