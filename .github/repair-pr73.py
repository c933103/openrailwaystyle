from pathlib import Path
import json
import re
import subprocess
import tempfile


def git(*args, check=True):
    return subprocess.run(['git', *args], check=check, text=True, capture_output=True)


def replace_once(text, before, after):
    if before not in text:
        if after in text:
            return text
        raise SystemExit('Missing repair anchor: ' + before[:100])
    return text.replace(before, after, 1)


version = '20261003-104700'
main = git('rev-parse', 'origin/main').stdout.strip()
base = git('merge-base', 'HEAD', 'origin/main').stdout.strip()
print('INTEGRATION_BASE', base, 'MAIN', main, flush=True)
result = git('merge', '--no-ff', '--no-commit', 'origin/main', check=False)
print(result.stdout, result.stderr, flush=True)
conflicts = git('diff', '--name-only', '--diff-filter=U').stdout.splitlines()
print('CONFLICTS', conflicts, flush=True)
main_html = git('show', 'origin/main:styles/index.html').stdout
intro = re.search(r'^    <p><strong>Railway Atlas</strong> is .*?</p>$', main_html, re.M)
if not intro:
    raise SystemExit('Missing current main introduction')
for path in conflicts:
    if path in {'styles/world.style.json', 'styles/major-stations.geojson'}:
        git('checkout', '--ours', '--', path)
        git('add', '--', path)
        continue
    if path == 'scripts/build-style.mjs':
        Path(path).write_text(git('show', 'origin/main:' + path).stdout)
        git('add', '--', path)
        continue
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for stage in [2, 1, 3]:
            p = Path(tmp) / str(stage)
            text = git('show', f':{stage}:{path}').stdout
            if (path.startswith('styles/') and not Path(path).name.startswith('data-check')) or path.startswith('scripts/check-'):
                text = re.sub(r'\b20\d{6}-\d+\b', version, text)
            if path == 'styles/app.mjs' and stage in [1, 2]:
                # Main moved this legacy implementation into layer-semantics.mjs.
                text, count = re.subn(r'// The drawn base map: hidden under satellite imagery\.\n.*?(?=const OSM_API=|let majorStationData)', '', text, flags=re.S)
                if count != 1:
                    raise SystemExit('Expected one retired visibility block')
            if path == 'styles/index.html' and stage in [1, 2]:
                # Main's new project description wins; keep our separate station help.
                text, count = re.subn(r'^    <p><strong>Railway Atlas</strong> is .*?</p>$', lambda m: intro.group(), text, flags=re.M)
                if count != 1:
                    raise SystemExit('Expected one old introduction')
            p.write_text(text)
            parts.append(str(p))
        merged = git('merge-file', '-p', *parts, check=False)
        if merged.returncode:
            active = False
            for line in merged.stdout.splitlines():
                if line.startswith('<<<<<<<'):
                    active = True
                if active:
                    print(path + ': ' + line, flush=True)
                if line.startswith('>>>>>>>'):
                    active = False
            raise SystemExit('Unresolved semantic conflict: ' + path)
        Path(path).write_text(merged.stdout)
        git('add', '--', path)

# Use the atlas-owned composer, not the retired monolithic build script.
build = Path('scripts/build-style.mjs')
text = build.read_text()
if 'import {composeStyle}' not in text:
    raise SystemExit('Expected atlas-owned composition')
text = text.replace('validateStationCountries, majorStationsGeoJSON, selectMajorStations, curatedStationFilter', 'validateStationCountries, majorStationsGeoJSON')
text = re.sub(r'^const curatedFilter = curatedStationFilter\([^\n]+\);\n', '', text, flags=re.M)
text = text.replace('composeStyle({majorStationData, curatedFilter})', "composeStyle({majorStationData, curatedFilter: ['literal', true]})")
build.write_text(text)
for root in ['styles', 'scripts']:
    for p in Path(root).glob('*'):
        if not p.is_file() or p.suffix not in ['.mjs', '.html']:
            continue
        if p.name.startswith('data-check'):
            continue
        if root == 'scripts' and not p.name.startswith('check-'):
            continue
        text = p.read_text()
        updated = re.sub(r'\b20\d{6}-\d+\b', version, text)
        if updated != text:
            p.write_text(updated)

app = Path('styles/app.mjs')
text = app.read_text()
text = replace_once(text, 'let majorStationData,majorStationsPromise,majorStationNamesPromise;', 'let majorStationData,majorStationSearchData,majorStationsPromise,majorStationNamesPromise;')
text = replace_once(text,
    "source.setData({...data,features:data.features.map(f=>{const properties={...f.properties,...(names[majorStationObjectKey(f.properties)]||{})};return{...f,properties:{...properties,atlas_name:chooseName(properties,language),atlas_language:language,atlas_name_source:'osm'}};})});majorStationLanguages.set(source,language);",
    "const hydrated={...data,features:data.features.map(f=>{const properties={...f.properties,...(names[majorStationObjectKey(f.properties)]||{})};return{...f,properties:{...properties,atlas_name:chooseName(properties,language),atlas_language:language,atlas_name_source:'osm'}};})};majorStationSearchData=hydrated;source.setData(hydrated);majorStationLanguages.set(source,language);")
text = replace_once(text, "source === 'stationMajor' ? (majorStationData?.features || [])", "source === 'stationMajor' ? (majorStationSearchData?.features || [])")
text = replace_once(text,
    "if(!ready||language!==settings.language||source!==map.getSource('stationMajor')||majorStationLanguages.get(source)===language)return;",
    "if(!ready||!settings.stations||settings.background==='satellite'||map.getZoom()<3||map.getZoom()>=7||language!==settings.language||source!==map.getSource('stationMajor')||majorStationLanguages.get(source)===language)return;")
app.write_text(text)
source = json.loads(Path('styles/data-src/major-stations.json').read_text())
assert all(isinstance(e.get('name'), str) for e in source)
assert not any(k.startswith('name:') for e in source for k in e)
assert Path('scripts/style/compose-style.mjs').is_file()
assert Path('styles/layer-semantics.mjs').is_file()
assert not Path('styles/default.style.json').exists()
print('INTEGRATED_VERSION', version, flush=True)
