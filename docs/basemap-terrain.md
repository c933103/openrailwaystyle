# Basemap, terrain and contours

## Stations and boundaries

Station symbols use orange markers and bold names with halos, while retaining collision spacing.

### Boundaries

First-level regional boundaries use OSM admin levels 3/4 where supplied by the basemap; subdivision conventions and coverage differ by country.

## Terrain and relief

Land and seabed shading comes from [Mapzen Terrain Tiles hosted by AWS](https://registry.opendata.aws/terrain-tiles/), including NOAA ETOPO1 bathymetry. See `styles/terrain-credits.html` for source credits.

## Contours

Contours are calculated in the browser using the pinned maplibre-contour library, reusing the DEM cache with hillshade. Brown lines show land elevation and blue lines show negative seabed elevation, labelled in signed metres. Fine / index intervals are 200 / 1,000 m at zoom 7, 100 / 500 m at 9, 50 / 250 m at 11, 20 / 100 m at 13, and 10 / 50 m at 15.

### Limits

Ocean bathymetry is generally much coarser than land elevation; extra zoom does not create survey detail.

### Polar caps

Beyond 85.05° N and S, where the terrain tiles end, the globe's relief and contours come from NOAA ETOPO 2022 at 60 arc-seconds (about 1.85 km), prepared in advance rather than in the browser. This is not a navigation chart.
