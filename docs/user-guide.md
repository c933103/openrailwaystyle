# Using Open Railway Atlas

[Documentation index](README.md) · [Project overview](../README.md)

## Find and inspect railways

Use station search to locate a place and choose a railway view: track type, maximum speed, electrification, infrastructure or loading gauge. Click a railway to see its recorded speed, voltage, frequency, gauge and operator.

Stations appear progressively as you zoom in. Construction, proposed and former lines use distinct patterns. The [rendering reference](rendering.md) explains symbols, zoom levels, units and coverage limits.

## Display settings and sharing

Station search and responsive controls. Display settings and the label language are remembered in a cookie; the address carries only the map position, and “Copy map link” adds the display settings so a shared link opens the same view (they are then saved and removed from the address).

The shared language selector offers local names or 12 languages. It uses recorded names and fallbacks, without automatic translation or script conversion; see [label rules](labels.md).

Display options also control transport facilities, destinations, planning constraints, relief and metric or imperial units. On small screens the controls start folded away.

## Navigate and change detail

The compass resets north. The “more detail” button cycles through 100%, 50% and 25%: the next zoom level is drawn at half size, then two levels further in at a quarter size, so the same area shows more tiles and features. Its tooltip reports the scale.

The map reopens where it was left, on the globe or flat map as last used. The globe/map button (🌍/🗺️) switches projection. The globe can be dragged and zoomed over the poles while keeping the planet’s size as the view moves.

The map switches to the globe automatically below zoom 4, and back to the flat map from zoom 4 unless most of the view is beyond 60° N or S. This can be turned off in Display options. Polar coverage and its resolution are described in the [data maintenance guide](data-maintenance.md#polar-caps).

## Draw and measure

Draw points, lines, smooth curves and areas with a chosen colour, line style and
width. Drawings include length and area measurements, are kept in the browser,
and can be saved or opened as GeoJSON.

A line can mix straight sections and curves. With **Curved** on, newly added points
form a smooth curve; with it off, they form corners. The measure tool supports
multi-segment distances and curve radius, using a least-squares circle through
three or more points clicked along a curve.

In either tool, drag a point to move it or click to select it. A selected point
can be deleted after confirmation or switched between corner and curve point.
Selecting an endpoint of a finished line lets you extend the line.

## Understand the limits

Mapped speed limits are infrastructure information, not train operating speeds, temporary restrictions or timetables. Nearby facilities are straight-line context, not verified walking connections. Planning areas are mapped context, not legal boundary determinations or permission to build. Worldwide coverage does not guarantee that every feature is mapped.

Community-hosted external services can be unavailable or change schema. The application shows loading failures rather than replacing missing speeds with guessed values. Station search uses the cross-origin-enabled `https://api.openrailwaymap.org/v2/facility` endpoint; railway vectors continue to use `openrailwaymap.app`. Search requests are submitted only on demand and have cancellation and timeout handling. No personal location is requested automatically.

For sources and credits, use the map’s **About & data** panel or the [data and attribution reference](data-maintenance.md#sources-and-attribution).
