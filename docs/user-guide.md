# Using Railway Atlas

[Documentation index](README.md) · [Project overview](../README.md)

## Find and inspect railways

Use station search to locate a place and choose a railway view: infrastructure (the view on a first visit), maximum speed, power, train control, gauge, loading gauge or owner. Click a railway, station or level crossing to see what is recorded for it, with a link that opens that very object (node, way or relation) on OpenStreetMap.

A station's panel lists its next rail departures from [Transitous](https://transitous.org), which combines operators' published timetables (GTFS) with their live updates (GTFS-RT) where they publish any: live rows show the expected time and the delay, others the timetabled time, and cancellations are marked. Coverage follows what operators publish; the panel says when no timetable covers a station. “Journey from here” and “Journey to here” open the Transitous journey planner with the station filled in. Only opening a station sends its position to Transitous.

Stations appear progressively as you zoom in. Construction, proposed and former lines use distinct patterns. The [rendering reference](rendering.md) explains symbols, zoom levels, units and coverage limits.

## Display settings and sharing

Station search and responsive controls. Display settings and the label language are remembered in a cookie; the address carries only the map position, and the link button (🔗, copy map link) adds the display settings so a shared link opens the same view (they are then saved and removed from the address). The satellite button copies the GPS coordinates of the map centre (latitude, longitude in decimal degrees).

The shared language selector offers local names or 12 languages. It uses recorded names and fallbacks, without automatic translation or script conversion; see [label rules](labels.md).

Under the view buttons, the background can be the drawn map, satellite imagery alone, or hybrid: the imagery under the railways (and stations) of the chosen view, without the map's roads and labels. The imagery is EOxCloudless (Sentinel-2, 10 m per pixel): stations, yards and track corridors show, not single tracks.

The gear button opens the settings, in place of the map controls (‹ returns): in three groups (railways, surroundings, map), they control the boxed track counts of the Infrastructure view, transport facilities, destinations, planning constraints, relief, metric or imperial units, and the readout under the scale bar: the coordinates under the cursor (the map's centre on a touch screen) and the zoom. With the map focused, the arrow keys pan smoothly while held (a short press moves one step); Shift with an arrow turns or tilts the map. On small screens the controls start folded away; the panel's title and its fold button stay in view when the panel scrolls. Under the legend, “How to read this view” explains the current view's colours.

## Install as an app

The atlas can be installed on a phone, tablet or computer from the browser (for example “Install app” or “Add to Home screen”); it then opens in its own window. The app's own files are kept for opening without a connection, but the map data needs one.

## Navigate and change detail

The compass resets north. The location button shows your position (the browser asks first; the position stays in the browser) and follows it as it moves, with the direction of travel where the device reports one; moving the map stops following, and pressing the button again resumes it. The “more detail” button cycles through 100%, 50% and 25%: the next zoom level is drawn at half size, then two levels further in at a quarter size, so the same area shows more tiles and features. Its tooltip reports the scale.

The map reopens where it was left, on the globe or flat map as last used. The globe/map button (🌍/🗺️) switches projection. Dragging the globe keeps its direction and the compass heading: sideways along the parallel, up and down along the meridian. Beyond 85° (the polar caps) it turns as a ball and carries on over the pole, after which the map is the other way up. The planet keeps its size as the view moves.

The map switches to the globe automatically below zoom 4, and back to the flat map from zoom 4 unless most of the view is beyond 60° N or S. This can be turned off in the settings. Polar coverage and its resolution are described in the [data maintenance guide](data-maintenance.md#polar-caps).

## Draw and measure

Draw points, lines, smooth curves and areas with a chosen colour, line style and
width. Drawings include length and area measurements, are kept in the browser,
and can be saved or opened as GeoJSON.

A line can mix straight sections and curves. With **Curved** on, newly added points
form a smooth curve; with it off, they form corners. A curve leaves and joins a
straight section along it, without a corner. The measure tool supports
multi-segment distances, with the height difference and gradient (% and ‰)
between the first and last points, and curve radius, using a least-squares
circle through three or more points clicked along a curve.

With the drawing tools closed, click a drawn line for its elevation profile:
heights about every 10 m along it, with lowest and highest points, ascent,
descent and the steepest stretch; hovering the chart marks the place on the map.
Heights come from the terrain tiles (ground or seabed, not track level on
bridges or in tunnels). The tiles' known faults (isolated pixels far below the
ground around them, and a band along 120° E in the Taiwan Strait) are repaired
from the surrounding ground before they are shaded, contoured or measured.

In either tool, drag a point to move it or click to select it. In the drawing
tools, the small dot in the middle of each segment adds a point there (click it,
or drag it to where the point should go). A selected point
can be deleted after confirmation or switched between corner and curve point.
Selecting an endpoint of a finished line lets you extend the line.

## Understand the limits

Mapped speed limits are infrastructure information, not train operating speeds, temporary restrictions or timetables. Nearby facilities are straight-line context, not verified walking connections. Planning areas are mapped context, not legal boundary determinations or permission to build. Worldwide coverage does not guarantee that every feature is mapped.

Community-hosted external services can be unavailable or change schema. The application shows loading failures rather than replacing missing speeds with guessed values. Station search uses the cross-origin-enabled `https://api.openrailwaymap.org/v2/facility` endpoint; railway vectors continue to use `openrailwaymap.app`. Search requests are submitted only on demand and have cancellation and timeout handling. No personal location is requested automatically.

For sources and credits, use the map’s **?** help page or the [data and attribution reference](data-maintenance.md#sources-and-attribution).
