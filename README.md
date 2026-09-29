# Open Railway Atlas — worldwide GitHub Pages map

A worldwide, station-first railway map built with MapLibre and published at
**https://c933103.github.io/openrailwaystyle/**. It is a fork of
[Open Railway Styles](docs/upstream.md); the original Hack4Rail example styles and
Europe extractor remain in the repository but are not used by the site.

## Highlights

- Worldwide railway vectors from OpenRailwayMap, with spaced, collision-aware station symbols.
- Maximum-speed, track-type, electrification and infrastructure views; bridges, tunnels, track counts.
- Construction, proposed and former railways from a published OSM lifecycle snapshot.
- One label-language selector (local names or 12 languages), station search, drawing and measuring tools, flat map and globe including the polar caps.
- Static site: no server, account, API key or paid hosting.

See [docs/features.md](docs/features.md) for the full list.

## Quick start

```sh
npm install --ignore-scripts
npm run build
npm test
```

Serving the site needs the published railway snapshot; see [docs/development.md](docs/development.md).

## Documentation

| Topic | File |
| --- | --- |
| Full feature list | [docs/features.md](docs/features.md) |
| Local setup, style build, tests | [docs/development.md](docs/development.md) |
| GitHub Pages deployment | [docs/deployment.md](docs/deployment.md) |
| Data sources, attribution, external services | [docs/data-sources.md](docs/data-sources.md) |
| Speed and station data | [docs/railway-data.md](docs/railway-data.md) |
| Lifecycle snapshot pipeline | [docs/lifecycle-snapshot.md](docs/lifecycle-snapshot.md) |
| Basemap, terrain, contours | [docs/basemap-terrain.md](docs/basemap-terrain.md) |
| Label languages and fallbacks | [docs/languages.md](docs/languages.md) |
| Transport, destinations, planning context | [docs/context-layers.md](docs/context-layers.md) |
| Street-running tracks | [docs/street-running.md](docs/street-running.md) |
| Upstream Open Railway Styles | [docs/upstream.md](docs/upstream.md) |

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0, see [LICENSE](LICENSE).
