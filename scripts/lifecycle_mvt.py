"""Upgrade only the version byte of validated line-only lifecycle MVTs."""
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


def line(data, start, end):
    x = y = 0
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
        command, start = varint(data, start, end)
        count = command >> 3
        if command & 7 != 2 or not 1 <= count <= (end - start) // 2:
            raise ValueError('expected nonempty line LineTo')
        if max(abs(x), abs(y)) > 2**31 - 1:
            raise ValueError('out-of-range line coordinate')
        for _ in range(count):
            dx, start = varint(data, start, end)
            dy, start = varint(data, start, end)
            if not (dx or dy):
                raise ValueError('zero-length line segment')
            x += (dx >> 1) ^ -(dx & 1)
            y += (dy >> 1) ^ -(dy & 1)
            if max(abs(x), abs(y)) > 2**31 - 1:
                raise ValueError('out-of-range line coordinate')


def normalize(data):
    """Return deterministic gzip and whether the layer version changed."""
    compressed = data.startswith(b'\x1f\x8b')
    raw = gzip.decompress(data) if compressed else data
    layer, = fields(raw, 0, len(raw))
    if layer[:2] != (3, 2):
        raise ValueError('expected one lifecycle layer')
    schema = {}
    features = []
    for field, wire, start, end, value in fields(raw, layer[2], layer[3]):
        if field in (1, 5, 15):
            if field in schema or wire != (2 if field == 1 else 0):
                raise ValueError('invalid or repeated lifecycle layer header')
            schema[field] = (start, end, value)
        elif field in (2, 3, 4) and wire == 2:
            if field == 2:
                features.append((start, end))
        else:
            raise ValueError('unexpected lifecycle layer field')
    if set(schema) != {1, 5, 15} or not features:
        raise ValueError('incomplete lifecycle layer')
    start, end, _ = schema[1]
    if raw[start:end] != b'lifecycle' or schema[5][2] != 4096:
        raise ValueError('unexpected lifecycle layer name or extent')
    at, end, version = schema[15]
    if end != at + 1 or version not in (1, 2):
        raise ValueError('unsupported lifecycle layer version')
    for start, end in features:
        feature = {}
        for field, wire, first, last, value in fields(raw, start, end):
            if field not in (1, 2, 3, 4) or field in feature or wire != (0 if field in (1, 3) else 2):
                raise ValueError('unexpected lifecycle feature field')
            feature[field] = (first, last, value)
        if feature.get(3, (None, None, None))[2] != 2 or 4 not in feature:
            raise ValueError('expected lifecycle line feature')
        line(raw, *feature[4][:2])
    if version == 2 and compressed:
        return data, False
    if version == 1:
        raw = raw[:at] + b'\x02' + raw[at+1:]
    return gzip.compress(raw, mtime=0), version == 1
