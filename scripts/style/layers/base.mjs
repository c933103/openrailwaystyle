// Atlas-owned cartographic definitions. Layer order is declared by compose-style.mjs.

export const baseFills = [
  {
    "id": "background",
    "type": "background",
    "paint": {
      "background-color": "#f2f1e9"
    }
  },
  {
    "id": "landuse-residential",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "landuse",
    "minzoom": 9,
    "filter": [
      "all",
      [
        "==",
        "$type",
        "Polygon"
      ],
      [
        "in",
        "class",
        "residential",
        "suburb",
        "neighbourhood"
      ]
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "fill-color": "hsl(47, 13%, 86%)",
      "fill-opacity": 0.7
    }
  },
  {
    "id": "landcover_grass",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "landcover",
    "filter": [
      "==",
      "class",
      "grass"
    ],
    "paint": {
      "fill-color": "hsl(82, 46%, 72%)",
      "fill-opacity": {
        "stops": [
          [
            5,
            0
          ],
          [
            22,
            1
          ]
        ]
      }
    }
  },
  {
    "id": "landcover_wood",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "landcover",
    "filter": [
      "==",
      "class",
      "wood"
    ],
    "paint": {
      "fill-color": "hsl(82, 46%, 72%)",
      "fill-opacity": {
        "base": 1,
        "stops": [
          [
            5,
            0
          ],
          [
            22,
            1
          ]
        ]
      }
    }
  },
  {
    "id": "water",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "water",
    "filter": [
      "all",
      [
        "==",
        "$type",
        "Polygon"
      ],
      [
        "!=",
        "intermittent",
        1
      ],
      [
        "!=",
        "brunnel",
        "tunnel"
      ]
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "fill-color": "#bfd8e0"
    }
  },
  {
    "id": "water_intermittent",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "water",
    "filter": [
      "all",
      [
        "==",
        "$type",
        "Polygon"
      ],
      [
        "==",
        "intermittent",
        1
      ]
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "fill-color": "hsl(205, 56%, 73%)",
      "fill-opacity": 0.7
    }
  },
  {
    "id": "landcover-ice-shelf",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "landcover",
    "filter": [
      "==",
      "subclass",
      "ice_shelf"
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "fill-color": "hsl(47, 26%, 88%)",
      "fill-opacity": 0.8
    }
  },
  {
    "id": "landcover_sand",
    "type": "fill",
    "metadata": {},
    "source": "openmaptiles",
    "source-layer": "landcover",
    "filter": [
      "all",
      [
        "in",
        "class",
        "sand"
      ]
    ],
    "paint": {
      "fill-antialias": false,
      "fill-color": "#e7dfc7",
      "fill-opacity": 0.3
    }
  },
  {
    "id": "landuse",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "landuse",
    "filter": [
      "==",
      "class",
      "agriculture"
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "fill-color": "#eae0d0"
    }
  },
  {
    "id": "landuse_overlay_national_park",
    "type": "fill",
    "source": "openmaptiles",
    "source-layer": "landcover",
    "filter": [
      "==",
      "class",
      "national_park"
    ],
    "paint": {
      "fill-color": "#E1EBB0",
      "fill-opacity": {
        "base": 1,
        "stops": [
          [
            5,
            0
          ],
          [
            9,
            0.75
          ]
        ]
      }
    }
  }
];

