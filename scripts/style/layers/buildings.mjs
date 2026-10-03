// Atlas-owned cartographic definitions. Layer order is declared by compose-style.mjs.

export const buildingLayers = [
  {
    "id": "building-footprints",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "building",
    "minzoom": 13,
    "paint": {
      "fill-color": "#a8aca4",
      "fill-opacity": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        13,
        0.12,
        15,
        0.24,
        17,
        0.34
      ]
    }
  },
  {
    "id": "building-outlines",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "building",
    "minzoom": 15,
    "paint": {
      "line-color": "#879187",
      "line-width": 0.55,
      "line-opacity": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        15,
        0.05,
        18,
        0.22
      ]
    }
  }
];
