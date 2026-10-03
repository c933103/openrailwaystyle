// Atlas-owned cartographic definitions. Layer order is declared by compose-style.mjs.

export const reliefLayers = [
  {
    "id": "terrain-relief",
    "type": "hillshade",
    "source": "relief",
    "paint": {
      "hillshade-exaggeration": 0.3,
      "hillshade-shadow-color": "#667365",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#738978",
      "hillshade-illumination-anchor": "map",
      "hillshade-illumination-direction": 315
    }
  }
];

export const contourLayers = [
  {
    "type": "line",
    "source": "contours",
    "source-layer": "contours",
    "minzoom": 7,
    "filter": [
      "all",
      [
        "!=",
        [
          "get",
          "ele"
        ],
        0
      ],
      [
        "any",
        [
          "<",
          [
            "zoom"
          ],
          9
        ],
        [
          ">",
          [
            "get",
            "ele"
          ],
          0
        ]
      ]
    ],
    "layout": {
      "line-join": "round"
    },
    "id": "terrain-contours",
    "paint": {
      "line-color": [
        "case",
        [
          "<",
          [
            "get",
            "ele"
          ],
          0
        ],
        "#467d9a",
        "#927b5a"
      ],
      "line-width": [
        "case",
        [
          ">",
          [
            "get",
            "level"
          ],
          0
        ],
        0.8,
        0.4
      ],
      "line-opacity": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        7,
        0.45,
        12,
        0.65
      ]
    }
  },
  {
    "type": "line",
    "source": "seabedContours",
    "source-layer": "contours",
    "minzoom": 5,
    "filter": [
      "all",
      [
        "<",
        [
          "get",
          "ele"
        ],
        0
      ],
      [
        "any",
        [
          ">=",
          [
            "zoom"
          ],
          9
        ],
        [
          ">",
          [
            "get",
            "ele"
          ],
          -200
        ]
      ]
    ],
    "layout": {
      "line-join": "round"
    },
    "id": "terrain-seabed-contours",
    "maxzoom": 11,
    "paint": {
      "line-color": [
        "case",
        [
          "<",
          [
            "get",
            "ele"
          ],
          0
        ],
        "#467d9a",
        "#927b5a"
      ],
      "line-width": [
        "case",
        [
          ">",
          [
            "get",
            "level"
          ],
          0
        ],
        0.8,
        0.4
      ],
      "line-opacity": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        5,
        0.4,
        12,
        0.65
      ]
    }
  },
  {
    "type": "line",
    "source": "seabedContoursClose",
    "source-layer": "contours",
    "minzoom": 11,
    "filter": [
      "<",
      [
        "get",
        "ele"
      ],
      0
    ],
    "layout": {
      "line-join": "round"
    },
    "id": "terrain-seabed-contours-close",
    "paint": {
      "line-color": [
        "case",
        [
          "<",
          [
            "get",
            "ele"
          ],
          0
        ],
        "#467d9a",
        "#927b5a"
      ],
      "line-width": [
        "case",
        [
          ">",
          [
            "get",
            "level"
          ],
          0
        ],
        0.8,
        0.4
      ],
      "line-opacity": [
        "interpolate",
        [
          "linear"
        ],
        [
          "zoom"
        ],
        5,
        0.4,
        12,
        0.65
      ]
    }
  }
];

export const contourLabels = [
  {
    "id": "terrain-contour-labels",
    "type": "symbol",
    "source": "contours",
    "source-layer": "contours",
    "minzoom": 8,
    "filter": [
      "all",
      [
        ">",
        [
          "get",
          "level"
        ],
        0
      ],
      [
        "!=",
        [
          "get",
          "ele"
        ],
        0
      ],
      [
        "any",
        [
          "<",
          [
            "zoom"
          ],
          9
        ],
        [
          ">",
          [
            "get",
            "ele"
          ],
          0
        ]
      ]
    ],
    "layout": {
      "symbol-placement": "line",
      "symbol-spacing": 250,
      "text-field": [
        "concat",
        [
          "to-string",
          [
            "get",
            "ele"
          ]
        ],
        " m"
      ],
      "text-font": [
        "Noto Sans Regular"
      ],
      "text-size": 10,
      "text-padding": 10
    },
    "paint": {
      "text-color": [
        "case",
        [
          "<",
          [
            "get",
            "ele"
          ],
          0
        ],
        "#467d9a",
        "#927b5a"
      ],
      "text-halo-color": "#f2f1e9",
      "text-halo-width": 1
    }
  },
  {
    "id": "terrain-seabed-contour-labels",
    "type": "symbol",
    "source": "seabedContours",
    "source-layer": "contours",
    "minzoom": 6,
    "maxzoom": 11,
    "filter": [
      "all",
      [
        ">",
        [
          "get",
          "level"
        ],
        0
      ],
      [
        "<",
        [
          "get",
          "ele"
        ],
        0
      ],
      [
        "any",
        [
          ">=",
          [
            "zoom"
          ],
          9
        ],
        [
          ">",
          [
            "get",
            "ele"
          ],
          -200
        ]
      ]
    ],
    "layout": {
      "symbol-placement": "line",
      "symbol-spacing": 250,
      "text-field": [
        "concat",
        [
          "to-string",
          [
            "get",
            "ele"
          ]
        ],
        " m"
      ],
      "text-font": [
        "Noto Sans Regular"
      ],
      "text-size": 10,
      "text-padding": 10
    },
    "paint": {
      "text-color": [
        "case",
        [
          "<",
          [
            "get",
            "ele"
          ],
          0
        ],
        "#467d9a",
        "#927b5a"
      ],
      "text-halo-color": "#f2f1e9",
      "text-halo-width": 1
    }
  },
  {
    "id": "terrain-seabed-contour-labels-close",
    "type": "symbol",
    "source": "seabedContoursClose",
    "source-layer": "contours",
    "minzoom": 11,
    "filter": [
      "all",
      [
        ">",
        [
          "get",
          "level"
        ],
        0
      ],
      [
        "<",
        [
          "get",
          "ele"
        ],
        0
      ]
    ],
    "layout": {
      "symbol-placement": "line",
      "symbol-spacing": 250,
      "text-field": [
        "concat",
        [
          "to-string",
          [
            "get",
            "ele"
          ]
        ],
        " m"
      ],
      "text-font": [
        "Noto Sans Regular"
      ],
      "text-size": 10,
      "text-padding": 10
    },
    "paint": {
      "text-color": [
        "case",
        [
          "<",
          [
            "get",
            "ele"
          ],
          0
        ],
        "#467d9a",
        "#927b5a"
      ],
      "text-halo-color": "#f2f1e9",
      "text-halo-width": 1
    }
  }
];