export const baseLines = [
  {
    "id": "waterway-tunnel",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "waterway",
    "filter": [
      "all",
      [
        "==",
        "$type",
        "LineString"
      ],
      [
        "==",
        "brunnel",
        "tunnel"
      ]
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "line-color": "hsl(205, 56%, 73%)",
      "line-dasharray": [
        3,
        3
      ],
      "line-gap-width": {
        "stops": [
          [
            12,
            0
          ],
          [
            20,
            6
          ]
        ]
      },
      "line-opacity": 1,
      "line-width": {
        "base": 1.4,
        "stops": [
          [
            8,
            1
          ],
          [
            20,
            2
          ]
        ]
      }
    }
  },
  {
    "id": "waterway",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "waterway",
    "minzoom": 5,
    "filter": [
      "all",
      [
        "==",
        "$type",
        "LineString"
      ],
      [
        "!in",
        "brunnel",
        "tunnel",
        "bridge"
      ],
      [
        "!=",
        "intermittent",
        1
      ]
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "line-color": "rgba(168, 190, 207, 0.54)",
      "line-opacity": 1,
      "line-width": {
        "base": 1.4,
        "stops": [
          [
            8,
            1
          ],
          [
            20,
            8
          ]
        ]
      }
    }
  },
  {
    "id": "waterway_intermittent",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "waterway",
    "filter": [
      "all",
      [
        "==",
        "$type",
        "LineString"
      ],
      [
        "!in",
        "brunnel",
        "tunnel",
        "bridge"
      ],
      [
        "==",
        "intermittent",
        1
      ]
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "line-color": "hsl(205, 56%, 73%)",
      "line-dasharray": [
        2,
        1
      ],
      "line-opacity": 1,
      "line-width": {
        "base": 1.4,
        "stops": [
          [
            8,
            1
          ],
          [
            20,
            8
          ]
        ]
      }
    }
  },
  {
    "id": "waterway-bridge-case",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "waterway",
    "filter": [
      "all",
      [
        "==",
        "$type",
        "LineString"
      ],
      [
        "==",
        "brunnel",
        "bridge"
      ]
    ],
    "layout": {
      "line-cap": "butt",
      "line-join": "miter"
    },
    "paint": {
      "line-color": "#bbbbbb",
      "line-gap-width": {
        "base": 1.55,
        "stops": [
          [
            4,
            0.25
          ],
          [
            20,
            30
          ]
        ]
      },
      "line-width": {
        "base": 1.6,
        "stops": [
          [
            12,
            0.5
          ],
          [
            20,
            10
          ]
        ]
      }
    }
  },
  {
    "id": "waterway-bridge",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "waterway",
    "filter": [
      "all",
      [
        "==",
        "$type",
        "LineString"
      ],
      [
        "==",
        "brunnel",
        "bridge"
      ]
    ],
    "layout": {
      "line-cap": "round",
      "line-join": "round"
    },
    "paint": {
      "line-color": "hsl(205, 56%, 73%)",
      "line-width": {
        "base": 1.55,
        "stops": [
          [
            4,
            0.25
          ],
          [
            20,
            30
          ]
        ]
      }
    }
  },
  {
    "id": "admin_sub",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "boundary",
    "minzoom": 0,
    "maxzoom": 2,
    "filter": [
      "in",
      "admin_level",
      6,
      8
    ],
    "layout": {
      "visibility": "visible"
    },
    "paint": {
      "line-color": "#96928c",
      "line-width": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        5,
        0.35,
        10,
        0.65
      ],
      "line-opacity": 0.45,
      "line-dasharray": [
        3,
        3
      ]
    }
  },
  {
    "id": "admin_country_z0-4",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "boundary",
    "minzoom": 0,
    "maxzoom": 5,
    "filter": [
      "all",
      [
        "<=",
        "admin_level",
        2
      ],
      [
        "==",
        "$type",
        "LineString"
      ],
      [
        "!has",
        "claimed_by"
      ]
    ],
    "layout": {
      "line-cap": "round",
      "line-join": "round",
      "visibility": "visible"
    },
    "paint": {
      "line-color": "#6b6570",
      "line-width": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        0,
        0.6,
        4,
        1.2,
        7,
        1.8,
        12,
        2.3
      ]
    }
  },
  {
    "id": "admin_country_z5-",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "boundary",
    "minzoom": 5,
    "filter": [
      "all",
      [
        "<=",
        "admin_level",
        2
      ],
      [
        "==",
        "$type",
        "LineString"
      ]
    ],
    "layout": {
      "line-cap": "round",
      "line-join": "round",
      "visibility": "visible"
    },
    "paint": {
      "line-color": "#6b6570",
      "line-width": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        0,
        0.6,
        4,
        1.2,
        7,
        1.8,
        12,
        2.3
      ]
    }
  },
  {
    "id": "woods-ouline",
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "landcover",
    "filter": [
      "all",
      [
        "==",
        "class",
        "wood"
      ]
    ],
    "paint": {
      "line-color": "hsl(82, 46%, 72%)",
      "line-blur": 25,
      "line-width": 5
    }
  },
  {
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "boundary",
    "minzoom": 3,
    "filter": [
      "in",
      "admin_level",
      3,
      4
    ],
    "layout": {
      "line-join": "round"
    },
    "id": "regional-border-casing",
    "paint": {
      "line-color": "#fffef7",
      "line-opacity": 0.8,
      "line-width": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        3,
        1.3,
        7,
        2.5,
        12,
        3.4
      ]
    }
  },
  {
    "type": "line",
    "source": "openmaptiles",
    "source-layer": "boundary",
    "minzoom": 3,
    "filter": [
      "in",
      "admin_level",
      3,
      4
    ],
    "layout": {
      "line-join": "round"
    },
    "id": "regional-borders",
    "paint": {
      "line-color": "#81747e",
      "line-opacity": 0.9,
      "line-width": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        3,
        0.7,
        7,
        1.25,
        12,
        1.8
      ],
      "line-dasharray": [
        5,
        2
      ]
    }
  }
];

