# Project origins

[Documentation index](README.md) · [Project overview](../README.md)

Railway Atlas originated as a fork of **[Open Railway Styles](https://github.com/OpenRail-Playground/openrailwaystyle)**, developed at [Hack4Rail 2025](https://hack4rail.event.sbb.ch/en/), organised by SBB, ÖBB and DB with the OpenRail Association. The inherited code and adapted basemap definitions retain the [Apache 2.0 licence](../LICENSE).

Atlas now owns its cartography and composes independent basemap, terrain, railway, station and planning layers. En Liberté supplies OpenMapTiles-compatible geometry, OpenRailwayMap supplies railway detail, and Atlas's published snapshots and browser adapters fill specific data gaps. Atlas does not operate a general-purpose worldwide tile renderer. See the [rendering architecture](rendering.md#style-and-source-architecture), [user guide](user-guide.md) and [data maintenance guide](data-maintenance.md).

The upstream description of a Europe-only demonstration map and commercial lines as future work no longer describes Atlas. Its Service view already shows mapped urban rail services, with coverage determined by the published data.

## Inherited code audit

The audit on 3 October 2026 follows the build, workflows, application and published files.

| Inherited item | Current status |
| --- | --- |
| `styles/default.style.json` | Removed. Its 23 useful basemap layers now live in [`scripts/style/layers/base.mjs`](../scripts/style/layers/base.mjs); the unused definitions, Europe railway source, sprite and editor metadata are gone. |
| `ProcessRailway.java` and `justfile` | Removed. The standalone Europe Planetiler pipeline was unused by Atlas. |
| The three standalone demo pages and styles | Removed. Platform numbers, boarding-edge references and lengths, signals and entrances use Atlas's own Infrastructure layers and worldwide sources. The old bus-route display is not retained. |
| [`img/hack4rail-logo.jpg`](../img/hack4rail-logo.jpg) | Unused artwork; the written origin credit does not depend on it. |
| [`MAINTAINERS.md`](../MAINTAINERS.md) | Empty inherited template; no application or build dependency. |

The adapted application, workflows and contribution guidance remain in use. Keep the upstream credit and licence when pruning inherited code.

## Original demonstrations

Historical demos remain available upstream:

- [Infra Viewers](https://openrail-playground.github.io/openrailwaystyle/infra_viewers.html): infrastructure types, signals and entrances.
- [European Train Spotter](https://openrail-playground.github.io/openrailwaystyle/european_train_spotter.html): a network overview emphasising main, branch and high-speed lines, with stations.
- [Openstreet Trainsformer](https://openrail-playground.github.io/openrailwaystyle/openstreet_trainsformer.html): close passenger transport detail, including rail, tram and bus routes/stops, platform references and edge labels.

These emphases are inferred from the original rendering rules. They describe the upstream examples, not Atlas's current functionality.
