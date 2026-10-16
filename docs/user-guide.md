# Using Railway Atlas

[Documentation index](README.md) · [Project overview](../README.md)

## Find and inspect railways

Use station search to locate a place and choose a railway view: infrastructure (the view on a first visit), maximum speed, power, train control, gauge, loading gauge, owner, or service (metro, light rail, tram, monorail and commuter rail lines drawn along the tracks they use, each in its own colour and named; long-distance trains are not shown). Click a railway, station or level crossing to see what is recorded for it, with a link that opens that very object (node, way or relation) on OpenStreetMap.

A station's panel lists its next rail departures from [Transitous](https://transitous.org), which combines operators' published timetables (GTFS) with their live updates (GTFS-RT) where they publish any: live rows show the expected time and the delay, others the timetabled time, and cancellations are marked. Coverage follows what operators publish. If no rail timetable stop matches within 400 metres, the panel reports that no nearby stop was matched; this does not establish that the station has no published timetable. A malformed or failed stop lookup is reported as a loading failure. “Journey from here” and “Journey to here” open the Transitous journey planner with the station filled in. Only opening a station sends its position to Transitous.

Nearby timetable stops and duplicate station-search results use the short longitude
distance across the ±180° meridian. Stops on opposite sides of that meridian
can therefore belong to the same nearby station. The existing distance limits,
name matching and two-board request limit still apply; this does not expand
provider coverage.

Repeated observations within one timetable board are combined only when their
trip and route identifiers, service names, mode family, destination and scheduled
time agree. Distinguishable simultaneous services remain separate. A combined
row retains any cancellation and uses a live prediction when available. When
live predictions disagree and no update timestamp is available, the later
predicted departure is displayed consistently; this does not establish which
update is newest. An explicit live platform is retained when another update
supplies only a departure time; scheduled platforms remain a fallback. If live
platforms conflict, the platform attached to the later predicted departure is
used, with a consistent choice for equal times. This also cannot establish which
platform update is newest. Matches between different boards require the same
finite scheduled instant, including seconds; equivalent time-zone representations
are compared as instants. Different or invalid scheduled times remain separate,
even within one displayed minute. When a schedule is absent, the existing actual-time
fallback is used. Precision disagreements are not guessed away; they can leave
duplicate-looking rows until stronger shared identity evidence is available.
The existing same-minute candidate checks remain in place so this stricter time
condition cannot choose between previously ambiguous trains. Ambiguous matches
between different boards remain separate. Different numeric destination components
(for example, Terminal 1 and Terminal 10, or Central and Central 2) also prevent
the entire candidate group from merging. Bilingual names may repeat the same
numeric component. Numbers attached to additional service descriptions are not
guessed away, so this conservative check can retain duplicate-looking rows.
Complete destination text must also agree: Central and Central Park, York and
New York, and 中央 and 中央公園 remain separate. Different scripts alone are
not evidence of a translation: Central (北), Central北 and (North) 中央 retain
their qualifiers. The known 桜木町 / Sakuragichō and Terminal N / 第N航廈
bilingual pairs remain compatible, as do the leading service tags `(Local)`,
`(普通)` and `(普通 Local)`. Other aliases and unknown tags remain part of the
destination, so some duplicate-looking rows stay separate until stronger source
evidence is available. These checks veto the entire group without choosing a
smaller subgroup. This does not establish full cross-source train identity.

An invalid departure-board response counts as a loading failure, not an empty
timetable. This includes malformed rows or wrong-typed fields consumed by the
board. Each selected board is parsed independently; one invalid row rejects that
board rather than presenting an incomplete subset as successfully loaded. Optional
null values retain their existing fallback/filtering behavior, and unused provider
extensions and excluded travel modes do not need rail-row fields. If a selected stop’s departure board fails while another loads, usable departures
remain visible with an incomplete-load warning. The same warning appears when the
successful boards return no upcoming rail departures; this is not a complete empty
result. Reopening or redrawing a station within the existing one-minute cache keeps
that status, including when a translated label changes. Cache identity follows the
mapped object or scoped source identifier where available, with raw names as a
fallback; resolving an unnamed station still allows a new named lookup. After the cache expires, opening the board again checks the selected
stops afresh. This status describes those requests only, not worldwide timetable
coverage or the map’s separately matched frequency profiles.