export const placeLayers = [
  {
    "id": "place_label_city",
    "type": "symbol",
    "source": "openmaptiles",
    "source-layer": "place",
    "minzoom": 5,
    "maxzoom": 16,
    "filter": [
      "all",
      [
        "==",
        "$type",
        "Point"
      ],
      [
        "==",
        "class",
        "city"
      ]
    ],
    "layout": {
      "text-field": "{name:latin}\n{name:nonlatin}",
      "text-font": [
        "Noto Sans Regular"
      ],
      "text-max-width": 10,
      "text-size": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        5,
        10,
        14,
        12
      ]
    },
    "paint": {
      "text-color": "#74807d",
      "text-halo-blur": 0,
      "text-halo-color": "hsla(0, 0%, 100%, 0.75)",
      "text-halo-width": 1
    }
  },
  {
    "id": "place_label_other",
    "type": "symbol",
    "source": "openmaptiles",
    "source-layer": "place",
    "minzoom": 8,
    "filter": [
      "all",
      [
        "==",
        "$type",
        "Point"
      ],
      [
        "!in",
        "class",
        "city",
        "state",
        "province",
        "country",
        "continent"
      ]
    ],
    "layout": {
      "text-anchor": "center",
      "text-field": "{name:latin}\n{name:nonlatin}",
      "text-font": [
        "Noto Sans Regular"
      ],
      "text-max-width": 6,
      "text-size": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        5,
        10,
        14,
        12
      ],
      "visibility": "visible",
      "icon-rotation-alignment": "auto"
    },
    "paint": {
      "text-color": "#74807d",
      "text-halo-blur": 0,
      "text-halo-color": "hsl(0, 0%, 100%)",
      "text-halo-width": {
        "stops": [
          [
            6,
            0.5
          ],
          [
            10,
            1
          ]
        ]
      }
    }
  },
  {
    "id": "state_label",
    "type": "symbol",
    "source": "openmaptiles",
    "source-layer": "place",
    "minzoom": 4,
    "maxzoom": 10,
    "filter": [
      "all",
      [
        "==",
        [
          "geometry-type"
        ],
        "Point"
      ],
      [
        "match",
        [
          "get",
          "class"
        ],
        [
          "state",
          "province"
        ],
        true,
        false
      ]
    ],
    "layout": {
      "text-field": "{name:latin}",
      "text-font": [
        "Noto Sans Regular"
      ],
      "text-size": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        4,
        9,
        8,
        12
      ],
      "text-transform": "uppercase",
      "text-letter-spacing": 0.08,
      "text-max-width": 8,
      "text-padding": 4
    },
    "paint": {
      "text-color": "#86938f",
      "text-halo-color": "rgba(255,255,255,0.8)",
      "text-halo-width": 1.5,
      "text-opacity": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        9,
        1,
        10,
        0
      ]
    }
  }
];

export const countryLayers = [
  {
    "id": "country_label",
    "type": "symbol",
    "source": "openmaptiles",
    "source-layer": "place",
    "maxzoom": 8,
    "filter": [
      "all",
      [
        "==",
        "$type",
        "Point"
      ],
      [
        "==",
        "class",
        "country"
 
    ],
    "layout": {
      "text-field": "{name:en}",
      "text-padding": 10,
      "text-font": [
        "Noto Sans Regular"
      ],
      "text-max-width": 8,
      "text-size": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        2,
        10,
        6,
        15
      ],
      "visibility": "visible",
      "text-transform": "uppercase",
      "text-letter-spacing": 0.12
    },
    "paint": {
      "text-color": "#5c6c68",
      "text-halo-blur": 0,
      "text-halo-color": {
        "stops": [
          [
            6,
            "rgba(255,255,255,0.75)"
          ],
          [
            10,
            "rgba(255,255,255,0.75)"
          ]
        ]
      },
      "text-halo-width": 2,
      "text-opacity": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        7,
        1,
        8,
        0
      ]
    },
    "minzoom": 1
  }
];
