import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {restrictedTileOrigin} from '../styles/restricted-tiles.mjs';

export function restrictedPreviewPage(html, origin, fixture = false) {
  const tag = '<meta name="atlas-restricted-tile-origin" content="">';
  if (html.split(tag).length !== 2) throw new Error('Expected one restricted preview setting.');
  const parsed = restrictedTileOrigin(origin, origin);
  if (!parsed) throw new Error('Invalid restricted preview origin.');
  return html.replace(tag, () => `<meta name="atlas-restricted-tile-origin" content="${parsed}">` +
    (fixture ? '<meta name="atlas-restricted-tile-fixture" content="1">' : ''));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = (process.env.AUTH_BACKEND_ORIGIN ?? '').trim();
  if (origin) {
    if (!restrictedTileOrigin(origin)) throw new Error('AUTH_BACKEND_ORIGIN must be an HTTPS origin.');
    const html = await readFile('styles/index.html', 'utf8');
    await writeFile('styles/admin-preview.html', restrictedPreviewPage(html, origin));
  }
}