Bare numeric departure labels are omitted from the line-name badge unless the
source also supplies a nonempty, nonnumeric long route name. Surrounding whitespace
and decimal digits in other scripts follow the same rule. Meaningful text and
alphanumeric service labels remain available; otherwise the badge shows the mode.
Raw labels and identifiers remain available to reconciliation, so hiding a number
does not make two differently numbered routes compatible. This display guard does
not prove that a number is an internal ID or a public route reference. The board
does not infer a separately labelled public ref from an ambiguous numeric field;
broader cross-feed identity and public-ref verification remain open in
[issue #113](https://github.com/c933103/openrailwaystyle/issues/113).

Stations appear progressively as you zoom in. Construction, proposed and former lines use distinct patterns. The [rendering reference](rendering.md) explains symbols, zoom levels, units and coverage limits.

Train control shows concurrent systems as adjacent colour bands along the track. The legend and infobox use short system names; hover for the full description, or tap/click a name to expand it. The same descriptions can be opened with the keyboard.

Power shows mapped railway electricity supplies, diesel/fuel and coal facilities, and steam-water towers, tanks and cranes. Click a supply for its recorded details. Museums and theatres remain visible as surrounding context without opening a facility infobox.

## Display settings and sharing

Station search and responsive controls. Display settings and the label language are remembered in a cookie; the address carries only the map position, and the link button (🔗, copy map link) adds the display settings so a shared link opens the same view (they are then saved and removed from the address). The satellite button copies the GPS coordinates of the map centre (latitude, longitude in decimal degrees).

The shared language selector offers local names or 12 languages. It uses recorded names and fallbacks, without automatic translation or script conversion; see [label rules](labels.md).

Under the view buttons, the background can be the drawn map, satellite imagery alone, or hybrid: the imagery under the railways (and stations) of the chosen view, without the map's roads and labels. The imagery is EOxCloudless (Sentinel-2, 10 m per pixel): stations, yards and track corridors show, not single tracks.

The gear button opens the settings, in place of the map controls (‹ returns): in three groups (railways, surroundings, map), they control the boxed track counts of the Infrastructure view, transport facilities, destinations, planning constraints, relief and the readout under the scale bar: the coordinates under the cursor (the map's centre on a touch screen) and the zoom. With the map focused, the arrow keys pan smoothly while held (a short press moves one step); Shift with an arrow turns or tilts the map. On small screens the controls start folded away; the panel's title and its fold button stay in view when the panel scrolls. Under the legend, “How to read this view” explains the current view's colours.

## Install as an app

The atlas can be installed on a phone, tablet or computer from the browser (for example “Install app” or “Add to Home screen”); it then opens in its own window. The app's own files are kept for opening without a connection, but the map data needs one.

## Navigate and change detail

The compass resets north. The location button shows your position (the browser asks first; the position stays in the browser) and follows it as it moves, with the direction of travel where the device reports one; moving the map stops following, and pressing the button again resumes it. The “more detail” button cycles through 100%, 50% and 25%: the next zoom level is drawn at half size, then two levels further in at a quarter size, so the same area shows more tiles and features. Its tooltip reports the scale.

The map reopens where it was left, on the globe or flat map as last used. The globe/map button (🌍/🗺️) switches projection. Dragging the globe keeps its direction and the compass heading: sideways along the parallel, up and down along the meridian. Beyond 85° (the polar caps) it turns as a ball and carries on over the pole, including close-up views, after which the map is the other way up. The planet keeps its size as the view moves.

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
from the surrounding ground, or from the same place at the next zoom where that
zoom has no such fault, before they are shaded, contoured or measured.

In either tool, drag a point to move it or click to select it. In the drawing
tools, the small dot in the middle of each segment adds a point there (click it,
or drag it to where the point should go). A selected point
can be deleted after confirmation or switched between corner and curve point.
Selecting an endpoint of a finished line lets you extend the line.

## Understand the limits

Mapped speed limits are infrastructure information, not train operating speeds, temporary restrictions or timetables. Nearby facilities are straight-line context, not verified walking connections. Planning areas are mapped context, not legal boundary determinations or permission to build. Worldwide coverage does not guarantee that every feature is mapped.

Community-hosted external services can be unavailable or change schema. The application shows loading failures rather than replacing missing speeds with guessed values. Station search uses the cross-origin-enabled `https://api.openrailwaymap.org/v2/facility` endpoint, which holds station nodes only, together with OpenStreetMap's Nominatim geocoder (`https://nominatim.openstreetmap.org/search`, one request per submitted search) for stations mapped as areas, such as Hong Kong's Sha Tin, and for ordinary place names, listed under the railway results. Stations already drawn on the map whose name matches part of the search (a word beginning with it, as Sha Tin Wai for “Sha tin”; anywhere in the name for Chinese, Japanese or Korean) join the railway results, nearest first; railway vectors continue to use `openrailwaymap.app`. Search requests are submitted only on demand and have cancellation and timeout handling. No personal location is requested automatically.

If either search service fails, usable results stay visible and the status identifies the unavailable service as an incomplete search. An empty partial result means only that the available sources returned no matches. If both services fail and no drawn station matches, search is unavailable. A successful no-match result is still limited to those services’ coverage and the stations already drawn on the map; it does not establish that a station or place does not exist. Repeating a search reuses successful place responses for the same query and language while cached in this page session (up to 50 query-and-language combinations). Failed place responses are not cached.

For sources and credits, use the map’s **?** help page or the [data and attribution reference](data-maintenance.md#sources-and-attribution).

Metric/imperial units are directly below Language. They apply to speed, dimensions, axle loads and platform lengths. Separately mapped boarding edges show their complete length. Platforms mapped as areas show approximate longitudinal extent with **≈**; platforms mapped as lines show complete path length. These describe complete mapped geometry and are not a guarantee of usable train length.

Infrastructure and Train control show mapped railway signals from zoom 13, with references from zoom 16. Infrastructure also shows train or subway station entrances from zoom 16. Platform numbers and boarding-edge references appear from zoom 17, with platform and complete edge lengths added from zoom 19. Click these objects for their mapped details and OpenStreetMap link. The **Value labels** setting hides their text; the platform shapes, edges and point markers remain visible. Signal markers show mapped locations, not current aspects.

The **Carto** background shows OpenStreetMap Standard beneath the railways. Railway colours, station labels and the legend follow your settings. Carto provides its own place labels; the terrain and contour toggle still applies. Carto tiles are for online viewing and are not saved for offline use.

On phones and short landscape screens, the controls start as a floating app icon. Tap it to open the menu; the collapse button or Escape returns it to the icon.

The information button at the bottom right identifies the page's build and links to its source commit. This identifies the code running in your current page, including a saved installed-app version.

See [Axle load](axle-load.md) for the new view, national class distinctions, source references and the 28-day snapshot refresh.

The Axle load button follows Service and Owner. Metric keeps mapped tonnes or kilograms; Imperial keeps mapped US short tons or pounds. A converted value is added only when the mapped unit belongs to the other system.
