# Project origins

[Documentation index](README.md) · [Project overview](../README.md)

Railway Atlas originated as a fork of **[Open Railway Styles](https://github.com/OpenRail-Playground/openrailwaystyle)**, developed at [Hack4Rail 2025](https://hack4rail.event.sbb.ch/en/), organised by SBB, ÖBB and DB with the OpenRail Association. The inherited code and adapted basemap definitions retain the [Apache 2.0 licence](../LICENSE).

Atlas now owns its cartography and composes independent basemap, terrain, railway, station and planning layers. En Liberté supplies OpenMapTiles-compatible geometry, OpenRailwayMap supplies railway detail, and Atlas's published snapshots and browser adapters fill specific data gaps. Atlas does not operate a general-purpose worldwide tile renderer. See the [rendering architecture](rendering.md#style-and-source-architecture), [user guide](user-guide.md) and [data maintenance guide](data-maintenance.md).

The original Europe Planetiler extractor and standalone demo styles have been removed. Their useful platform references, boarding-edge labels, signals and entrances are integrated into Infrastructure view using worldwide sources; the old bus-route display is not retained. The original demos remain available [upstream](https://github.com/OpenRail-Playground/openrailwaystyle). Historical project descriptions refer to that project, rather than Atlas's current capabilities.
