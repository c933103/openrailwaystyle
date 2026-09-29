# Street-running track data

Infrastructure-view level crossings and street-running roadbeds.

Infrastructure view adds level crossings (`points_of_interest.type=level_crossing`, zoom 15+) and ochre roadbeds for explicitly mapped street-running tracks (zoom 13+). The latter uses a weekly, validated worldwide Overpass extract, published atomically to `street-data`; each website build copies the complete static vector tiles. Visitors do not make Overpass requests. Only `embedded=yes` or road `embedded_rails` tags qualify; trams and adjacent roads do not imply sharing. Its manifest and ODbL GeoJSON download are linked under About. Failed refreshes retain the last published snapshot.
