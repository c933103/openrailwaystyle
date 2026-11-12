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
        # Uniform angular index cells; local latitude determines distances.
        self.sx = self.sy = 111320
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
                # Unwrap at the antimeridian: consecutive vertices never differ
                # by more than 180° of longitude, so 179.9° to -179.9° is a
                # short step. Output edges are normalized back to ±180°.
                if points:
                    p = (round(p[0] + 360*round((points[-1][0]-p[0])/360), 6), p[1])
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
            longitudes = [x for x, _ in points]
            self.shapes[key] = {'points': points, 'lengths': lengths, 'measures': measures, 'anchors': {}, 'lookup': None,
                                'centre': (min(longitudes)+max(longitudes))/2}
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
                    return 'monorail' if value in (12, 405) else 'funicular' if value in (7, 1400) else 'subway' if value == 1 or 400 <= value < 500 else 'tram' if value in (0, 5) or 900 <= value < 1000 else 'rail'
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
        for shape in self.shapes.values():
            shape.pop('lookup', None)
        # Index only served paths. Source-edge identity prevents a dense
        # polyline's own vertices from becoming competing track evidence.
        raw, eligible, shape_owners, rail_owners = {}, set(), {}, {}
        for trip_id, trip in sorted(trips.items()):
            sequence = sorted(times.get(trip_id, []), key=lambda r: int(r['stop_sequence']))
            key = self.pattern_key(trip, sequence)
            if trip_id in config.get('eligible_trip_ids', trips):
                eligible.add(key)
            if key in raw or self.patterns[key] is None:
                continue
            if key in self.rail_patterns:
                kind = self.rail_patterns[key]
                matcher = self.rail[kind]
                path = matcher.patterns[matcher.pattern_key(trip, sequence)]
                identity = tuple(self.canonical(a) for a, _, _ in path) + (self.canonical(path[-1][1]),)
                identity = kind, min(identity, tuple(reversed(identity)))
                owner = ('rail', kind, rail_owners.setdefault(identity, len(rail_owners)))
                def rail_path(path=path, owner=owner):
                    for a, b, anchor in path:
                        yield a, b, anchor, (owner, tuple(sorted((self.canonical(a), self.canonical(b)))))
                raw[key] = rail_path
                continue
            shape = self.shapes[trip['shape_id']]
            positions = self.patterns[key]
            if 'owner' not in shape:
                identity = tuple(self.canonical(p) for p in shape['points'])
                identity = min(identity, tuple(reversed(identity)))
                shape['owner'] = ('shape', shape_owners.setdefault(identity, len(shape_owners)))
            def shape_path(shape=shape, positions=positions, sequence_length=len(sequence)):
                points, lengths = shape['points'], shape['lengths']
                first = max(0, bisect_right(lengths, positions[0])-1)
                last = min(len(points)-1, bisect_right(lengths, positions[-1]))
                for i in range(first, last):
                    a, b = points[i:i+2]
                    begin, end = max(lengths[i], positions[0]), min(lengths[i+1], positions[-1])
                    if end <= begin:
                        continue
                    cuts = sorted({begin, end, *(v for v in positions if begin < v < end)})
                    support = (shape['owner'], tuple(sorted((self.canonical(a), self.canonical(b)))))
                    def point(value):
                        t = (value-lengths[i])/(lengths[i+1]-lengths[i])
                        return (round(a[0]+t*(b[0]-a[0]), 6), round(a[1]+t*(b[1]-a[1]), 6))
                    for lo, hi in zip(cuts, cuts[1:]):
                        anchor = max(0, min(sequence_length-2, bisect_right(positions, (lo+hi)/2)-1))
                        p, q = point(lo), point(hi)
                        if p != q:
                            yield p, q, anchor, support
            raw[key] = shape_path
        # A non-contributing pattern may supply an interval boundary, but cannot
        # move a current working or create its competing-track ambiguity.
        boundaries, groups = defaultdict(lambda: defaultdict(set)), defaultdict(dict)
        for key, path in raw.items():
            groups[(key[0], key in eligible)][key] = path
            for a, b, _, support in path():
                boundaries[key[0]][self.canonical(a)].add(support)
                boundaries[key[0]][self.canonical(b)].add(support)
        self.edge_paths, self.ambiguous_patterns = {}, set()
        for (route, _), paths in groups.items():
            edges, ambiguous = self.reconcile(paths, boundaries[route])
            self.edge_paths.update(edges)
            self.ambiguous_patterns.update(ambiguous)
        for route, current in groups:
            if current or (route, True) not in groups:
                continue
            self.edge_paths.update(self.align_noncontributing(
                {key: self.edge_paths[key] for key in groups[(route, False)]},
                {key: self.edge_paths[key] for key in groups[(route, True)]}))

    def align_noncontributing(self, paths, contributors):
        """Reuse existing current intervals without changing their geometry."""
        reference, grid = set(), defaultdict(set)
        for path in contributors.values():
            for a, b, _, _ in path():
                reference.add(tuple(sorted((self.canonical(a), self.canonical(b)))))
        for edge in reference:
            for point in edge:
                grid[self.cell(point)].add(edge)
        def distance(a, b):
            return self.distance(a, (b[0]+360*round((a[0]-b[0])/360), b[1]))
        cache = {}
        def align(a, b, support):
            edge_key = tuple(sorted((self.canonical(a), self.canonical(b))))
            key = edge_key, support[1], support[2]
            original = support[2] if self.canonical(a) == edge_key[0] else tuple(reversed(support[2]))
            if key not in cache:
                lo, hi = edge_key
                radius, _ = self.radii(lo, .15)
                candidates = set()
                if radius > 256:
                    candidates = reference
                else:
                    for turn in (-360, 0, 360):
                        x, y = self.cell((lo[0]+turn, lo[1]))
                        for dx in range(-radius, radius+1):
                            for dy in (-1, 0, 1):
                                candidates.update(grid.get((x+dx, y+dy), ()))
                matches = {}
                for edge in candidates:
                    orientations = []
                    for left, right in (edge, tuple(reversed(edge))):
                        first, last = distance(lo, left), distance(hi, right)
                        if max(first, last, distance(original[0], left), distance(original[1], right),
                               self.source_error(left, support), self.source_error(right, support)) <= .15:
                            orientations.append((first+last, left, right))
                    if orientations:
                        orientations.sort()
                        matches[edge] = (orientations[0][1:] if len(orientations) == 1 or
                                         orientations[1][0]-orientations[0][0] > 1e-9 else None)
                cache[key] = next(iter(matches.values())) if len(matches) == 1 else None
            chosen = cache[key]
            if chosen is None:
                return a, b
            if self.canonical(a) != edge_key[0]:
                chosen = tuple(reversed(chosen))
            return tuple((round(q[0]+360*round((p[0]-q[0])/360), 6), q[1]) for p, q in zip((a, b), chosen))
        result = {}
        for key, path in paths.items():
            def mapped(path=path):
                for a, b, anchor, support in path():
                    a, b = align(a, b, support)
                    yield a, b, anchor, support
            result[key] = mapped
        return result

    def reconcile(self, paths, boundaries):
        """Partition one route's equally eligible, explicitly owned paths."""
        grid, supports, source_edges = defaultdict(set), defaultdict(set), defaultdict(set)
        for path in paths.values():
            for a, b, _, support in path():
                for p in (a, b):
                    p = self.canonical(p)
                    supports[p].add(support); grid[self.cell(p)].add(p)
                middle = (a[0]+b[0])/2
                shift = -360*math.floor((middle+180)/360)
                edge = tuple(sorted(((round(a[0]+shift, 6), a[1]), (round(b[0]+shift, 6), b[1]))))
                source_edges[edge].add(support)
        vertices = set(supports)
        def nearby(a, b, points, lookup):
            middle = (a[0]+b[0])/2
            shift = -360*math.floor((middle+180)/360)
            radius_x, _ = self.radii((0, max(abs(a[1]), abs(b[1]))), .15)
            cells = set()
            for turn in (-360, 0, 360):
                s0, s1 = (a[0]+shift+turn, a[1]), (b[0]+shift+turn, b[1])
                if max(s0[0], s1[0]) < -181 or min(s0[0], s1[0]) > 181:
                    continue
                x0, y0 = self.cell(s0); x1, y1 = self.cell(s1)
                steps = max(abs(x1-x0), abs(y1-y0), 1)
                for step in range(steps+1):
                    c = self.cell((s0[0]+(s1[0]-s0[0])*step/steps, s0[1]+(s1[1]-s0[1])*step/steps))
                    if radius_x <= 256:
                        cells.update((c[0]+dx, c[1]+dy) for dx in range(-radius_x, radius_x+1) for dy in (-1, 0, 1))
            candidates = points if radius_x > 256 else {p for cell in cells for p in lookup.get(cell, ())}
            return [(round(p[0]+360*round((middle-p[0])/360), 6), p[1]) for p in candidates]
        def separation(a, b):
            return self.distance(a, (b[0]+360*round((a[0]-b[0])/360), b[1]))
        def off_line(p, a, b):
            sx = self.sx*math.cos(math.radians(p[1]))
            dx, dy = (b[0]-a[0])*sx, (b[1]-a[1])*self.sy
            length = math.hypot(dx, dy)
            return abs(dx*(p[1]-a[1])*self.sy-dy*(p[0]-a[0])*sx)/length if length else 0
        def owners(point, metadata):
            return {support[0] for support in metadata[self.canonical(point)]}
        def compatible(a, b, centre, metadata):
            if owners(a, metadata) & owners(b, metadata):
                return True
            # Separate trip extents may meet at one ordered graph bend. Only
            # the actual local degree-two vertex proves that continuity; a
            # distant connection or a junction cannot equate parallel paths.
            centre = self.canonical(centre)
            for left in metadata[self.canonical(a)]:
                if left[0][0] != 'rail' or centre not in left[1]:
                    continue
                graph = self.rail[left[0][1]].graph
                degree = max(len(graph.get((centre[0]+turn, centre[1]), ())) for turn in (-360, 0, 360))
                if degree != 2:
                    continue
                if any(right[0][:2] == left[0][:2] and centre in right[1]
                       for right in metadata[self.canonical(b)]):
                    return True
            return False
        def cluster(metadata, protected=(), ambiguous=()):
            lookup = defaultdict(set)
            for p in metadata:
                lookup[self.cell(p)].add(p)
            protected, ambiguous = set(protected), set(ambiguous)
            for point in sorted(metadata):
                neighbours = {self.canonical(p) for p in nearby(point, point, metadata, lookup)
                              if separation(point, p) <= .15}
                if any(separation(a, b) > .15 for a in neighbours for b in neighbours):
                    protected.update(neighbours)
                    # Longitudinal samples from one source are not two tracks,
                    # even when another path shares some of those coordinates.
                    if any(separation(a, b) > .15 and not compatible(a, b, point, metadata)
                           for a in neighbours for b in neighbours):
                        ambiguous.update(neighbours)
            result = {p: p for p in protected}
            for point in sorted(metadata):
                if point in result:
                    continue
                members = [point]
                for p in sorted({self.canonical(p) for p in nearby(point, point, metadata, lookup)}):
                    if p == point or p in result or separation(point, p) > .15:
                        continue
                    # Distinct vertices from one source polyline keep their
                    # order and geometry; only different paths can reconcile.
                    if any(owners(p, metadata) & owners(other, metadata) for other in members):
                        continue
                    if all(separation(p, other) <= .15 for other in members):
                        members.append(p)
                for p in members:
                    result[p] = point
            return result, protected, ambiguous
        def reconciled(p, mapping):
            q = mapping[self.canonical(p)]
            return (round(q[0]+360*round((p[0]-q[0])/360), 6), q[1])
        def relevant(p, a, b, edge_supports, metadata):
            related = metadata[self.canonical(p)]
            same_owner = {v[0] for v in related} & {v[0] for v in edge_supports}
            return not same_owner or bool(related & edge_supports) or off_line(p, a, b) <= 1e-6

        endpoints, protected, ambiguous = cluster(supports)
        candidates = defaultdict(set)
        for p, values in supports.items():
            candidates[endpoints[p]].update(values)
        for (a, b), edge_supports in source_edges.items():
            a, b = reconciled(a, endpoints), reconciled(b, endpoints)
            for p in nearby(a, b, vertices, grid):
                if not relevant(p, a, b, edge_supports, supports):
                    continue
                t, error = self.project_segment(p, a, b)
                if error <= .15:
                    q = (round(a[0]+t*(b[0]-a[0]), 6), round(a[1]+t*(b[1]-a[1]), 6))
                    if self.distance(p, q) <= .15:
                        candidates[self.canonical(q)].update(edge_supports)
        representatives, protected, ambiguous = cluster(candidates, protected, ambiguous)
        metadata = defaultdict(set)
        for p, representative in representatives.items():
            metadata[representative].update(candidates[p])
        vertices, grid = set(metadata), defaultdict(set)
        for p in vertices:
            grid[self.cell(p)].add(p)
        extra_grid = defaultdict(set)
        for p in boundaries:
            extra_grid[self.cell(p)].add(p)
        split_cache = {}
        def split(a, b, support):
            key = tuple(sorted((a, b))), support
            if key not in split_cache:
                lo, hi = key[0]
                near = [p for p in nearby(lo, hi, vertices, grid)
                        if relevant(p, lo, hi, {support}, metadata)]
                protected_edge = any(self.canonical(p) in protected and
                    self.project_segment(p, lo, hi)[1] <= .15 and off_line(p, lo, hi) > 1e-6 for p in near)
                uncertain = any(self.canonical(p) in ambiguous and
                    self.project_segment(p, lo, hi)[1] <= .15 and off_line(p, lo, hi) > 1e-6 for p in near)
                if not protected_edge:
                    lo = reconciled(reconciled(lo, endpoints), representatives)
                    hi = reconciled(reconciled(hi, endpoints), representatives)
                cuts = {(0, lo), (1, hi)}
                near = [p for p in nearby(lo, hi, vertices, grid)
                        if relevant(p, lo, hi, {support}, metadata)]
                near += [p for p in nearby(lo, hi, boundaries, extra_grid)
                         if self.canonical(p) not in supports and relevant(p, lo, hi, {support}, boundaries)]
                for p in near:
                    t, error = self.project_segment(p, lo, hi)
                    if 1e-8 < t < 1-1e-8 and error <= .15:
                        q = (round(lo[0]+t*(hi[0]-lo[0]), 6), round(lo[1]+t*(hi[1]-lo[1]), 6))
                        if not protected_edge and self.canonical(q) in representatives:
                            q = reconciled(q, representatives)
                        t, _ = self.project_segment(q, lo, hi)
                        cuts.add((t, q))
                original_lo, original_hi = key[0]
                def original_point(t):
                    return (original_lo[0]+t*(original_hi[0]-original_lo[0]),
                            original_lo[1]+t*(original_hi[1]-original_lo[1]))
                # Endpoint and projection passes may each be bounded yet drift
                # in composition. Check the final point against its original
                # served interval AND its supporting edge. Clipping the served
                # endpoints has already rounded them once; that rounding must
                # not add another allowance to the original source bound.
                if any(max(self.distance(p, original_point(t)), self.source_error(p, support)) > .15
                       for t, p in cuts):
                    uncertain = True
                    source_cuts = {(0, original_lo), (1, original_hi)}
                    for _, p in cuts:
                        t, _ = self.project_segment(p, original_lo, original_hi)
                        if 1e-8 < t < 1-1e-8:
                            q = tuple(round(value, 6) for value in original_point(t))
                            if self.source_error(q, support) <= .15:
                                source_cuts.add((t, q))
                    cuts = source_cuts
                split_cache[key] = sorted(cuts), uncertain
            cuts, uncertain = split_cache[key]
            if a != key[0][0]:
                cuts = [(1-t, p) for t, p in reversed(cuts)]
            return cuts, uncertain
        result, ambiguous_paths = {}, set()
        for key, path in paths.items():
            for a, b, _, support in path():
                if split(a, b, support)[1]:
                    ambiguous_paths.add(key)
            # Keep the shared split cache, not a copied full path per pattern.
            def mapped(path=path):
                for a, b, anchor, support in path():
                    cuts, _ = split(a, b, support)
                    for (t0, p0), (t1, p1) in zip(cuts, cuts[1:]):
                        if p0 != p1 and t1-t0 > 1e-8:
                            def original_point(t):
                                return (a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1]))
                            yield p0, p1, anchor, (*support, (original_point(t0), original_point(t1)))
            result[key] = mapped
        return result, ambiguous_paths

    @staticmethod
    def canonical(p):
        """A point's longitude in -180 <= lon < 180."""
        return (round((p[0]+180) % 360 - 180, 6), p[1])

    def source_error(self, point, support):
        """Distance to the original supporting edge in the point's world copy."""
        a, b = support[1]
        a = (a[0]+360*round((point[0]-a[0])/360), a[1])
        b = (b[0]+360*round((a[0]-b[0])/360), b[1])
        return self.project_segment(point, a, b)[1]

    def xy(self, p):
        return p[0]*self.sx, p[1]*self.sy

    def cell(self, p):
        x,y = self.xy(p); return math.floor(x/100),math.floor(y/100)

    def distance(self, a, b):
        sx = self.sx*math.cos(math.radians((a[1]+b[1])/2))
        return math.hypot((b[0]-a[0])*sx,(b[1]-a[1])*self.sy)

    def radii(self, p, metres):
        cosine=max(1e-12,abs(math.cos(math.radians(p[1]))))
        return math.ceil(metres/(100*cosine))+1,math.ceil(metres/100)+1

    def project_segment(self, p, a, b):
        sx = self.sx*math.cos(math.radians(p[1]))
        ax,ay = a[0]*sx,a[1]*self.sy; bx,by = b[0]*sx,b[1]*self.sy; px,py = p[0]*sx,p[1]*self.sy
        dx,dy = bx-ax,by-ay
        length=dx*dx+dy*dy
        t = max(0,min(1,((px-ax)*dx+(py-ay)*dy)/length)) if length>1e-18 else 0
        return t,math.hypot(px-ax-t*dx,py-ay-t*dy)

    def pattern_key(self, trip, sequence):
        # Route scope keeps graph fallbacks and their mode-specific failures
        # separate even when two services have identical stops and no shape.
        return trip['route_id'], trip.get('shape_id'), tuple((r['stop_id'],r.get('shape_dist_traveled','')) for r in sequence)

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
            # The stop in the shape's (possibly unwrapped) world copy.
            p = (p[0] + 360*round((shape['centre']-p[0])/360), p[1])
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
                if shape['lookup'] is None:
                    lookup = defaultdict(list)
                    for i,(a,b) in enumerate(zip(shape['points'],shape['points'][1:])):
                        x0,y0=self.cell(a);x1,y1=self.cell(b)
                        steps=max(1,abs(x1-x0),abs(y1-y0))
                        cells={self.cell((a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps)) for j in range(steps+1)}
                        for cell in cells:lookup[cell].append(i)
                    shape['lookup']=lookup
                x,y=self.cell(p);radius_x,radius_y=self.radii(p,self.max_snap)
                indices=range(len(shape['points'])-1) if radius_x>256 else {i for dx in range(-radius_x,radius_x+1) for dy in range(-radius_y,radius_y+1) for i in shape['lookup'].get((x+dx,y+dy),())}
                for i in indices:
                    a,b=shape['points'][i:i+2]
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
        out = []
        path = self.edge_paths.get(self.pattern_key(trip, sequence))
        for a, b, anchor, _ in path() if path else ():
            for p, q in self.normalized(a, b):
                lo, hi = sorted((p, q))
                out.append(((trip['route_id'], lo, hi), 0 if p == lo else 1, sequence[anchor], [lo, hi]))
        return out

    @staticmethod
    def normalized(a, b):
        """An unwrapped edge as one or two edges within -180..180 longitude."""
        shift = -360*round((a[0]+b[0])/720)
        a, b = (round(a[0]+shift, 6), a[1]), (round(b[0]+shift, 6), b[1])
        edge = 180 if max(a[0], b[0]) > 180 else -180 if min(a[0], b[0]) < -180 else None
        if edge is None:
            return [(a, b)]
        t = (edge-a[0])/(b[0]-a[0])
        middle = round(a[1]+t*(b[1]-a[1]), 6)
        turn = 360 if edge > 0 else -360
        if a[0] > 180 or a[0] < -180:
            return [((a[0]-turn, a[1]), (-edge, middle)), ((edge, middle), b)]
        return [(a, (edge, middle)), ((-edge, middle), (b[0]-turn, b[1]))]
