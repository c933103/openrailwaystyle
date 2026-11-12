import {DEM_URL} from '../../../styles/map-model.mjs';

export function terrainSources() {
  return {
    bathymetry: {type:'raster', tiles:['atlas-depth://{z}/{x}/{y}'], tileSize:512, maxzoom:14},
    contours: {type:'vector', tiles:['atlas-contour://{z}/{x}/{y}'], minzoom:7, maxzoom:15},
    // Depth data ends at z10. The close source is enlarged beyond z11
    // rather than regenerating contours from nonexistent deeper tiles.
    seabedContours: {type:'vector', tiles:['atlas-contour://{z}/{x}/{y}'], minzoom:5, maxzoom:10},
    seabedContoursClose: {type:'vector', tiles:['atlas-contour://{z}/{x}/{y}'], minzoom:11, maxzoom:11},
    terrain3d: {type:'raster-dem', tiles:['atlas-terrain://{z}/{x}/{y}'], tileSize:256, encoding:'terrarium', maxzoom:14,
      attribution:'<a href="terrain-credits.html">Terrain: Mapzen / AWS and data contributors</a>'},
    relief: {type:'raster-dem', tiles:[DEM_URL], tileSize:256, encoding:'terrarium', maxzoom:15,
      attribution:'<a href="terrain-credits.html">Terrain: Mapzen / AWS and data contributors</a>'},
  };
}
