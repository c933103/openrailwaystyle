"""Normalize validated line-only lifecycle MVTs without re-encoding properties."""
import gzip


def varint(data, at, end):
    result = 0
    for shift in range(0, 70, 7):
        if at >= end:
            break
        byte = data[at]
        at += 1
        if shift == 63 and byte > 1:
            break
        result |= (byte & 127) << shift
        if byte < 128:
            return result, at
    raise ValueError('invalid protobuf varint')


def fields(data, at, end):
    while at < end:
        tag, at = varint(data, at, end)
        field, wire = divmod(tag, 8)
        if not 0 < field < (1 << 29):
            raise ValueError('invalid protobuf field')
        start = at
        if wire == 0:
            value, at = varint(data, at, end)
        elif wire == 2:
            size, start = varint(data, at, end)
            value, at = None, start + size
        elif wire in (1, 5):
            value, at = None, at + (8 if wire == 1 else 4)
        else:
            raise ValueError('unsupported protobuf wire type')
        if at > end:
            raise ValueError('truncated protobuf field')
        yield field, wire, start, at, value


def vint(value):
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def message(field, body):
    return vint((field << 3) | 2) + vint(len(body)) + body


def line(data, start, end, version):
    x = y = 0
    paths = []
    dropped_segments = dropped_paths = move_only = 0
    if start == end:
        raise ValueError('empty line geometry')
    while start < end:
        move, start = varint(data, start, end)
        if move != 9:  # MoveTo with count 1
            raise ValueError('expected line MoveTo')
        dx, start = varint(data, start, end)
        dy, start = varint(data, start, end)
        x += (dx >> 1) ^ -(dx & 1)
        y += (dy >> 1) ^ -(dy & 1)
        if max(abs(x), abs(y)) > 2**31 - 1:
            raise ValueError('out-of-range line coordinate')
        command, after = varint(data, start, end) if start < end else (None, start)
        # vt-pbf 3.1.3 emits no LineTo for a singleton ring. A full MoveTo
        # with exactly two complete deltas and no line segments traces no line.
        if command in (None, 9) and version == 1:
            move_only += 1
            dropped_paths += 1
            continue
        if command is None:
            raise ValueError('missing line LineTo')
        start = after
        count = command >> 3
        if command & 7 != 2 or not 1 <= count <= (end - start) // 2:
            raise ValueError('expected nonempty line LineTo')
        path = [(x, y)]
        for _ in range(count):
            dx, start = varint(data, start, end)
            dy, start = varint(data, start, end)
            if not (dx or dy):
                if version == 2:
                    raise ValueError('zero-length MVT v2 line segment')
                dropped_segments += 1
                continue
            x += (dx >> 1) ^ -(dx & 1)
            y += (dy >> 1) ^ -(dy & 1)
            if max(abs(x), abs(y)) > 2**31 - 1:
                raise ValueError('out-of-range line coordinate')
            path.append((x, y))
        if len(path) > 1:
            paths.append(path)
        else:
            dropped_paths += 1
    if not dropped_paths and not dropped_segments:
        return None, 0, 0, 0
    # Recompute commands from absolute vertices: dropping a path changes the
    # relative MoveTo delta of its successor, even if that successor was clean.
    encoded = bytearray()
    x = y = 0
    for path in paths:
        encoded.append(9)
        for index, (px, py) in enumerate(path):
            dx, dy = px - x, py - y
            encoded += vint((dx << 1) ^ (dx >> 63))
            encoded += vint((dy << 1) ^ (dy >> 63))
            x, y = px, py
            if index == 0:
                encoded += vint(((len(path) - 1) << 3) | 2)
    return bytes(encoded), dropped_segments, dropped_paths, move_only


def normalize(data, singleton_sample=None):
    """Return gzip plus counts of upgraded tiles, segments, paths and features."""
    compressed = data.startswith(b'\x1f\x8b')
    raw = gzip.decompress(data) if compressed else data
    layer, = fields(raw, 0, len(raw))
    if layer[:2] != (3, 2):
        raise ValueError('expected one lifecycle layer')
    schema = {}
    features = []
    previous = layer[2]
    for field, wire, start, end, value in fields(raw, layer[2], layer[3]):
        if field in (1, 5, 15):
            if field in schema or wire != (2 if field == 1 else 0):
                raise ValueError('invalid or repeated lifecycle layer header')
            schema[field] = (start, end, value)
        elif field in (2, 3, 4) and wire == 2:
            if field == 2:
                features.append((previous, start, end))
        else:
            raise ValueError('unexpected lifecycle layer field')
        previous = end
    if set(schema) != {1, 5, 15}:
        raise ValueError('incomplete lifecycle layer')
    start, end, _ = schema[1]
    if raw[start:end] != b'lifecycle' or schema[5][2] != 4096:
        raise ValueError('unexpected lifecycle layer name or extent')
    at, end, version = schema[15]
    if end != at + 1 or version not in (1, 2) or (version == 1 and not features):
        raise ValueError('unsupported lifecycle layer version')
    changes = [(at, at + 1, b'\x02')] if version == 1 else []
    segments = paths = removed = move_only = 0
    for field_start, start, end in features:
        feature = {}
        previous = start
        for field, wire, first, last, value in fields(raw, start, end):
            if field not in (1, 2, 3, 4) or field in feature or wire != (0 if field in (1, 3) else 2):
                raise ValueError('unexpected lifecycle feature field')
            feature[field] = (first, last, value, previous)
            previous = last
        if feature.get(3, (None, None, None))[2] != 2 or 4 not in feature:
            raise ValueError('expected lifecycle line feature')
        first, last, _, header = feature[4]
        try:
            geometry, dropped_segments, dropped_paths, singleton_paths = line(raw, first, last, version)
        except ValueError as error:
            payload = raw[first:last]
            sample = payload.hex() if len(payload) <= 128 else payload[:64].hex() + '...' + payload[-64:].hex()
            raise ValueError(f'{error}; geometry length={len(payload)} hex={sample}') from error
        if singleton_paths and singleton_sample is not None:
            singleton_sample(raw[first:last])
        move_only += singleton_paths
        segments += dropped_segments
        paths += dropped_paths
        if geometry is not None:
            replacement = b''
            if geometry:
                replacement = message(2, raw[start:header] + message(4, geometry) + raw[last:end])
            else:
                removed += 1
            changes.append((field_start, end, replacement))
    if version == 2 and compressed:
        return data, (0, 0, 0, 0, 0)
    if version == 1 and not (segments or paths):
        return gzip.compress(raw[:at] + b"\x02" + raw[at+1:], mtime=0), (1, 0, 0, 0, 0)
    chunks = []
    previous = layer[2]
    for start, end, replacement in sorted(changes):
        chunks.extend((raw[previous:start], replacement))
        previous = end
    chunks.append(raw[previous:layer[3]])
    # A tile can contain no remaining line if every input feature was
    # zero-length; retain its key and exact layer dictionaries nevertheless.
    raw = message(3, b''.join(chunks)) if changes else raw
    return gzip.compress(raw, mtime=0), (int(version == 1), segments, paths, removed, move_only)
