# Railway Atlas

A worldwide railway map built with MapLibre and OpenStreetMap data, with railway
stations and infrastructure at the centre of the map.

**[Open the map](https://c933103.github.io/openrailwaystyle/)** ·
[User guide](docs/user-guide.md) · [Documentation](docs/README.md)

## Features

- Railway views for track type, maximum speed, electrification, infrastructure and loading gauge.
- Station search, prominent railway labels, and distinct construction, proposed and former lines.
- Transport interchanges, passenger destinations and planning context over subdued roads and buildings.
- Land and seabed relief, elevation contours, and flat-map or globe navigation including the poles.
- Recorded names in local languages or 12 selectable languages, with shared label settings.
- Drawing and measurement tools, GeoJSON import/export, and shareable map settings.

The site is static and needs an internet connection and WebGL. No account or API
key is required. Coverage depends on mapped data and external services; it is
not a timetable or navigation chart.

## Development

See the [development guide](docs/development.md) for local setup, published map
data, validation and GitHub Pages deployment. Start with the
[contribution guidelines](CONTRIBUTING.md) when proposing changes.

## Documentation

| I want to… | Read |
| --- | --- |
| Use the controls, drawing tools or shared links | [User guide](docs/user-guide.md) |
| Understand symbols, zoom levels and data limits | [Rendering reference](docs/rendering.md) |
| Understand language selection and regional fallback rules | [Label languages](docs/labels.md) |
| Build, test or deploy the site | [Development guide](docs/development.md) |
| Maintain snapshots or check sources and attribution | [Data maintenance](docs/data-maintenance.md) |
| Explore the original Hack4Rail project and examples | [Upstream history](docs/upstream.md) |

## Credits and licence

This is a fork of **Open Railway Styles**, initiated at Hack4Rail 2025. Its
original examples and Europe extractor remain in the repository.

Repository code is licensed under [Apache 2.0](LICENSE). Map data and third-party
assets retain their own licences; see [sources and attribution](docs/data-maintenance.md#sources-and-attribution)
and the map’s **?** help page.
