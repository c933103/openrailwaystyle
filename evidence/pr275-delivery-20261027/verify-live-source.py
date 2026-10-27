import datetime, hashlib, json, re, subprocess, sys, urllib.request, urllib.parse

commit, checkout = sys.argv[1:3]
assert re.fullmatch(r'[0-9a-f]{40}', commit)
base = 'https://c933103.github.io/openrailwaystyle/'
version = '20261027-terrain-pitch-2'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected redirect: ' + str(code))
opener = urllib.request.build_opener(NoRedirect)
def get(path):
    url = urllib.parse.urljoin(base, path)
    assert urllib.parse.urlparse(url).netloc == 'c933103.github.io'
    with opener.open(urllib.request.Request(url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
        assert response.status == 200
        return response.read()
paths = ['app.mjs', 'cjk-font.mjs', 'data-check.html', 'data-check.mjs',
         'departures-ui.mjs', 'elevation.mjs', 'index.html', 'layer-semantics.mjs',
         'map-model.mjs', 'station-world.mjs', 'terrain-3d.mjs', 'sw.js', 'app.css']
rows = []
for path in paths:
    expected = subprocess.check_output(['git', '-C', checkout, 'show', commit + ':styles/' + path])
    actual = get(path + ('?v=' + version if path != 'sw.js' else ''))
    rows.append({'path': path, 'bytes': len(actual), 'sha256': hashlib.sha256(actual).hexdigest(),
                 'expected_sha256': hashlib.sha256(expected).hexdigest(), 'exact_source_match': actual == expected})
bundle = get('vendor/tile-labels.js?v=' + version)
source_url = 'https://github.com/c933103/openrailwaystyle/commit/' + commit
embedded = {'commit_present': commit.encode() in bundle, 'source_url_present': source_url.encode() in bundle,
            'release_present': version.encode() in bundle, 'bytes': len(bundle), 'sha256': hashlib.sha256(bundle).hexdigest()}
result = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'base': base,
          'expected_commit': commit, 'version': version, 'files': rows, 'embedded_build_identity': embedded,
          'scope': 'Read-only first-party HTTP source-byte and embedded build identity checks; no browser or provider requests.'}
print(json.dumps(result, indent=2))
assert all(r['exact_source_match'] for r in rows), 'A deployed first-party source file differs from the expected merge'
assert embedded['commit_present'] and embedded['source_url_present'] and embedded['release_present'], 'Deployed bundle build identity mismatch'
