"""Publication-only legacy lineage projection. Never an acquisition input."""
import json
import math
from pathlib import Path
import re

SCHEMA = json.loads(Path(__file__).with_name('frequency-publication-lineage-schema.json').read_text())
STRINGS = frozenset(SCHEMA['string_fields'])
SCALARS = frozenset(SCHEMA['scalar_fields'])
HASHES = frozenset(key+'_sha256' for key in STRINGS | SCALARS)
MARKER = SCHEMA['alias_marker']


def project_lineage(value, display_url, url_start):
    if not isinstance(value, list):
        raise ValueError('invalid_publication_lineage_container')
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError('invalid_publication_lineage_record')
        record = {}
        for key, data in item.items():
            if key in STRINGS:
                if not isinstance(data, str):
                    raise ValueError('invalid_publication_lineage_identity')
                if key in SCHEMA['url_fields'] and url_start(data) and display_url(data) == '[invalid source URL]':
                    raise ValueError('invalid_publication_lineage_url')
                record[key] = data
            elif key in SCALARS:
                if not (data is None or isinstance(data, (str, bool, int)) or
                        isinstance(data, float) and math.isfinite(data)):
                    raise ValueError('invalid_publication_lineage_authority')
                record[key] = data
            elif key in HASHES:
                if not isinstance(data, str) or re.fullmatch(SCHEMA['hash_pattern'], data) is None:
                    raise ValueError('invalid_publication_lineage_hash')
                record[key] = data
        result.append(record)
    return result


def project_metadata(value, display_url, alias_compatible, url_start):
    """Retain an alias rejection across lossy display rendering; never emit true."""
    result = dict(value)
    if MARKER in result:
        if type(result[MARKER]) is not bool:
            raise ValueError('invalid_publication_alias_marker')
        if result[MARKER] is True:
            del result[MARKER]
    if ('lineage' in value or value.get('delivery') == 'direct') and 'source_resolution' not in value:
        if 'lineage' in value:
            result['lineage'] = project_lineage(value['lineage'], display_url, url_start)
        if value.get(MARKER) is False or not alias_compatible(value):
            result[MARKER] = False
    if 'catalogue_lineage' in value:
        result['catalogue_lineage'] = project_lineage(value['catalogue_lineage'], display_url, url_start)
    return result
