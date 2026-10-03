"""Conservative stop-pattern matching to an already published railway graph.

This does not fetch tracks, connect disconnected tracks, or draw stop chords.
An ambiguous alternative path or missing connection is withheld. The supplied
branch/metro snapshot is geographically global but is not a complete mainline
network, so missing paths are expected and reported.
"""
from collections import defaultdict
import gzip
import heapq
import json
import math


def distance(a, b):
    sx = 111320*math.cos(math.radians((a[1]+b[1])/2))
    return math.hypot((a[0]-b[0])*sx, (a[1]-b[1])*111320)


class RailPaths:
    def __init__(self, path, trips, times, stops, max_snap=200):
        self.patterns, self.rejected, self.graph = {}, defaultdict(int), defaultdict(dict)
        self.max_snap = max_snap
        used = {row['stop_id'] for seq in times.values() for row in seq}
        positions = [(float(stops[k]['stop_lon']), float(stops[k]['stop_lat'])) for k in used]
        if not positions:
            return
        west, east = min(p[0] for p in positions)-.2, max(p[0] for p in positions)+.2
        south, north = min(p[1] for p in positions)-.2, max(p[1] for p in positions)+.2
        self.grid = defaultdict(set)
        opener = gzip.open if str(path).endswith('.gz') else open
        with opener(path, 'rt') as file:
            for line in file:
                item = json.loads(line)
                if item.get('type') != 'Feature' or item.get('geometry', {}).get('type') != 'LineString':
                    continue
                p = item.get('properties', {})
                if p.get('state', 'present') != 'present' or p.get('service'):
                    continue
                coords = [tuple(round(float(v), 6) for v in point) for point in item['geometry']['coordinates']]
                for a, b in zip(coords, coords[1:]):
                    if a == b or max(a[0], b[0]) < west or min(a[0], b[0]) > east or max(a[1], b[1]) < south or min(a[1], b[1]) > north:
                        continue
                    length = distance(a, b)
                    self.graph[a][b] = self.graph[b][a] = length
                    # Index complete segments, including long simplified ways.
                    steps = max(1, math.ceil(length/100))
                    for i in range(steps+1):
                        q = (a[0]+(b[0]-a[0])*i/steps, a[1]+(b[1]-a[1])*i/steps)
                        self.grid[self.cell(q)].add(tuple(sorted((a, b))))
        self.snaps = {key: self.snap((float(stops[key]['stop_lon']), float(stops[key]['stop_lat']))) for key in used}
        # Insert every projected station into its graph edge before routing.
        cuts = defaultdict(set)
        for snap in self.snaps.values():
            if snap:
                a, b, q = snap
                cuts[(a, b)].add(q)
        for (a, b), points in cuts.items():
            self.graph[a].pop(b, None); self.graph[b].pop(a, None)
            chain = sorted({a, b, *points}, key=lambda p: distance(a, p))
            for lo, hi in zip(chain, chain[1:]):
                self.graph[lo][hi] = self.graph[hi][lo] = distance(lo, hi)
        self.pairs = {}
        for trip_id, trip in trips.items():
            sequence = sorted(times.get(trip_id, []), key=lambda row: int(row['stop_sequence']))
            key = self.pattern_key(trip, sequence)
            if key not in self.patterns:
                self.patterns[key] = self.pattern(sequence)
            if self.patterns[key] is None:
                self.rejected['missing_or_ambiguous_railway_path'] += 1

    @staticmethod
    def cell(p):
        # Longitude-aware query radius below keeps this valid at high latitude.
        return math.floor(p[0]*1000), math.floor(p[1]*1000)

    def snap(self, p):
        candidates = []
        x, y = self.cell(p)
        rx = math.ceil(self.max_snap/(111.32*max(.02, math.cos(math.radians(p[1])))))+1
        ry = math.ceil(self.max_snap/111.32)+1
        sx, sy = 111320*math.cos(math.radians(p[1])), 111320
        edges = set().union(*(self.grid.get((x+dx, y+dy), set()) for dx in range(-rx, rx+1) for dy in range(-ry, ry+1)))
        for a, b in edges:
            dx, dy = (b[0]-a[0])*sx, (b[1]-a[1])*sy
            t = max(0, min(1, (((p[0]-a[0])*sx)*dx+((p[1]-a[1])*sy)*dy)/(dx*dx+dy*dy)))
            q = (round(a[0]+t*(b[0]-a[0]), 6), round(a[1]+t*(b[1]-a[1]), 6))
            candidates.append((distance(p, q), a, b, q))
        if not candidates:
            return None
        error, a, b, q = min(candidates)
        if error > self.max_snap:
            return None
        # Two equally close, distinct tracks cannot be identified from a stop.
        if any(e <= error+1 and distance(other, q) > 2 for e, _, _, other in candidates):
            return None
        return a, b, q

    def shortest(self, a, b, budget, excluded=None):
        heap, best, parents = [(0, a)], {a: 0}, {}
        examined = 0
        while heap:
            cost, node = heapq.heappop(heap)
            if cost != best[node]:
                continue
            if node == b:
                result = [b]
                while result[-1] != a:
                    result.append(parents[result[-1]])
                return cost, list(reversed(result))
            examined += 1
            if examined > 50000 or cost > budget:
                return None
            for nxt, length in self.graph[node].items():
                if excluded == tuple(sorted((node, nxt))):
                    continue
                value = cost+length
                if value <= budget and value < best.get(nxt, math.inf):
                    best[nxt] = value; parents[nxt] = node
                    heapq.heappush(heap, (value, nxt))
        return None

    def pair(self, a, b):
        if a == b:
            return [a]
        key = (a, b)
        if key in self.pairs:
            return self.pairs[key]
        budget = max(1000, distance(a, b)*3)
        result = self.shortest(a, b, budget)
        path = result[1] if result else None
        if path:
            # Only branch edges can admit a different simple path. Withhold
            # any alternative within 15% rather than choose a plausible line.
            for lo, hi in zip(path, path[1:]):
                if len(self.graph[lo]) > 2 or len(self.graph[hi]) > 2:
                    alt = self.shortest(a, b, result[0]*1.15+10, tuple(sorted((lo, hi))))
                    if alt:
                        path = None
                        break
        self.pairs[key] = path
        return path

    @staticmethod
    def pattern_key(trip, sequence):
        return trip['route_id'], tuple(row['stop_id'] for row in sequence)

    def pattern(self, sequence):
        out = []
        for index, (up, down) in enumerate(zip(sequence, sequence[1:])):
            a, b = self.snaps.get(up['stop_id']), self.snaps.get(down['stop_id'])
            if not a or not b:
                return None
            path = self.pair(a[2], b[2])
            if path is None:
                return None
            out.extend((lo, hi, index) for lo, hi in zip(path, path[1:]))
        return out or None

    def segments(self, trip, sequence):
        path = self.patterns.get(self.pattern_key(trip, sequence))
        if path is None:
            return []
        out = []
        for a, b, anchor in path:
            lo, hi = sorted((a, b))
            out.append(((trip['route_id'], lo, hi), 0 if a == lo else 1, sequence[anchor], [lo, hi]))
        return out
