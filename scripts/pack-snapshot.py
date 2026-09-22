import json, base64
from pmtiles.writer import write
from pmtiles.tile import zxy_to_tileid, TileType, Compression
with write('snapshot/lifecycle.pmtiles') as archive:
    with open('snapshot/tiles.jsonl') as tiles:
        for row in tiles:
            z,x,y,data=json.loads(row)
            archive.write_tile(zxy_to_tileid(z,x,y),base64.b64decode(data))
    archive.finalize({'tile_type':TileType.MVT,'tile_compression':Compression.GZIP,'min_lon_e7':-1800000000,'min_lat_e7':-850000000,'max_lon_e7':1800000000,'max_lat_e7':850000000,'center_zoom':5,'center_lon_e7':150000000,'center_lat_e7':230000000},{'name':'Worldwide planned and former railways','attribution':'© OpenStreetMap contributors, ODbL','vector_layers':[{'id':'lifecycle','fields':{'name':'String','state':'String','osm_id':'Number'},'minzoom':5,'maxzoom':10}]})
