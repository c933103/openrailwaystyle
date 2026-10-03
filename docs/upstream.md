# Project origins and inherited code

[Documentation index](README.md) · [Project overview](../README.md)

Railway Atlas originated as a fork of
**[Open Railway Styles](https://github.com/OpenRail-Playground/openrailwaystyle)**.
That upstream project began at [Hack4Rail 2025](https://hack4rail.event.sbb.ch/en/),
organised by SBB, ÖBB and DB in partnership with the OpenRail Association.
Its [README](https://github.com/OpenRail-Playground/openrailwaystyle/blob/main/README.md)
records the original aims and approach. Repository code retains the
[Apache 2.0 licence](../LICENSE).

## Current project scope

Atlas is developed in this repository as a worldwide railway map. It combines
railway infrastructure and service views, prominent stations, subdued roads and
buildings, transport and planning context, land and seabed relief, multilingual
labels, globe navigation, and drawing and measurement tools.
See the [user guide](user-guide.md), [rendering reference](rendering.md) and
[data maintenance guide](data-maintenance.md) for current behaviour and sources.

The upstream description of a demonstration webpage backed by a Europe-only
Planetiler extractor does not describe Atlas's build or data pipeline. Atlas uses
OpenRailwayMap railway tiles and its own published worldwide OSM snapshots.
The upstream suggestion of adding commercial lines is historical background;
Atlas already has a Service view for mapped urban rail routes. That view's
coverage depends on published data and is not a complete worldwide timetable.

## Inherited code audit

The audit on 3 October 2026 follows the npm build, `.github/workflows/`, the
application in `styles/`, and the published `styles/` directory. A legacy
Europe-only extractor remains in the repository. The three standalone demo pages and
their styles have been removed after integrating their useful railway detail
features into Atlas's Infrastructure view.

| Inherited item | Current use | Assessment |
| --- | --- | --- |
| [`styles/default.style.json`](../styles/default.style.json) | Read by [`scripts/build-style.mjs`](../scripts/build-style.mjs); supplies the OpenMapTiles source, glyph URL and 23 land, water, boundary and place-label layers | Required build input. Its other 32 railway, station, road and airport layers, Europe railway source, sprite URL and editor metadata are discarded by the builder. Those unused definitions can be pruned while preserving the generated style. |
| [`ProcessRailway.java`](../ProcessRailway.java) and [`justfile`](../justfile) | Standalone Europe OSM download/filter/Planetiler pipeline; no current npm build, workflow or app reference | Unused by Atlas. They can be removed if the old extractor is no longer offered as a separate example. |
| The three original standalone demo pages and styles | Removed from this fork; historical examples are linked below | Platform/boarding-edge references, signals and entrances now use Atlas's own layers and worldwide sources. The old bus-route layer is not retained. |
| [`img/hack4rail-logo.jpg`](../img/hack4rail-logo.jpg) | Former history-page illustration; no application or build dependency | Unused artwork; the written origin credit does not need it. |
| [`MAINTAINERS.md`](../MAINTAINERS.md) | An empty inherited maintainer-list template | No functional dependency or maintainer information. |

Keep the upstream credit and licence when pruning unused code. The current
application page, deployment workflow and contribution guidelines have been
adapted for Atlas and remain in use. Upstream origin alone is not a reason to
delete a file.

## Original demonstrations

Historical demos remain available at the upstream project's site:

- [Infra Viewers](https://openrail-playground.github.io/openrailwaystyle/infra_viewers.html): infrastructure by type, including main lines, branches, service tracks, urban rail, disused lines, signals and entrances.
- [European Train Spotter](https://openrail-playground.github.io/openrailwaystyle/european_train_spotter.html): a network overview emphasising main, branch and high-speed lines, with station markers and labels and subdued tram/narrow-gauge lines.
- [Openstreet Trainsformer](https://openrail-playground.github.io/openrailwaystyle/openstreet_trainsformer.html): close-zoom passenger transport context, including rail, tram and bus routes/stops, platform references and platform-edge labels.

These emphases are inferred from the original styles' rendering rules; the
upstream README does not set out a detailed design brief for each team.

These are upstream examples, not descriptions of current Atlas functionality.
