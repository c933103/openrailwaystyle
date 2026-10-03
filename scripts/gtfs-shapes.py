"""Match rail trips to their supplied GTFS shapes, without drawing stop chords.

Split shared geometric edges at source vertices and station projections. Only
collinear vertices within 15 cm are unified: distinct nearby tracks stay apart.
This is a path frequency, not an inference about individual physical tracks.
"""
from bisect import bisect_right
from collections import defaultdict
import importlib.util
import math
from pathlib import Path


class ShapePaths:
    def __init__(self, rows, trips, times, stops, config):
        wanted = {t.get('shape_id') for t in trips.values()} - {None, ''}
        source = defaultdict(list)
        for row in rows:
            if row['shape_id'] in wanted:
                source[row['shape_id']].append(row)
        latitudes = [float(r['shape_pt_lat']) for rs in source.values() for r in rs]
        self.sx = 111320 * math.cos(math.radians(sum(latitudes) / len(latitudes))) if latitudes else 111320
        self.sy = 111320
        self.shapes, self.patterns, self.rejected = {}, {}, defaultdict(int)
        self.max_snap = config.get('max_stop_snap_metres', 200)
        for key, rs in source.items():
            rs.sort(key=lambda r: int(r['shape_pt_sequence']))
            if len({r['shape_pt_sequence'] for r in rs}) != len(rs):
                raise ValueError('Duplicate shape sequence')
            points, distances = [], []
            for r in rs:
                p = (round(float(r['shape_pt_lon']), 6), round(float(r['shape_pt_lat']), 6))
                if not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90):
                    raise ValueError('Invalid shape coordinate')
                if not points or p != points[-1]:
                    points.append(p); distances.append(r.get('shape_dist_traveled', '').strip())
            if len(points) < 2:
                continue
            lengths = [0.0]
            for a, b in zip(points, points[1:]):
                lengths.append(lengths[-1] + self.distance(a, b))
            measures = [float(v) for v in distances] if all(distances) else None
            if measures and any(b <= a for a, b in zip(measures, measures[1:])):
                measures = None
            self.shapes[key] = {'points': points, 'lengths': lengths, 'measures': measures, 'anchors': {}}
        # One projection per stop pattern, rather than once per train.
        for trip_id, trip in sorted(trips.items()):
            sequence = sorted(times.get(trip_id, []), key=lambda r: int(r['stop_sequence']))
            key = self.pattern_key(trip, sequence)
            if key not in self.patterns:
                self.patterns[key] = self.project_pattern(trip, sequence, stops)
            if self.patterns[key] is None:
                self.rejected['missing_or_unusable_shape'] += 1
        self.rail, self.rail_patterns = {}, {}
        if config.get('rail_graph'):
            missing = {key: trip for key, trip in trips.items() if self.patterns[self.pattern_key(trip, sorted(times.get(key, []), key=lambda r: int(r['stop_sequence'])))] is None}
            if missing:
                spec = importlib.util.spec_from_file_location('gtfs_rail_paths', Path(__file__).with_name('gtfs-rail-paths.py'))
                module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
                def mode(trip):
                    value = int(config['rail_route_types'][trip['route_id']])
                    return 'subway' if value == 1 or 400 <= value < 500 else 'tram' if value == 0 or 900 <= value < 1000 else 'monorail' if value == 12 else 'funicular' if value == 7 else 'rail'
                for kind in {mode(trip) for trip in missing.values()}:
                    selected = {key: trip for key, trip in missing.items() if mode(trip) == kind}
                    self.rail[kind] = module.RailPaths(config['rail_graph'], selected, {key: times[key] for key in selected}, stops, self.max_snap, kind)
                for key, trip in missing.items():
                    sequence = sorted(times[key], key=lambda r: int(r['stop_sequence']))
                    pattern = self.pattern_key(trip, sequence)
                    matcher = self.rail[mode(trip)]
                    if matcher.patterns.get(matcher.pattern_key(trip, sequence)) is not None:
                        self.patterns[pattern] = 'rail'
                        self.rail_patterns[pattern] = mode(trip)
                        self.rejected['missing_or_unusable_shape'] -= 1
                if not self.rejected['missing_or_unusable_shape']:
                    del self.rejected['missing_or_unusable_shape']
        # Every stop/vertex from every pattern is a split candidate. This also
        # handles express trips skipping stops and unequal vertex densities.
        grid, vertices = defaultdict(set), set()
        for shape in self.shapes.values():
            coords = shape['points'] + list(shape['anchors'].values())
            for p in coords:
                if p not in vertices:
                    vertices.add(p); grid[self.cell(p)].add(p)
        split_cache = {}
        for shape in self.shapes.values():
            edges = []
            for i, (a, b) in enumerate(zip(shape['points'], shape['points'][1:])):
                key = tuple(sorted((a, b)))
                if key not in split_cache:
                    lo, hi = key
                    cuts = [(0, lo), (1, hi)]
                    x0, y0 = self.cell(lo); x1, y1 = self.cell(hi)
                    # Query cells along the segment, not a large diagonal box.
                    cells = set()
                    steps = max(abs(x1-x0), abs(y1-y0), 1)
                    for step in range(steps+1):
                        c = self.cell((lo[0]+(hi[0]-lo[0])*step/steps, lo[1]+(hi[1]-lo[1])*step/steps))
                        cells.update((c[0]+dx, c[1]+dy) for dx in (-1,0,1) for dy in (-1,0,1))
                    for cell in cells:
                        for p in grid.get(cell, ()):
                            t, error = self.project_segment(p, lo, hi)
                            if 1e-8 < t < 1-1e-8 and error <= .15:
                                cuts.append((t, p))
                    cuts.sort()
                    split_cache[key] = cuts
                cuts = split_cache[key]
                if a != key[0]:
                    cuts = [(1-t, p) for t,p in reversed(cuts)]
                length = shape['lengths'][i+1]-shape['lengths'][i]
                for (t0,p0),(t1,p1) in zip(cuts,cuts[1:]):
                    if p0 != p1:
                        edges.append((shape['lengths'][i]+t0*length, shape['lengths'][i]+t1*length, p0,p1))
            shape['edges'] = edges

    def xy(self, p):
        return p[0]*self.sx, p[1]*self.sy

    def cell(self, p):
        x,y = self.xy(p); return math.floor(x/100),math.floor(y/100)

    def distance(self, a, b):
        return math.hypot((b[0]-a[0])*self.sx,(b[1]-a[1])*self.sy)

    def project_segment(self, p, a, b):
        ax,ay = self.xy(a); bx,by = self.xy(b); px,py = self.xy(p)
        dx,dy = bx-ax,by-ay
        t = max(0,min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
        return t,math.hypot(px-ax-t*dx,py-ay-t*dy)

    def pattern_key(self, trip, sequence):
        return trip.get('shape_id'), tuple((r['stop_id'],r.get('shape_dist_traveled','')) for r in sequence)

    def project_pattern(self, trip, sequence, stops):
        shape = self.shapes.get(trip.get('shape_id'))
        if not shape or len(sequence) < 2:
            return None
        positions, previous = [], -1.0
        for row in sequence:
            stop = stops.get(row['stop_id'])
            if not stop:
                raise ValueError('Trip references an absent stop')
            p = (float(stop['stop_lon']),float(stop['stop_lat']))
            value = row.get('shape_dist_traveled','').strip()
            measures = shape['measures']
            if value and measures:
                distance = float(value)
                if distance < measures[0]-1e-6 or distance > measures[-1]+1e-6:
                    return None
                i = min(len(measures)-2, max(0,bisect_right(measures,distance)-1))
                t = (distance-measures[i])/(measures[i+1]-measures[i])
                position = shape['lengths'][i]+t*(shape['lengths'][i+1]-shape['lengths'][i])
                a,b = shape['points'][i:i+2]
                q = (a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
                if self.distance(p,q) > self.max_snap or position < previous-.15:
                    return None
            else:
                candidates = []
                for i,(a,b) in enumerate(zip(shape['points'],shape['points'][1:])):
                    t,error = self.project_segment(p,a,b)
                    position = shape['lengths'][i]+t*(shape['lengths'][i+1]-shape['lengths'][i])
                    if position >= previous-.15:
                        candidates.append((error,position,i,t))
                if not candidates:
                    return None
                error,position,i,t = min(candidates)
                if error > self.max_snap:
                    return None
                # An ambiguous loop/crossing match is withheld, not guessed.
                if any(e <= error+.5 and abs(pos-position)>100 for e,pos,_,_ in candidates):
                    return None
                a,b = shape['points'][i:i+2]
                q = (a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))
            previous = max(previous,position)
            positions.append(previous)
            shape['anchors'][round(previous,6)] = (round(q[0],6),round(q[1],6))
        return positions if positions[-1] > positions[0]+.15 else None

    def segments(self, trip, sequence):
        key = self.pattern_key(trip, sequence)
        if key in self.rail_patterns:
            return self.rail[self.rail_patterns[key]].segments(trip, sequence)
        positions = self.patterns.get(key)
        if positions is None:
            return []
        shape = self.shapes[trip['shape_id']]
        out = []
        for begin,end,a,b in shape['edges']:
            middle = (begin+end)/2
            if middle < positions[0]-.001 or middle >= positions[-1]-.001:
                continue
            anchor = max(0,min(len(sequence)-2,bisect_right(positions,middle)-1))
            lo,hi = sorted((a,b))
            out.append(((trip['route_id'],lo,hi),0 if a==lo else 1,sequence[anchor], [lo,hi]))
        return out
