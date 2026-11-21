import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {parseStaticTileSettings, restrictedTileOrigin} from '../styles/restricted-tiles.mjs';

function replaceSetting(html, name, value) {
  const tag = `<meta name="${name}" content="">`;
  if (html.split(tag).length !== 2) throw new Error(`Expected one ${name} setting.`);
  return html.replace(tag, () => `<meta name="${name}" content="${value}">`);
}

export function restrictedPreviewPage(html, origin, fixture = false) {
  const parsed = restrictedTileOrigin(origin, origin);
  if (!parsed) throw new Error('Invalid restricted preview origin.');
  const page = replaceSetting(html, 'atlas-restricted-tile-origin', parsed);
  return fixture ? page.replace('</head>', '<meta name="atlas-restricted-tile-fixture" content="1">\n</head>') : page;
}

export function configureRestrictedMap(html, {repository, googleKey = '', historical = ''}) {
  const defaultSource = repository === 'c933103/openrailwaystyle' ? 'indian-open-maps' : '';
  const source = historical === 'off' ? '' : historical || defaultSource;
  if (!googleKey && !source) return html;
  const value = `${repository}|${googleKey}|${source}`;
  if (!parseStaticTileSettings(value)) throw new Error('Invalid browser test-background configuration.');
  return replaceSetting(html, 'atlas-static-tile-tests', value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = 'styles/index.html';
  const html = await readFile(path, 'utf8');
  const page = configureRestrictedMap(html, {
    repository: process.env.ADMIN_REPO,
    googleKey: process.env.GOOGLE_MAPS_API_KEY?.trim(),
    historical: process.env.SOVIET_TOPO_TILE_SERVICE?.trim(),
  });
  if (page !== html) await writeFile(path, page);
}
