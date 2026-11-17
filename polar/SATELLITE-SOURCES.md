# Polar composite imagery

NASA Earth Observatory — Blue Marble: Next Generation, a historical 2004 land-surface composite, delivered through NASA EOSDIS Global Imagery Browse Services (GIBS), part of NASA ESDIS.

Source and reuse guidance: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/
API and data-use acknowledgement: https://nasa-gibs.github.io/gibs-api-docs/
WMS interface: https://nasa-gibs.github.io/gibs-api-docs/access-basics/

Two 1024×1024 JPEG GetMap responses were acquired on 2026-11-17, one per cap, through the published EPSG:3413 and EPSG:3031 WMS services. Parameters: SERVICE=WMS, REQUEST=GetMap, VERSION=1.1.1, LAYERS=BlueMarble_NextGeneration, STYLES=, FORMAT=image/jpeg, BBOX=-1048576,-1048576,1048576,1048576, WIDTH=1024, HEIGHT=1024. SRS matches the endpoint projection. Endpoints: https://gibs.earthdata.nasa.gov/wms/epsg3413/best/wms.cgi and https://gibs.earthdata.nasa.gov/wms/epsg3031/best/wms.cgi.

The existing builder's 60-second request deadline, 8-MiB maximum and zero-retry policy were used. Both JPEGs fully decoded to 1024×1024 RGB and were visually inspected. Each index records the exact SHA-256. North: 9472b692a190460cf79021868e03d2d1396af98aea55ab136816be621ff715de. South: afcce88c8609d0696d549f2dc862a4db02e0f7b1580a1cea987e3fe88592a06e.

This product is not current imagery, a seasonal sea-ice observation, or a station survey. The Arctic ocean is rendered as dark ocean by this composite; it is not evidence that the Arctic is ice-free. Antarctic terrain/surface detail is historical. The image spans a square outside the cap; the client draws only its polar-cap region. Approximate output sampling is 2,048 metres per pixel in the projected grid, not the source product's native resolution.

This update preserves every accepted terrain, relief, contour, cartographic and lifecycle asset from rail-data commit eaafe96ea3d060414ef80058dd6898ce46443ef5; only these two JPEGs, their index satellite fields, and this source note are added. Satellite credit is displayed by the client while a composite is drawn.
