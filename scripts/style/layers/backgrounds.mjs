// Atlas-owned cartographic definitions. Layer order is declared by compose-style.mjs.

export const backgroundLayers = [
  {
    "id": "carto",
    "type": "raster",
    "source": "carto",
    "layout": {
      "visibility": "none"
    },
    "paint": {
      "raster-fade-duration": 150
    }
  },
  {
    "id": "satellite",
    "type": "raster",
    "source": "satellite",
    "layout": {
      "visibility": "none"
    },
    "paint": {
      "raster-fade-duration": 150
    }
  }
];
